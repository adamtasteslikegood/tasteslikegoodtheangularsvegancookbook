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


def seam(*args):
    out = subprocess.run(
        ["bash", str(SCRIPT), *map(str, args)],
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.split("\n")[:-1]


def plan(backend_owed, cookbook_owed, step9):
    return seam("--backsync-plan", backend_owed, cookbook_owed, step9)


def step9(failed_urls, marker_hits, rendered):
    lines = seam("--step9-state", failed_urls, marker_hits, rendered)
    return lines[0] if lines else ""


class Step9StateTest(unittest.TestCase):
    def test_all_evidence_is_done(self):
        self.assertEqual(step9(0, 3, 1), "done")

    def test_marker_only_is_not_done(self):
        self.assertEqual(step9(0, 3, 0), "content-ok")

    def test_failed_url_is_not_verified(self):
        self.assertEqual(step9(1, 3, 1), "")

    def test_missing_marker_is_not_verified(self):
        self.assertEqual(step9(0, 0, 1), "")

    def test_marker_only_does_not_merge_cookbook(self):
        self.assertEqual(plan(0, 1, step9(0, 3, 0)), ["cookbook open"])

    def test_failed_url_does_not_merge_cookbook(self):
        self.assertEqual(plan(0, 1, step9(1, 3, 1)), ["cookbook open"])

    def test_full_verification_merges_cookbook(self):
        self.assertEqual(plan(0, 1, step9(0, 3, 1)), ["cookbook merge"])


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
