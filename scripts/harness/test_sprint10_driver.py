"""Tests for the Sprint 10 PM driver: order, WIP, exact-Done starts, D6 caps."""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sprint10_driver as driver  # noqa: E402

PLAN = driver.load_plan()
IDS = [t["id"] for t in PLAN["tasks"]]


def write_state(state_dir, task_id, status):
    (Path(state_dir) / ("%s.state.json" % task_id)).write_text(
        json.dumps({"status": "open", "tasks": [{"id": task_id, "status": status}]}))


def jira_with(statuses):
    jira = Mock()
    jira.issue.side_effect = lambda key, fields: {
        "fields": {"status": {"name": statuses.get(key, "Done")}}}
    return lambda: jira


class PlanContractTests(unittest.TestCase):
    def test_dependencies_name_real_tasks_and_are_acyclic(self):
        deps = {t["id"]: t["depends_on"] for t in PLAN["tasks"]}
        for tid, ds in deps.items():
            self.assertTrue(set(ds) <= set(IDS), tid)
        seen, done = set(), set()

        def visit(tid):
            self.assertNotIn(tid, seen - done, "cycle at %s" % tid)
            if tid in done:
                return
            seen.add(tid)
            for d in deps[tid]:
                visit(d)
            done.add(tid)

        for tid in IDS:
            visit(tid)

    def test_every_task_carries_the_charter_attempt_cap(self):
        self.assertTrue(all(t["max_attempts"] == 3 for t in PLAN["tasks"]))
        self.assertEqual(PLAN["loop"]["max_loop_iterations"], 12)

    def test_launch_post_requires_its_gate_rows_done(self):
        t11 = next(t for t in PLAN["tasks"] if t["id"] == "T11")
        self.assertEqual(set(t11["requires_done"]), {
            "RCP-98", "RCP-101", "RCP-103", "RCP-104", "RCP-105", "RCP-106",
            "RCP-107", "RCP-108"})
        self.assertNotIn("gates", t11)

    def test_close_task_waits_for_every_other_task(self):
        t17 = next(t for t in PLAN["tasks"] if t["id"] == "T17")
        self.assertEqual(set(t17["depends_on"]), set(IDS) - {"T17"})

    def test_generated_task_plan_is_one_goal_capped_at_twelve(self):
        tp = driver.task_plan(PLAN, "T5")
        self.assertEqual([t["id"] for t in tp["tasks"]], ["T5"])
        self.assertEqual(tp["loop"]["max_loop_iterations"], 12)
        self.assertEqual(tp["tasks"][0]["max_attempts"], 3)
        self.assertEqual(tp["schema"], PLAN["schema"])


class StartRuleTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def test_first_task_is_startable_on_an_empty_board(self):
        self.assertEqual(driver.refusals(PLAN, "T0", self.dir), [])

    def test_refuses_until_dependencies_are_verified(self):
        reasons = driver.refusals(PLAN, "T3", self.dir)
        self.assertTrue(any("depends on T1" in r for r in reasons), reasons)
        for tid in ("T0", "T1"):
            write_state(self.dir, tid, "verified")
        self.assertEqual(driver.refusals(PLAN, "T3", self.dir), [])

    def test_refuses_a_fourth_open_task(self):
        write_state(self.dir, "T0", "verified")
        for tid in ("T1", "T2", "T5"):
            write_state(self.dir, tid, "in_progress")
        reasons = driver.refusals(PLAN, "T10", self.dir)
        self.assertTrue(any("WIP is 3" in r for r in reasons), reasons)

    def test_escalated_task_still_occupies_a_wip_slot(self):
        write_state(self.dir, "T0", "verified")
        write_state(self.dir, "T1", "escalated")
        write_state(self.dir, "T2", "verifying")
        write_state(self.dir, "T5", "pending")
        reasons = driver.refusals(PLAN, "T10", self.dir)
        self.assertTrue(any("WIP is 3" in r for r in reasons), reasons)

    def test_refuses_to_reinitialize_a_started_task(self):
        write_state(self.dir, "T0", "verifying")
        reasons = driver.refusals(PLAN, "T0", self.dir)
        self.assertTrue(any("already open" in r for r in reasons), reasons)

    def _verify_t11_deps(self):
        for tid in ("T0", "T1", "T2", "T4", "T5", "T6", "T7", "T8", "T9"):
            write_state(self.dir, tid, "verified")

    def test_launch_post_refuses_a_gate_row_in_review(self):
        self._verify_t11_deps()
        reasons = driver.refusals(PLAN, "T11", self.dir,
                                  jira_with({"RCP-104": "In Review"}))
        self.assertEqual(len(reasons), 1, reasons)
        self.assertIn("RCP-104 is 'In Review'", reasons[0])

    def test_launch_post_starts_when_every_gate_row_is_done(self):
        self._verify_t11_deps()
        self.assertEqual(driver.refusals(PLAN, "T11", self.dir, jira_with({})), [])

    def test_start_initializes_only_the_task_plan_via_the_controller(self):
        with (
            patch("sprint10_driver.subprocess.run",
                  return_value=Mock(returncode=0)) as run,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            rc = driver.main(["--state-dir", self.dir, "start", "T0",
                              "--controller", "/fake/loop_controller.py"])
        self.assertEqual(rc, 0)
        cmd = run.call_args[0][0]
        self.assertEqual(cmd[1:3], ["/fake/loop_controller.py", "init"])
        written = json.loads((Path(self.dir) / "T0.plan.json").read_text())
        self.assertEqual([t["id"] for t in written["tasks"]], ["T0"])

    def test_refused_start_exits_3_and_initializes_nothing(self):
        with (
            patch("sprint10_driver.subprocess.run") as run,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            rc = driver.main(["--state-dir", self.dir, "start", "T3"])
        self.assertEqual(rc, driver.REFUSED)
        run.assert_not_called()
        self.assertFalse(list(Path(self.dir).iterdir()))


if __name__ == "__main__":
    unittest.main()
