#!/usr/bin/env python3
"""Sprint 9 board operations — the mutating half of the harness's Jira wiring.

The read-only gate lives in ``sprint9_hard_gate.py`` and is deliberately a
SEPARATE file: the harness is judged by that gate, so nothing that mutates the
board shares a module with it.

Subcommands
-----------
``status``       print every Sprint 9 issue with status + category (read-only)
``create``       create Sprint 9 on the RCP scrum board and start it
``add``          add the charter's issues to Sprint 9
``reset-truth``  undo bulk automation sweeps by replaying each issue's own
                 changelog backwards — restores the last status a HUMAN put the
                 issue in, per-issue, never uniformly

Why ``reset-truth`` exists
--------------------------
Two "Automation for Jira" runs corrupted the Sprint 9 board on 2026-08-27:
11:28:16Z moved a batch ``To Do -> In Progress``, and 16:58:34Z moved everything
``-> Done`` — including three bugs filed that morning and never worked. A board
that reports Done (or In Progress) for unstarted work makes the harness's hard
gate pass vacuously, which is the same failure mode the Sprint 9 charter names
in R2.

Repairing only the most recent sweep is not enough: it would leave those rows at
a fabricated "In Progress" that satisfies a no-To-Do gate without any work
happening. So the rule is **the last human-authored status is the truth**. Walk
each issue's changelog back over the trailing run of bot-authored transitions
and restore what the last human set — or, when a bot has driven the row its
whole life, the status it was originally created in.
"""

import argparse
import datetime
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _jira_client import Jira  # noqa: E402

RCP_SCRUM_BOARD = 168          # Sprint 8's originBoardId — sprints must match
SPRINT_NAME = "Sprint 9"
SPRINT_GOAL = ("Nav-away lifecycle fixes, Valkey response-cache restore (KAN-151), "
               "staging->GCP Cloud Build cutover, v0.4.13.")

# The nine committed SIs from specs/SPRINT_9_PLAN.md, plus the delivery epic.
CHARTER_ISSUES = [
    "RCP-88",                       # epic
    "KAN-255", "KAN-256",           # S1a
    "KAN-257",                      # S1b
    "KAN-151",                      # S2  (anchor)
    "KAN-249", "KAN-250",           # S3
    "KAN-258",                      # S4  (filed 2026-08-27; the charter's S4 cited
                                    #      KAN-248, which is really the staging-DB
                                    #      subtask of KAN-244 — see KAN-258)
    "KAN-209",                      # S5  (droppable)
    "KAN-195",                      # S6
    "RCP-67",                       # S7  (droppable)
    "KAN-176",                      # S8  (droppable)
]

# Display-name substrings whose status transitions carry no human intent. A row
# driven only by these is, for board-truth purposes, untouched.
BOT_ACTORS = ("Automation for Jira",)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def find_sprint(jira, name=SPRINT_NAME, board=RCP_SCRUM_BOARD):
    for s in jira.sprints(board):
        if s["name"].strip().lower() == name.strip().lower():
            return s
    return None


def cmd_status(jira, args):
    sprint = find_sprint(jira)
    rows = []
    if sprint:
        members = {i["key"] for i in jira.sprint_issues(sprint["id"])}
    else:
        members = set()
    for key in CHARTER_ISSUES:
        f = jira.issue(key)["fields"]
        rows.append({
            "key": key,
            "status": f["status"]["name"],
            "category": f["status"]["statusCategory"]["name"],
            "resolution": (f.get("resolution") or {}).get("name"),
            "in_sprint": key in members,
            "summary": f["summary"][:60],
        })
    print(json.dumps({
        "sprint": {"id": sprint["id"], "state": sprint["state"]} if sprint else None,
        "issues": rows,
    }, indent=2))
    return 0


def cmd_create(jira, args):
    existing = find_sprint(jira)
    if existing:
        print("Sprint 9 already exists: id=%d state=%s" % (existing["id"], existing["state"]))
        sprint = existing
    else:
        start = datetime.datetime.now(datetime.timezone.utc)
        end = start + datetime.timedelta(days=args.days)
        sprint = jira.create_sprint(RCP_SCRUM_BOARD, SPRINT_NAME, iso(start), iso(end), SPRINT_GOAL)
        print("created sprint id=%d" % sprint["id"])
    if sprint.get("state") == "future" and not args.no_start:
        start = datetime.datetime.now(datetime.timezone.utc)
        end = start + datetime.timedelta(days=args.days)
        jira.start_sprint(sprint["id"], iso(start), iso(end))
        print("started sprint id=%d (%d-day box)" % (sprint["id"], args.days))
    return 0


def cmd_add(jira, args):
    sprint = find_sprint(jira)
    if not sprint:
        print("Sprint 9 does not exist — run `create` first", file=sys.stderr)
        return 1
    members = {i["key"] for i in jira.sprint_issues(sprint["id"])}
    todo = [k for k in CHARTER_ISSUES + list(args.extra) if k not in members]
    if not todo:
        print("all charter issues already in Sprint 9")
        return 0
    # Sub-tasks and cross-project rows can be refused individually; add one at a
    # time so one rejection does not silently drop the rest of the batch.
    failed = []
    for key in todo:
        try:
            jira.add_to_sprint(sprint["id"], [key])
            print("added %s" % key)
        except RuntimeError as exc:
            failed.append((key, str(exc)[:160]))
            print("FAILED %s: %s" % (key, str(exc)[:160]), file=sys.stderr)
    return 1 if failed else 0


def _status_transitions(data):
    """Every status change on an issue, oldest first."""
    out = []
    for h in data["changelog"]["histories"]:
        for it in h["items"]:
            if it["field"] == "status":
                out.append({"at": h["created"], "author": h["author"]["displayName"],
                            "from": it["fromString"], "to": it["toString"]})
    out.sort(key=lambda t: t["at"])
    return out


def truth_status(data, bot_actors):
    """The status this issue would hold if no bot had ever touched it.

    Returns ``(target, why)``; ``target`` is None when there is nothing to
    repair — either the issue has no history, or its most recent status change
    was made by a human and is therefore already the truth.
    """
    trans = _status_transitions(data)
    if not trans:
        return None, "no status transitions on record"

    def is_bot(t):
        return any(b.strip().lower() in t["author"].lower() for b in bot_actors if b.strip())

    idx = len(trans) - 1
    while idx >= 0 and is_bot(trans[idx]):
        idx -= 1
    if idx == len(trans) - 1:
        return None, "latest transition is human-authored"
    if idx >= 0:
        return trans[idx]["to"], "last human transition %s by %s" % (
            trans[idx]["at"][:19], trans[idx]["author"])
    return trans[0]["from"], "bot-driven since creation; original status"


def cmd_reset_truth(jira, args):
    """Restore each issue's last human-authored status from its own changelog."""
    bots = [b for b in args.bot_actor]
    changed, skipped = [], []
    for key in CHARTER_ISSUES + list(args.extra):
        data = jira.issue(key, fields="status")
        data["changelog"] = {"histories": jira.issue_changelog(key)}
        current = data["fields"]["status"]["name"]
        target, why = truth_status(data, bots)
        if not target:
            skipped.append((key, current, why))
            continue
        if current.strip().lower() == target.strip().lower():
            skipped.append((key, current, "already truthful (%s)" % why))
            continue
        if args.dry_run:
            changed.append((key, current, target, "DRY-RUN — %s" % why))
            continue
        jira.transition_to(key, target)
        after = jira.issue(key, fields="status,resolution")["fields"]
        changed.append((key, current, after["status"]["name"],
                        "resolution=%s" % ((after.get("resolution") or {}).get("name"))))
    for key, was, now, note in changed:
        print("%-9s %s -> %s  (%s)" % (key, was, now, note))
    for key, cur, why in skipped:
        print("%-9s %-12s SKIP: %s" % (key, cur, why))
    return 0


def cmd_transition(jira, args):
    """Move a row, requiring the evidence that justifies the move.

    Charter D4: "no acceptance row moves without its named evidence linked" —
    and Sprint 8's retro action 8 says the same. So ``--evidence`` is mandatory
    and is posted as a comment BEFORE the transition, which means a move can
    never end up on the board without its reason sitting next to it.
    """
    jira.comment(args.key, "[harness] %s -> %s\n\nEvidence: %s"
                 % (jira.issue(args.key)["fields"]["status"]["name"],
                    args.status, args.evidence))
    used = jira.transition_to(args.key, args.status)
    if used is None:
        print("%s already at %s (evidence recorded)" % (args.key, args.status))
    else:
        print("%s -> %s (evidence recorded)" % (args.key, args.status))
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("status", help="print Sprint 9 issue statuses as JSON")

    c = sub.add_parser("create", help="create + start Sprint 9 on the RCP scrum board")
    c.add_argument("--days", type=int, default=14, help="sprint box length (default 14)")
    c.add_argument("--no-start", action="store_true", help="create in `future` state only")

    a = sub.add_parser("add", help="add charter issues to Sprint 9")
    a.add_argument("--extra", nargs="*", default=[], help="additional issue keys")

    r = sub.add_parser("reset-truth", help="restore each issue's last human-authored status")
    r.add_argument("--bot-actor", nargs="*", default=list(BOT_ACTORS),
                   help="display-name substrings treated as non-human authors "
                        "(default: %s)" % ", ".join(BOT_ACTORS))
    r.add_argument("--extra", nargs="*", default=[], help="additional issue keys")
    r.add_argument("--dry-run", action="store_true")

    t = sub.add_parser("transition", help="move a row, with mandatory evidence")
    t.add_argument("key")
    t.add_argument("status", help='target status name, e.g. "In Progress"')
    t.add_argument("--evidence", required=True,
                   help="what justifies the move — PR link, observed behaviour, "
                        "command output. Posted as a comment before the transition.")

    args = p.parse_args()
    jira = Jira()
    return {
        "status": cmd_status, "create": cmd_create,
        "add": cmd_add, "reset-truth": cmd_reset_truth,
        "transition": cmd_transition,
    }[args.cmd](jira, args)


if __name__ == "__main__":
    sys.exit(main())
