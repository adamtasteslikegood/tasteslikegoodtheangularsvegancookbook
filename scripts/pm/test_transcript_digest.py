"""Tests for the transcript digest that feeds the PreCompact session-log hook.

This module is a critical dependency of the hook: if it silently stops extracting
(say, the transcript JSONL shape drifts), the hook keeps "succeeding" and quietly
publishes an empty or contentless session log. That failure is invisible, which is
exactly the kind worth pinning down with tests.

The load-bearing behaviours:
  * tool RESULTS are dropped (they are the bulk of the bytes and carry no decisions)
  * a 'user' turn that is only a tool_result is NOT mistaken for the human talking
  * harness-injected <system-reminder> turns are not mistaken for the human either
  * assistant prose survives; tool_use blocks become names + file/command extraction

Standard library only, same as the other scripts/pm tests:
    python3 -m unittest discover -s scripts/pm -p 'test_*.py'
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from transcript_digest import clean_user_text, digest  # noqa: E402


def _line(entry: dict) -> str:
    return json.dumps(entry)


def _user(content) -> str:
    return _line({"type": "user", "message": {"content": content}})


def _assistant(content) -> str:
    return _line({"type": "assistant", "message": {"content": content}})


def _write(lines: list[str]) -> Path:
    tmp = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, encoding="utf-8")
    tmp.write("\n".join(lines) + "\n")
    tmp.close()
    return Path(tmp.name)


class TestDigestExtraction(unittest.TestCase):
    def setUp(self):
        self._paths: list[Path] = []

    def tearDown(self):
        for p in self._paths:
            p.unlink(missing_ok=True)

    def digest_of(self, lines: list[str], max_chars: int = 40000) -> dict:
        path = _write(lines)
        self._paths.append(path)
        return digest(path, max_chars)

    def test_human_ask_and_assistant_prose_survive(self):
        result = self.digest_of(
            [
                _user("fix the daemon watcher lockfile"),
                _assistant([{"type": "text", "text": "Electing a single watcher via flock."}]),
            ]
        )
        self.assertIn("fix the daemon watcher lockfile", result["turns"])
        self.assertIn("Electing a single watcher via flock.", result["turns"])
        self.assertEqual(result["user_asks"], ["fix the daemon watcher lockfile"])

    def test_tool_results_are_dropped(self):
        """The whole point of the digest: tool output is the bulk of the bytes."""
        noise = "SECRET_TOOL_OUTPUT " * 500
        result = self.digest_of(
            [
                _user("what changed?"),
                _assistant([{"type": "text", "text": "Reading the file."}]),
                _user([{"type": "tool_result", "tool_use_id": "t1", "content": noise}]),
            ]
        )
        self.assertNotIn("SECRET_TOOL_OUTPUT", result["turns"])
        # A tool_result-only turn must not be counted as a human ask.
        self.assertEqual(result["user_asks"], ["what changed?"])

    def test_system_reminder_turns_are_not_treated_as_human(self):
        result = self.digest_of(
            [
                _user("<system-reminder>injected harness context</system-reminder>"),
                _user("the real ask"),
            ]
        )
        self.assertEqual(result["user_asks"], ["the real ask"])
        self.assertNotIn("injected harness context", result["turns"])

    def test_files_touched_extracted_from_edit_and_write(self):
        result = self.digest_of(
            [
                _assistant(
                    [
                        {"type": "tool_use", "name": "Edit", "input": {"file_path": "a/one.py"}},
                        {"type": "tool_use", "name": "Write", "input": {"file_path": "b/two.ts"}},
                        {"type": "tool_use", "name": "Read", "input": {"file_path": "c/skip.md"}},
                    ]
                )
            ]
        )
        self.assertEqual(result["files_touched"], ["a/one.py", "b/two.ts"])
        # Read is not a mutation — it must not appear as a file "touched".
        self.assertNotIn("c/skip.md", result["files_touched"])

    def test_files_touched_are_deduped(self):
        result = self.digest_of(
            [
                _assistant([{"type": "tool_use", "name": "Edit", "input": {"file_path": "same.py"}}]),
                _assistant([{"type": "tool_use", "name": "Edit", "input": {"file_path": "same.py"}}]),
            ]
        )
        self.assertEqual(result["files_touched"], ["same.py"])

    def test_bash_commands_keep_only_the_first_line(self):
        result = self.digest_of(
            [
                _assistant(
                    [
                        {
                            "type": "tool_use",
                            "name": "Bash",
                            "input": {"command": "git status --short\necho 'second line'"},
                        }
                    ]
                )
            ]
        )
        self.assertEqual(result["commands"], ["git status --short"])

    def test_tool_use_counts_are_tallied(self):
        result = self.digest_of(
            [
                _assistant(
                    [
                        {"type": "tool_use", "name": "Bash", "input": {"command": "ls"}},
                        {"type": "tool_use", "name": "Bash", "input": {"command": "pwd"}},
                        {"type": "tool_use", "name": "Edit", "input": {"file_path": "x.py"}},
                    ]
                )
            ]
        )
        self.assertEqual(result["tools_used"], {"Bash": 2, "Edit": 1})

    def test_string_content_is_handled_not_just_block_lists(self):
        """Older transcript entries carry a bare string instead of typed blocks."""
        result = self.digest_of([_user("plain string ask")])
        self.assertIn("plain string ask", result["turns"])

    def test_malformed_lines_are_skipped_not_fatal(self):
        path = _write([_user("good ask")])
        self._paths.append(path)
        with path.open("a", encoding="utf-8") as fh:
            fh.write("{not valid json\n\n")
        result = digest(path, 40000)
        self.assertIn("good ask", result["turns"])

    def test_empty_transcript_yields_empty_digest_without_raising(self):
        result = self.digest_of([])
        self.assertEqual(result["turns"], "")
        self.assertEqual(result["turn_count"], 0)
        self.assertEqual(result["files_touched"], [])


class TestHarnessInjectedTurnsAreNotTheHuman(unittest.TestCase):
    """The transcript records lots of role=user entries the human never typed.

    Regression: a real digest fed Haiku an entire injected SKILL.md body and a
    pile of <bash-stdout> dumps as '### HUMAN' turns. That both burned the digest
    budget and misled the summarizer about what was actually asked for.
    """

    def setUp(self):
        self._paths: list[Path] = []

    def tearDown(self):
        for p in self._paths:
            p.unlink(missing_ok=True)

    def digest_of(self, lines: list[str]) -> dict:
        path = _write(lines)
        self._paths.append(path)
        return digest(path, 40000)

    def test_injected_skill_body_is_dropped(self):
        skill = (
            "Base directory for this skill: /home/x/.claude/skills/receiving-code-review\n\n"
            "# Code Review Reception\n\n" + ("Verify before implementing. " * 300)
        )
        result = self.digest_of([_user(skill), _user("go ahead and fix both comments here")])
        self.assertEqual(result["user_asks"], ["go ahead and fix both comments here"])
        self.assertNotIn("Code Review Reception", result["turns"])

    def test_command_output_wrappers_are_dropped(self):
        for tag in ("local-command-stdout", "local-command-stderr", "bash-stdout", "bash-stderr"):
            with self.subTest(tag=tag):
                self.assertEqual(clean_user_text(f"<{tag}>noisy output here</{tag}>"), "")

    def test_local_command_caveat_is_dropped(self):
        caveat = (
            "<local-command-caveat>Caveat: The messages below were generated by the user "
            "while running local commands.</local-command-caveat>"
        )
        self.assertEqual(clean_user_text(caveat), "")

    def test_slash_command_is_kept_as_a_compact_action(self):
        text = (
            "<command-name>/autofix-pr</command-name>"
            "<command-message>autofix-pr</command-message>"
            "<command-args>152</command-args>"
        )
        self.assertEqual(clean_user_text(text), "/autofix-pr 152")

    def test_bash_input_is_kept_but_its_output_is_not(self):
        """The command the human typed is signal; its stdout is noise."""
        text = "<bash-input>gh pr ready 3113</bash-input><bash-stdout>tons of output</bash-stdout>"
        self.assertEqual(clean_user_text(text), "$ gh pr ready 3113")

    def test_system_reminder_embedded_in_a_real_ask_is_stripped(self):
        text = "fix the watcher lock<system-reminder>injected junk</system-reminder>"
        self.assertEqual(clean_user_text(text), "fix the watcher lock")

    def test_plain_human_prose_is_untouched(self):
        self.assertEqual(clean_user_text("so thats a /wrap ?"), "so thats a /wrap ?")

    def test_noise_only_turns_do_not_count_as_asks(self):
        result = self.digest_of(
            [
                _user("<bash-stdout>output</bash-stdout>"),
                _user("<system-reminder>reminder</system-reminder>"),
                _user("the only real ask"),
            ]
        )
        self.assertEqual(result["user_asks"], ["the only real ask"])


class TestDigestTruncation(unittest.TestCase):
    def test_oversized_body_is_elided_in_the_middle(self):
        """Head (the ask) and tail (what landed) are kept; the middle is sacrificed."""
        lines = [_user("FIRST_ASK_MARKER")]
        lines += [_assistant([{"type": "text", "text": "filler " * 200}]) for _ in range(60)]
        lines += [_assistant([{"type": "text", "text": "LAST_TURN_MARKER"}])]

        path = _write(lines)
        self.addCleanup(path.unlink, True)
        result = digest(path, max_chars=4000)

        self.assertIn("FIRST_ASK_MARKER", result["turns"], "the original ask must survive")
        self.assertIn("LAST_TURN_MARKER", result["turns"], "what actually landed must survive")
        self.assertIn("elided", result["turns"])
        # Elision must actually bound the output (allow for the marker text).
        self.assertLess(len(result["turns"]), 4000 + 200)


if __name__ == "__main__":
    unittest.main()
