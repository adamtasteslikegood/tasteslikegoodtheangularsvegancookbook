#!/usr/bin/env python3
"""Refactoring Backlog Driver — drives KAN-460..KAN-467 in 4 groups with human check-in stopping points.

Built on ``sprint10_driver.py``'s per-task controller pattern, extended with
**group barriers and mandatory human check-in gates** between groups:

* **Group 1 (`G1`, Backend Core):** `T1` (`KAN-460`) + `T2` (`KAN-461`) -> **STOPPING POINT `C1` (`G1-CHECKIN`)**
* **Group 2 (`G2`, Backend API/Auth):** `T3` (`KAN-462`) + `T4` (`KAN-463`) -> **STOPPING POINT `C2` (`G2-CHECKIN`)**
* **Group 3 (`G3`, Cookbook SPA):** `T5` (`KAN-464`) + `T6` (`KAN-465`) -> **STOPPING POINT `C3` (`G3-CHECKIN`)**
* **Group 4 (`G4`, SSR & Tooling):** `T7` (`KAN-466`) + `T8` (`KAN-467`) -> **STOPPING POINT `C4` (`G4-CHECKIN`)**

How stopping points work
------------------------
1. Within an unlocked group (e.g. `G1`), up to `WIP <= 2` refactoring tasks (`T1`, `T2`)
   can be started and driven through `loop_controller.py` (`execute` -> `verify` -> `close`).
2. Once all refactoring tasks in Group `G<N>` are `verified`, the loop reaches the
   group stopping point (`C<N>`):
   - Any attempt to `start` a task in Group `G<N+1>` is **refused (exit 3)** until:
     a) all tasks in `G<N>` are `verified`,
     b) the human check-in gate `<state_dir>/G<N>.checkin.json` is recorded via
        `checkin G<N> --approve --notes "..."`, AND
     c) the check-in task `C<N>` itself is `verified`.
3. `checkin G<N> --approve --notes "..."` refuses (exit 3) if any refactoring task in
   `G<N>` is not yet `verified`, preventing premature sign-off.

Usage::

    python3 scripts/harness/refactor_driver.py status
    python3 scripts/harness/refactor_driver.py start T1
    python3 scripts/harness/refactor_driver.py start T2 --dry-run
    python3 scripts/harness/refactor_driver.py start C1
    python3 scripts/harness/refactor_driver.py checkin G1 --approve --notes "Reviewed KAN-460/461 PRs and pytest output"
    python3 scripts/harness/refactor_driver.py check-gate G1

Exit codes: 0 ok · 1 check-gate failed · 2 config/API error · 3 refused.
"""

import argparse
import fcntl
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO / ".claude" / "skills" / "harness-qa-loop"))
import sprint10_driver as base_driver  # noqa: E402

PLAN = REPO / "specs" / "harness" / "REFACTOR_HARNESS_PLAN.json"
STATE_NAME = "refactor"
WIP_LIMIT = 2
GOAL_ITERATIONS = 12
TASK_ATTEMPTS = 3
REFUSED = base_driver.REFUSED
CONTROLLER = base_driver.CONTROLLER


def default_state_dir(name: str = STATE_NAME) -> Path:
    return base_driver.default_state_dir(name)


def load_plan(path=PLAN) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def checkin_path(state_dir: Path, group_id: str) -> Path:
    return Path(state_dir) / f"{group_id}.checkin.json"


def load_checkin(state_dir: Path, group_id: str):
    path = checkin_path(state_dir, group_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def is_group_checkin_approved(state_dir: Path, group_id: str) -> bool:
    data = load_checkin(state_dir, group_id)
    return bool(
        data
        and data.get("approved") is True
        and str(data.get("notes") or "").strip()
    )


def snapshot(plan: dict, state_dir: Path):
    states = {
        t["id"]: base_driver.task_state(state_dir, t["id"])
        for t in plan.get("tasks", [])
    }
    wip = sorted(
        tid for tid, st in states.items() if st in ("open", "escalated")
    )
    return states, wip


def group_summary(plan: dict, state_dir: Path, group_id: str) -> dict:
    groups = plan.get("groups") or {}
    grp = groups[group_id]
    states, _ = snapshot(plan, state_dir)
    task_ids = list(grp.get("tasks") or [])
    checkin_tid = grp.get("checkin_task")
    all_tasks_verified = all(states.get(tid) == "verified" for tid in task_ids)
    approved = is_group_checkin_approved(state_dir, group_id)
    checkin_task_verified = (
        states.get(checkin_tid) == "verified" if checkin_tid else True
    )
    if all_tasks_verified and approved and checkin_task_verified:
        phase = "completed"
    elif all_tasks_verified and not (approved and checkin_task_verified):
        phase = "stopped-for-checkin"
    elif any(states.get(tid) != "not-started" for tid in task_ids):
        phase = "in-progress"
    else:
        phase = "pending"
    return {
        "group": group_id,
        "name": grp.get("name", group_id),
        "tasks": task_ids,
        "checkin_task": checkin_tid,
        "all_tasks_verified": all_tasks_verified,
        "checkin_approved": approved,
        "checkin_task_verified": checkin_task_verified,
        "phase": phase,
    }


def refusals(plan: dict, task_id: str, state_dir: Path) -> list:
    tasks = {t["id"]: t for t in plan.get("tasks", [])}
    if task_id not in tasks:
        return [f"unknown task {task_id}"]
    task = tasks[task_id]
    states, wip = snapshot(plan, state_dir)
    reasons = []

    if states[task_id] != "not-started":
        reasons.append(
            f"{task_id} is already {states[task_id]} — drive it with the controller, "
            f"do not re-initialize it"
        )

    # Enforce group check-in barrier before any task in a dependent group may start.
    groups = plan.get("groups") or {}
    group_id = task.get("group")
    grp = groups.get(group_id) or {}
    prev_group_id = grp.get("depends_on_group")
    if prev_group_id and prev_group_id in groups:
        prev_grp = groups[prev_group_id]
        prev_tasks = prev_grp.get("tasks") or []
        unverified_prev = [
            tid for tid in prev_tasks if states.get(tid) != "verified"
        ]
        if unverified_prev:
            reasons.append(
                f"{task_id} belongs to {group_id}, which waits for {prev_group_id} "
                f"tasks ({', '.join(unverified_prev)}) to be verified"
            )
        if not is_group_checkin_approved(state_dir, prev_group_id):
            reasons.append(
                f"{task_id} is blocked by {prev_group_id} stopping point: human check-in "
                f"for {prev_group_id} has not been approved yet "
                f"(`python3 scripts/harness/refactor_driver.py checkin {prev_group_id} --approve --notes \"...\"`)"
            )
        prev_checkin_tid = prev_grp.get("checkin_task")
        if prev_checkin_tid and states.get(prev_checkin_tid) != "verified":
            reasons.append(
                f"{task_id} waits for {prev_group_id} check-in task {prev_checkin_tid} "
                f"to be verified"
            )

    waiting = [
        d for d in task.get("depends_on", []) if states.get(d) != "verified"
    ]
    if waiting:
        reasons.append(
            f"{task_id} depends on {', '.join(waiting)}, not yet verified"
        )

    if len(wip) >= WIP_LIMIT:
        reasons.append(
            f"WIP is {len(wip)} ({', '.join(wip)}) against the group limit of {WIP_LIMIT}"
        )

    return reasons


def task_plan(plan: dict, task_id: str) -> dict:
    task = dict(next(t for t in plan["tasks"] if t["id"] == task_id))
    task["max_attempts"] = TASK_ATTEMPTS
    lane = task.get("lane")
    no_touch = plan.get("lanes", {}).get(lane, {}).get("must_not_touch", [])
    if no_touch:
        task["objective"] += "\n\nLANE %s MUST NOT TOUCH: %s" % (
            lane,
            ", ".join(no_touch),
        )
    return {
        "schema": plan["schema"],
        "goal": "%s (%s, %s): %s"
        % (
            task_id,
            task.get("si", "-"),
            task.get("group", "-"),
            task["done_when"],
        ),
        "domain": plan.get("domain"),
        "charter": plan.get("charter"),
        "tasks": [task],
        "loop": {
            "order": "sequential",
            "max_loop_iterations": GOAL_ITERATIONS,
            "escalate_on": plan.get("loop", {}).get("escalate_on", []),
        },
    }


def cmd_status(args) -> int:
    try:
        plan = load_plan(args.plan)
        state_dir = Path(args.state_dir)
        states, wip = snapshot(plan, state_dir)
        print(
            "WIP %d/%d%s"
            % (
                len(wip),
                WIP_LIMIT,
                (" — " + ", ".join(wip)) if wip else "",
            )
        )
        groups = plan.get("groups") or {}
        tasks_by_id = {t["id"]: t for t in plan.get("tasks", [])}
        for gid in ("G1", "G2", "G3", "G4"):
            if gid not in groups:
                continue
            gs = group_summary(plan, state_dir, gid)
            chk_status = (
                "APPROVED"
                if gs["checkin_approved"]
                else ("READY FOR CHECK-IN" if gs["all_tasks_verified"] else "pending")
            )
            print(
                f"\n=== {gid}: {gs['name']} [{gs['phase'].upper()} | check-in: {chk_status}] ==="
            )
            member_ids = list(gs["tasks"]) + (
                [gs["checkin_task"]] if gs["checkin_task"] else []
            )
            for tid in member_ids:
                t = tasks_by_id[tid]
                st = states[tid]
                reasons = refusals(plan, tid, state_dir) if st == "not-started" else []
                if st == "not-started":
                    note = "startable" if not reasons else f"blocked ({reasons[0]})"
                elif tid == gs["checkin_task"] and st != "verified":
                    note = (
                        "STOPPING POINT — run `checkin %s --approve --notes ...` then verify %s"
                        % (gid, tid)
                    )
                else:
                    note = ""
                jira_str = ",".join(t.get("jira") or [])
                print(
                    "  %-4s %-12s %-14s %-12s %s"
                    % (tid, t.get("si", "-"), jira_str, st, note)
                )
            if gs["phase"] == "stopped-for-checkin":
                print(
                    f"  >>> STOPPING POINT REACHED FOR {gid}: pause loop and check in with human operator."
                )
                print(
                    f"      Approve with: python3 scripts/harness/refactor_driver.py checkin {gid} --approve --notes \"<review summary>\""
                )
        return 0
    except (Exception, SystemExit) as exc:
        print(f"CONFIG/API ERROR: {exc}", file=sys.stderr)
        return 2


def cmd_start(args) -> int:
    try:
        plan = load_plan(args.plan)
        state_dir = Path(args.state_dir)
        state_dir.mkdir(parents=True, exist_ok=True)
        with (state_dir / ".start.lock").open("a") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            reasons = refusals(plan, args.task, state_dir)
            if reasons:
                print(f"START REFUSED — {args.task}:")
                for r in reasons:
                    print(f"  - {r}")
                return REFUSED
            plan_path = state_dir / f"{args.task}.plan.json"
            state_path = state_dir / f"{args.task}.state.json"
            if args.dry_run:
                print(
                    f"START ALLOWED — {args.task} (dry run; nothing initialized)"
                )
                return 0
            plan_path.write_text(
                json.dumps(task_plan(plan, args.task), indent=2) + "\n",
                encoding="utf-8",
            )
            proc = subprocess.run(
                [
                    sys.executable,
                    args.controller,
                    "init",
                    "--plan",
                    str(plan_path),
                    "--state",
                    str(state_path),
                ]
            )
            if proc.returncode != 0:
                return 2
            print(
                f"STARTED {args.task} — drive it with: python3 {args.controller} next --state {state_path}"
            )
            return 0
    except (Exception, SystemExit) as exc:
        print(f"CONFIG/API ERROR: {exc}", file=sys.stderr)
        return 2


def cmd_checkin(args) -> int:
    try:
        plan = load_plan(args.plan)
        groups = plan.get("groups") or {}
        if args.group not in groups:
            print(f"CHECKIN REFUSED — unknown group {args.group!r}")
            return REFUSED
        state_dir = Path(args.state_dir)
        state_dir.mkdir(parents=True, exist_ok=True)
        grp = groups[args.group]
        states, _ = snapshot(plan, state_dir)

        if args.revoke:
            cpath = checkin_path(state_dir, args.group)
            if cpath.exists():
                cpath.unlink()
            print(f"CHECKIN REVOKED — {args.group}")
            return 0

        if not args.approve:
            print(
                f"CHECKIN REFUSED — pass `--approve --notes \"<summary>\"` to approve {args.group}"
            )
            return REFUSED

        notes = (args.notes or "").strip()
        if not notes:
            print(
                f"CHECKIN REFUSED — `--notes` must be non-empty when approving {args.group}"
            )
            return REFUSED

        unverified = [
            tid for tid in grp.get("tasks", []) if states.get(tid) != "verified"
        ]
        if unverified:
            print(
                f"CHECKIN REFUSED — {args.group} tasks {', '.join(unverified)} are not yet verified "
                f"(states: {', '.join(f'{t}={states.get(t)}' for t in grp.get('tasks', []))})"
            )
            return REFUSED

        record = {
            "group": args.group,
            "name": grp.get("name", args.group),
            "approved": True,
            "reviewer": args.reviewer,
            "notes": notes,
            "verified_tasks": list(grp.get("tasks", [])),
            "jira": list(grp.get("jira", [])),
            "approved_at": datetime.now(timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            ),
        }
        cpath = checkin_path(state_dir, args.group)
        cpath.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        checkin_tid = grp.get("checkin_task")
        print(
            f"CHECKIN APPROVED — {args.group} recorded at {cpath} (tasks: {', '.join(record['verified_tasks'])})"
        )
        if checkin_tid:
            print(
                f"NEXT: finish stopping-point task {checkin_tid} (`verify` + `record --phase verify` + `close`) to unlock the next group."
            )
        return 0
    except (Exception, SystemExit) as exc:
        print(f"CONFIG/API ERROR: {exc}", file=sys.stderr)
        return 2


def cmd_check_gate(args) -> int:
    try:
        plan = load_plan(args.plan)
        groups = plan.get("groups") or {}
        if args.group not in groups:
            print(f"CHECK-GATE FAILED — unknown group {args.group!r}")
            return 1
        state_dir = Path(args.state_dir)
        grp = groups[args.group]
        states, _ = snapshot(plan, state_dir)
        unverified = [
            tid for tid in grp.get("tasks", []) if states.get(tid) != "verified"
        ]
        if unverified:
            print(
                f"CHECK-GATE FAILED — {args.group} has unverified tasks: {', '.join(unverified)}"
            )
            return 1
        if not is_group_checkin_approved(state_dir, args.group):
            print(
                f"CHECK-GATE FAILED — human check-in for {args.group} is not recorded/approved "
                f"(expected {checkin_path(state_dir, args.group)})"
            )
            return 1
        data = load_checkin(state_dir, args.group)
        print(
            f"CHECK-GATE PASSED — {args.group} approved at {data.get('approved_at')} "
            f"by {data.get('reviewer')}: {data.get('notes')}"
        )
        return 0
    except (Exception, SystemExit) as exc:
        print(f"CONFIG/API ERROR: {exc}", file=sys.stderr)
        return 2


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--plan", default=str(PLAN))
    p.add_argument(
        "--state-dir",
        default=None,
        help=f"shared state dir (default: <main checkout>/.agent-harness/{STATE_NAME})",
    )
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser(
        "status",
        help="show every group (G1..G4), task state, WIP, and active stopping point",
    )
    s = sub.add_parser("start", help="initialize one task's own capped state")
    s.add_argument("task")
    s.add_argument("--controller", default=CONTROLLER)
    s.add_argument(
        "--dry-run",
        action="store_true",
        help="run every start and group-barrier check, initialize nothing",
    )
    c = sub.add_parser(
        "checkin",
        help="record human check-in approval at a group stopping point (G1..G4)",
    )
    c.add_argument("group", choices=["G1", "G2", "G3", "G4"])
    c.add_argument(
        "--approve",
        action="store_true",
        help="approve the group check-in after reviewing its verified tasks",
    )
    c.add_argument(
        "--revoke",
        action="store_true",
        help="remove an existing group check-in approval",
    )
    c.add_argument(
        "--notes",
        default="",
        help="human review summary / check-in notes (required with --approve)",
    )
    c.add_argument(
        "--reviewer",
        default=os.environ.get("USER", "human-operator"),
        help="reviewer identifier recorded in <group>.checkin.json",
    )
    g = sub.add_parser(
        "check-gate",
        help="verify that a group's tasks are verified and its human check-in is approved",
    )
    g.add_argument("group", choices=["G1", "G2", "G3", "G4"])
    return p


def main(argv=None) -> int:
    args_list = list(sys.argv[1:] if argv is None else argv)
    normalized = ["status" if a == "--status" else a for a in args_list]
    parser = build_parser()
    args = parser.parse_args(normalized)
    if args.state_dir is None:
        args.state_dir = str(default_state_dir(STATE_NAME))
    if args.cmd == "status":
        return cmd_status(args)
    if args.cmd == "start":
        return cmd_start(args)
    if args.cmd == "checkin":
        return cmd_checkin(args)
    if args.cmd == "check-gate":
        return cmd_check_gate(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
