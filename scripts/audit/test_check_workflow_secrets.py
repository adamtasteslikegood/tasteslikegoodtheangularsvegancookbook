"""Tests for check_workflow_secrets.py (KAN-300). Stdlib only, no network.

Run: python3 -m unittest scripts/audit/test_check_workflow_secrets.py
"""

from __future__ import annotations

import io
import re
import subprocess
import sys
from contextlib import redirect_stdout
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import check_workflow_secrets as cws  # noqa: E402

PRESENCE = "SECRET_PRESENT_{n}: ${{{{ secrets.{n} != '' }}}}"


def gate_text(names: list[str], extra: str = "") -> str:
    block = "\n".join("          " + PRESENCE.format(n=n) for n in names)
    return (
        "jobs:\n  workflow-secrets:\n    steps:\n      - env:\n"
        f"          {cws.BLOCK_BEGIN}\n{block}\n          {cws.BLOCK_END}\n" + extra
    )


class ExtractionTest(unittest.TestCase):
    def test_accepts_lowercase_letters_and_digits(self):
        text = "a: ${{ secrets.foo_1 }}\nb: ${{ secrets.ABC9 }}\nc: ${{ secrets.x9y }}"
        self.assertEqual(cws.extract_names(text), {"FOO_1", "ABC9", "X9Y"})

    def test_pattern_keeps_the_authoritative_name_class(self):
        self.assertIn("([A-Za-z0-9_]+)", cws.REFERENCE_RE.pattern)
        self.assertIn("secrets", cws.REFERENCE_RE.pattern)

    def test_context_name_is_case_insensitive_and_whitespace_tolerant(self):
        for ref in ("${{ SeCrEtS.NEW_TOKEN }}", "${{ SECRETS . NEW_TOKEN }}", "${{ secrets .new_token }}"):
            with self.subTest(ref=ref):
                self.assertEqual(cws.extract_names(ref), {"NEW_TOKEN"})

    def test_names_compare_case_insensitively(self):
        self.assertEqual(cws.extract_names("${{ secrets.Gemini_Api_Key }}"), {"GEMINI_API_KEY"})

    def test_every_reference_in_an_expression_is_found(self):
        text = "t: ${{ secrets.A || secrets.B || secrets.GITHUB_TOKEN }}"
        self.assertEqual(cws.extract_names(text), {"A", "B", "GITHUB_TOKEN"})

    def test_filenames_containing_secrets_are_not_references(self):
        text = (
            "require('/tmp/gh-aw/actions/redact_secrets.cjs')\n"
            "cat redact-secrets.json path/secrets.yml"
        )
        self.assertEqual(cws.extract_names(text), set())


class ExemptionTest(unittest.TestCase):
    def test_github_token_is_the_builtin_exemption(self):
        self.assertEqual(cws.BUILTIN_EXEMPT, "GITHUB_TOKEN")
        self.assertTrue(cws.is_exempt("GITHUB_TOKEN"))
        self.assertTrue(cws.is_exempt("github_token"))

    def test_exemption_is_exact_name_only(self):
        for name in ("GITHUB_TOKEN_X", "GH_AW_GITHUB_TOKEN", "MY_GITHUB_TOKEN", "GITHUB_TOKEN2", "GITHUB"):
            with self.subTest(name=name):
                self.assertFalse(cws.is_exempt(name))

    def test_scan_drops_only_github_token(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "w.yml").write_text(
                "x: ${{ secrets.GITHUB_TOKEN }}\ny: ${{ secrets.GITHUB_TOKEN_X }}\n"
                "z: ${{ secrets.GH_AW_GITHUB_TOKEN }}\n"
            )
            referenced = set(cws.scan(root, root / "pr-gate.yml").where)
        self.assertEqual(referenced, {"GITHUB_TOKEN_X", "GH_AW_GITHUB_TOKEN"})

    def test_no_optional_secret_lacks_a_reason_or_shadows_the_exemption(self):
        self.assertNotIn(cws.BUILTIN_EXEMPT, cws.OPTIONAL_SECRETS)
        for name, entry in cws.OPTIONAL_SECRETS.items():
            with self.subTest(name=name):
                self.assertTrue(entry.reason.strip())


class DriftTest(unittest.TestCase):
    """The presence block must equal the referenced set, in both directions."""

    def setUp(self):
        # Temp trees do not reference the real optional names; isolate from them.
        patcher = mock.patch.dict(cws.OPTIONAL_SECRETS, {}, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def scan_tree(self, files: dict[str, str]):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        for name, text in files.items():
            (root / name).write_text(text)
        return cws.scan(root, root / "pr-gate.yml")

    def test_matching_block_passes(self):
        scanned = self.scan_tree({"pr-gate.yml": gate_text(["A"]), "w.yml": "${{ secrets.a }}"})
        self.assertEqual(cws.static_problems(*scanned), [])

    def test_reference_without_presence_line_fails(self):
        scanned = self.scan_tree({"pr-gate.yml": gate_text(["A"]), "w.yml": "${{ secrets.A }} ${{ secrets.NEW }}"})
        problems = cws.static_problems(*scanned)
        self.assertEqual(len(problems), 1)
        self.assertIn("NEW: referenced by a workflow but has no presence line", problems[0])

    def test_stale_presence_line_fails(self):
        # The line itself mentions the secret; it must not count as a reference.
        scanned = self.scan_tree({"pr-gate.yml": gate_text(["A", "OLD"]), "w.yml": "${{ secrets.A }}"})
        problems = cws.static_problems(*scanned)
        self.assertEqual(len(problems), 1)
        self.assertIn("OLD: presence line in pr-gate.yml but no workflow references it", problems[0])

    def test_missing_block_fails(self):
        scanned = self.scan_tree({"pr-gate.yml": "jobs: {}\n", "w.yml": "${{ secrets.A }}"})
        self.assertTrue(any("no presence block" in p for p in cws.static_problems(*scanned)))

    def test_presence_key_must_match_its_secret(self):
        bad = gate_text([]).replace(
            cws.BLOCK_END, "SECRET_PRESENT_A: ${{ secrets.B != '' }}\n          " + cws.BLOCK_END
        )
        with self.assertRaises(cws.InspectError):
            self.scan_tree({"pr-gate.yml": bad})

    def test_unrecognised_block_line_is_an_inspect_error(self):
        bad = gate_text([]).replace(cws.BLOCK_END, "SECRET_PRESENT_A: ${{ secrets.A }}\n          " + cws.BLOCK_END)
        with self.assertRaises(cws.InspectError):
            self.scan_tree({"pr-gate.yml": bad})

    def test_environment_scoped_job_is_flagged(self):
        scanned = self.scan_tree({
            "pr-gate.yml": gate_text(["A"]),
            "deploy.yml": "jobs:\n  d:\n    environment: production\n    env:\n      K: ${{ secrets.A }}\n",
        })
        problems = cws.static_problems(*scanned)
        self.assertEqual(len(problems), 1)
        self.assertIn("environment:", problems[0])
        self.assertIn("deploy.yml", problems[0])

    def test_stale_optional_entry_fails(self):
        cws.OPTIONAL_SECRETS["GONE"] = cws.OptionalSecret("was optional once", ("w.yml",))
        scanned = self.scan_tree({"pr-gate.yml": gate_text(["A"]), "w.yml": "${{ secrets.A }}"})
        self.assertEqual(
            cws.static_problems(*scanned),
            ["GONE: listed in OPTIONAL_SECRETS but no workflow references it"],
        )

    def test_referenced_optional_entry_passes(self):
        cws.OPTIONAL_SECRETS["A"] = cws.OptionalSecret("guarded by an if:", ("w.yml",))
        scanned = self.scan_tree({"pr-gate.yml": gate_text(["A"]), "w.yml": "${{ secrets.A }}"})
        self.assertEqual(cws.static_problems(*scanned), [])

    def test_optional_entry_without_reason_fails(self):
        cws.OPTIONAL_SECRETS["A"] = cws.OptionalSecret("  ", ("w.yml",))
        scanned = self.scan_tree({"pr-gate.yml": gate_text(["A"]), "w.yml": "${{ secrets.A }}"})
        self.assertEqual(cws.static_problems(*scanned), ["A: optional-secret entry has no reason"])

    def test_nested_environment_input_is_not_flagged(self):
        scanned = self.scan_tree({
            "pr-gate.yml": gate_text(["A"]),
            "w.yml": (
                "jobs:\n  d:\n    runs-on: ubuntu-latest\n    steps:\n"
                "      - uses: some/action@v1\n        with:\n          environment: production\n"
                "        env:\n          K: ${{ secrets.A }}\n"
            ),
        })
        self.assertEqual(cws.static_problems(*scanned), [])

    def test_job_level_environment_is_found_per_job(self):
        text = (
            "on: push\njobs:\n  build:\n    runs-on: x\n    with:\n      environment: no\n"
            "  deploy:\n    environment:\n      name: production\n"
        )
        self.assertEqual(cws.job_level_environment_jobs(text), ["deploy"])

    def test_bracket_access_is_rejected(self):
        for ref in (
            "${{ secrets['FOO'] }}",
            '${{ secrets["FOO"] }}',
            "${{ secrets[matrix.name] }}",
            "${{ SECRETS ['FOO'] }}",
        ):
            with self.subTest(ref=ref):
                scanned = self.scan_tree({"pr-gate.yml": gate_text(["A"]), "w.yml": "${{ secrets.A }} " + ref})
                problems = cws.static_problems(*scanned)
                self.assertEqual(len(problems), 1)
                self.assertIn("w.yml: index access to the secrets context", problems[0])

    def test_optional_name_referenced_outside_its_files_fails(self):
        cws.OPTIONAL_SECRETS["A"] = cws.OptionalSecret("guarded in w.yml", ("w.yml",))
        scanned = self.scan_tree({
            "pr-gate.yml": gate_text(["A"]),
            "w.yml": "${{ secrets.A }}",
            "unguarded.yml": "${{ secrets.A }}",
        })
        problems = cws.static_problems(*scanned)
        self.assertEqual(len(problems), 1)
        self.assertIn("A: optional only in w.yml, but also referenced in unguarded.yml", problems[0])

    def test_optional_entry_without_files_fails(self):
        cws.OPTIONAL_SECRETS["A"] = cws.OptionalSecret("guarded", ())
        scanned = self.scan_tree({"pr-gate.yml": gate_text(["A"]), "w.yml": "${{ secrets.A }}"})
        self.assertEqual(
            cws.static_problems(*scanned),
            ["A: optional-secret entry names no files"],
        )

    def test_only_yaml_files_are_scanned(self):
        scanned = self.scan_tree({
            "pr-gate.yml": gate_text(["A"]),
            "w.yml": "${{ secrets.A }}",
            "prompt.md": "Example: ${{ secrets.ONLY_IN_PROSE }}",
        })
        self.assertEqual(cws.static_problems(*scanned), [])

    def test_emit_block_reuses_the_existing_indent(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        gate = Path(tmp.name) / "pr-gate.yml"
        gate.write_text("jobs:\n" + "      " + cws.BLOCK_BEGIN + "\n      " + cws.BLOCK_END + "\n")
        self.assertEqual(cws.current_block_indent(gate), "      ")
        self.assertEqual(cws.current_block_indent(Path(tmp.name) / "missing.yml"), "          ")

    def test_bare_secrets_context_is_rejected(self):
        for ref in ("${{ toJSON(secrets) }}", "${{ SECRETS }}", "${{ fromJSON(toJSON( secrets )) }}"):
            with self.subTest(ref=ref):
                scanned = self.scan_tree({"pr-gate.yml": gate_text(["A"]), "w.yml": "${{ secrets.A }}\nx: " + ref})
                problems = cws.static_problems(*scanned)
                self.assertEqual(len(problems), 1)
                self.assertIn("w.yml: the whole secrets context is used", problems[0])

    def test_word_secrets_outside_expressions_or_in_literals_is_fine(self):
        text = (
            "# forks see no secrets at all\n"
            "run: echo \"rotate secrets weekly\"\n"
            "x: ${{ contains(github.event.head_commit.message, 'secrets') }}\n"
        )
        self.assertFalse(cws.uses_bare_context(text))

    def test_emit_block_round_trips(self):
        names = {"A", "B_2"}
        lines = cws.emit_block(names).splitlines()
        self.assertEqual(lines[0].strip(), cws.BLOCK_BEGIN)
        self.assertEqual(lines[-1].strip(), cws.BLOCK_END)
        self.assertEqual(cws.parse_presence_block(lines[1:-1]), names)


class PresenceTest(unittest.TestCase):
    def test_all_true_passes(self):
        env = {"SECRET_PRESENT_A": "true", "SECRET_PRESENT_B": "true"}
        configured = cws.configured_from_env({"A", "B"}, env)
        self.assertEqual(cws.missing_problems({"A", "B"}, configured), [])

    def test_deliberately_missing_secret_fails(self):
        env = {"SECRET_PRESENT_A": "true", "SECRET_PRESENT_NOPE": "false"}
        configured = cws.configured_from_env({"A", "NOPE"}, env)
        self.assertEqual(
            cws.missing_problems({"A", "NOPE"}, configured),
            ["NOPE: referenced by a workflow but not configured"],
        )

    def test_missing_optional_secret_is_a_notice_not_a_failure(self):
        with mock.patch.dict(cws.OPTIONAL_SECRETS, {"OPT": cws.OptionalSecret("guarded", ("w.yml",))}, clear=True):
            env = {"SECRET_PRESENT_A": "true", "SECRET_PRESENT_OPT": "false"}
            configured = cws.configured_from_env({"A", "OPT"}, env)
            self.assertEqual(cws.missing_problems({"A", "OPT"}, configured), [])
            self.assertEqual(
                cws.optional_notices({"A", "OPT"}, configured),
                ["OPT: optional and not configured (guarded)"],
            )

    def test_present_optional_secret_gives_no_notice(self):
        with mock.patch.dict(cws.OPTIONAL_SECRETS, {"OPT": cws.OptionalSecret("guarded", ("w.yml",))}, clear=True):
            self.assertEqual(cws.optional_notices({"OPT"}, {"OPT"}), [])

    def test_unexported_presence_variable_is_an_inspect_error(self):
        with self.assertRaises(cws.InspectError):
            cws.configured_from_env({"A"}, {})

    def test_presence_value_must_be_a_boolean_string(self):
        with self.assertRaises(cws.InspectError):
            cws.configured_from_env({"A"}, {"SECRET_PRESENT_A": "hunter2"})


class MainTest(unittest.TestCase):
    def run_main(self, files: dict[str, str], argv: list[str], environ: dict[str, str]):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        for name, text in files.items():
            (root / name).write_text(text)
        out = io.StringIO()
        with mock.patch.object(cws, "WORKFLOWS", root), \
                mock.patch.object(cws, "GATE_FILE", root / "pr-gate.yml"), \
                mock.patch.dict(cws.OPTIONAL_SECRETS, {}, clear=True), \
                mock.patch.dict(cws.os.environ, environ, clear=True), \
                redirect_stdout(out):
            code = cws.main(argv)
        return code, out.getvalue()

    def test_env_inspect_failure_still_reports_static_drift(self):
        code, out = self.run_main(
            {"pr-gate.yml": gate_text(["A"]), "w.yml": "${{ secrets.A }} ${{ secrets.NEW }}"},
            ["--env"],
            {"SECRET_PRESENT_A": "true"},
        )
        self.assertEqual(code, 2)
        self.assertIn("NEW: referenced by a workflow but has no presence line", out)

    def test_env_mode_fails_on_a_missing_secret(self):
        code, out = self.run_main(
            {"pr-gate.yml": gate_text(["A"]), "w.yml": "${{ secrets.A }}"},
            ["--env"],
            {"SECRET_PRESENT_A": "false"},
        )
        self.assertEqual(code, 1)
        self.assertIn("A: referenced by a workflow but not configured", out)

    def test_env_inspect_failure_prints_the_referenced_names(self):
        code, out = self.run_main(
            {"pr-gate.yml": gate_text(["A"]), "w.yml": "${{ secrets.A }}"},
            ["--env"],
            {},
        )
        self.assertEqual(code, 2)
        self.assertIn("1 secret name(s) referenced (excluding GITHUB_TOKEN): A", out)

    def test_gh_mode_counts_repository_secrets_only(self):
        calls = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            return subprocess.CompletedProcess(cmd, 0, stdout='[{"name": "foo"}]', stderr="")

        with mock.patch.object(cws.subprocess, "run", side_effect=fake_run):
            self.assertEqual(cws.configured_from_gh(), {"FOO"})
        self.assertEqual(calls, [["gh", "secret", "list", "--json", "name"]])

    def test_gh_non_json_output_is_an_inspect_error(self):
        done = subprocess.CompletedProcess(["gh"], 0, stdout="warning: banner\n", stderr="")
        with mock.patch.object(cws.subprocess, "run", return_value=done):
            with self.assertRaises(cws.InspectError):
                cws.configured_from_gh()


class RepositoryTest(unittest.TestCase):
    """Against the real .github/workflows tree."""

    def test_real_presence_block_matches_real_references(self):
        self.assertEqual(cws.static_problems(*cws.scan(cws.WORKFLOWS, cws.GATE_FILE)), [])

    def test_every_optional_secret_is_scoped_to_files(self):
        for name, entry in cws.OPTIONAL_SECRETS.items():
            with self.subTest(name=name):
                self.assertTrue(entry.files)
                for f in entry.files:
                    self.assertTrue((cws.WORKFLOWS / f).is_file(), f)

    def test_the_six_agreed_optional_secrets_are_listed(self):
        self.assertEqual(
            set(cws.OPTIONAL_SECRETS),
            {
                "ANTHROPIC_API_KEY",
                "GCP_WORKLOAD_IDENTITY_PROVIDER",
                "GCP_SERVICE_ACCOUNT",
                "QODANA_CONFIGURATIONS_TOKEN",
                "GH_AW_GITHUB_TOKEN",
                "GH_AW_GITHUB_MCP_SERVER_TOKEN",
            },
        )

    def test_gate_needs_the_job(self):
        text = cws.GATE_FILE.read_text()
        gate = text[text.index("\n  gate:\n"):]
        needs = gate[gate.index("needs:"):gate.index("if: always()")]
        self.assertRegex(needs, r"(?m)^\s+- workflow-secrets$")

    def test_presence_step_skips_dependabot_and_fork_prs(self):
        text = cws.GATE_FILE.read_text()
        step = text[text.index("- name: Every referenced secret is configured"):text.index(cws.BLOCK_BEGIN)]
        condition = re.sub(r"\s+", " ", step)
        for clause in (
            "github.event.pull_request.head.repo.full_name == github.repository",
            "github.actor != 'dependabot[bot]'",
            "github.event.pull_request.user.login != 'dependabot[bot]'",
        ):
            with self.subTest(clause=clause):
                self.assertIn(clause, condition)


if __name__ == "__main__":
    unittest.main()
