"""train-run.sh back-sync plan: the cookbook half merges only after step 9.

RUNBOOK step 8: the Backend back-sync merges any time; the cookbook back-sync
opens before production is verified and merges only once step 9 is recorded
as done. Runs the driver's --backsync-plan seam, which touches no repo or
network.
"""

import pathlib
import subprocess
import unittest

SCRIPT = pathlib.Path(__file__).with_name("train-run.sh")


def plan(backend_owed, cookbook_owed, step9):
    out = subprocess.run(
        ["bash", str(SCRIPT), "--backsync-plan", str(backend_owed), str(cookbook_owed), step9],
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.split("\n")[:-1]


class BacksyncPlanTest(unittest.TestCase):
    def test_before_verification_cookbook_opens_only(self):
        self.assertEqual(plan(2, 3, ""), ["backend merge", "cookbook open"])

    def test_after_verification_cookbook_merges(self):
        self.assertEqual(plan(2, 3, "done"), ["backend merge", "cookbook merge"])

    def test_backend_merges_without_verification(self):
        self.assertEqual(plan(1, 0, ""), ["backend merge"])

    def test_cookbook_alone_before_verification(self):
        self.assertEqual(plan(0, 1, ""), ["cookbook open"])

    def test_nothing_owed(self):
        self.assertEqual(plan(0, 0, "done"), [])


if __name__ == "__main__":
    unittest.main()
