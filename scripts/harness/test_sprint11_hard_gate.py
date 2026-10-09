"""Tests for the Sprint 11 hard gate, chiefly its ``--charter`` (day-1) mode."""

import contextlib
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sprint11_hard_gate as hard_gate  # noqa: E402


class Sprint11HardGateTests(unittest.TestCase):
    def _members(self):
        return set(hard_gate.GATED) | set(hard_gate.ACCEPTANCE.values())

    def _row_fields(self, key):
        """Board fields for a row: a conforming acceptance Story when it is one."""
        for si, row in hard_gate.ACCEPTANCE.items():
            if row == key:
                return {"issuetype": {"name": "Story"},
                        "summary": "S11 acceptance: test (%s)"
                                   % ", ".join(hard_gate.SI_EXECUTION[si])}
        return {"issuetype": {"name": "Story"}, "summary": "test"}

    def _run_gate(self, members, state="active", charter=False, rendered=None,
                  todo_keys=None, issues=None, row_fields=None):
        members = set(members)
        todo_keys = members if todo_keys is None else set(todo_keys)
        jira = Mock()
        jira.sprints.return_value = [{"id": 121, "name": "Sprint 11", "state": state}]
        jira.sprint_issues.return_value = [{"key": k} for k in sorted(members)]
        if rendered is None:
            rendered = set(hard_gate.ACCEPTANCE.values()) & members
        row_fields = row_fields or {}
        jira.board_sprint_issues.return_value = [
            {"key": k, "fields": row_fields.get(k, self._row_fields(k))}
            for k in sorted(rendered)]

        def issue(key, fields):
            todo = key in todo_keys
            return {"fields": {"summary": "test", "status": {
                "name": "To Do" if todo else "In Progress",
                "statusCategory": {"key": "new" if todo else "indeterminate"}}}}

        jira.issue.side_effect = issue
        argv = ["sprint11_hard_gate.py"]
        if charter:
            argv.append("--charter")
        elif issues is not None:
            argv.extend(["--issues", *issues])
        output = io.StringIO()
        with (
            patch("sprint11_hard_gate.Jira", return_value=jira),
            patch.object(sys, "argv", argv),
            contextlib.redirect_stdout(output),
        ):
            rc = hard_gate.main()
        return rc, output.getvalue()

    def test_every_si_has_an_acceptance_row_and_no_drops(self):
        self.assertEqual(set(hard_gate.SI_EXECUTION), set(hard_gate.ACCEPTANCE))
        self.assertTrue(all(hard_gate.ACCEPTANCE.values()))
        self.assertEqual(len(set(hard_gate.ACCEPTANCE.values())), len(hard_gate.ACCEPTANCE))
        self.assertEqual(hard_gate.DROPPABLE, {})

    def test_every_execution_row_is_required(self):
        executed = {k for rows in hard_gate.SI_EXECUTION.values() for k in rows}
        self.assertEqual(executed | {"RCP-123"}, set(hard_gate.REQUIRED))

    def test_charter_and_scoped_modes_are_mutually_exclusive(self):
        argv = ["sprint11_hard_gate.py", "--charter", "--issues", "KAN-306"]
        with (
            patch.object(sys, "argv", argv),
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit) as raised,
        ):
            hard_gate.main()
        self.assertEqual(raised.exception.code, 2)

    def test_scoped_success_is_not_labeled_as_the_full_gate(self):
        rc, output = self._run_gate((), issues=("KAN-306",), todo_keys=())
        self.assertEqual(rc, 0, output)
        self.assertIn("SCOPED CHECK PASSED", output)
        self.assertNotIn("HARD GATE PASSED", output)

    def test_charter_passes_on_day_one_with_everything_in_todo(self):
        rc, output = self._run_gate(self._members(), charter=True)
        self.assertEqual(rc, 0, output)

    def test_full_gate_fails_on_day_one_because_everything_is_todo(self):
        rc, output = self._run_gate(self._members())
        self.assertEqual(rc, 1)
        self.assertIn("KAN-306 is in To Do", output)

    def test_full_gate_passes_when_nothing_is_in_todo(self):
        rc, output = self._run_gate(self._members(), state="closed", todo_keys=())
        self.assertEqual(rc, 0, output)

    def test_missing_sprint_is_a_failure_not_a_vacuous_pass(self):
        jira = Mock()
        jira.sprints.return_value = [{"id": 85, "name": "Sprint 10", "state": "closed"}]
        output = io.StringIO()
        with (
            patch("sprint11_hard_gate.Jira", return_value=jira),
            patch.object(sys, "argv", ["sprint11_hard_gate.py", "--charter"]),
            contextlib.redirect_stdout(output),
        ):
            rc = hard_gate.main()
        self.assertEqual(rc, 1)
        self.assertIn("Sprint 11 does not exist", output.getvalue())

    def test_charter_refuses_a_sprint_that_is_not_started(self):
        rc, output = self._run_gate(self._members(), state="future", charter=True)
        self.assertEqual(rc, 1)
        self.assertIn("expected active", output)

    def test_charter_refuses_a_closed_sprint(self):
        rc, _ = self._run_gate(self._members(), state="closed", charter=True)
        self.assertEqual(rc, 1)

    def test_charter_fails_when_a_required_item_left_the_sprint(self):
        # Literal keys: a fixture derived from the gate's own sets cannot
        # notice the gate ceasing to require them. KAN-312 is one of S22's
        # three rows; KAN-356 is the row Adam added during chartering.
        for key in ("KAN-306", "KAN-312", "KAN-356", "KAN-350"):
            with self.subTest(key=key):
                rc, output = self._run_gate(self._members() - {key}, charter=True)
                self.assertEqual(rc, 1)
                self.assertIn("%s is not in Sprint 11" % key, output)

    def test_charter_fails_when_an_acceptance_row_is_not_rendered(self):
        for row in ("RCP-124", "RCP-117", "RCP-150"):
            with self.subTest(row=row):
                rendered = set(hard_gate.ACCEPTANCE.values()) - {row}
                rc, output = self._run_gate(self._members(), charter=True, rendered=rendered)
                self.assertEqual(rc, 1)
                self.assertIn("%s is not rendered by board 168" % row, output)

    def test_charter_fails_when_the_rendered_row_is_not_the_acceptance_story(self):
        # RCP-146 is S22's row: one Story for KAN-311, KAN-312 and KAN-313.
        story = {"name": "Story"}
        cases = (
            ("RCP-128", {"issuetype": {"name": "Epic"},
                         "summary": "S11 acceptance: test (KAN-306)"},
             "RCP-128 is type Epic, not a Story"),
            ("RCP-128", {"issuetype": story, "summary": "Publish refusal (KAN-306)"},
             "RCP-128 is not titled 'S11 acceptance: ...'"),
            ("RCP-128", {"issuetype": story, "summary": "S10 acceptance: test (KAN-306)"},
             "RCP-128 is not titled 'S11 acceptance: ...'"),
            ("RCP-128", {"issuetype": story, "summary": "S11 acceptance: test (KAN-3060)"},
             "RCP-128 does not name KAN-306 in its summary"),
            ("RCP-146", {"issuetype": story,
                         "summary": "S11 acceptance: test (KAN-311, KAN-313)"},
             "RCP-146 does not name KAN-312 in its summary"),
            ("RCP-128", {}, "RCP-128 is of unknown type, not a Story"),
        )
        for row, fields, expected in cases:
            with self.subTest(expected=expected):
                rc, output = self._run_gate(self._members(), charter=True,
                                            row_fields={row: fields})
                self.assertEqual(rc, 1)
                self.assertIn(expected, output)

    def test_an_acceptance_row_outside_rcp_is_named(self):
        fields = {"issuetype": {"name": "Story"},
                  "summary": "S11 acceptance: test (KAN-306)"}
        self.assertEqual(
            hard_gate.acceptance_row_problems("S4", "KAN-999", fields),
            ["is not in project RCP"])
        self.assertEqual(hard_gate.acceptance_row_problems("S4", "RCP-128", fields), [])

    def test_close_gate_rejects_an_acceptance_row_left_in_todo(self):
        rc, output = self._run_gate(self._members(), todo_keys={"RCP-149"})
        self.assertEqual(rc, 1)
        self.assertIn("RCP-149 is in To Do", output)

    def test_rows_kept_for_sprint_12_are_not_gated(self):
        gated = self._members()
        for key in ("KAN-277", "RCP-109", "KAN-299", "RCP-110", "KAN-352"):
            with self.subTest(key=key):
                self.assertIn(key, hard_gate.NOT_IN_SPRINT)
                self.assertNotIn(key, gated)

    def test_a_sprint_12_row_back_in_the_sprint_fails_both_gates(self):
        for key in ("KAN-299", "KAN-352"):
            with self.subTest(key=key):
                members = self._members() | {key}
                rc, output = self._run_gate(members, charter=True)
                self.assertEqual(rc, 1)
                self.assertIn("%s (" % key, output)
                self.assertIn("stays under RCP-119 for Sprint 12", output)
                rc, _ = self._run_gate(members, state="closed", todo_keys=())
                self.assertEqual(rc, 1)

    def test_a_sprint_12_acceptance_row_on_the_board_fails(self):
        rendered = set(hard_gate.ACCEPTANCE.values()) | {"RCP-110"}
        rc, output = self._run_gate(self._members(), charter=True, rendered=rendered)
        self.assertEqual(rc, 1)
        self.assertIn("RCP-110 (", output)


if __name__ == "__main__":
    unittest.main()
