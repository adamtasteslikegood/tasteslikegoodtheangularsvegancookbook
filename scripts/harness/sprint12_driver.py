#!/usr/bin/env python3
"""Sprint 12 PM driver — the Sprint 10/11 driver run against the Sprint 12 plan.

The rules are ``sprint10_driver.py``'s, unchanged: one controller state per SI,
``depends_on`` order, exact-Done starts (``requires_done``), WIP <= 3, 12
iterations and 3 attempts per SI, and ``soak`` for a task whose only remaining
evidence is a time window. Only the plan and the state dir differ:

* plan:  ``specs/harness/SPRINT_12_HARNESS_PLAN.json``
* state: ``<main checkout>/.agent-harness/sprint12/`` (gitignored)

Usage::

    python3 scripts/harness/sprint12_driver.py status
    python3 scripts/harness/sprint12_driver.py --status
    python3 scripts/harness/sprint12_driver.py --day1-cutover [--dry-run] [--apply-spillover-swaps] [--json]
    python3 scripts/harness/sprint12_driver.py --check-spillover [--dry-run] [--json]
    python3 scripts/harness/sprint12_driver.py --verify-process-lane [--json]
    python3 scripts/harness/sprint12_driver.py start T0
    python3 scripts/harness/sprint12_driver.py start T1 --dry-run

Exit codes are the Sprint 10 driver's: 0 ok, 2 config/API error, 3 refused.
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO / ".claude" / "skills" / "harness-qa-loop"))
import plan_qa  # noqa: E402
import sprint10_driver as driver  # noqa: E402
import sprint12_hard_gate as hard_gate  # noqa: E402

PLAN = REPO / "specs" / "harness" / "SPRINT_12_HARNESS_PLAN.json"
STATE_NAME = "sprint12"
PROCESS_LANE_KEYS = ["KAN-188", "KAN-429", "KAN-402", "KAN-390"]


def _forward_cutover_flags(args, base_flag):
    hg_args = [base_flag]
    for flag in ("--dry-run", "--apply-spillover-swaps", "--json"):
        if flag in args:
            hg_args.append(flag)
    for opt in ("--max-spillover", "--override-spillover-reason"):
        if opt in args:
            idx = args.index(opt)
            if idx + 1 < len(args):
                hg_args.extend([opt, args[idx + 1]])
            continue
        prefix = opt + "="
        for a in args:
            if a.startswith(prefix):
                hg_args.append(a)
                break
    return hg_args


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if "--day1-cutover" in args:
        hg_args = _forward_cutover_flags(args, "--day1-cutover")
        rc = hard_gate.main(hg_args)
        if rc != 0:
            return rc
        qa_res = plan_qa.qa(json.loads(PLAN.read_text(encoding="utf-8")))
        if qa_res.get("blockers") or qa_res.get("warnings"):
            print("PLAN QA FAILED during --day1-cutover", file=sys.stderr)
            return 1
        if "--json" not in args:
            print(
                "NEXT: python3 scripts/harness/sprint12_driver.py start T0"
            )
        return 0
    if "--check-spillover" in args:
        hg_args = _forward_cutover_flags(args, "--check-spillover")
        return hard_gate.main(hg_args)
    if "--verify-process-lane" in args:
        hg_args = ["--require-done", "--issues", *PROCESS_LANE_KEYS]
        if "--json" in args:
            hg_args.append("--json")
        return hard_gate.main(hg_args)
    normalized = ["status" if a == "--status" else a for a in args]
    return driver.main(
        normalized, plan=PLAN, state_name=STATE_NAME, description=__doc__
    )


if __name__ == "__main__":
    sys.exit(main())

