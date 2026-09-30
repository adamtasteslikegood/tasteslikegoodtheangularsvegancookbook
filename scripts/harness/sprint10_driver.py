#!/usr/bin/env python3
"""Sprint 10 PM driver — one controller state per SI, started in charter order.

The pinned agent-harness ``loop_controller.py`` runs one plan strictly in list
order, drops lane and gate metadata at ``init``, and keeps a single global
iteration counter. One monolithic Sprint 10 plan therefore cannot run the
charter's parallel lanes, and cannot enforce D6 ("3 attempts per task, 12
iterations per goal, WIP <= 3"). Copilot on #3540 found both; this driver is
the fix, and it leaves the controller untouched.

How it maps D6
--------------
* **Goal = one SI (one task).** ``start`` writes a one-task plan for that task
  and initializes its own state, capped at 12 iterations and 3 attempts. A
  happy-path task costs 3 iterations (execute record, verify run, manual-evidence
  record) and a failed attempt at most 3, so 3 attempts fit inside 12. This is a
  reading of "goal", named in the plan and README so Adam can overrule it.
* **Order.** Each task in ``SPRINT_10_HARNESS_PLAN.json`` carries ``depends_on``;
  ``start`` refuses until every dependency's state is verified.
* **WIP <= 3.** ``start`` refuses while 3 task states are open (started and not
  verified; an escalated task still occupies its slot until a human resolves it).
  A task that is only waiting out a time window holds no slot (Adam,
  2026-09-30): ``soak T1 --until <iso> --reason ...`` marks it, and the mark is
  honoured only while the controller status is ``verifying`` and the deadline
  has not passed. ``unsoak`` clears it.
* **Irreversible starts.** A task with ``requires_done`` (T11, the launch post)
  refuses unless every listed Jira row is exactly ``Done``. ``In Review`` is not
  enough: the post cannot be taken back, so the check runs before the work, not
  in verification after it.

The driver only decides whether a task may start. Everything after that is the
plain controller: ``next`` / ``record`` / ``verify`` / ``close`` with
``--state .agent-harness/sprint10/<T>.state.json``.

Usage
-----
    python3 scripts/harness/sprint10_driver.py status
    python3 scripts/harness/sprint10_driver.py start T1
    python3 scripts/harness/sprint10_driver.py start T11 --dry-run

Exit codes: 0 ok · 2 configuration or API error · 3 start refused.
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
sys.path.insert(0, str(REPO / "scripts" / "pm"))
PLAN = REPO / "specs" / "harness" / "SPRINT_10_HARNESS_PLAN.json"
CONTROLLER = os.environ.get(
    "HARNESS_CONTROLLER",
    str(Path.home() / ".claude/plugins/cache/claude-code-skills/agent-harness/"
        "1.0.0/skills/agent-harness/scripts/loop_controller.py"))

GOAL_ITERATIONS = 12   # D6: 12 iterations per goal, goal = one SI
TASK_ATTEMPTS = 3      # D6: 3 attempts per task
WIP_LIMIT = 3          # D6: WIP <= 3
REFUSED = 3


def default_state_dir():
    """The shared state dir in the MAIN checkout, even from a linked worktree.

    WIP, the start lock and D6 all depend on one state dir shared by every lane
    session. Deriving it from ``__file__`` would give each worktree its own, so a
    session that omitted ``--state-dir`` would see an empty board and start a
    fourth task. ``repo_root()`` resolves ``--git-common-dir``, as the Jira client
    does for ``.env``.
    """
    from _jira_client import repo_root
    return repo_root() / ".agent-harness" / "sprint10"


def load_plan(path=PLAN):
    return json.loads(Path(path).read_text())


def task_state(state_dir, task_id):
    """not-started | open | escalated | verified, read from the task's state."""
    path = Path(state_dir) / ("%s.state.json" % task_id)
    if not path.exists():
        return "not-started"
    state = json.loads(path.read_text())
    status = state["tasks"][0]["status"]
    if status in ("verified", "waived"):
        return "verified"
    return "escalated" if status == "escalated" else "open"


def raw_status(state_dir, task_id):
    """The controller's own task status (pending, verifying, ...), or None."""
    path = Path(state_dir) / ("%s.state.json" % task_id)
    if not path.exists():
        return None
    return json.loads(path.read_text())["tasks"][0]["status"]


def soak_until(state_dir, task_id, now=None):
    """The soak deadline if ``task_id`` is soaking right now, else None.

    Soaking (Adam, 2026-09-30): a task whose work is done and whose only
    remaining evidence is a time window (T1's 24 h Datadog window, T2's 72 h
    RUM window) holds no WIP slot. It is honoured only while the controller
    status is ``verifying`` and the deadline has not passed: once the window
    ends, collecting the evidence is active work again, and a task sent back
    to execute was never just waiting.

    A soak mark written during an earlier ``verifying`` spell is stale after a
    ``verifying → other → verifying`` bounce: the docstring says "sent back to
    execute was never just waiting", so re-entry into ``verifying`` requires a
    fresh operator ``soak`` call. Detected by mtime: if the state file was
    modified after the soak file, some transition happened in between.
    """
    path = Path(state_dir) / ("%s.soak.json" % task_id)
    state_path = Path(state_dir) / ("%s.state.json" % task_id)
    if not path.exists() or raw_status(state_dir, task_id) != "verifying":
        return None
    if state_path.stat().st_mtime > path.stat().st_mtime:
        return None
    until = datetime.fromisoformat(json.loads(path.read_text())["until"])
    now = now or datetime.now(timezone.utc)
    return until if now < until else None


def snapshot(plan, state_dir, now=None):
    states = {t["id"]: task_state(state_dir, t["id"]) for t in plan["tasks"]}
    wip = sorted(k for k, v in states.items()
                 if v == "escalated"
                 or (v == "open" and soak_until(state_dir, k, now) is None))
    return states, wip


def refusals(plan, task_id, state_dir, jira_factory=None):
    """Every reason ``task_id`` may not start now; empty means it may."""
    tasks = {t["id"]: t for t in plan["tasks"]}
    if task_id not in tasks:
        return ["unknown task %s" % task_id]
    task = tasks[task_id]
    states, wip = snapshot(plan, state_dir)
    reasons = []
    if states[task_id] != "not-started":
        reasons.append("%s is already %s — drive it with the controller, do not "
                       "re-initialize it" % (task_id, states[task_id]))
    waiting = [d for d in task.get("depends_on", []) if states[d] != "verified"]
    if waiting:
        reasons.append("%s depends on %s, not yet verified"
                       % (task_id, ", ".join(waiting)))
    # WIP limits how many tasks are open, not which go first. after_started
    # holds deferred tasks until the day-1 tasks have taken their slots
    # (Adam, 2026-09-29: after T0, T1, T2 and T5 open first; T10 waits).
    unstarted = [d for d in task.get("after_started", [])
                 if states[d] == "not-started"]
    if unstarted:
        reasons.append("%s waits until %s have started (day-1 priority)"
                       % (task_id, ", ".join(unstarted)))
    if len(wip) >= WIP_LIMIT:
        reasons.append("WIP is %d (%s) against the charter's limit of %d"
                       % (len(wip), ", ".join(wip), WIP_LIMIT))
    required = task.get("requires_done", [])
    if required:
        if jira_factory is None:
            from _jira_client import Jira
            jira_factory = Jira
        jira = jira_factory()
        for key in required:
            status = jira.issue(key, fields="status")["fields"]["status"]["name"]
            if status != "Done":
                reasons.append("%s is %r; %s needs it exactly Done before it "
                               "starts" % (key, status, task_id))
    return reasons


def task_plan(plan, task_id):
    """The one-task controller plan for ``task_id`` (one goal = one SI)."""
    task = dict(next(t for t in plan["tasks"] if t["id"] == task_id))
    task["max_attempts"] = TASK_ATTEMPTS
    lane = task.get("lane")
    no_touch = plan.get("lanes", {}).get(lane, {}).get("must_not_touch", [])
    if no_touch:
        # The pinned controller drops custom lane metadata at init. Put the
        # charter boundary in the retained objective so the executing agent
        # receives it in every directive.
        task["objective"] += "\n\nLANE %s MUST NOT TOUCH: %s" % (
            lane, ", ".join(no_touch))
    return {
        "schema": plan["schema"],
        "goal": "%s (%s): %s" % (task_id, task.get("si", "-"), task["done_when"]),
        "domain": plan.get("domain"),
        "charter": plan.get("charter"),
        "tasks": [task],
        "loop": {"order": "sequential", "max_loop_iterations": GOAL_ITERATIONS,
                 "escalate_on": plan["loop"].get("escalate_on", [])},
    }


def cmd_status(args):
    try:
        plan = load_plan(args.plan)
        states, wip = snapshot(plan, args.state_dir)
        print("WIP %d/%d%s" % (len(wip), WIP_LIMIT,
                               (" — " + ", ".join(wip)) if wip else ""))
        for t in plan["tasks"]:
            deps = t.get("depends_on", [])
            ready = all(states[d] == "verified" for d in deps)
            note = ""
            if states[t["id"]] == "not-started":
                note = "startable" if ready and len(wip) < WIP_LIMIT else (
                    "waiting on " + ", ".join(
                        d for d in deps if states[d] != "verified")
                    if not ready else "WIP full")
                if t.get("requires_done") and note == "startable":
                    note = "startable if %s are Done" % ", ".join(
                        t["requires_done"])
            until = soak_until(args.state_dir, t["id"])
            if until is not None:
                note = "soaking until %s (no WIP slot)" % until.isoformat()
            print("%-4s %-8s %-2s %-12s %s" % (
                t["id"], t.get("si", "-"), t.get("lane", "-"),
                states[t["id"]], note))
        return 0
    except (Exception, SystemExit) as exc:
        print("CONFIG/API ERROR: %s" % exc, file=sys.stderr)
        return 2


def cmd_start(args):
    try:
        plan = load_plan(args.plan)
        state_dir = Path(args.state_dir)
        state_dir.mkdir(parents=True, exist_ok=True)
        # Multiple lane sessions may call start concurrently. Keep the WIP
        # snapshot and controller initialization in one cross-process critical
        # section so two callers cannot both observe WIP=2 and create WIP=4.
        with (state_dir / ".start.lock").open("a") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            reasons = refusals(plan, args.task, state_dir)
            if reasons:
                print("START REFUSED — %s:" % args.task)
                for r in reasons:
                    print("  - %s" % r)
                return REFUSED
            plan_path = state_dir / ("%s.plan.json" % args.task)
            state_path = state_dir / ("%s.state.json" % args.task)
            if args.dry_run:
                print("START ALLOWED — %s (dry run; nothing initialized)" % args.task)
                return 0
            plan_path.write_text(json.dumps(task_plan(plan, args.task), indent=2) + "\n")
            proc = subprocess.run([sys.executable, args.controller, "init",
                                   "--plan", str(plan_path), "--state", str(state_path)])
            if proc.returncode != 0:
                return 2
            print("STARTED %s — drive it with: python3 %s next --state %s"
                  % (args.task, args.controller, state_path))
            return 0
    except (Exception, SystemExit) as exc:  # missing creds, guard, API/filesystem failure
        print("CONFIG/API ERROR: %s" % exc, file=sys.stderr)
        return 2


def cmd_soak(args):
    try:
        state_dir = Path(args.state_dir)
        path = state_dir / ("%s.soak.json" % args.task)
        if args.cmd == "unsoak":
            path.unlink(missing_ok=True)
            print("UNSOAKED %s — it counts toward WIP again" % args.task)
            return 0
        status = raw_status(state_dir, args.task)
        if status != "verifying":
            print("SOAK REFUSED — %s is %s; only a task whose work is recorded "
                  "(controller status verifying) can wait out a window" % (args.task, status))
            return REFUSED
        until = datetime.fromisoformat(args.until)
        if until.tzinfo is None:
            print("SOAK REFUSED — --until needs a timezone, e.g. 2026-10-01T00:10:00+00:00")
            return REFUSED
        path.write_text(json.dumps({"until": until.isoformat(), "reason": args.reason,
                                    "set_at": datetime.now(timezone.utc).isoformat()},
                                   indent=2) + "\n")
        print("SOAKING %s until %s — no WIP slot while it waits" % (args.task, until.isoformat()))
        return 0
    except (Exception, SystemExit) as exc:
        print("CONFIG/API ERROR: %s" % exc, file=sys.stderr)
        return 2


def build_parser():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--plan", default=str(PLAN))
    p.add_argument("--state-dir", default=None,
                   help="shared state dir (default: <main checkout>/.agent-harness/sprint10)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="every task's state, WIP, and what may start")
    s = sub.add_parser("start", help="initialize one task's own capped state")
    s.add_argument("task")
    s.add_argument("--controller", default=CONTROLLER)
    s.add_argument("--dry-run", action="store_true",
                   help="run every start check, initialize nothing")
    k = sub.add_parser("soak", help="mark a verifying task as only waiting out a time window")
    k.add_argument("task")
    k.add_argument("--until", required=True, help="ISO 8601 with timezone")
    k.add_argument("--reason", required=True)
    u = sub.add_parser("unsoak", help="clear a soak mark")
    u.add_argument("task")
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    if args.state_dir is None:
        args.state_dir = str(default_state_dir())
    if args.cmd in ("soak", "unsoak"):
        return cmd_soak(args)
    return cmd_status(args) if args.cmd == "status" else cmd_start(args)


if __name__ == "__main__":
    sys.exit(main())
