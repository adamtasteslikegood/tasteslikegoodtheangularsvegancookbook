"""Integration tests for the fail-open session-log hooks (PreCompact, SessionEnd)."""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_HOOK = _REPO_ROOT / ".claude/hooks/precompact-session-log.sh"
_END_HOOK = _REPO_ROOT / ".claude/hooks/sessionend-session-log.sh"
_DIGEST = _REPO_ROOT / "scripts/pm/transcript_digest.py"


class TestPrecompactHook(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        (self.repo / ".claude").mkdir()
        (self.repo / "scripts/pm").mkdir(parents=True)
        (self.repo / "bin").mkdir()
        subprocess.run(
            ["git", "init", "-q", "-b", "hook-test"],
            cwd=self.repo,
            check=True,
        )

    def tearDown(self):
        self._tmp.cleanup()

    def run_hook(
        self, payload: dict, env: dict[str, str] | None = None, hook: Path = _HOOK
    ):
        hook_env = os.environ.copy()
        hook_env["CLAUDE_PROJECT_DIR"] = str(self.repo)
        if env:
            hook_env.update(env)
        return subprocess.run(
            ["bash", str(hook)],
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            env=hook_env,
            timeout=10,
            check=False,
        )

    def read_log(self):
        return (self.repo / ".claude/session-log-hook.log").read_text(encoding="utf-8")

    def test_missing_transcript_fails_open(self):
        result = self.run_hook(
            {"session_id": "missing", "transcript_path": "", "trigger": "auto"}
        )

        self.assertEqual(result.returncode, 0)
        self.assertIn("skip: no transcript", self.read_log())

    def test_missing_credentials_skip_before_model_call(self):
        transcript = self.repo / "session.jsonl"
        transcript.write_text("", encoding="utf-8")

        result = self.run_hook(
            {
                "session_id": "no-creds",
                "transcript_path": str(transcript),
                "trigger": "manual",
            },
            {
                "ATLASSIAN_URL": "",
                "ATLASSIAN_EMAIL": "",
                "ATLASSIAN_API_TOKEN": "",
            },
        )

        self.assertEqual(result.returncode, 0)
        self.assertIn("skip: missing Atlassian credentials", self.read_log())

    def test_recursion_guard_exits_without_touching_log(self):
        result = self.run_hook({}, {"CLAUDE_PM_SESSION_LOG_ACTIVE": "1"})

        self.assertEqual(result.returncode, 0)
        self.assertFalse((self.repo / ".claude/session-log-hook.log").exists())

    def test_valid_transcript_is_summarized_and_published(self):
        self.assert_summarized_and_published(_HOOK)

    def test_session_end_transcript_is_summarized_and_published(self):
        self.assert_summarized_and_published(_END_HOOK)

    def assert_summarized_and_published(self, hook: Path):
        shutil.copy2(_DIGEST, self.repo / "scripts/pm/transcript_digest.py")
        transcript = self.repo / "session.jsonl"
        transcript.write_text(
            json.dumps(
                {
                    "type": "user",
                    # Long enough to clear SessionEnd's 800-char substance gate.
                    "message": {"content": "Ship the release safely. " * 60},
                }
            )
            + "\n",
            encoding="utf-8",
        )

        claude = self.repo / "bin/claude"
        claude.write_text(
            "#!/usr/bin/env bash\n"
            # Record how the hook ran the summarizer: argv (brackets keep an
            # empty argument visible), the plugin dirs it inherited, its cwd.
            'printf "[%s]\\n" "$@" >"$CLAUDE_PROJECT_DIR/claude-argv.txt"\n'
            'printf "%s" "${CLAUDE_CODE_PLUGIN_DIRS-unset}" '
            '>"$CLAUDE_PROJECT_DIR/claude-plugins.txt"\n'
            'pwd >"$CLAUDE_PROJECT_DIR/claude-cwd.txt"\n'
            "printf '%s\\n' '## Summary' 'Release prepared.' "
            "'## Key decisions' '- None.' '## Files changed' '- None.' "
            "'## Follow-ups' '- None.' '## Gotchas' '- None.'\n",
            encoding="utf-8",
        )
        claude.chmod(claude.stat().st_mode | stat.S_IXUSR)

        publisher = self.repo / "scripts/pm/run_pm_script.sh"
        publisher.write_text(
            "#!/usr/bin/env bash\n"
            'while [ "$#" -gt 0 ]; do\n'
            '  if [ "$1" = "--file" ]; then cp "$2" "$CLAUDE_PROJECT_DIR/published.md"; exit 0; fi\n'
            "  shift\n"
            "done\n"
            "exit 1\n",
            encoding="utf-8",
        )
        publisher.chmod(publisher.stat().st_mode | stat.S_IXUSR)

        result = self.run_hook(
            {
                "session_id": "session-123",
                "transcript_path": str(transcript),
                "trigger": "auto",
                "reason": "other",
            },
            {
                "ATLASSIAN_URL": "tasteslikegood.atlassian.net",
                "ATLASSIAN_EMAIL": "test@example.com",
                "ATLASSIAN_API_TOKEN": "test-token",
                "PATH": f"{self.repo / 'bin'}:{os.environ['PATH']}",
                "CLAUDE_CODE_PLUGIN_DIRS": "/plugins/pr-lifecycle",
            },
            hook,
        )

        self.assertEqual(result.returncode, 0)
        published = self.repo / "published.md"
        deadline = time.monotonic() + 5
        while not published.exists() and time.monotonic() < deadline:
            time.sleep(0.05)

        self.assertTrue(published.exists(), self.read_log())
        body = published.read_text(encoding="utf-8")
        self.assertIn("# Session Log", body)
        self.assertIn("hook-test", body)
        self.assertIn("session-123", body)
        self.assertIn("Release prepared.", body)
        self.assertIn("OK: published session log", self.read_log())

        # KAN-419: the summarizer gets no tools, MCP, settings or plugins, and
        # runs outside the repo, so it cannot act on a prompt meant for the
        # session (it once committed and pushed to a PR).
        argv = (self.repo / "claude-argv.txt").read_text(encoding="utf-8").split("\n")
        self.assertNotIn("[--allowedTools]", argv)
        for flag in ("[--tools]", "[--setting-sources]"):
            self.assertEqual(argv[argv.index(flag) + 1], "[]", flag)
        self.assertIn("[--strict-mcp-config]", argv)
        plugins = (self.repo / "claude-plugins.txt").read_text(encoding="utf-8")
        self.assertEqual(plugins, "unset")
        cwd = Path((self.repo / "claude-cwd.txt").read_text(encoding="utf-8").strip())
        self.assertNotEqual(cwd.resolve(), self.repo.resolve())
        self.assertFalse(cwd.resolve().is_relative_to(self.repo.resolve()))


if __name__ == "__main__":
    unittest.main()
