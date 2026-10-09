"""Tests for the Sprint 11 harness plan and its driver entry point.

The driver's mechanics (WIP, soak, locking, D6 caps) are tested in
``test_sprint10_driver.py``. These tests cover what is Sprint 11's own: the
plan agrees with the hard gate, the graph matches the charter's ordered list,
and the entry point reads the Sprint 11 plan and state dir.
"""

import contextlib
import io
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sprint10_driver as base  # noqa: E402
import sprint11_driver as driver  # noqa: E402
import sprint11_hard_gate as hard_gate  # noqa: E402


def _jira(statuses):
    jira = Mock()
    jira.issue.side_effect = lambda key, fields=None: {
        "fields": {"status": {"name": statuses.get(key, "To Do")}}}
    return lambda: jira


def _verify(state_dir, *task_ids):
    for task_id in task_ids:
        (Path(state_dir) / ("%s.state.json" % task_id)).write_text(
            '{"tasks": [{"status": "verified"}]}')


class Sprint11PlanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = base.load_plan(driver.PLAN)
        cls.tasks = {t["id"]: t for t in cls.plan["tasks"]}

    def test_one_task_per_si_plus_charter_and_close(self):
        sis = [t["si"] for t in self.plan["tasks"]]
        self.assertEqual(sis, ["charter"] + ["S%d" % n for n in range(1, 28)] + ["close"])

    def test_every_task_names_its_gate_rows(self):
        for task in self.plan["tasks"]:
            si = task["si"]
            if si == "close":
                continue
            with self.subTest(si=si):
                expected = set(hard_gate.SI_EXECUTION[si]) | {hard_gate.ACCEPTANCE[si]}
                self.assertEqual(set(task["jira"]) - {"RCP-123"}, expected)

    def test_plan_covers_every_gated_row_and_no_sprint_12_row(self):
        planned = {k for t in self.plan["tasks"] for k in t["jira"]}
        self.assertEqual(planned, set(hard_gate.REQUIRED) | set(hard_gate.ACCEPTANCE.values()))
        self.assertFalse(planned & set(hard_gate.NOT_IN_SPRINT))
        # Literal keys, so the check does not depend on the gate's own sets.
        for key in ("KAN-277", "KAN-299", "KAN-352", "RCP-109", "RCP-110"):
            self.assertNotIn(key, planned)

    def test_every_task_has_a_board_check_and_a_non_status_check(self):
        for task in self.plan["tasks"]:
            with self.subTest(task=task["id"]):
                kinds = [v["kind"] for v in task["verification"]]
                self.assertTrue({"board", "board-wiring", "hard-gate"} & set(kinds))
                self.assertTrue({"artifact", "manual-evidence", "lane"} & set(kinds))

    def test_backend_sis_check_the_backend_repo(self):
        for task_id in ("T1", "T2", "T3", "T8", "T9", "T12", "T15", "T24"):
            with self.subTest(task=task_id):
                cmds = [v["cmd"] for v in self.tasks[task_id]["verification"]
                        if v["kind"] == "artifact"]
                self.assertTrue(cmds)
                self.assertTrue(all("-R adamtasteslikegood/tasteslikegood.com" in c for c in cmds))

    def test_s22_checks_each_of_its_three_rows(self):
        board = self.tasks["T22"]["verification"][0]["cmd"]
        for key in ("KAN-311", "KAN-312", "KAN-313", "RCP-146"):
            self.assertIn(key, board)

    def test_the_rate_limiter_task_carries_no_detail(self):
        # Both repos are public and KAN-335 is unfixed: the plan says where the
        # detail is, nothing more.
        task = self.tasks["T6"]
        self.assertIn("detail on the ticket", task["objective"])
        self.assertLess(len(task["objective"]), 800)

    def test_only_the_process_lane_may_edit_workflows(self):
        for name, lane in self.plan["lanes"].items():
            with self.subTest(lane=name):
                if name == "Process":
                    self.assertNotIn(".github/workflows/", lane["must_not_touch"])
                else:
                    self.assertIn(".github/workflows/", lane["must_not_touch"])
        self.assertEqual({t["lane"] for t in self.plan["tasks"]} - {"PM"},
                         set(self.plan["lanes"]))

    def test_close_depends_on_every_other_task(self):
        self.assertEqual(set(self.tasks["T28"]["depends_on"]),
                         set(self.tasks) - {"T28"})

    def test_soak_is_declared_only_for_the_dated_counts(self):
        soaks = {t["id"]: t["soak_window_hours"] for t in self.plan["tasks"]
                 if t.get("soak_window_hours")}
        self.assertEqual(soaks, {"T12": 168, "T20": 168, "T25": 336})
        self.assertEqual(self.tasks["T25"]["soak_deadline"],
                         "2026-10-23T23:59:00+00:00")


class Sprint11DriverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = base.load_plan(driver.PLAN)

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.state = tmp.name

    def _refusals(self, task_id, statuses=None):
        return base.refusals(self.plan, task_id, self.state, _jira(statuses or {}))

    def test_only_the_charter_task_starts_first(self):
        self.assertEqual(self._refusals("T0"), [])
        self.assertIn("T1 depends on T0", self._refusals("T1")[0])

    def test_the_crawl_lane_starts_in_order(self):
        _verify(self.state, "T0")
        self.assertEqual(self._refusals("T1"), [])
        self.assertIn("T2 waits until T1", self._refusals("T2")[0])
        self.assertIn("T3 waits until T2", self._refusals("T3")[0])

    def test_the_feedback_build_waits_for_the_pre_build_task(self):
        _verify(self.state, "T0")
        self.assertIn("T27 waits until T25", self._refusals("T27")[0])
        self.assertIn("T15 waits until T16", self._refusals("T15")[0])

    def test_status_does_not_call_a_task_startable_when_start_refuses_it(self):
        _verify(self.state, "T0")
        self.assertTrue(self._refusals("T2"))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            rc = driver.main(["--state-dir", self.state, "status"])
        self.assertEqual(rc, 0)
        notes = {line.split()[0]: line for line in output.getvalue().splitlines()[1:]}
        self.assertTrue(notes["T1"].endswith("startable"))
        self.assertIn("waiting for T1 to start", notes["T2"])
        self.assertIn("waiting for T16 to start", notes["T15"])
        self.assertIn("waiting for T25 to start", notes["T27"])

    def test_the_walk_needs_the_stability_rows_exactly_done(self):
        _verify(self.state, "T0", "T4", "T5", "T6")
        done = {"RCP-128": "Done", "RCP-129": "Done", "RCP-130": "Done"}
        self.assertEqual(self._refusals("T26", done), [])
        reasons = self._refusals("T26", dict(done, **{"RCP-130": "In Review"}))
        self.assertEqual(len(reasons), 1)
        self.assertIn("RCP-130 is 'In Review'", reasons[0])

    def test_the_walk_waits_for_the_stability_tasks(self):
        _verify(self.state, "T0", "T4", "T5")
        done = {"RCP-128": "Done", "RCP-129": "Done", "RCP-130": "Done"}
        self.assertIn("T26 depends on T6", self._refusals("T26", done)[0])

    def test_t25_soak_cannot_move_past_its_absolute_deadline(self):
        (Path(self.state) / "T25.state.json").write_text(
            '{"tasks": [{"status": "verifying"}]}')
        output = io.StringIO()
        with (
            patch.object(base, "datetime") as clock,
            contextlib.redirect_stdout(output),
        ):
            clock.now.return_value = datetime(2026, 10, 20, tzinfo=timezone.utc)
            clock.fromisoformat.side_effect = datetime.fromisoformat
            rc = driver.main([
                "--state-dir", self.state, "soak", "T25",
                "--until", "2026-10-24T12:00:00+00:00", "--reason", "count",
            ])
        self.assertEqual(rc, base.REFUSED)
        self.assertIn("absolute deadline 2026-10-23T23:59:00+00:00",
                      output.getvalue())

    def test_a_carried_task_is_named_for_sprint_11(self):
        plan = {"jira": {"sprint": "Sprint 11"},
                "tasks": [{"id": "T9", "carried_to": "RCP-119"}]}
        reasons = base.refusals(plan, "T9", self.state)
        self.assertIn("carried out of Sprint 11 to RCP-119", reasons[0])

    def test_default_state_dir_is_sprint_11s_in_the_main_checkout(self):
        with patch("_jira_client.repo_root", return_value=Path("/main/checkout")):
            self.assertEqual(base.default_state_dir(driver.STATE_NAME),
                             Path("/main/checkout/.agent-harness/sprint11"))

    def test_the_entry_point_reads_the_sprint_11_plan_and_state_dir(self):
        output = io.StringIO()
        with (
            patch.object(base, "default_state_dir", return_value=Path(self.state)) as state_dir,
            contextlib.redirect_stdout(output),
        ):
            rc = driver.main(["status"])
        self.assertEqual(rc, 0)
        state_dir.assert_called_once_with("sprint11")
        lines = output.getvalue().splitlines()
        self.assertEqual(lines[0], "WIP 0/3")
        self.assertEqual(len(lines), 30)
        self.assertIn("S27", output.getvalue())

    def test_the_sprint_10_entry_point_is_unchanged(self):
        with patch.object(base, "default_state_dir", return_value=Path(self.state)) as state_dir, \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(base.main(["status"]), 0)
        state_dir.assert_called_once_with("sprint10")
        self.assertEqual(base.build_parser().get_default("plan"), str(base.PLAN))


if __name__ == "__main__":
    unittest.main()
