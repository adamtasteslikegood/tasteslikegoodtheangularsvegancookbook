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
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _jira_client import Jira  # noqa: E402
# One-way read of the gate's droppable set, so the two can never disagree about
# which items D6 pre-authorises. The dependency only points this way: the gate
# imports nothing from here, and stays the file that is never edited to make a
# run pass.
from sprint9_hard_gate import ACCEPTANCE, DROPPABLE, SI_EXECUTION  # noqa: E402

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

# The RCP acceptance rows — the ONLY half of the sprint board 168 can render.
#
# Board 168 filters `project = RCP ORDER BY Rank ASC`, so every KAN key above is a
# sprint member that no column shows. Sprint 8 handled this with one RCP
# `S<N> acceptance:` Story per SI (RCP-81..RCP-86) alongside its KAN execution rows;
# Sprint 9 opened with the epic and none of them, and the board displayed a single
# row for four days. Filed 2026-09-01 as RCP-89..RCP-96 (KAN-260).
#
# Read from the gate rather than restated here, so `add`/`status` and the gate can
# never disagree about which row belongs to which SI. Dependency stays one-way: the
# gate imports nothing from this file.
ACCEPTANCE_ISSUES = sorted({v for v in ACCEPTANCE.values() if v})

CHARTER_ISSUES = CHARTER_ISSUES + [k for k in ACCEPTANCE_ISSUES
                                   if k not in CHARTER_ISSUES]

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
                # Some Jira events (deleted-app integrations, cross-tenant
                # automation) serialise author as null or omit displayName.
                # Fall back to an empty string so is_bot() treats them as
                # human — a non-matching author cannot be a known bot actor.
                author = h.get("author") or {}
                out.append({"at": h["created"],
                            "author": author.get("displayName") or "",
                            "from": it["fromString"], "to": it["toString"]})
    out.sort(key=lambda t: t["at"])
    return out


def _parse_ts(value):
    """Jira ('...+0000') and GitHub ('...Z') timestamps to aware datetimes."""
    if not value:
        return None
    v = value.strip().replace("Z", "+00:00")
    # Jira sends +0000; fromisoformat wants +00:00.
    if len(v) >= 5 and (v[-5] in "+-") and ":" not in v[-5:]:
        v = v[:-2] + ":" + v[-2:]
    try:
        return datetime.datetime.fromisoformat(v)
    except ValueError:
        return None


AUTO_TRANSITION_REPO = (
    "adamtasteslikegood/tasteslikegoodtheangularsvegancookbook"
)


def _key_pattern(key):
    """Word-boundary regex matching the workflow's own key extractor.

    jira-auto-transition.yml uses ``grep -oE '\\b(KAN|RCP)-[0-9]+\\b'`` — so a
    correlator that wants to see the same PRs the workflow sees must match on
    the same word boundary. GitHub search's ``in:title`` is token-based and
    would accept ``KAN-2580`` as a hit for ``KAN-258``, silently reclassifying
    a real human ``Done`` on the wrong ticket as automated.
    """
    return re.compile(r"\b" + re.escape(key) + r"\b")


def github_merge_times(keys, timeout=30):
    """{key: [datetime, ...]} for merged PRs matching each key in title.

    jira-auto-transition.yml exists only in AUTO_TRANSITION_REPO.
    A title-matched merge in another repository cannot fire this workflow and
    must not be used to reclassify a human Jira transition as automated.

    One ``gh`` invocation per ``reset-truth`` regardless of key count — the
    former per-key spawn turned an ~1s reset into ~30s of serial network calls.
    Titles are fetched and matched locally with the same word-boundary regex
    the workflow itself uses, so token-based collisions on GitHub search
    (``KAN-258`` matching ``KAN-2580``) cannot leak in.

    Accepts a single key (str) for backward-compat, or an iterable of keys;
    returns [] / {} respectively on failure — a missing correlation must
    never silently reclassify a human transition as automated.
    """
    if isinstance(keys, str):
        result = github_merge_times([keys], timeout=timeout)
        return result.get(keys, [])
    keys = list(keys)
    if not keys:
        return {}
    search = " OR ".join(keys) + " in:title"
    cmd = [
        "gh", "pr", "list",
        "-R", AUTO_TRANSITION_REPO,
        "--search", search,
        "--state", "merged",
        "--json", "mergedAt,title",
        # 20 candidate PRs per key is enough for any real ticket while capping
        # the response size on a wide reset-truth batch.
        "--limit", str(20 * len(keys)),
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if r.returncode != 0 or not r.stdout.strip():
            return {k: [] for k in keys}
        data = json.loads(r.stdout)
        # `gh` returns [] on no matches and always an array on success, but a
        # defensive isinstance guard costs nothing and keeps the "returns []
        # on failure" contract intact if the tool ever emits null/object.
        if not isinstance(data, list):
            return {k: [] for k in keys}
        patterns = [(k, _key_pattern(k)) for k in keys]
        out = {k: [] for k in keys}
        for pr in data:
            if not isinstance(pr, dict):
                continue
            title = pr.get("title") or ""
            ts = _parse_ts(pr.get("mergedAt"))
            if not ts:
                continue
            for k, pat in patterns:
                if pat.search(title):
                    out[k].append(ts)
        return out
    except (subprocess.SubprocessError, ValueError, OSError):
        return {k: [] for k in keys}

# The auto-transition workflow runs within seconds of the merge; a minute of
# slack covers a slow runner without reaching far enough to swallow a human who
# merged and then clicked Done themselves.
MERGE_CORRELATION_WINDOW_S = 120


def truth_status(data, bot_actors, merge_times=None):
    """The status this issue would hold if no bot had ever touched it.

    Returns ``(target, why)``; ``target`` is None when there is nothing to
    repair — either the issue has no history, or its most recent status change
    was made by a human and is therefore already the truth.

    Author name alone is NOT sufficient to identify automation here.
    ``.github/workflows/jira-auto-transition.yml`` authenticates with
    ``secrets.ATLASSIAN_API_TOKEN`` — Adam's personal token — so Jira attributes
    its transitions to "Adam Schoen", identical to a human edit, and it posts no
    comment to distinguish itself. It moved KAN-249 and KAN-258 to Done seconds
    after their PRs merged on 2026-08-28 and read as human until the workflow
    runs were checked.

    So a transition is treated as automated when EITHER the author is a known
    bot, OR it lands on "Done" within ``MERGE_CORRELATION_WINDOW_S`` of a merge
    of a PR whose title carries this issue's key — the workflow's exact
    signature. ``merge_times`` of None or [] disables the correlation half and
    falls back to author matching alone.
    """
    trans = _status_transitions(data)
    if not trans:
        return None, "no status transitions on record"

    merge_times = merge_times or []

    def is_bot(t):
        if any(b.strip().lower() in t["author"].lower() for b in bot_actors if b.strip()):
            return True
        # The auto-transition workflow only ever moves TO Done, and only on a
        # merge. Requiring both keeps a human who merged and then deliberately
        # closed the row hours later out of this branch.
        if (t["to"] or "").strip().lower() != "done":
            return False
        at = _parse_ts(t["at"])
        if not at:
            return False
        return any(0 <= (at - m).total_seconds() <= MERGE_CORRELATION_WINDOW_S
                   for m in merge_times)

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
    bots = list(args.bot_actor)
    changed, skipped, failed = [], [], []
    all_keys = CHARTER_ISSUES + list(args.extra)
    # One batched gh call for the whole set, not one per key — the per-key
    # loop turned a formerly ~1s reset into ~30s of serial subprocess spawns.
    merge_index = (github_merge_times(all_keys)
                   if args.github_correlate else {})
    for key in all_keys:
        data = jira.issue(key, fields="status")
        data["changelog"] = {"histories": jira.issue_changelog(key)}
        current = data["fields"]["status"]["name"]
        merges = merge_index.get(key, [])
        target, why = truth_status(data, bots, merges)
        if not target:
            skipped.append((key, current, why))
            continue
        if current.strip().lower() == target.strip().lower():
            skipped.append((key, current, "already truthful (%s)" % why))
            continue
        if args.dry_run:
            changed.append((key, current, target, "DRY-RUN — %s" % why))
            continue
        # One workflow-blocked transition must not swallow the rest of the
        # batch. Record the failure and press on so the operator sees the
        # whole picture rather than a half-applied reset with no summary.
        try:
            jira.transition_to(key, target)
        except RuntimeError as exc:
            failed.append((key, current, target, str(exc)[:200]))
            continue
        after = jira.issue(key, fields="status,resolution")["fields"]
        changed.append((key, current, after["status"]["name"],
                        "resolution=%s" % ((after.get("resolution") or {}).get("name"))))
    for key, was, now, note in changed:
        print("%-9s %s -> %s  (%s)" % (key, was, now, note))
    for key, cur, why in skipped:
        print("%-9s %-12s SKIP: %s" % (key, cur, why))
    for key, was, target, why in failed:
        print("%-9s %s -> %s  FAILED: %s" % (key, was, target, why),
              file=sys.stderr)
    return 1 if failed else 0


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


def cmd_drop(jira, args):
    """Fire a D6 pre-authorised drop: record the rationale, then remove the row
    from the sprint.

    Removal from the sprint IS the drop — it is the board-visible act, and it is
    what exempts the row from the hard gate. Only S5/S7/S8 carry a pre-authorised
    drop; anything else needs a charter update, so this refuses to touch a
    required item. The charter is emphatic that the drop must actually fire:
    Sprint 8 pre-authorised one and it rolled a fifth time instead. Dropped is a
    valid outcome; rolled is not.

    An SI drops as a UNIT — execution row AND acceptance row. Dropping only the
    execution key was a real defect introduced alongside the acceptance rows and
    caught in review on #3471: the hard gate's rule 4 exempts an SI from needing a
    rendered acceptance row the moment its execution key leaves the sprint, so
    dropping KAN-209 alone would strand RCP-95 on board 168 — an unexplained row
    for a supposedly dropped item, with both gates green over it.

    S7 is the degenerate case: RCP-67 is both its own execution and acceptance row,
    so the pair deduplicates to one key rather than being commented on twice.
    """
    if args.key not in DROPPABLE:
        print("%s is not a D6 pre-authorised drop (droppable: %s) — dropping it "
              "needs a charter update, not this command"
              % (args.key, ", ".join(sorted(DROPPABLE))), file=sys.stderr)
        return 1
    sprint = find_sprint(jira)
    if not sprint:
        print("Sprint 9 does not exist", file=sys.stderr)
        return 1
    si = next((s for s, keys in SI_EXECUTION.items() if args.key in keys), None)
    if not si:
        print("%s is droppable but has no SI execution mapping — refusing a "
              "partial drop" % args.key, file=sys.stderr)
        return 1
    acceptance = ACCEPTANCE.get(si)
    if not acceptance:
        print("%s (%s) has no acceptance-row mapping — refusing a partial drop"
              % (args.key, si), file=sys.stderr)
        return 1
    targets = [args.key]
    if acceptance not in targets:
        targets.append(acceptance)

    # Rationale on every row first, then ONE removal call for the pair. Two separate
    # removals could half-apply on an API failure and leave exactly the stranded row
    # this is fixing; the Agile backlog endpoint takes a list, so it does not have to.
    for key in targets:
        jira.comment(key, "[harness] DROPPED from Sprint 9 under charter D6.\n\n"
                          "Rationale: %s%s" % (
                              args.rationale,
                              "" if key == args.key else
                              "\n\nDropped as part of %s alongside %s — an SI drops "
                              "as a unit, execution row and acceptance row together."
                              % (si, args.key)))
    jira.call("POST", "/rest/agile/1.0/backlog/issue", {"issues": targets})
    print("%s dropped from Sprint 9 (rationale recorded)"
          % " + ".join(targets))
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
    r.add_argument("--github-correlate", action="store_true",
                   help="enable the GitHub merge-time correlation that identifies "
                        "jira-auto-transition.yml's moves (it authors as a human, "
                        "so author matching alone cannot see them)")
    r.add_argument("--dry-run", action="store_true")

    t = sub.add_parser("transition", help="move a row, with mandatory evidence")
    t.add_argument("key")
    t.add_argument("status", help='target status name, e.g. "In Progress"')
    t.add_argument("--evidence", required=True,
                   help="what justifies the move — PR link, observed behaviour, "
                        "command output. Posted as a comment before the transition.")

    d = sub.add_parser("drop", help="fire a D6 pre-authorised drop (S5/S7/S8 only)")
    d.add_argument("key")
    d.add_argument("--rationale", required=True,
                   help="the written rationale — a drop without one is a silent roll")

    args = p.parse_args()
    jira = Jira()
    return {
        "status": cmd_status, "create": cmd_create,
        "add": cmd_add, "reset-truth": cmd_reset_truth,
        "transition": cmd_transition, "drop": cmd_drop,
    }[args.cmd](jira, args)


if __name__ == "__main__":
    sys.exit(main())
