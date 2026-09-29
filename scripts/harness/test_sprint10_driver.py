"""Tests for the Sprint 10 PM driver: order, WIP, exact-Done starts, D6 caps."""

import contextlib
import io
import json
import sys
import tempfile
import threading
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

    def test_lane_a_preserves_s1_then_s3_then_s4(self):
        deps = {t["id"]: t["depends_on"] for t in PLAN["tasks"]}
        self.assertEqual(deps["T3"], ["T1"])
        self.assertEqual(deps["T4"], ["T3"])

    def test_lane_c_launch_waits_for_owned_property_work(self):
        deps = {t["id"]: t["depends_on"] for t in PLAN["tasks"]}
        self.assertIn("T10", deps["T11"])

    def test_lane_d_claude_md_work_waits_for_preflight(self):
        deps = {t["id"]: t["depends_on"] for t in PLAN["tasks"]}
        self.assertEqual(deps["T14"], ["T15"])
        self.assertEqual(deps["T13"], ["T14"])
        self.assertEqual(deps["T16"], ["T13"])

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

    def test_close_task_requires_no_si_process_lane_dispositions(self):
        t17 = next(t for t in PLAN["tasks"] if t["id"] == "T17")
        evidence = next(v["cmd"] for v in t17["verification"]
                        if v["kind"] == "manual-evidence")
        self.assertIn("closed or explicitly carried with a linked reason", evidence)
        for marker in (
            "KAN-271/272/273/274/276", "KAN-250", "RCP-58", "67108866",
            "T9 `-R` scope", "KAN-259", "PR #3537", "KAN-291", "KAN-275/KAN-290",
        ):
            self.assertIn(marker, evidence)

    def test_generated_task_plan_is_one_goal_capped_at_twelve(self):
        tp = driver.task_plan(PLAN, "T5")
        self.assertEqual([t["id"] for t in tp["tasks"]], ["T5"])
        self.assertEqual(tp["loop"]["max_loop_iterations"], 12)
        self.assertEqual(tp["tasks"][0]["max_attempts"], 3)
        self.assertEqual(tp["schema"], PLAN["schema"])

    def test_generated_task_plans_carry_lane_no_touch_boundaries(self):
        tasks = {t["id"]: t for t in PLAN["tasks"]}
        for task_id, task in tasks.items():
            lane = task.get("lane")
            if lane not in PLAN["lanes"]:
                continue
            generated = driver.task_plan(PLAN, task_id)["tasks"][0]
            self.assertIn("LANE %s MUST NOT TOUCH:" % lane,
                          generated["objective"], task_id)
            for path in PLAN["lanes"][lane]["must_not_touch"]:
                self.assertIn(path, generated["objective"], task_id)


class StatusRuleTests(unittest.TestCase):
    def test_missing_plan_returns_the_documented_config_error_code(self):
        with (
            tempfile.TemporaryDirectory() as state_dir,
            contextlib.redirect_stderr(io.StringIO()) as stderr,
        ):
            rc = driver.main([
                "--plan", str(Path(state_dir) / "missing.json"),
                "--state-dir", state_dir,
                "status",
            ])
        self.assertEqual(rc, 2)
        self.assertIn("CONFIG/API ERROR:", stderr.getvalue())

    def test_malformed_state_returns_the_documented_config_error_code(self):
        with tempfile.TemporaryDirectory() as state_dir:
            (Path(state_dir) / "T0.state.json").write_text("{")
            with contextlib.redirect_stderr(io.StringIO()) as stderr:
                rc = driver.main(["--state-dir", state_dir, "status"])
        self.assertEqual(rc, 2)
        self.assertIn("CONFIG/API ERROR:", stderr.getvalue())


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

    def test_s4_waits_for_s3_after_s1_is_verified(self):
        for tid in ("T0", "T1"):
            write_state(self.dir, tid, "verified")
        reasons = driver.refusals(PLAN, "T4", self.dir)
        self.assertTrue(any("depends on T3" in r for r in reasons), reasons)
        write_state(self.dir, "T3", "verified")
        self.assertEqual(driver.refusals(PLAN, "T4", self.dir), [])

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
        for tid in ("T0", "T1", "T2", "T4", "T5", "T6", "T7", "T8", "T9", "T10"):
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

    def test_start_locks_before_evaluating_wip(self):
        with (
            patch("sprint10_driver.fcntl.flock") as flock,
            patch("sprint10_driver.refusals") as refusals,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            def assert_locked(*_args):
                self.assertTrue(flock.called)
                return []

            refusals.side_effect = assert_locked
            rc = driver.main(["--state-dir", self.dir, "start", "T0", "--dry-run"])
        self.assertEqual(rc, 0)
        flock.assert_called_once()
        self.assertEqual(flock.call_args.args[1], driver.fcntl.LOCK_EX)

    def test_concurrent_starts_serialize_before_the_wip_snapshot(self):
        first_inside = threading.Event()
        release_first = threading.Event()
        second_started = threading.Event()
        calls = []
        results = {}

        def guarded_refusals(_plan, task_id, _state_dir):
            calls.append(task_id)
            if task_id == "T0":
                first_inside.set()
                self.assertTrue(release_first.wait(1))
            return []

        def run(name, task_id, started=None):
            if started:
                started.set()
            results[name] = driver.main(
                ["--state-dir", self.dir, "start", task_id, "--dry-run"])

        with (
            patch("sprint10_driver.refusals", side_effect=guarded_refusals),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            first = threading.Thread(target=run, args=("first", "T0"))
            second = threading.Thread(
                target=run, args=("second", "T1", second_started))
            first.start()
            self.assertTrue(first_inside.wait(1))
            second.start()
            self.assertTrue(second_started.wait(1))
            second.join(0.05)
            self.assertTrue(second.is_alive(), "second start must wait on .start.lock")
            self.assertEqual(calls, ["T0"])
            release_first.set()
            first.join(1)
            second.join(1)

        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        self.assertEqual(results, {"first": 0, "second": 0})
        self.assertEqual(calls, ["T0", "T1"])

    def test_refused_start_exits_3_and_initializes_nothing(self):
        with (
            patch("sprint10_driver.subprocess.run") as run,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            rc = driver.main(["--state-dir", self.dir, "start", "T3"])
        self.assertEqual(rc, driver.REFUSED)
        run.assert_not_called()
        self.assertEqual([p.name for p in Path(self.dir).iterdir()], [".start.lock"])



class SharedStateDirTests(unittest.TestCase):
    def test_default_state_dir_is_the_main_checkout_not_the_worktree(self):
        # Linked worktrees share one common dir; the default must follow it, or
        # each lane session would lock and count WIP in its own directory.
        import _jira_client
        with patch.object(_jira_client, "repo_root",
                          return_value=Path("/main/checkout")):
            self.assertEqual(driver.default_state_dir(),
                             Path("/main/checkout/.agent-harness/sprint10"))

    def test_omitting_state_dir_uses_the_shared_default(self):
        with (
            tempfile.TemporaryDirectory() as shared,
            patch.object(driver, "default_state_dir", return_value=Path(shared)),
            patch("sprint10_driver.cmd_status", return_value=0) as status,
        ):
            driver.main(["status"])
        self.assertEqual(status.call_args[0][0].state_dir, shared)


if __name__ == "__main__":
    unittest.main()
