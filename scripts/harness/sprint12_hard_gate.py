#!/usr/bin/env python3
"""Sprint 12 HARD GATE — no committed Sprint 12 item may sit in To Do.

Sprint 12 successor of ``sprint11_hard_gate.py``: the same 4 rules with Sprint 12
constants, plus ``--bootstrap-charter`` for the Day-1 cutover once Sprint 11
(id 121) closes.

``--charter`` is the Day-1 form (Retro R-1). It runs rules 1, 2, and 4 and
requires the sprint to be ``active``; it skips rule 3, because on day 1 items
are legitimately in To Do. ``--charter`` proves the board is honest at charter
time; the full gate is the close gate.

The rule
--------
Exit 0 only when ALL of these hold:

1. **Sprint 12 exists** on the RCP scrum board (168) and is ``active`` or
   ``closed``.
2. **Every committed item is a sprint member.**
3. **No committed item that is in the sprint sits in the To Do status
   category.** Done, In Progress, and In Review all pass.
4. **Every committed SI has an RCP acceptance row the BOARD ACTUALLY RENDERS**
   (KAN-260). Board 168's filter is ``project = RCP ORDER BY Rank ASC``, so
   rule 4 reads the board-scoped endpoint and asserts one RCP
   ``S12 acceptance:`` Story per SI, checking each row's type and summary, and
   that the summary names the SI's execution rows.

Usage
-----
    python3 scripts/harness/sprint12_hard_gate.py                      # full (close) gate
    python3 scripts/harness/sprint12_hard_gate.py --charter            # day-1 gate
    python3 scripts/harness/sprint12_hard_gate.py --issues KAN-356
    python3 scripts/harness/sprint12_hard_gate.py --bootstrap-charter  # day-1 cutover (after Sprint 11 closes)
    python3 scripts/harness/sprint12_hard_gate.py --json

Exit codes: 0 pass · 1 gate failed · 2 configuration or API error.
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _jira_client import Jira  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pm"))
from _atlassian_guard import AtlassianGuardError  # noqa: E402

RCP_SCRUM_BOARD = 168
SPRINT_NAME = "Sprint 12"
SPRINT_ID = 122
PREV_SPRINT_ID = 121
PREV_SPRINT_NAME = "Sprint 11"
EPIC_KEY = "RCP-119"
ACCEPTANCE_PREFIX = "S12 acceptance:"
RCP_MAP_PATH = (
    Path(__file__).resolve().parents[2]
    / "specs"
    / "harness"
    / "sprint12_rcp_map.json"
)

# Committed items that must be in Sprint 12 and, at close, out of To Do.
# Charter: specs/SPRINT_12_PLAN.md. SI numbers are the plan's ordered list.
REQUIRED = {
    "RCP-119": "epic — Sprint 12 delivery/acceptance under distribution & launch",
    "KAN-S12-CHARTER": "charter — execution row; closes with RCP-S12-CHARTER",
    "KAN-356": "S1  — Recipe feedback build, Phase 1",
    "KAN-411": "S2  — md4a-fastapi PyPI release with [fastapi]/[wsgi] extras and R16 escape",
    "KAN-434": "S3  — Author display name for Adam's recipes (user id 1)",
    "KAN-290": "S4  — Recycle bin server-side soft delete and unpublished restore",
    "KAN-334": "S5  — SPA publish toggle server sync and legacy sourceSlug explanation",
    "KAN-426": "S6  — Flask malformed JSON body returns 400 instead of 500",
    "KAN-389": "S7  — Recipe tags become links (hub >= 3 recipes, filtered browse < 3)",
    "KAN-347": "S8  — Crawl-evidence instrument: verified Googlebot fetches by path prefix",
    "KAN-435": "S9  — Recipe JSON-LD image as 16x9, 4x3 and 1x1 crops (split from KAN-320)",
    "KAN-421": "S10 — Browse header page-number nav tap targets >= 24x24 px on phone",
    "KAN-336": "S11 — Backend review follow-ups from the publish-gate release (7 items)",
    "KAN-337": "S12 — Publish-audit and write-pause operations in staging deploy",
    "KAN-400": "S13 — Agent readiness AR-11: WebMCP tools in the browser",
    "KAN-404": "S14 — Agent tools limits and comment advisory from PR #3671",
    "KAN-277": "S15 — 3-5 articles under the Q6 rubric (lane:adam)",
    "KAN-425": "S16 — Backend Postgres driver to psycopg 3 and SQLAlchemy 2.1",
}

RECORDED = {}

SI_EXECUTION = {
    "charter": ["KAN-S12-CHARTER"],
    "S1": ["KAN-356"],
    "S2": ["KAN-411"],
    "S3": ["KAN-434"],
    "S4": ["KAN-290"],
    "S5": ["KAN-334"],
    "S6": ["KAN-426"],
    "S7": ["KAN-389"],
    "S8": ["KAN-347"],
    "S9": ["KAN-435"],
    "S10": ["KAN-421"],
    "S11": ["KAN-336"],
    "S12": ["KAN-337"],
    "S13": ["KAN-400"],
    "S14": ["KAN-404"],
    "S15": ["KAN-277"],
    "S16": ["KAN-425"],
}

# Sprint items -> the RCP acceptance Story the BOARD renders for them.
# Eight SIs reuse the RCP rows carried into Sprint 12 (retitled to
# "S12 acceptance: ..." at Day-1 charter); the remaining nine SIs have
# deterministic placeholder keys replaced by sprint12_rcp_map.json when
# --bootstrap-charter mints the live RCP stories on Day 1.
ACCEPTANCE = {
    "charter": "RCP-S12-CHARTER",
    "S1": "RCP-150",
    "S2": "RCP-S12-S2",
    "S3": "RCP-S12-S3",
    "S4": "RCP-138",
    "S5": "RCP-135",
    "S6": "RCP-S12-S6",
    "S7": "RCP-159",
    "S8": "RCP-144",
    "S9": "RCP-S12-S9",
    "S10": "RCP-S12-S10",
    "S11": "RCP-136",
    "S12": "RCP-137",
    "S13": "RCP-S12-S13",
    "S14": "RCP-S12-S14",
    "S15": "RCP-109",
    "S16": "RCP-S12-S16",
}

PLACEHOLDER_ACCEPTANCE = dict(ACCEPTANCE)
BRAND_AUTHOR_SUFFIX = os.getenv("BRAND_AUTHOR_SUFFIX", "classic").strip() or "classic"

SI_SUMMARIES = {
    "charter": "Sprint 12 chartered — board 168 honest on day 1, plan synced to Confluence ({kan})",
    "S1": "Recipe feedback Phase 1 is live — cooked entry, stars, held notes, public summary ({kan})",
    "S2": "md4a-fastapi published to PyPI with [fastapi]/[wsgi] extras and R16 plain-mode escape ({kan})",
    "S3": f"Author display name for Adam's recipes (user id 1) is Tasteslikegood - {BRAND_AUTHOR_SUFFIX} ({{kan}})",
    "S4": "Recycle bin survives reloads, logouts and devices; failed deletes show; restore never re-publishes ({kan})",
    "S5": "Publish toggle shows the server's state, and legacy manual rows get the right explanation ({kan})",
    "S6": "Malformed JSON bodies on recipe write routes return 400 instead of 500 ({kan})",
    "S7": "Every recipe tag is a link, to a hub or to a filtered browse view ({kan})",
    "S8": "Crawl-evidence instrument: verified Googlebot fetches by path prefix, weekly ({kan})",
    "S9": "Recipe JSON-LD emits 16x9, 4x3 and 1x1 image crops >= 50K px ({kan})",
    "S10": "Browse header page-number nav tap targets are >= 24x24 px on phone ({kan})",
    "S11": "Backend review follow-ups from the publish-gate release ({kan})",
    "S12": "Publish-audit and write-pause operations are in the deploy, and the runbook matches the day ({kan})",
    "S13": "WebMCP tools (search_recipes, get_recipe) registered via navigator.modelContext ({kan})",
    "S14": "Agent tools limits and comment advisory follow-ups from PR #3671 ({kan})",
    "S15": "Owned-property links audited and completed, plus 3-5 articles under the Q6 rubric ({kan})",
    "S16": "Backend Postgres driver moved to psycopg 3 and SQLAlchemy 2.1 after staging soak ({kan})",
}

BASE_REQUIRED = dict(REQUIRED)
BASE_SI_EXECUTION = {k: list(v) for k, v in SI_EXECUTION.items()}
BASE_ACCEPTANCE = dict(ACCEPTANCE)
BASE_PLACEHOLDER_ACCEPTANCE = dict(PLACEHOLDER_ACCEPTANCE)
BASE_SI_SUMMARIES = dict(SI_SUMMARIES)

DROPPABLE_SIS = set()
DROPPABLE = {}
SWAPS = []
LINKED_SIS = set()

# Rows that belong to a later sprint (Sprint 13 beta, Sprint 14 launch post) or
# that were closed as superseded during Sprint 11 (KAN-346 / RCP-147, superseded
# by KAN-356 on 2026-10-14). The charter and close gates fail if any of them
# remains in Sprint 12 or renders on its board.
NOT_IN_SPRINT = {
    "KAN-346": "superseded S23 tested-recipe marker (closed Done 2026-10-14; replaced by KAN-356)",
    "RCP-147": "superseded acceptance row for KAN-346 (closed Done 2026-10-14)",
    "KAN-351": "S26 readiness walk (Sprint 13, the two-week staging beta)",
    "RCP-149": "acceptance row for S26 (Sprint 13)",
    "RCP-174": "S13 acceptance: beta go/no-go signed by Adam (Sprint 13)",
    "KAN-299": "launch post and 7-day readout (Sprint 14)",
    "RCP-110": "acceptance row for the launch post (Sprint 14)",
}


def _sync_derived_sets():
    COMMITTED.clear()
    COMMITTED.update(REQUIRED)
    COMMITTED.update(DROPPABLE)
    GATED.clear()
    GATED.update(REQUIRED)
    GATED.update(RECORDED)


def reset_state():
    """Reset module-level scope dicts to their static baseline before applying a map."""
    REQUIRED.clear()
    REQUIRED.update(BASE_REQUIRED)
    SI_EXECUTION.clear()
    SI_EXECUTION.update({k: list(v) for k, v in BASE_SI_EXECUTION.items()})
    ACCEPTANCE.clear()
    ACCEPTANCE.update(BASE_ACCEPTANCE)
    PLACEHOLDER_ACCEPTANCE.clear()
    PLACEHOLDER_ACCEPTANCE.update(BASE_PLACEHOLDER_ACCEPTANCE)
    SI_SUMMARIES.clear()
    SI_SUMMARIES.update(BASE_SI_SUMMARIES)
    DROPPABLE_SIS.clear()
    DROPPABLE.clear()
    SWAPS.clear()
    LINKED_SIS.clear()
    _sync_derived_sets()


def apply_rcp_map(map_path=RCP_MAP_PATH):
    """Overlay minted charter/RCP keys, carried-in swaps, and dropped SIs from ``sprint12_rcp_map.json``."""
    if not map_path or not Path(map_path).exists():
        return
    try:
        data = json.loads(Path(map_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    reset_state()
    LINKED_SIS.update(data.get("linked_sis") or [])
    charter_kan = data.get("charter_kan") or data.get("kan_charter")
    if charter_kan and "charter" in SI_EXECUTION and charter_kan != SI_EXECUTION["charter"][0]:
        old_kan = SI_EXECUTION["charter"][0]
        desc = REQUIRED.pop(old_kan, "charter — execution row")
        REQUIRED[charter_kan] = desc
        SI_EXECUTION["charter"] = [charter_kan]
    rcp_charter = data.get("rcp_charter")
    if rcp_charter and "charter" in ACCEPTANCE:
        ACCEPTANCE["charter"] = rcp_charter

    raw_swaps = list(data.get("swaps") or data.get("group_d_swaps") or [])
    for s in raw_swaps:
        carried_kan = (s.get("carried_in") or "").strip()
        if not carried_kan:
            continue
        deferred_si = (s.get("deferred_si") or "").strip()
        deferred_kan = (s.get("deferred_kan") or "").strip()
        if not deferred_kan and deferred_si in BASE_SI_EXECUTION:
            deferred_kan = BASE_SI_EXECUTION[deferred_si][0]
        carry_si = (s.get("si") or f"CARRY-{carried_kan}").strip()
        carried_summary = (
            (s.get("carried_summary") or s.get("summary") or "").strip()
            or f"Carried {carried_kan} from {PREV_SPRINT_NAME}"
        )
        placeholder_rcp = f"RCP-S12-{carried_kan}"
        acc_rcp = (s.get("acceptance_rcp") or placeholder_rcp).strip()
        REQUIRED[carried_kan] = (
            f"{carry_si} — carried from {PREV_SPRINT_NAME} "
            f"(swapped for {deferred_si}/{deferred_kan}): {carried_summary}"
        )
        SI_EXECUTION[carry_si] = [carried_kan]
        ACCEPTANCE[carry_si] = acc_rcp
        PLACEHOLDER_ACCEPTANCE[carry_si] = placeholder_rcp
        if re.search(r"\b%s\b" % re.escape(carried_kan), carried_summary):
            SI_SUMMARIES[carry_si] = carried_summary
        else:
            SI_SUMMARIES[carry_si] = f"{carried_summary} ({{kan}})"
        SWAPS.append(
            {
                "si": carry_si,
                "carried_in": carried_kan,
                "carried_summary": carried_summary,
                "acceptance_rcp": acc_rcp,
                "deferred_si": deferred_si,
                "deferred_kan": deferred_kan,
            }
        )

    minted = dict(data.get("acceptance") or {})
    minted.update(data.get("minted_rcp") or {})
    for si, rcp_key in minted.items():
        if si in ACCEPTANCE and rcp_key:
            ACCEPTANCE[si] = rcp_key
            for s in SWAPS:
                if s.get("si") == si:
                    s["acceptance_rcp"] = rcp_key

    dropped_sis = set(data.get("dropped_sis") or []) | {
        s["deferred_si"] for s in SWAPS if s.get("deferred_si")
    }
    for si in sorted(dropped_sis):
        if si in SI_EXECUTION:
            DROPPABLE_SIS.add(si)
            for k in SI_EXECUTION.get(si, []):
                desc = REQUIRED.pop(k, f"{si} — dropped via spillover swap")
                DROPPABLE[k] = desc
            acc_key = ACCEPTANCE.get(si)
            if acc_key:
                DROPPABLE[acc_key] = f"{si} acceptance — dropped via spillover swap"
    _sync_derived_sets()


SI_ACCEPTANCE = ACCEPTANCE
COMMITTED = dict(REQUIRED, **DROPPABLE)
GATED = dict(COMMITTED, **RECORDED)
TODO_CATEGORY_KEYS = {"new", "undefined"}

apply_rcp_map()


def resolve_issue_aliases(issues, map_path=RCP_MAP_PATH):
    """Resolve placeholder tokens (KAN-S12-CHARTER, RCP-S12-*) to minted Jira keys."""
    alias_map = {
        "KAN-S12-CHARTER": SI_EXECUTION.get("charter", ["KAN-S12-CHARTER"])[0],
        "RCP-S12-CHARTER": ACCEPTANCE.get("charter", "RCP-S12-CHARTER"),
    }
    for si, placeholder in PLACEHOLDER_ACCEPTANCE.items():
        alias_map[placeholder] = ACCEPTANCE.get(si, placeholder)
    if map_path and Path(map_path).exists():
        try:
            data = json.loads(Path(map_path).read_text(encoding="utf-8"))
            charter_kan = data.get("charter_kan") or data.get("kan_charter")
            if charter_kan:
                alias_map["KAN-S12-CHARTER"] = charter_kan
            rcp_charter = data.get("rcp_charter")
            if rcp_charter:
                alias_map["RCP-S12-CHARTER"] = rcp_charter
            minted = dict(data.get("acceptance") or {})
            minted.update(data.get("minted_rcp") or {})
            for si, rcp_key in minted.items():
                placeholder = PLACEHOLDER_ACCEPTANCE.get(si)
                if placeholder and rcp_key:
                    alias_map[placeholder] = rcp_key
        except (OSError, json.JSONDecodeError):
            pass
    return [alias_map.get(k, k) for k in issues]


def is_todo(fields):
    cat = fields["status"].get("statusCategory") or {}
    if cat.get("key"):
        return cat["key"].lower() in TODO_CATEGORY_KEYS
    return (cat.get("name") or "").strip().lower() == "to do"


def is_done(fields):
    cat = fields["status"].get("statusCategory") or {}
    if (cat.get("key") or "").lower() == "done":
        return True
    return (fields["status"].get("name") or "").strip().lower() == "done"


def print_dx_error(problem, cause, fix, docs="specs/SPRINT_12_PLAN.md#day-1-actions"):
    """Emit structured 4-line PROBLEM / CAUSE / FIX / DOCS diagnostic to stderr."""
    print(f"PROBLEM: {problem}", file=sys.stderr)
    print(f"CAUSE:   {cause}", file=sys.stderr)
    print(f"FIX:     {fix}", file=sys.stderr)
    print(f"DOCS:    {docs}", file=sys.stderr)


def acceptance_row_problems(si, row, fields):
    """Why a rendered row is not this SI's acceptance row; empty when it is.

    The convention is an RCP Story titled ``S12 acceptance: <what> (KAN-###)``,
    so the row's project, type, and summary are checked against it, and the
    summary must name every execution row of the SI.
    """
    problems = []
    if not row.startswith("RCP-"):
        problems.append("is not in project RCP")
    issuetype = (fields.get("issuetype") or {}).get("name")
    if issuetype != "Story":
        problems.append(
            "is %s, not a Story"
            % (("type " + issuetype) if issuetype else "of unknown type")
        )
    summary = fields.get("summary") or ""
    if not summary.startswith(ACCEPTANCE_PREFIX):
        problems.append("is not titled %r" % (ACCEPTANCE_PREFIX + " ..."))
    missing = [
        k
        for k in SI_EXECUTION[si]
        if not re.search(r"\b%s\b" % re.escape(k), summary)
    ]
    if missing:
        problems.append("does not name %s in its summary" % "/".join(missing))
    return problems


def _write_rcp_map_checkpoint(
    map_path,
    charter_kan,
    minted_acceptance,
    dropped_sis=None,
    swaps=None,
    linked_sis=None,
):
    if not map_path:
        return
    prior = {}
    if Path(map_path).exists():
        try:
            prior = json.loads(Path(map_path).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            prior = {}
    payload = {
        "charter_kan": charter_kan,
        "acceptance": dict(minted_acceptance),
    }
    effective_dropped = sorted(
        set(dropped_sis)
        if dropped_sis is not None
        else set(prior.get("dropped_sis") or [])
    )
    if effective_dropped:
        payload["dropped_sis"] = effective_dropped

    raw_swaps = (
        swaps
        if swaps is not None
        else (SWAPS or prior.get("swaps") or prior.get("group_d_swaps") or [])
    )
    if raw_swaps:
        serialized_swaps = []
        for s in raw_swaps:
            item = dict(s)
            si_key = item.get("si")
            if si_key and si_key in minted_acceptance:
                item["acceptance_rcp"] = minted_acceptance[si_key]
            serialized_swaps.append(item)
        payload["swaps"] = serialized_swaps

    effective_linked = sorted(
        set(linked_sis)
        if linked_sis is not None
        else (set(LINKED_SIS) | set(prior.get("linked_sis") or []))
    )
    if effective_linked:
        payload["linked_sis"] = effective_linked

    # Preserve audit metadata written by check_spillover (e.g. the
    # --override-spillover-reason) across bootstrap_charter checkpoints.
    reason = (prior.get("override_spillover_reason") or "").strip()
    if reason:
        payload["override_spillover_reason"] = reason
    Path(map_path).parent.mkdir(parents=True, exist_ok=True)
    Path(map_path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _jql_quote(text):
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def find_existing_by_summary(jira, project, summary, parent=None):
    """Return the key of an issue in ``project`` whose summary is exactly ``summary``.

    Jira can commit ``POST /rest/api/3/issue`` and the client still lose the
    response (timeout, dropped connection). The row then exists but is not yet
    a Sprint 12 member, because members are added only at the end of the
    bootstrap, so a retry that only indexes ``sprint_issues(122)`` cannot see
    it and would create an identical row. This looks the row up by its
    deterministic summary across the whole project (and epic, when given)
    before any create. Returns ``None`` when nothing matches.
    """
    jql = "project = %s AND summary ~ %s" % (project, _jql_quote(summary))
    if parent:
        jql += " AND parent = %s" % parent
    resp = jira.call(
        "POST",
        "/rest/api/3/search/jql",
        {"jql": jql, "fields": ["summary"], "maxResults": 50},
    )
    issues = resp.get("issues") if isinstance(resp, dict) else None
    matches = sorted(
        i["key"]
        for i in (issues or [])
        if i.get("key")
        and ((i.get("fields") or {}).get("summary") or "").strip() == summary
    )
    return matches[0] if matches else None


def bootstrap_charter(
    jira,
    map_path=RCP_MAP_PATH,
    dry_run=False,
    dropped_sis=None,
):
    """Day-1 cutover helper: prepare Sprint 12 on board 168 after Sprint 11 closes.

    Refuses to run while Sprint 11 (id 121) is still ``active`` so other agents
    wrapping up Sprint 11 are never disrupted. Writes per-ticket checkpoints to
    ``sprint12_rcp_map.json`` so any partial run is idempotent on retry.
    """
    apply_rcp_map(map_path)
    sprints = {s["name"].strip().lower(): s for s in jira.sprints(RCP_SCRUM_BOARD)}
    s11 = sprints.get(PREV_SPRINT_NAME.lower())
    if s11 and s11.get("state") == "active" and not dry_run:
        print(
            "REFUSED: %s (id %s) is still active — close %s before running "
            "--bootstrap-charter for %s."
            % (PREV_SPRINT_NAME, s11["id"], PREV_SPRINT_NAME, SPRINT_NAME),
            file=sys.stderr,
        )
        print_dx_error(
            f"{PREV_SPRINT_NAME} (id {s11['id']}) is still active on board {RCP_SCRUM_BOARD}.",
            "Day-1 cutover refuses to mutate live Jira while the previous sprint is still open.",
            f"Close {PREV_SPRINT_NAME} in Jira (or run with --dry-run to preview), then re-run.",
        )
        return 1

    s12 = sprints.get(SPRINT_NAME.lower())
    if not s12:
        print(
            "FAILED: %s does not exist on board %d." % (SPRINT_NAME, RCP_SCRUM_BOARD),
            file=sys.stderr,
        )
        print_dx_error(
            f"{SPRINT_NAME} was not found on board {RCP_SCRUM_BOARD}.",
            "Board 168 sprint list did not contain a sprint named 'Sprint 12'.",
            "Verify board 168 in Jira and ensure Sprint 12 (id 122) exists.",
        )
        return 1

    sprint_id = s12["id"]
    sprint_issues_list = jira.sprint_issues(sprint_id)
    current_members = {i["key"] for i in sprint_issues_list}
    existing_by_summary = {
        (i.get("fields") or {}).get("summary", "").strip(): i["key"]
        for i in sprint_issues_list
        if i.get("key") and (i.get("fields") or {}).get("summary")
    }
    stale = sorted(current_members & set(NOT_IN_SPRINT))

    dropped_set = set(dropped_sis or []) | set(DROPPABLE_SIS)
    for si in dropped_set:
        if si in SI_EXECUTION:
            DROPPABLE_SIS.add(si)
            for k in SI_EXECUTION[si]:
                if k in REQUIRED:
                    DROPPABLE[k] = REQUIRED.pop(k)
            acc_key = ACCEPTANCE.get(si)
            if acc_key:
                DROPPABLE[acc_key] = f"{si} acceptance — dropped via spillover swap"
    _sync_derived_sets()

    suffix = os.getenv("BRAND_AUTHOR_SUFFIX", "classic").strip() or "classic"

    if dry_run:
        active_sis = [si for si in sorted(SI_EXECUTION) if si not in DROPPABLE_SIS]
        print(
            "DRY-RUN ONLY — BOOTSTRAP CHARTER %s (id %d): stale_to_remove=%s, active_sis=%d, dropped_sis=%s"
            % (SPRINT_NAME, sprint_id, stale, len(active_sis), sorted(DROPPABLE_SIS))
        )
        return 0

    # 1. Remove superseded Done rows (KAN-346, RCP-147) and any dropped SIs from Sprint 12.
    dropped_keys = [
        k
        for si in DROPPABLE_SIS
        for k in (*SI_EXECUTION.get(si, []), ACCEPTANCE.get(si))
        if k and k in current_members
    ]
    to_backlog = sorted(set(stale) | set(dropped_keys))
    if to_backlog:
        jira.call("POST", "/rest/agile/1.0/backlog/issue", {"issues": to_backlog})

    # 2. Mint charter KAN execution row if still using placeholder.
    charter_kan = SI_EXECUTION["charter"][0]
    minted_acceptance = {
        si: rcp
        for si, rcp in ACCEPTANCE.items()
        if re.match(r"^RCP-\d+$", rcp or "")
    }
    charter_kan_summary = (
        "Charter Sprint 12: sync SPRINT_12_PLAN.md, mint S12 acceptance stories, pass day-1 hard gate"
    )
    if charter_kan == "KAN-S12-CHARTER":
        recovered_kan = existing_by_summary.get(charter_kan_summary) or (
            find_existing_by_summary(jira, "KAN", charter_kan_summary)
        )
        if recovered_kan and re.match(r"^KAN-\d+$", recovered_kan):
            charter_kan = recovered_kan
        else:
            created_kan = jira.call(
                "POST",
                "/rest/api/3/issue",
                {
                    "fields": {
                        "project": {"key": "KAN"},
                        "issuetype": {"name": "Task"},
                        "summary": charter_kan_summary,
                        "labels": ["sprint-12", "pm"],
                    }
                },
            )
            charter_kan = created_kan["key"]
        SI_EXECUTION["charter"] = [charter_kan]
        REQUIRED.pop("KAN-S12-CHARTER", None)
        REQUIRED[charter_kan] = "charter — execution row; closes with charter RCP story"
        _sync_derived_sets()
        _write_rcp_map_checkpoint(
            map_path,
            charter_kan,
            minted_acceptance,
            DROPPABLE_SIS,
            swaps=SWAPS,
            linked_sis=LINKED_SIS,
        )

    # 3. Retitle the 8 carried RCP rows to "S12 acceptance: ..." and mint the
    #    new RCP Story rows under Epic RCP-119, checkpointing immediately after
    #    creation and reconciling links idempotently on retry.
    for si, kan_keys in sorted(SI_EXECUTION.items()):
        if si in DROPPABLE_SIS:
            continue
        kan_str = ", ".join(kan_keys)
        desired_summary = "%s %s" % (
            ACCEPTANCE_PREFIX,
            SI_SUMMARIES[si].format(kan=kan_str, suffix=suffix),
        )
        current_rcp = ACCEPTANCE[si]
        was_placeholder = not re.match(r"^RCP-\d+$", BASE_ACCEPTANCE.get(si, ""))
        if re.match(r"^RCP-\d+$", current_rcp):
            rcp_key = current_rcp
            jira.call(
                "PUT",
                "/rest/api/3/issue/%s" % rcp_key,
                {"fields": {"summary": desired_summary, "labels": ["sprint-12"]}},
            )
            minted_acceptance[si] = rcp_key
        else:
            recovered_rcp = existing_by_summary.get(desired_summary) or (
                find_existing_by_summary(
                    jira, "RCP", desired_summary, parent=EPIC_KEY
                )
            )
            if recovered_rcp and re.match(r"^RCP-\d+$", recovered_rcp):
                rcp_key = recovered_rcp
            else:
                created_rcp = jira.call(
                    "POST",
                    "/rest/api/3/issue",
                    {
                        "fields": {
                            "project": {"key": "RCP"},
                            "issuetype": {"name": "Story"},
                            "parent": {"key": EPIC_KEY},
                            "summary": desired_summary,
                            "labels": ["sprint-12"],
                        }
                    },
                )
                rcp_key = created_rcp["key"]
            ACCEPTANCE[si] = rcp_key
            minted_acceptance[si] = rcp_key
            for s in SWAPS:
                if s.get("si") == si:
                    s["acceptance_rcp"] = rcp_key
            # Persist the newly created/recovered RCP key BEFORE linking so a
            # transient issueLink failure never causes a duplicate Story on retry.
            _write_rcp_map_checkpoint(
                map_path,
                charter_kan,
                minted_acceptance,
                DROPPABLE_SIS,
                swaps=SWAPS,
                linked_sis=LINKED_SIS,
            )

        if was_placeholder and si not in LINKED_SIS:
            for k in kan_keys:
                jira.call(
                    "POST",
                    "/rest/api/3/issueLink",
                    {
                        "type": {"name": "Relates"},
                        "inwardIssue": {"key": k},
                        "outwardIssue": {"key": rcp_key},
                    },
                )
            LINKED_SIS.add(si)

        _write_rcp_map_checkpoint(
            map_path,
            charter_kan,
            minted_acceptance,
            DROPPABLE_SIS,
            swaps=SWAPS,
            linked_sis=LINKED_SIS,
        )

    # 4. Finalize sprint12_rcp_map.json and add all active committed KAN + RCP rows to Sprint 12.
    _write_rcp_map_checkpoint(
        map_path,
        charter_kan,
        minted_acceptance,
        DROPPABLE_SIS,
        swaps=SWAPS,
        linked_sis=LINKED_SIS,
    )
    apply_rcp_map(map_path)

    active_sis = [si for si in SI_EXECUTION if si not in DROPPABLE_SIS]
    all_sprint_keys = sorted(
        {k for si in active_sis for k in SI_EXECUTION[si]}
        | {ACCEPTANCE[si] for si in active_sis}
        | {EPIC_KEY}
    )
    jira.add_to_sprint(sprint_id, all_sprint_keys)

    if s12.get("state") == "future":
        jira.start_sprint(
            sprint_id,
            s12.get("startDate", "2026-10-23T22:00:00.000Z"),
            s12.get("endDate", "2026-11-06T22:00:00.000Z"),
        )

    print(
        "BOOTSTRAP CHARTER COMPLETE — %d issues in %s (id %d); map written to %s"
        % (len(all_sprint_keys), SPRINT_NAME, sprint_id, map_path)
    )
    return 0


# Default Group D swap order (3 slots) plus leaf-only Group B/C fallback slots
# when --max-spillover > 3 is explicitly passed with --override-spillover-reason.
GROUP_D_SWAP_CANDIDATES = [
    ("S16", "KAN-425"),
    ("S14", "KAN-404"),
    ("S13", "KAN-400"),
    ("S6", "KAN-426"),
    ("S5", "KAN-334"),
    ("S8", "KAN-347"),
]
DEFAULT_MAX_SPILLOVER = 3


def check_spillover(
    jira,
    as_json=False,
    max_spillover=DEFAULT_MAX_SPILLOVER,
    override_reason=None,
    apply_swaps=False,
    map_path=RCP_MAP_PATH,
    dry_run=False,
):
    """Non-destructive Day-1 inspection of Sprint 11 (id 121) open items.

    Computes the deterministic Priority Group D swap preview (S16 -> S14 -> S13,
    plus leaf fallback slots S6 -> S5 -> S8 when ``max_spillover > 3`` is passed
    with ``override_reason``). When ``apply_swaps=True`` (and not ``dry_run``),
    persists ``dropped_sis`` and full ``swaps`` (including carried-in KAN +
    acceptance row mapping) to ``sprint12_rcp_map.json``.
    """
    if max_spillover > DEFAULT_MAX_SPILLOVER and not (override_reason or "").strip():
        print_dx_error(
            f"--max-spillover {max_spillover} exceeds default cap ({DEFAULT_MAX_SPILLOVER}) without --override-spillover-reason.",
            "Expanding spillover beyond 3 slots drops Group B/C items and requires an explicit audit reason.",
            f"Pass --max-spillover {max_spillover} --override-spillover-reason \"<reason>\" to authorize leaf swaps.",
        )
        return 2

    effective_cap = min(max_spillover, len(GROUP_D_SWAP_CANDIDATES))
    candidates = GROUP_D_SWAP_CANDIDATES[:effective_cap]

    issues = jira.sprint_issues(PREV_SPRINT_ID)
    rcp_stories = []
    open_items = []
    for item in issues:
        key = item.get("key", "")
        fields = item.get("fields") or {}
        if key.startswith("RCP-"):
            rcp_stories.append((key, (fields.get("summary") or "").strip()))
        cat = ((fields.get("status") or {}).get("statusCategory") or {}).get("key", "")
        status_name = ((fields.get("status") or {}).get("name") or "").strip()
        if cat.lower() != "done" and status_name.lower() != "done":
            if key.startswith("KAN-"):
                open_items.append(
                    {
                        "key": key,
                        "status": status_name or "Open",
                        "summary": (fields.get("summary") or "").strip(),
                    }
                )
    swaps = []
    for idx, carried in enumerate(open_items):
        if idx < len(candidates):
            si, kan = candidates[idx]
            carried_key = carried["key"]
            carried_summary = (
                carried.get("summary")
                or f"Carried {carried_key} from {PREV_SPRINT_NAME}"
            )
            existing_rcp = next(
                (
                    r_key
                    for r_key, r_sum in rcp_stories
                    if re.search(r"\b%s\b" % re.escape(carried_key), r_sum)
                ),
                None,
            )
            swaps.append(
                {
                    "si": f"CARRY-{carried_key}",
                    "carried_in": carried_key,
                    "carried_summary": carried_summary,
                    "acceptance_rcp": existing_rcp or f"RCP-S12-{carried_key}",
                    "deferred_si": si,
                    "deferred_kan": kan,
                }
            )
    overload = len(open_items) > len(candidates)
    overflow_items = [item["key"] for item in open_items[len(candidates) :]]
    dropped_sis = [s["deferred_si"] for s in swaps]

    if apply_swaps and not overload and not dry_run and map_path:
        existing = {}
        if Path(map_path).exists():
            try:
                existing = json.loads(Path(map_path).read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                existing = {}
        existing["dropped_sis"] = dropped_sis
        existing["swaps"] = swaps
        if override_reason:
            existing["override_spillover_reason"] = override_reason.strip()
        Path(map_path).parent.mkdir(parents=True, exist_ok=True)
        Path(map_path).write_text(json.dumps(existing, indent=2) + "\n", encoding="utf-8")
        apply_rcp_map(map_path)

    payload = {
        "previous_sprint": PREV_SPRINT_NAME,
        "previous_sprint_id": PREV_SPRINT_ID,
        "dry_run": bool(dry_run),
        "spillover_count": len(open_items),
        "max_spillover": effective_cap,
        "open_items": open_items,
        "group_d_swaps": swaps,
        "dropped_sis": dropped_sis,
        "overload": overload,
        "overflow_items": overflow_items,
    }
    if override_reason:
        payload["override_spillover_reason"] = override_reason.strip()
    if as_json:
        print(json.dumps(payload, indent=2))
    else:
        print(
            "SPILLOVER CHECK (%s, id %d)%s: %d non-Done KAN item(s)"
            % (
                PREV_SPRINT_NAME,
                PREV_SPRINT_ID,
                " [DRY-RUN ONLY]" if dry_run else "",
                len(open_items),
            )
        )
        for item in open_items:
            print("  - %s [%s]: %s" % (item["key"], item["status"], item["summary"]))
        for s in swaps:
            print(
                "  SWAP: carry %s -> defer %s (%s) to next-sprint-candidate"
                % (s["carried_in"], s["deferred_si"], s["deferred_kan"])
            )
        if overload:
            print(
                "  OVERLOAD: %d spillover items exceed the %d swap slots "
                "(overflow: %s) — charter re-plan required before --bootstrap-charter"
                % (
                    len(open_items),
                    len(candidates),
                    ", ".join(overflow_items),
                )
            )
            print_dx_error(
                f"{len(open_items)} spillover KAN items exceed the {len(candidates)} configured swap slots ({', '.join(overflow_items)}).",
                "Sprint 11 has more unfinished KAN items than Priority Group D swap slots.",
                f"Run with --max-spillover {len(open_items)} --override-spillover-reason \"<reason>\" or close remaining Sprint 11 tickets first.",
            )
    return 1 if overload else 0


def run_day1_cutover(
    jira,
    dry_run=False,
    apply_spillover_swaps=False,
    as_json=False,
    max_spillover=DEFAULT_MAX_SPILLOVER,
    override_reason=None,
    map_path=RCP_MAP_PATH,
):
    """Single-command Day-1 cutover: check spillover and bootstrap charter."""
    rc = check_spillover(
        jira,
        as_json=as_json,
        max_spillover=max_spillover,
        override_reason=override_reason,
        apply_swaps=apply_spillover_swaps,
        map_path=map_path,
        dry_run=dry_run,
    )
    if rc != 0:
        return rc
    if dry_run and as_json:
        return 0
    return bootstrap_charter(jira, map_path=map_path, dry_run=dry_run)


def main(argv=None):
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    mode = p.add_mutually_exclusive_group()
    mode.add_argument(
        "--issues",
        nargs="+",
        default=None,
        help="scoped check: only these keys must be out of To Do "
        "(or Done when --require-done is set; skips sprint-membership rules)",
    )
    mode.add_argument(
        "--charter",
        action="store_true",
        help="day-1 gate: rules 1, 2, 4 with the sprint active; "
        "skips rule 3 (To Do)",
    )
    mode.add_argument(
        "--close",
        action="store_true",
        help="close gate: rules 1, 2, 3, and 4 must all pass and every committed item must be Done",
    )
    mode.add_argument(
        "--bootstrap-charter",
        action="store_true",
        help="day-1 cutover: once Sprint 11 is closed, clean stale rows, "
        "mint/retitle S12 acceptance stories, and activate Sprint 12",
    )
    mode.add_argument(
        "--check-spillover",
        action="store_true",
        help="non-destructive Day-1 inspection of Sprint 11 open items and "
        "Priority Group D swap preview",
    )
    mode.add_argument(
        "--day1-cutover",
        action="store_true",
        help="single-command Day-1 cutover: check spillover, bootstrap charter, and verify --charter",
    )
    p.add_argument(
        "--require-done",
        action="store_true",
        help="require checked issues to be in Done status category (enabled automatically by --close)",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="preview Day-1 cutover / bootstrap actions without mutating Jira",
    )
    p.add_argument(
        "--apply-spillover-swaps",
        action="store_true",
        help="record deferred Group D SIs in sprint12_rcp_map.json as dropped_sis",
    )
    p.add_argument(
        "--max-spillover",
        type=int,
        default=DEFAULT_MAX_SPILLOVER,
        help="maximum spillover swap slots (default: 3; >3 requires --override-spillover-reason)",
    )
    p.add_argument(
        "--override-spillover-reason",
        type=str,
        default=None,
        help="audit reason required when --max-spillover exceeds 3",
    )
    p.add_argument("--json", action="store_true", help="machine-readable output")
    args = p.parse_args(argv)

    try:
        jira = Jira()
    except (SystemExit, AtlassianGuardError) as exc:
        print("CONFIG ERROR: %s" % exc, file=sys.stderr)
        print_dx_error(
            f"Jira client initialization failed: {exc}",
            "Missing or invalid Atlassian credentials or disallowed project guard.",
            "Ensure JIRA_API_TOKEN and JIRA_EMAIL are set in .env and re-run.",
        )
        return 2

    if args.check_spillover:
        try:
            return check_spillover(
                jira,
                as_json=args.json,
                max_spillover=args.max_spillover,
                override_reason=args.override_spillover_reason,
                apply_swaps=args.apply_spillover_swaps,
                dry_run=args.dry_run,
            )
        except RuntimeError as exc:
            print("API ERROR: %s" % exc, file=sys.stderr)
            return 2

    if args.bootstrap_charter:
        try:
            return bootstrap_charter(jira, dry_run=args.dry_run)
        except RuntimeError as exc:
            print("API ERROR: %s" % exc, file=sys.stderr)
            return 2

    if args.day1_cutover:
        try:
            rc = run_day1_cutover(
                jira,
                dry_run=args.dry_run,
                apply_spillover_swaps=args.apply_spillover_swaps,
                as_json=args.json,
                max_spillover=args.max_spillover,
                override_reason=args.override_spillover_reason,
            )
            if rc != 0 or args.dry_run:
                return rc
            # Proceed into --charter verification after live bootstrap
            args.charter = True
        except RuntimeError as exc:
            print("API ERROR: %s" % exc, file=sys.stderr)
            return 2

    apply_rcp_map(RCP_MAP_PATH)
    require_done = bool(args.close or args.require_done)
    gate = (
        "sprint12-charter"
        if args.charter
        else "sprint12-scoped-status"
        if args.issues is not None
        else "sprint12-close"
        if args.close
        else "sprint12-no-todo"
    )
    report = {"gate": gate, "checks": [], "violations": [], "passed": False}
    status_descriptions = dict(GATED)

    try:
        if args.issues:
            scope = resolve_issue_aliases(args.issues)
        else:
            sprint = next(
                (
                    s
                    for s in jira.sprints(RCP_SCRUM_BOARD)
                    if s["name"].strip().lower() == SPRINT_NAME.lower()
                ),
                None,
            )
            if not sprint:
                report["violations"].append(
                    "Sprint 12 does not exist on board %d — a missing sprint is a "
                    "vacuous pass, not a pass" % RCP_SCRUM_BOARD
                )
                return finish(report, args)
            report["sprint"] = {"id": sprint["id"], "state": sprint["state"]}
            allowed = ("active",) if args.charter else ("active", "closed")
            if sprint["state"] not in allowed:
                report["violations"].append(
                    "Sprint 12 is %r; expected %s"
                    % (sprint["state"], " or ".join(allowed))
                )
            members = {i["key"] for i in jira.sprint_issues(sprint["id"])}
            report["member_count"] = len(members)
            for key, what in sorted(dict(REQUIRED, **RECORDED).items()):
                if key not in members:
                    report["violations"].append(
                        "%s is not in Sprint 12 (%s) — required items cannot be "
                        "dropped without a charter update" % (key, what)
                    )
            report["dropped"] = sorted(k for k in DROPPABLE if k not in members)

            # Rule 4 — board visibility.
            rendered_fields = {
                i["key"]: i.get("fields") or {}
                for i in jira.board_sprint_issues(RCP_SCRUM_BOARD, sprint["id"])
            }
            rendered = set(rendered_fields)
            report["board_rendered"] = sorted(rendered)

            # Enforce the sprint split & superseded exclusions.
            for key, what in sorted(NOT_IN_SPRINT.items()):
                if key in members or key in rendered:
                    report["violations"].append(
                        "%s (%s) belongs to a later sprint or was superseded but is in "
                        "Sprint 12 — remove it from sprint %s, or record a "
                        "charter update" % (key, what, sprint["id"])
                    )
            report["acceptance"] = {}
            active_acceptance = {}
            for si in sorted(SI_EXECUTION):
                row = ACCEPTANCE.get(si)
                if si in DROPPABLE_SIS:
                    stranded_exec = [
                        k for k in SI_EXECUTION[si] if k in members or k in rendered
                    ]
                    stranded_acc = bool(row and (row in members or row in rendered))
                    if not row:
                        report["acceptance"][si] = "dropped — MISSING MAPPING"
                        report["violations"].append(
                            "%s is treated as dropped but has no acceptance-row "
                            "mapping, so the gate cannot prove the SI was removed "
                            "as a unit" % si
                        )
                    elif stranded_exec or stranded_acc:
                        stranded = list(stranded_exec) + (
                            [row] if stranded_acc else []
                        )
                        report["acceptance"][si] = "STRANDED — %s" % "/".join(stranded)
                        report["violations"].append(
                            "%s is dropped via spillover swap, but row(s) %s "
                            "remain in Sprint 12 or on board %d — remove the "
                            "dropped SI as a unit"
                            % (si, "/".join(stranded), RCP_SCRUM_BOARD)
                        )
                    else:
                        report["acceptance"][si] = "dropped"
                    continue
                report["acceptance"][si] = row
                if not row:
                    report["violations"].append(
                        "%s has no RCP acceptance row — board %d filters "
                        "`project = RCP`, so its execution row(s) %s are sprint "
                        "members that no column renders"
                        % (si, RCP_SCRUM_BOARD, "/".join(SI_EXECUTION[si]))
                    )
                elif row not in rendered:
                    report["violations"].append(
                        "%s's acceptance row %s is not rendered by board %d for "
                        "this sprint — add it to the sprint, or the item is "
                        "invisible on the board" % (si, row, RCP_SCRUM_BOARD)
                    )
                else:
                    active_acceptance[row] = "%s — board-visible acceptance" % si
                    for problem in acceptance_row_problems(
                        si, row, rendered_fields[row]
                    ):
                        report["violations"].append(
                            "%s's acceptance row %s %s" % (si, row, problem)
                        )

            for k, v in active_acceptance.items():
                status_descriptions.setdefault(k, v)
            scope = {k for k in GATED if k in members} | {
                k for k in active_acceptance if k in members
            }

        if args.charter:
            scope = []  # rule 3 is the close gate; day 1 is all To Do by design
        for key in sorted(scope):
            f = jira.issue(key, fields="summary,status")["fields"]
            todo = is_todo(f)
            done = is_done(f)
            report["checks"].append(
                {
                    "key": key,
                    "status": f["status"]["name"],
                    "category": (f["status"].get("statusCategory") or {}).get("name"),
                    "todo": todo,
                    "done": done,
                }
            )
            if todo:
                report["violations"].append(
                    "%s is in To Do (%s) — %s"
                    % (
                        key,
                        f["status"]["name"],
                        status_descriptions.get(key, "scoped check"),
                    )
                )
            elif require_done and not done:
                report["violations"].append(
                    "%s is in %s (close/strict gate requires Done) — %s"
                    % (
                        key,
                        f["status"]["name"],
                        status_descriptions.get(key, "scoped check"),
                    )
                )
    except RuntimeError as exc:
        print("API ERROR: %s" % exc, file=sys.stderr)
        return 2

    return finish(report, args)


def finish(report, args):
    report["passed"] = not report["violations"]
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        for c in report["checks"]:
            print(
                "%-9s %-14s %s"
                % (c["key"], c["status"], "TO DO" if c["todo"] else "ok")
            )
        for si, row in sorted(report.get("acceptance", {}).items()):
            print(
                "%-9s %-14s %s"
                % (si, "acceptance", row if row else "MISSING — no RCP row")
            )
        for d in report.get("dropped", []):
            print(
                "%-9s %-14s dropped from sprint (D6 timebox) — exempt" % (d, "-")
            )
        if report["violations"]:
            print(
                "\nHARD GATE FAILED — %d violation(s):" % len(report["violations"])
            )
            for v in report["violations"]:
                print("  - %s" % v)
        elif report["gate"] == "sprint12-scoped-status":
            print("\nSCOPED CHECK PASSED — every requested issue is out of To Do.")
        else:
            print(
                "\nHARD GATE PASSED — every committed or recorded Sprint 12 item is %s AND has an "
                "acceptance row the board renders."
                % (
                    "a member of the active sprint"
                    if report["gate"] == "sprint12-charter"
                    else "Done"
                    if report["gate"] == "sprint12-close"
                    else "out of To Do"
                )
            )
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())

