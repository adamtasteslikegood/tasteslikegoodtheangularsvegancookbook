"""Tests for the Sprint 12 PM driver and its plan file.

The driver mechanics (WIP <= 3, soak/resume, requires_done, carried_to) live in
``sprint10_driver.py`` and are covered by ``test_sprint10_driver.py``. This file
checks that the Sprint 12 wrapper points at the Sprint 12 plan and state dir,
and that ``SPRINT_12_HARNESS_PLAN.json`` stays in lockstep with
``sprint12_hard_gate.py`` and ``plan_qa.py --strict``.
"""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO / ".claude" / "skills" / "harness-qa-loop"))
import plan_qa  # noqa: E402
import sprint10_driver as base_driver  # noqa: E402
import sprint12_driver as driver  # noqa: E402
import sprint12_hard_gate as hard_gate  # noqa: E402


class FakeControllerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state_dir = Path(self.tmp.name) / "state"
        self.fake = Path(self.tmp.name) / "fake_controller.py"
        self.fake.write_text(
            "import json, pathlib, sys\n"
            "args = sys.argv[1:]\n"
            "plan = pathlib.Path(args[args.index('--plan') + 1])\n"
            "state = pathlib.Path(args[args.index('--state') + 1])\n"
            "data = json.loads(plan.read_text())\n"
            "assert len(data['tasks']) == 1\n"
            "t = dict(data['tasks'][0], status='pending', attempts=0)\n"
            "state.write_text(json.dumps({\n"
            "    'iteration': 0,\n"
            "    'max_loop_iterations': data['loop']['max_loop_iterations'],\n"
            "    'tasks': [t],\n"
            "}))\n"
        )
        self.patcher = patch.object(base_driver, "CONTROLLER", str(self.fake))
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()
        self.tmp.cleanup()

    def run_driver(self, *args):
        out = io.StringIO()
        with (
            contextlib.redirect_stdout(out),
            contextlib.redirect_stderr(out),
        ):
            rc = driver.main(["--state-dir", str(self.state_dir), *args])
        return rc, out.getvalue()

    def test_wrapper_uses_sprint_12_plan_and_state_name(self):
        self.assertEqual(driver.STATE_NAME, "sprint12")
        self.assertEqual(driver.PLAN.name, "SPRINT_12_HARNESS_PLAN.json")
        rc, out = self.run_driver("status")
        self.assertEqual(rc, 0, out)
        self.assertIn("T0", out)
        self.assertIn("T18", out)

    def test_t0_starts_first_and_t1_waits_for_t0_and_t2(self):
        rc, out = self.run_driver("start", "T1")
        self.assertEqual(rc, base_driver.REFUSED)
        self.assertIn("T0", out)
        self.assertIn("T2", out)

        rc, out = self.run_driver("start", "T0")
        self.assertEqual(rc, 0, out)

    def test_status_flag_alias(self):
        rc, out = self.run_driver("--status")
        self.assertEqual(rc, 0, out)
        self.assertIn("T0", out)

    def test_check_spillover_and_verify_process_lane_flags(self):
        class FakeJira:
            def sprint_issues(self, sprint_id):
                self.last_sprint_id = sprint_id
                return [
                    {
                        "key": "KAN-306",
                        "fields": {
                            "summary": "Carried Sprint 11 bug",
                            "status": {
                                "name": "In Progress",
                                "statusCategory": {"key": "indeterminate"},
                            },
                        },
                    },
                    {
                        "key": "KAN-345",
                        "fields": {
                            "summary": "Closed Sprint 11 item",
                            "status": {
                                "name": "Done",
                                "statusCategory": {"key": "done"},
                            },
                        },
                    },
                ]

            def issue(self, key, fields=None):
                return {
                    "key": key,
                    "fields": {
                        "summary": f"Summary {key}",
                        "status": {
                            "name": "Done",
                            "statusCategory": {"key": "done", "name": "Done"},
                        },
                    },
                }

        with patch.object(hard_gate, "Jira", return_value=FakeJira()):
            rc, out = self.run_driver("--check-spillover", "--json")
            self.assertEqual(rc, 0, out)
            payload = json.loads(out)
            self.assertEqual(payload["spillover_count"], 1)
            self.assertEqual(payload["group_d_swaps"][0]["carried_in"], "KAN-306")
            self.assertEqual(payload["group_d_swaps"][0]["deferred_si"], "S16")

            rc2, out2 = self.run_driver("--verify-process-lane")
            self.assertEqual(rc2, 0, out2)
            self.assertIn("SCOPED CHECK PASSED", out2)

    def test_day1_cutover_dry_run_flag_forwards_to_hard_gate(self):
        class FakeCutoverJira:
            def sprints(self, board_id):
                return [
                    {"id": 121, "name": "Sprint 11", "state": "active"},
                    {"id": 122, "name": "Sprint 12", "state": "future"},
                ]

            def sprint_issues(self, sprint_id):
                return []

        with patch.object(hard_gate, "Jira", return_value=FakeCutoverJira()):
            rc, out = self.run_driver("--day1-cutover", "--dry-run", "--json")
            self.assertEqual(rc, 0, out)
            payload = json.loads(out)
            self.assertTrue(payload["dry_run"])
            self.assertEqual(payload["spillover_count"], 0)


class Sprint12PlanIntegrityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = json.loads(driver.PLAN.read_text())

    def test_sprint_12_plan_matches_sprint_12_hard_gate(self):
        self.assertEqual(self.plan["jira"]["sprint"], "Sprint 12")
        self.assertEqual(self.plan["jira"]["sprint_id"], 122)
        self.assertEqual(self.plan["jira"]["epic"], "RCP-119")
        self.assertIn("sprint12_hard_gate.py", self.plan["hard_gate"]["cmd"])
        self.assertIn(
            "sprint12_hard_gate.py --charter",
            self.plan["hard_gate"]["charter_cmd"],
        )

        # Every SI in the hard gate must have a task in the plan with the exact
        # same execution + acceptance keys.
        by_si = {t["si"]: t for t in self.plan["tasks"]}
        plan_sis = set(by_si) - {"process", "close"}
        self.assertEqual(plan_sis, set(hard_gate.SI_EXECUTION))
        for si, exec_keys in hard_gate.SI_EXECUTION.items():
            with self.subTest(si=si):
                t = by_si[si]
                expected = set(exec_keys) | {hard_gate.ACCEPTANCE[si]}
                self.assertEqual(set(t["jira"]), expected)

    def test_every_task_passes_plan_qa_strict(self):
        res = plan_qa.qa(self.plan)
        self.assertEqual(res["blockers"], [])
        self.assertEqual(res["warnings"], [])

    def test_no_two_tasks_share_a_non_manual_verification_command(self):
        # Prevents copy-paste verification where T_b passes because T_a's check
        # already holds. Shared gates (like check_sprint_lane.sh in T0 and T18)
        # must be explicitly marked `"shared_gate": true` in the plan.
        seen = {}
        for t in self.plan["tasks"]:
            for c in t["verification"]:
                cmd = c["cmd"]
                if cmd.startswith("MANUAL:") or c.get("shared_gate"):
                    continue
                self.assertNotIn(
                    cmd,
                    seen,
                    f"{t['id']} shares verification command with {seen.get(cmd)}: {cmd}",
                )
                seen[cmd] = t["id"]

    def test_close_task_waits_for_every_other_task(self):
        by_id = {t["id"]: t for t in self.plan["tasks"]}
        close = by_id["T18"]
        self.assertEqual(close["si"], "close")
        others = {t["id"] for t in self.plan["tasks"] if t["id"] != "T18"}
        self.assertEqual(set(close["depends_on"]), others)

    def test_charter_runs_first_and_only_process_allows_workflow_edits(self):
        by_id = {t["id"]: t for t in self.plan["tasks"]}
        self.assertEqual(by_id["T0"]["depends_on"], [])
        for tid, t in by_id.items():
            if tid != "T0":
                self.assertIn("T0", t["depends_on"], tid)
        for lane, rules in self.plan["lanes"].items():
            if lane == "Process":
                self.assertNotIn(".github/workflows/", rules["must_not_touch"])
            else:
                self.assertIn(
                    ".github/workflows/", rules["must_not_touch"], lane
                )

    def test_backend_tasks_target_the_backend_repo_in_gh_pr_list(self):
        backend_repo = self.plan["repo_scope"]["backend_repo"]
        # Tasks that are purely Backend SIs must query -R adamtasteslikegood/tasteslikegood.com
        backend_only_tasks = (
            "T2",
            "T3",
            "T6",
            "T7",
            "T9",
            "T10",
            "T11",
            "T12",
            "T14",
            "T16",
        )
        by_id = {t["id"]: t for t in self.plan["tasks"]}
        for tid in backend_only_tasks:
            with self.subTest(tid=tid):
                cmds = [
                    c["cmd"]
                    for c in by_id[tid]["verification"]
                    if c["cmd"].startswith("gh pr list")
                ]
                self.assertTrue(cmds, f"{tid} has no gh pr list check")
                for cmd in cmds:
                    self.assertIn(f"-R {backend_repo}", cmd)


if __name__ == "__main__":
    unittest.main()
