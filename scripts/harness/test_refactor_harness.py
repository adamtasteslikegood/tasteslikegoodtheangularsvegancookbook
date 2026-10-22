"""Tests for the Refactoring Backlog harness plan, driver, and hard gate (`KAN-460`..`KAN-467`).

Verifies:
1. `specs/harness/REFACTOR_HARNESS_PLAN.json` passes `plan_qa.py --strict` with
   0 blockers and 0 warnings.
2. Every refactoring group (`G1`..`G4`) has a mandatory stopping-point task
   (`C1`..`C4`) and `refactor_driver.py` refuses to start any task in Group N+1
   until Group N's tasks are verified, `checkin G<N> --approve --notes ...` is
   recorded, and `C<N>` is verified.
3. `refactor_hard_gate.py` structural checks fail on the unrefactored baseline
   (proving non-tautological outcome verification) and pass once target files
   are decomposed below their line ceilings with extracted modules present.
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
import refactor_driver as driver  # noqa: E402
import refactor_hard_gate as hard_gate  # noqa: E402


class RefactorPlanIntegrityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = json.loads(driver.PLAN.read_text(encoding="utf-8"))

    def test_plan_passes_plan_qa_strict_with_zero_blockers_and_warnings(self):
        res = plan_qa.qa(self.plan)
        self.assertEqual(res["blockers"], [], f"Blockers: {res['blockers']}")
        self.assertEqual(res["warnings"], [], f"Warnings: {res['warnings']}")
        self.assertEqual(res["task_count"], 12)
        self.assertTrue(all(r["status"] == "ok" for r in res["rows"]))

    def test_plan_groups_and_tasks_match_hard_gate(self):
        self.assertEqual(
            set(self.plan["groups"].keys()),
            {"G1", "G2", "G3", "G4"},
        )
        by_id = {t["id"]: t for t in self.plan["tasks"]}
        self.assertEqual(
            set(by_id.keys()),
            {"T1", "T2", "C1", "T3", "T4", "C2", "T5", "T6", "C3", "T7", "T8", "C4"},
        )
        for tid, spec in hard_gate.TASK_SPECS.items():
            with self.subTest(task=tid):
                t = by_id[tid]
                self.assertEqual(t["group"], spec["group"])
                self.assertEqual(t["jira"], spec["jira"])
        for gid, gspec in hard_gate.GROUPS.items():
            with self.subTest(group=gid):
                pgrp = self.plan["groups"][gid]
                self.assertEqual(pgrp["tasks"], gspec["tasks"])
                self.assertEqual(pgrp["checkin_task"], gspec["checkin_task"])
                self.assertEqual(pgrp["jira"], gspec["jira"])
                self.assertTrue(pgrp["stopping_point"])


class RefactorDriverGroupCheckinTests(unittest.TestCase):
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
            "}))\n",
            encoding="utf-8",
        )
        self.patcher = patch.object(driver, "CONTROLLER", str(self.fake))
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()
        self.tmp.cleanup()

    def run_driver(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            rc = driver.main(["--state-dir", str(self.state_dir), *args])
        return rc, out.getvalue()

    def mark_verified(self, task_id: str):
        self.state_dir.mkdir(parents=True, exist_ok=True)
        plan = driver.load_plan()
        t = next(item for item in plan["tasks"] if item["id"] == task_id)
        (self.state_dir / f"{task_id}.state.json").write_text(
            json.dumps(
                {
                    "iteration": 2,
                    "max_loop_iterations": 12,
                    "tasks": [dict(t, status="verified", attempts=1)],
                }
            ),
            encoding="utf-8",
        )

    def test_group_1_tasks_start_and_group_2_is_blocked_until_g1_checkin(self):
        # Initially T1 and T2 (G1) are startable; T3 (G2) and C1 (G1-CHECKIN) are refused.
        rc_t3, out_t3 = self.run_driver("start", "T3")
        self.assertEqual(rc_t3, driver.REFUSED, out_t3)
        self.assertIn("G1", out_t3)

        rc_c1, out_c1 = self.run_driver("start", "C1")
        self.assertEqual(rc_c1, driver.REFUSED, out_c1)
        self.assertIn("T1, T2", out_c1)

        # Approving G1 check-in before T1 and T2 are verified is refused.
        rc_chk_early, out_chk_early = self.run_driver(
            "checkin", "G1", "--approve", "--notes", "Too early"
        )
        self.assertEqual(rc_chk_early, driver.REFUSED, out_chk_early)
        self.assertIn("not yet verified", out_chk_early)

        # Start T1 and T2 (WIP reaches 2/2).
        rc_t1, out_t1 = self.run_driver("start", "T1")
        self.assertEqual(rc_t1, 0, out_t1)
        rc_t2, out_t2 = self.run_driver("start", "T2")
        self.assertEqual(rc_t2, 0, out_t2)

        # Once T1 and T2 are verified, status highlights the G1 stopping point.
        self.mark_verified("T1")
        self.mark_verified("T2")
        rc_st, out_st = self.run_driver("status")
        self.assertEqual(rc_st, 0, out_st)
        self.assertIn("STOPPING POINT REACHED FOR G1", out_st)

        # Even with T1 and T2 verified, T3 (Group 2) is STILL refused until
        # human check-in for G1 is approved and C1 is verified.
        rc_t3_blocked, out_t3_blocked = self.run_driver("start", "T3")
        self.assertEqual(rc_t3_blocked, driver.REFUSED, out_t3_blocked)
        self.assertIn("human check-in for G1 has not been approved", out_t3_blocked)

        # check-gate G1 fails before checkin approval.
        rc_gate_before, _ = self.run_driver("check-gate", "G1")
        self.assertEqual(rc_gate_before, 1)

        # Human operator approves Group 1 check-in.
        rc_chk, out_chk = self.run_driver(
            "checkin",
            "G1",
            "--approve",
            "--notes",
            "Reviewed KAN-460 and KAN-461 PRs; pytest green.",
        )
        self.assertEqual(rc_chk, 0, out_chk)
        self.assertIn("CHECKIN APPROVED — G1", out_chk)

        # check-gate G1 now exits 0.
        rc_gate_after, out_gate_after = self.run_driver("check-gate", "G1")
        self.assertEqual(rc_gate_after, 0, out_gate_after)

        # Complete C1 stopping-point task -> T3 and T4 in Group 2 are now unlocked!
        self.mark_verified("C1")
        rc_t3_ok, out_t3_ok = self.run_driver("start", "T3", "--dry-run")
        self.assertEqual(rc_t3_ok, 0, out_t3_ok)
        rc_t4_ok, out_t4_ok = self.run_driver("start", "T4", "--dry-run")
        self.assertEqual(rc_t4_ok, 0, out_t4_ok)

        # Group 3 (T5) remains blocked by Group 2's stopping point.
        rc_t5_blocked, out_t5_blocked = self.run_driver("start", "T5", "--dry-run")
        self.assertEqual(rc_t5_blocked, driver.REFUSED, out_t5_blocked)
        self.assertIn("G2", out_t5_blocked)


class RefactorHardGateTests(unittest.TestCase):
    def test_structural_gate_fails_on_unrefactored_baseline_and_passes_when_split(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo_dir = root / "Backend" / "repositories"
            repo_dir.mkdir(parents=True)
            target = repo_dir / "db_recipe_repository.py"

            # Unrefactored 1,737-line file with no extracted modules must FAIL.
            target.write_text(
                "class DbRecipeRepository:\n" + ("    pass\n" * 1736),
                encoding="utf-8",
            )
            failures = hard_gate.check_task_structure("T1", repo_root=root)
            self.assertTrue(
                any("ceiling <= 800" in f for f in failures),
                failures,
            )
            self.assertTrue(
                any("recipe_slugs.py does not exist" in f for f in failures),
                failures,
            )

            # Decomposed target (<= 800 lines) + 3 extracted modules (>= 25 lines each) must PASS.
            target.write_text(
                "class DbRecipeRepository:\n" + ("    pass\n" * 400),
                encoding="utf-8",
            )
            for mod in (
                "recipe_slugs.py",
                "recipe_worker_ops.py",
                "recipe_image_queue.py",
            ):
                (repo_dir / mod).write_text(
                    "# extracted module\n" * 30,
                    encoding="utf-8",
                )
            failures_after = hard_gate.check_task_structure("T1", repo_root=root)
            self.assertEqual(failures_after, [])

    def test_jira_gate_checks_refactor_label_and_status(self):
        class FakeJira:
            def issue(self, key, fields=None):
                return {
                    "key": key,
                    "fields": {
                        "summary": f"Refactor {key}",
                        "labels": ["backlog", "refactor", "backend"],
                        "status": {
                            "name": "In Progress",
                            "statusCategory": {"key": "indeterminate"},
                        },
                    },
                }

        with patch.object(hard_gate, "Jira", return_value=FakeJira()):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                rc = hard_gate.main(["--issues", "KAN-460", "KAN-461"])
            self.assertEqual(rc, 0, out.getvalue())

            # With --require-done, In Progress must fail.
            out_done = io.StringIO()
            with contextlib.redirect_stdout(out_done):
                rc_done = hard_gate.main(
                    ["--issues", "KAN-460", "--require-done"]
                )
            self.assertEqual(rc_done, 1, out_done.getvalue())


if __name__ == "__main__":
    unittest.main()
