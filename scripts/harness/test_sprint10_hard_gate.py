"""Tests for the Sprint 10 hard gate, chiefly its ``--charter`` (day-1) mode."""

import contextlib
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sprint10_hard_gate as hard_gate  # noqa: E402


class Sprint10HardGateTests(unittest.TestCase):
    def _members(self):
        return set(hard_gate.REQUIRED) | set(hard_gate.ACCEPTANCE.values())

    def _run_gate(self, members, state="active", charter=False, rendered=None,
                  todo_keys=None):
        members = set(members)
        todo_keys = members if todo_keys is None else set(todo_keys)
        jira = Mock()
        jira.sprints.return_value = [{"id": 85, "name": "Sprint 10", "state": state}]
        jira.sprint_issues.return_value = [{"key": k} for k in sorted(members)]
        if rendered is None:
            rendered = set(hard_gate.ACCEPTANCE.values()) & members
        jira.board_sprint_issues.return_value = [{"key": k} for k in sorted(rendered)]

        def issue(key, fields):
            todo = key in todo_keys
            return {"fields": {"summary": "test", "status": {
                "name": "To Do" if todo else "In Progress",
                "statusCategory": {"key": "new" if todo else "indeterminate"}}}}

        jira.issue.side_effect = issue
        argv = ["sprint10_hard_gate.py"] + (["--charter"] if charter else [])
        output = io.StringIO()
        with (
            patch("sprint10_hard_gate.Jira", return_value=jira),
            patch.object(sys, "argv", argv),
            contextlib.redirect_stdout(output),
        ):
            rc = hard_gate.main()
        return rc, output.getvalue()

    def test_every_si_has_an_acceptance_row_and_no_drops(self):
        self.assertEqual(set(hard_gate.SI_EXECUTION), set(hard_gate.ACCEPTANCE))
        self.assertTrue(all(hard_gate.ACCEPTANCE.values()))
        self.assertEqual(hard_gate.DROPPABLE, {})

    def test_charter_and_scoped_modes_are_mutually_exclusive(self):
        argv = [
            "sprint10_hard_gate.py", "--charter", "--issues", "KAN-268"]
        with (
            patch.object(sys, "argv", argv),
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit) as raised,
        ):
            hard_gate.main()
        self.assertEqual(raised.exception.code, 2)

    def test_scoped_mode_requires_at_least_one_issue(self):
        argv = ["sprint10_hard_gate.py", "--issues"]
        with (
            patch.object(sys, "argv", argv),
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit) as raised,
        ):
            hard_gate.main()
        self.assertEqual(raised.exception.code, 2)

    def test_charter_passes_on_day_one_with_everything_in_todo(self):
        rc, output = self._run_gate(self._members(), charter=True)
        self.assertEqual(rc, 0, output)

    def test_full_gate_fails_on_day_one_because_everything_is_todo(self):
        rc, output = self._run_gate(self._members())
        self.assertEqual(rc, 1)
        self.assertIn("KAN-268 is in To Do", output)

    def test_charter_refuses_a_sprint_that_is_not_started(self):
        rc, output = self._run_gate(self._members(), state="future", charter=True)
        self.assertEqual(rc, 1)
        self.assertIn("expected active", output)

    def test_charter_refuses_a_closed_sprint(self):
        rc, output = self._run_gate(self._members(), state="closed", charter=True)
        self.assertEqual(rc, 1)

    def test_charter_refuses_a_missing_member(self):
        members = self._members() - {"KAN-299"}
        rc, output = self._run_gate(members, charter=True)
        self.assertEqual(rc, 1)
        self.assertIn("KAN-299 is not in Sprint 10", output)

    def test_charter_refuses_an_unrendered_acceptance_row(self):
        rendered = set(hard_gate.ACCEPTANCE.values()) - {"RCP-110"}
        rc, output = self._run_gate(self._members(), charter=True, rendered=rendered)
        self.assertEqual(rc, 1)
        self.assertIn("RCP-110 is not rendered by board 168", output)

    def test_full_gate_passes_when_nothing_is_todo(self):
        rc, output = self._run_gate(self._members(), todo_keys=())
        self.assertEqual(rc, 0, output)


if __name__ == "__main__":
    unittest.main()
