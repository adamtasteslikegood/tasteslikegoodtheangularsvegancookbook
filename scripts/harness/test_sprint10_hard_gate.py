"""Tests for the Sprint 10 hard gate, chiefly its ``--charter`` (day-1) mode."""

import contextlib
import io
import json
import re
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
                  todo_keys=None, issues=None):
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
        argv = ["sprint10_hard_gate.py"]
        if charter:
            argv.append("--charter")
        elif issues is not None:
            argv.extend(["--issues", *issues])
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

    def test_scoped_success_is_not_labeled_as_the_full_gate(self):
        rc, output = self._run_gate(
            (), issues=("KAN-268",), todo_keys=())
        self.assertEqual(rc, 0, output)
        self.assertIn("SCOPED CHECK PASSED", output)
        self.assertNotIn("HARD GATE PASSED", output)
        self.assertNotIn("acceptance row the board renders", output)

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

    def test_active_acceptance_set_excludes_the_carried_rows(self):
        # S10, S11, S18 -> RCP-119 (2026-10-01): the gate, the plan's carry and
        # T17's close check must agree on which acceptance rows close here.
        plan = json.loads((Path(__file__).resolve().parents[2]
                           / "specs/harness/SPRINT_10_HARNESS_PLAN.json").read_text())
        carried = {t["si"] for t in plan["tasks"] if t.get("carried_to")}
        self.assertEqual(carried, set(hard_gate.CARRIED))
        self.assertFalse(carried & set(hard_gate.ACCEPTANCE))
        carried_rows = {rcp for _, rcp in hard_gate.CARRIED.values()}
        self.assertEqual(carried_rows, {"RCP-109", "RCP-110", "RCP-117"})
        self.assertFalse(carried_rows & set(hard_gate.ACCEPTANCE.values()))
        t17 = next(t for t in plan["tasks"] if t["id"] == "T17")
        manual = next(v["cmd"] for v in t17["verification"] if v["kind"] == "manual-evidence")
        self.assertIn("except RCP-109, RCP-110 and RCP-117", t17["objective"])
        self.assertIn("EXCEPT RCP-109, RCP-110 and RCP-117", manual)

    def test_a_carried_execution_row_back_in_the_sprint_fails(self):
        for charter in (True, False):
            rc, output = self._run_gate(self._members() | {"KAN-277"},
                                        charter=charter, todo_keys=set())
            self.assertEqual(rc, 1, output)
            self.assertIn("KAN-277 (S10) was carried to RCP-119", output)

    def test_a_carried_acceptance_row_on_the_board_fails(self):
        members = self._members() | {"RCP-117"}
        rendered = set(hard_gate.ACCEPTANCE.values()) | {"RCP-117"}
        rc, output = self._run_gate(members, charter=True, rendered=rendered)
        self.assertEqual(rc, 1, output)
        self.assertIn("RCP-117 (S18) was carried to RCP-119", output)

    def test_carried_children_and_kan_306_back_in_the_sprint_fail(self):
        self.assertEqual(set(hard_gate.CARRIED_EXTRA),
                         {"KAN-311", "KAN-312", "KAN-313", "KAN-306"})
        for key in sorted(hard_gate.CARRIED_EXTRA):
            rc, output = self._run_gate(self._members() | {key}, charter=True)
            self.assertEqual(rc, 1, (key, output))
            self.assertIn("%s (" % key, output)
            self.assertIn("was carried to RCP-119", output)

    def test_shipped_s10_children_stay_in_the_sprint(self):
        rc, output = self._run_gate(self._members() | {"KAN-314", "KAN-315"},
                                    charter=True)
        self.assertEqual(rc, 0, output)

    def test_the_split_sprint_passes_the_charter_gate(self):
        rc, output = self._run_gate(self._members(), charter=True)
        self.assertEqual(rc, 0, output)

    def test_t17_close_out_names_every_active_acceptance_row(self):
        # Rows RCP-101..RCP-118 are covered by the range; any active row outside
        # it (S20's RCP-120) must be named, so close-out cannot skip it.
        plan = json.loads((Path(__file__).resolve().parents[2]
                           / "specs/harness/SPRINT_10_HARNESS_PLAN.json").read_text())
        t17 = next(t for t in plan["tasks"] if t["id"] == "T17")
        manual = next(v["cmd"] for v in t17["verification"] if v["kind"] == "manual-evidence")
        self.assertIn("RCP-101 through RCP-118", manual)
        for row in hard_gate.ACCEPTANCE.values():
            n = int(re.sub(r"\D", "", row))
            if not 101 <= n <= 118:
                self.assertIn(row, manual, "%s missing from T17's close-out list" % row)

    def test_kitchen_ui_work_does_not_overlap_s20(self):
        plan = json.loads((Path(__file__).resolve().parents[2]
                           / "specs/harness/SPRINT_10_HARNESS_PLAN.json").read_text())
        deps = {t["id"]: t["depends_on"] for t in plan["tasks"]}
        self.assertIn("T6", deps["T21"])
        self.assertIn("T21", deps["T8"])

    def test_charter_refuses_a_missing_member(self):
        members = self._members() - {"KAN-298"}
        rc, output = self._run_gate(members, charter=True)
        self.assertEqual(rc, 1)
        self.assertIn("KAN-298 is not in Sprint 10", output)

    def test_charter_refuses_an_unrendered_acceptance_row(self):
        rendered = set(hard_gate.ACCEPTANCE.values()) - {"RCP-108"}
        rc, output = self._run_gate(self._members(), charter=True, rendered=rendered)
        self.assertEqual(rc, 1)
        self.assertIn("RCP-108 is not rendered by board 168", output)

    def test_charter_pair_is_a_gated_unit(self):
        self.assertIn("KAN-269", hard_gate.REQUIRED)
        self.assertEqual(hard_gate.SI_EXECUTION["charter"], ["KAN-269"])
        self.assertEqual(hard_gate.ACCEPTANCE["charter"], "RCP-99")

    def test_charter_refuses_a_missing_charter_execution_row(self):
        rc, output = self._run_gate(self._members() - {"KAN-269"}, charter=True)
        self.assertEqual(rc, 1)
        self.assertIn("KAN-269 is not in Sprint 10", output)

    def test_charter_refuses_an_unrendered_charter_acceptance_row(self):
        rendered = set(hard_gate.ACCEPTANCE.values()) - {"RCP-99"}
        rc, output = self._run_gate(self._members(), charter=True, rendered=rendered)
        self.assertEqual(rc, 1)
        self.assertIn("RCP-99 is not rendered by board 168", output)

    def test_full_gate_fails_when_the_charter_row_is_left_in_todo(self):
        rc, output = self._run_gate(self._members(), todo_keys={"RCP-99"})
        self.assertEqual(rc, 1)
        self.assertIn("RCP-99 is in To Do", output)

    def test_full_gate_passes_when_nothing_is_todo(self):
        rc, output = self._run_gate(self._members(), todo_keys=())
        self.assertEqual(rc, 0, output)


if __name__ == "__main__":
    unittest.main()
