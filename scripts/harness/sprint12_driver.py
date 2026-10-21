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

import copy
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
REFUSED = driver.REFUSED

_orig_load_plan = driver.load_plan
_orig_carried = driver.carried
_orig_snapshot = driver.snapshot
_orig_soak_blockers = driver.soak_blockers
_orig_refusals = driver.refusals
_orig_task_plan = driver.task_plan


def _is_sprint12_plan(plan):
    return (
        isinstance(plan, dict)
        and (plan.get("jira") or {}).get("sprint_id") == hard_gate.SPRINT_ID
    )


def compile_plan(plan_or_path=PLAN, map_path=None):
    """Overlay persisted ``sprint12_rcp_map.json`` drops and swaps onto the Sprint 12 plan."""
    if isinstance(plan_or_path, dict):
        plan = copy.deepcopy(plan_or_path)
    else:
        plan = json.loads(Path(plan_or_path).read_text(encoding="utf-8"))
    if not _is_sprint12_plan(plan):
        return plan

    effective_map = Path(map_path) if map_path else Path(hard_gate.RCP_MAP_PATH)
    data = {}
    if effective_map.exists():
        try:
            data = json.loads(effective_map.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}

    swaps = list(
        data.get("swaps")
        or data.get("group_d_swaps")
        or hard_gate.SWAPS
    )
    dropped_sis = (
        set(data.get("dropped_sis") or [])
        | set(hard_gate.DROPPABLE_SIS)
        | {s.get("deferred_si") for s in swaps if s.get("deferred_si")}
    )

    if not dropped_sis and not swaps and not effective_map.exists():
        return plan

    for t in plan.get("tasks", []):
        if effective_map.exists() and t.get("jira"):
            t["jira"] = hard_gate.resolve_issue_aliases(
                t["jira"], map_path=effective_map
            )
        if t.get("si") in dropped_sis and not t.get("carried_to"):
            t["carried_to"] = (
                "next-sprint-candidate (dropped via Day-1 spillover swap)"
            )

    dropped_task_ids = {
        t["id"] for t in plan.get("tasks", []) if t.get("carried_to")
    }
    if dropped_task_ids:
        for t in plan.get("tasks", []):
            if t.get("depends_on"):
                t["depends_on"] = [
                    d for d in t["depends_on"] if d not in dropped_task_ids
                ]
            if t.get("after_started"):
                t["after_started"] = [
                    d for d in t["after_started"] if d not in dropped_task_ids
                ]

    if swaps:
        plan["spillover_swaps"] = [dict(s) for s in swaps]
        carried_keys = []
        for s in swaps:
            for k in (s.get("carried_in"), s.get("acceptance_rcp")):
                if k and k not in carried_keys:
                    carried_keys.append(k)
        for t in plan.get("tasks", []):
            if t.get("si") == "close":
                for k in carried_keys:
                    if k not in t["jira"]:
                        t["jira"].append(k)
                if carried_keys:
                    cmd = (
                        "python3 scripts/harness/sprint12_hard_gate.py "
                        "--require-done --issues " + " ".join(carried_keys)
                    )
                    if not any(
                        c.get("cmd") == cmd for c in t.get("verification", [])
                    ):
                        t["verification"].insert(
                            0,
                            {
                                "cmd": cmd,
                                "expect_exit": 0,
                                "kind": "board",
                            },
                        )

    if dropped_sis:
        plan["dropped_sis"] = sorted(dropped_sis)
    return plan


def load_plan(path=PLAN, map_path=None):
    raw = _orig_load_plan(path)
    if _is_sprint12_plan(raw):
        return compile_plan(raw, map_path=map_path)
    return raw


def carried(plan):
    return _orig_carried(compile_plan(plan) if _is_sprint12_plan(plan) else plan)


def snapshot(plan, state_dir, now=None):
    return _orig_snapshot(
        compile_plan(plan) if _is_sprint12_plan(plan) else plan,
        state_dir,
        now=now,
    )


def soak_blockers(plan, state_dir, now=None):
    return _orig_soak_blockers(
        compile_plan(plan) if _is_sprint12_plan(plan) else plan,
        state_dir,
        now=now,
    )


def refusals(plan, task_id, state_dir, jira_factory=None):
    return _orig_refusals(
        compile_plan(plan) if _is_sprint12_plan(plan) else plan,
        task_id,
        state_dir,
        jira_factory=jira_factory,
    )


def task_plan(plan, task_id):
    return _orig_task_plan(
        compile_plan(plan) if _is_sprint12_plan(plan) else plan,
        task_id,
    )


driver.load_plan = load_plan
driver.carried = carried
driver.snapshot = snapshot
driver.soak_blockers = soak_blockers
driver.refusals = refusals
driver.task_plan = task_plan


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
        qa_res = plan_qa.qa(compile_plan(PLAN))
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

