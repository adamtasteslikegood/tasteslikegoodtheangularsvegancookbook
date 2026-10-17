"""Unit tests for check_claude_md_budget.py (KAN-417)."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_claude_md_budget as budget  # noqa: E402


def write(root: Path, name: str, text: str) -> None:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class FindImports(unittest.TestCase):
    def test_import_mid_line_and_in_bold(self):
        text = "- @docs/a.md\n**The full procedure is @docs/a.md**, driven by x.\n"
        self.assertEqual(budget.find_imports(text), [(1, "docs/a.md"), (2, "docs/a.md")])

    def test_code_spans_and_fences_are_not_imports(self):
        text = "An `@path` entry, `@angular/*` too.\n```\n@inside/fence.md\n```\n"
        self.assertEqual(budget.find_imports(text), [])

    def test_longer_fence_hides_a_shorter_inner_fence(self):
        text = "````markdown\n```\n@docs/example.md\n```\n````\n@docs/real.md\n"
        self.assertEqual(budget.find_imports(text), [(6, "docs/real.md")])

    def test_fence_closes_only_on_its_own_character(self):
        text = "~~~\n```\n@docs/example.md\n~~~\n@docs/real.md\n"
        self.assertEqual(budget.find_imports(text), [(5, "docs/real.md")])

    def test_escaped_space_is_part_of_the_path(self):
        self.assertEqual(budget.find_imports("See @Design\\ Docs/api.md, then go.\n"), [(1, "Design Docs/api.md")])

    def test_code_span_wrapping_onto_the_next_line_is_not_an_import(self):
        text = "Write `the path\n@docs/example.md` as shown.\n\n@docs/real.md\n"
        self.assertEqual(budget.find_imports(text), [(4, "docs/real.md")])

    def test_email_is_not_an_import(self):
        self.assertEqual(budget.find_imports("mail me at someone@example.org\n"), [])


class FindLinks(unittest.TestCase):
    def test_relative_links_only(self):
        text = "[a](./README.md) [b](https://x.org) [c](#anchor) [d](mailto:x@y) [e](docs/f.md#sec)\n"
        self.assertEqual(budget.find_links(text), [(1, "./README.md"), (1, "docs/f.md")])

    def test_angle_percent_and_paren_destinations(self):
        text = "[a](<docs/my file.md>) [b](docs/my%20file.md) [c](docs/f_(v2).md)\n"
        self.assertEqual(budget.find_links(text), [(1, "docs/my file.md"), (1, "docs/my file.md"), (1, "docs/f_(v2).md")])


    def test_authority_and_query_are_not_local_paths(self):
        text = "[a](//cdn.example.org/x.md) [b](docs/f.md?plain=1) [c](docs/g.md?x#y)\n"
        self.assertEqual(budget.find_links(text), [(1, "docs/f.md"), (1, "docs/g.md")])

    def test_site_relative_route_is_not_a_local_path(self):
        # [privacy](/privacy-policy) is an Express route, not a repo file;
        # pathlib's absolute-right-wins join would false-positive it as broken.
        text = "[privacy](/privacy-policy) [home](/) [doc](docs/x.md)\n"
        self.assertEqual(budget.find_links(text), [(1, "docs/x.md")])


class Walk(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_recurses_dedupes_and_sums(self):
        write(self.root, "CLAUDE.md", "- @docs/a.md\n**see @docs/a.md**,\n")
        write(self.root, "docs/a.md", "see @b.md\n")
        write(self.root, "docs/b.md", "back to @a.md\n")  # cycle
        report = budget.walk(self.root)
        self.assertEqual([name for name, _ in report.loaded], ["CLAUDE.md", "docs/a.md", "docs/b.md"])
        self.assertEqual(report.total, sum((self.root / n).stat().st_size for n, _ in report.loaded))
        self.assertEqual(budget.failures(report, 10_000), [])

    def test_missing_import_broken_link_and_budget_fail(self):
        write(self.root, "CLAUDE.md", "@Backend/CLAUDE.md and [x](nope.md)\n")
        report = budget.walk(self.root)
        problems = budget.failures(report, 10)
        self.assertEqual(report.missing_imports, ["CLAUDE.md:1 — @Backend/CLAUDE.md"])
        self.assertEqual(report.broken_links, ["CLAUDE.md:1 — nope.md"])
        self.assertTrue(problems[0].startswith("loaded bytes"))
        self.assertEqual(len(problems), 3)

    def test_escaped_space_import_resolves_and_missing_one_fails(self):
        write(self.root, "Design Docs/api.md", "x\n")
        write(self.root, "CLAUDE.md", "@Design\\ Docs/api.md @Design\\ Docs/gone.md\n")
        report = budget.walk(self.root)
        self.assertEqual([n for n, _ in report.loaded], ["CLAUDE.md", "Design Docs/api.md"])
        self.assertEqual(report.missing_imports, ["CLAUDE.md:1 — @Design Docs/gone.md"])

    def test_import_past_max_depth_is_reported(self):
        for i in range(budget.MAX_DEPTH + 1):
            write(self.root, f"d{i}.md", f"@d{i + 1}.md\n")
        write(self.root, f"d{budget.MAX_DEPTH + 1}.md", "end\n")
        write(self.root, "CLAUDE.md", "@d0.md\n")
        report = budget.walk(self.root)
        self.assertEqual(len(report.too_deep), 1)
        self.assertTrue(any("deeper than" in p for p in budget.failures(report, 10_000)))

    def test_cycle_closing_at_max_depth_is_not_too_deep(self):
        # CLAUDE.md -> c0 -> ... -> c4 -> c0: the edge back to c0 sits at MAX_DEPTH.
        n = budget.MAX_DEPTH
        for i in range(n):
            write(self.root, f"c{i}.md", f"@c{(i + 1) % n}.md\n")
        write(self.root, "CLAUDE.md", "@c0.md\n")
        report = budget.walk(self.root)
        self.assertEqual(len(report.loaded), n + 1)
        self.assertEqual(report.too_deep, [])

    def test_depth_is_the_shortest_path_whatever_the_import_order(self):
        # deep.md is MAX_DEPTH + 1 hops down the first chain but one hop from CLAUDE.md.
        chain = [f"d{i}.md" for i in range(budget.MAX_DEPTH)]
        for here, nxt in zip(chain, chain[1:] + ["deep.md"]):
            write(self.root, here, f"@{nxt}\n")
        write(self.root, "deep.md", "@leaf.md\n")
        write(self.root, "leaf.md", "end\n")
        write(self.root, "CLAUDE.md", "@d0.md\n@deep.md\n")
        report = budget.walk(self.root)
        self.assertEqual(report.too_deep, [])
        self.assertIn("leaf.md", [n for n, _ in report.loaded])

    def test_user_level_import_is_skipped(self):
        write(self.root, "CLAUDE.md", "@~/.claude/personal.md\n")
        report = budget.walk(self.root)
        self.assertEqual(report.skipped_imports, ["CLAUDE.md:1 — @~/.claude/personal.md"])
        self.assertEqual(budget.failures(report, 10_000), [])

    def test_absolute_import_is_skipped_not_walked(self):
        # @/etc/hosts would escape the repo through pathlib's absolute-right-wins join;
        # skip it the same way as ~/... instead of charging it against the budget.
        write(self.root, "CLAUDE.md", "@/etc/hosts\n")
        report = budget.walk(self.root)
        self.assertEqual(report.skipped_imports, ["CLAUDE.md:1 — @/etc/hosts"])
        self.assertEqual([n for n, _ in report.loaded], ["CLAUDE.md"])
        self.assertEqual(budget.failures(report, 10_000), [])

    def test_drift_reports_lines_naming_deleted_paths(self):
        git = ["git", "-c", "user.email=t@t", "-c", "user.name=t"]
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        write(self.root, "old/tool.sh", "x\n")
        write(self.root, "CLAUDE.md", "Run `old/tool.sh` first.\n")
        subprocess.run(git + ["add", "-A"], cwd=self.root, check=True)
        subprocess.run(git + ["commit", "-qm", "add"], cwd=self.root, check=True)
        subprocess.run(git + ["rm", "-q", "old/tool.sh"], cwd=self.root, check=True)
        subprocess.run(git + ["commit", "-qm", "rm"], cwd=self.root, check=True)
        report = budget.walk(self.root)
        budget.find_drift(self.root, report, budget.deleted_paths(self.root, 7))
        self.assertEqual(report.drift, ["CLAUDE.md:1 — names `old/tool.sh`, deleted or renamed"])

    def test_drift_matches_paths_relative_to_the_naming_file(self):
        write(self.root, "CLAUDE.md", "@scripts/RUNBOOK.md\n")
        write(self.root, "scripts/RUNBOOK.md", "Then run `./train-run.sh`.\n")
        report = budget.walk(self.root)
        budget.find_drift(self.root, report, {"scripts/train-run.sh"})
        self.assertEqual(report.drift, ["scripts/RUNBOOK.md:1 — names `scripts/train-run.sh`, deleted or renamed"])

    def test_drift_matches_whole_path_tokens_only(self):
        write(self.root, "CLAUDE.md", "Read weekly-report.md and docs/report.md.bak.\nThen report.md.\n")
        report = budget.walk(self.root)
        budget.find_drift(self.root, report, {"report.md"})
        self.assertEqual(report.drift, ["CLAUDE.md:2 — names `report.md`, deleted or renamed"])

    def test_plus_is_part_of_a_longer_name(self):
        write(self.root, "CLAUDE.md", "Keep report.md+backup and weekly+report.md.\n")
        report = budget.walk(self.root)
        budget.find_drift(self.root, report, {"report.md"})
        self.assertEqual(report.drift, [])

    def test_drift_matches_paths_with_spaces_parens_and_plus(self):
        write(self.root, "CLAUDE.md", "See `docs/f_(v2).md`.\nRead Design Docs/api.md now.\nAnd docs/api+auth.md, too.\n")
        report = budget.walk(self.root)
        budget.find_drift(self.root, report, {"docs/f_(v2).md", "Design Docs/api.md", "docs/api+auth.md"})
        self.assertEqual([d.split(" — ")[0] for d in report.drift], ["CLAUDE.md:1", "CLAUDE.md:2", "CLAUDE.md:3"])

    def test_drift_matches_parent_relative_paths(self):
        write(self.root, "CLAUDE.md", "@docs/guide.md\n")
        write(self.root, "docs/guide.md", "Run `../scripts/old.sh` first.\n")
        report = budget.walk(self.root)
        budget.find_drift(self.root, report, {"scripts/old.sh"})
        self.assertEqual(report.drift, ["docs/guide.md:1 — names `scripts/old.sh`, deleted or renamed"])

    def test_deleted_paths_reads_names_git_would_quote(self):
        git = ["git", "-c", "user.email=t@t", "-c", "user.name=t"]
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        write(self.root, "docs/café notes.md", "x\n")
        write(self.root, "docs/old.md", "x\n")
        subprocess.run(git + ["add", "-A"], cwd=self.root, check=True)
        subprocess.run(git + ["commit", "-qm", "add"], cwd=self.root, check=True)
        subprocess.run(git + ["rm", "-q", "docs/café notes.md"], cwd=self.root, check=True)
        subprocess.run(git + ["mv", "docs/old.md", "docs/new.md"], cwd=self.root, check=True)
        subprocess.run(git + ["commit", "-qm", "rm"], cwd=self.root, check=True)
        self.assertEqual(budget.deleted_paths(self.root, 7), {"docs/café notes.md", "docs/old.md"})

    def test_deleted_paths_skips_names_that_are_not_utf8(self):
        git = ["git", "-c", "user.email=t@t", "-c", "user.name=t"]
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        bad = bytes(self.root) + b"/bad\xff.md"
        with open(bad, "wb") as fh:
            fh.write(b"x\n")
        write(self.root, "gone.md", "x\n")
        subprocess.run(git + ["add", "-A"], cwd=self.root, check=True)
        subprocess.run(git + ["commit", "-qm", "add"], cwd=self.root, check=True)
        subprocess.run(git + ["rm", "-rq", "--", "."], cwd=self.root, check=True)
        subprocess.run(git + ["commit", "-qm", "rm"], cwd=self.root, check=True)
        self.assertEqual(budget.deleted_paths(self.root, 7), {"gone.md"})

    def test_deleted_paths_includes_a_merge_resolution_delete(self):
        git = ["git", "-c", "user.email=t@t", "-c", "user.name=t"]
        run = lambda *a: subprocess.run(git + list(a), cwd=self.root, check=True, capture_output=True)
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=self.root, check=True)
        write(self.root, "keep.md", "x\n")
        write(self.root, "doomed.md", "x\n")
        run("add", "-A"); run("commit", "-qm", "base")
        run("switch", "-qc", "side"); write(self.root, "side.md", "x\n"); run("add", "-A"); run("commit", "-qm", "side")
        run("switch", "-q", "main"); run("merge", "--no-ff", "--no-commit", "side")
        run("rm", "-q", "doomed.md"); run("commit", "-qm", "merge, dropping doomed.md")
        self.assertEqual(budget.deleted_paths(self.root, 7), {"doomed.md"})

    def test_audit_crash_exits_2_not_findings(self):
        write(self.root, "CLAUDE.md", "no git here\n")  # --drift needs a git repository
        self.assertEqual(budget.main(["--root", str(self.root), "--drift", "7"]), 2)


class RealTree(unittest.TestCase):
    # Parser oracle, not a second budget gate: the files this resolves must be the
    # files Claude Code loads (KAN-416). A new import fails here by name.
    def test_repository_claude_md_imports_only_the_runbook(self):
        root = Path(__file__).resolve().parents[2]
        report = budget.walk(root)
        self.assertEqual([name for name, _ in report.loaded], ["CLAUDE.md", "scripts/release/RUNBOOK.md"])
        self.assertEqual(report.missing_imports, [])
        self.assertEqual(report.broken_links, [])


if __name__ == "__main__":
    unittest.main()
