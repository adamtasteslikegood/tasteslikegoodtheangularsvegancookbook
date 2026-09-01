#!/usr/bin/env bash
# check_sprint_lane.sh — assert the KAN/RCP sprint lane has not collapsed again.
#
# WHY THIS EXISTS (Sprint 4 risk R1, specs/SPRINT_4_PLAN.md):
# KAN board 34 is type `simple` and the Agile API refuses to attach a sprint to it
# (`GET /rest/agile/1.0/board/34/sprint` → "The board does not support sprints").
# Sprints 1-3 were therefore `sprint-N` LABELS, not Jira sprints, and no burndown or
# velocity report has ever been possible. Sprint 4 restored the documented split:
# RCP holds sprint scope + acceptance, KAN holds execution, linked by issue links.
#
# That split already collapsed once, and the reason was structural, not moral: KAN is
# team-managed (one createJiraIssue away for an agent) while RCP is company-managed.
# A convention that isn't asserted is how the drift happened. This is the assertion.
#
# THIS IS NOW A BLOCKING GATE (Sprint 4 retrospective action, S8).
# `pr-gate.yml` runs it in the `sprint-lane` job and `gate.needs` includes that job,
# so a PR that orphans a `sprint-N` KAN row fails CI. Before that wiring it was a
# script run on demand — the same distinction that made the Alembic head-check look
# like a gate for weeks while only running on release-train dispatch.
#
# LIMIT 1 IS NOW CLOSED — and closing it is why this file changed (KAN-260).
# It used to read: "passes VACUOUSLY when no row carries the label; it detects lane
# DRIFT, not a missing sprint." Sprint 9 walked straight through that hole. Sprint 9
# ran with ZERO `sprint-9` labels anywhere, so label discovery fell back to the newest
# label it could see — `sprint-8`, whose rows are all Done and filtered out — and the
# script printed PASS on every Sprint 9 PR for four days while the RCP board showed one
# row. Vacuous twice over: no rows to check, and the wrong sprint being checked.
#
# The fix does not simply make "zero labelled rows" fatal; between sprints that would
# block every PR, including release PRs. It keys off board 168's ACTIVE sprint:
#   active sprint exists AND zero issues carry its `sprint-N` label  -> FAIL(1)
#   no active sprint                                                 -> pass, as before
# So the gate now detects a MISSING lane, not only a drifting one.
#
# TWO LIMITS THAT REMAIN, both deliberate:
#   1. Called with no argument (as CI does) it checks the ACTIVE sprint's label, or
#      falls back to the NEWEST sprint-N label when no sprint is running. An orphan on
#      an older, superseded label does not fail CI.
#   2. The CI job is skipped for fork PRs AND for Dependabot PRs, and `gate` counts
#      skipped as passing. These are two different cases, not one: a Dependabot PR is
#      NOT a fork — it is a same-repo `dependabot/...` branch that is merely denied
#      secrets — so it needs its own actor test in the workflow. Without it the job
#      runs, exits 2, and blocks every dependency update.
#
# Exit codes:
#   0  every non-Done sprint-labelled KAN row is linked to an RCP row
#   1  at least one orphan — the lane is drifting
#   2  setup/credential/API failure (NOT a pass; never treat as success)
#
# Usage: bash scripts/pm/check_sprint_lane.sh [sprint-label]   # default: newest sprint-N in KAN
set -euo pipefail

cd "$(dirname "$0")/../.."
# `.env` is how a developer machine supplies credentials; CI injects them as
# environment variables from repository secrets instead. A missing .env is therefore
# only fatal when the variables are not already present — but an unset variable still
# exits 2 rather than passing, so a misconfigured CI job fails closed rather than
# reporting a green lane it never checked.
if [[ -f .env ]]; then set -a; source .env; set +a; fi
# Explicit `exit 2`, not `${VAR:?...}`. The :? construct aborts with status 1, which
# this script's own contract defines as "an orphan was found — the lane is drifting".
# A CI job with no credentials would then be read as real lane drift. Credential
# failure must be distinguishable from a finding.
for _v in ATLASSIAN_EMAIL ATLASSIAN_API_TOKEN; do
  if [[ -z "${!_v:-}" ]]; then
    echo "FAIL(2): $_v unset (no .env, and not in the environment)" >&2
    exit 2
  fi
done

SITE="https://tasteslikegood.atlassian.net"

# Credentials go through the environment, never argv — argv is world-readable in `ps`,
# and every other scripts/pm/*.py already reads ATLASSIAN_API_TOKEN from os.environ.
export ATLASSIAN_SITE="$SITE"
export SPRINT_LANE_LABEL="${1:-}"

python3 <<'PY'
import base64, json, os, re, sys, urllib.error, urllib.parse, urllib.request

site = os.environ["ATLASSIAN_SITE"]
label = os.environ.get("SPRINT_LANE_LABEL", "")
auth = f'{os.environ["ATLASSIAN_EMAIL"]}:{os.environ["ATLASSIAN_API_TOKEN"]}'
hdr = {"Authorization": "Basic " + base64.b64encode(auth.encode()).decode(),
       "Accept": "application/json"}


def jql(q, fields):
    out, tok = [], None
    while True:
        p = {"jql": q, "maxResults": "100", "fields": fields}
        if tok:
            p["nextPageToken"] = tok
        url = f"{site}/rest/api/3/search/jql?" + urllib.parse.urlencode(p)
        try:
            # timeout matches atlassian_pm_link.py:101 — an unbounded urlopen would hang
            # forever on a stalled connection, which matters the moment this is wired
            # into CI rather than run by hand.
            req = urllib.request.Request(url, headers=hdr)
            d = json.load(urllib.request.urlopen(req, timeout=30))
        except urllib.error.HTTPError as e:
            print(f"FAIL(2): Jira API {e.code} on {q!r}", file=sys.stderr)
            sys.exit(2)
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"FAIL(2): Jira API unreachable ({e}) on {q!r}", file=sys.stderr)
            sys.exit(2)
        out += d.get("issues", [])
        tok = d.get("nextPageToken")
        if d.get("isLast") or not tok:
            return out


RCP_SCRUM_BOARD = 168


def agile(path):
    """GET on the Agile API. Boards and sprints are unreachable through the platform
    API, and the Atlassian MCP tools wrap only that one — hence the hand-roll."""
    url = f"{site}/rest/agile/1.0/{path}"
    try:
        req = urllib.request.Request(url, headers=hdr)
        return json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as e:
        print(f"FAIL(2): Jira Agile API {e.code} on {path!r}", file=sys.stderr)
        sys.exit(2)
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"FAIL(2): Jira Agile API unreachable ({e}) on {path!r}", file=sys.stderr)
        sys.exit(2)


def active_sprint():
    """(label, sprint) for the sprint running on board 168, or (None, None).

    Named `Sprint 9` -> label `sprint-9`. A sprint whose name does not carry a
    number cannot imply a label, so it is treated as "no active sprint" rather
    than guessed at."""
    for s in agile(f"board/{RCP_SCRUM_BOARD}/sprint?state=active").get("values", []):
        m = re.match(r"\s*sprint\s*[-_ ]?(\d+)\s*$", s.get("name", ""), re.I)
        if m:
            return f"sprint-{m.group(1)}", s
    return None, None


expected_label, sprint = active_sprint()

# Discover the label unless one was named. The ACTIVE sprint wins: deriving the label
# from the newest one that happens to exist is what let Sprint 9 be graded against
# Sprint 8's finished rows.
if not label and expected_label:
    label = expected_label
    print(f"active sprint: {sprint['name']!r} (id {sprint['id']}) -> label {label}")

# THE MISSING-LANE ASSERTION. A running sprint whose label nothing carries is not a
# clean lane, it is an unasserted one — the whole failure this gate exists to catch.
if expected_label and label == expected_label:
    tagged = jql(f'project in (KAN, RCP) AND labels = "{label}"', "summary")
    if not tagged:
        print(f"\nFAIL(1): sprint {sprint['name']!r} (id {sprint['id']}) is ACTIVE on "
              f"board {RCP_SCRUM_BOARD}, but ZERO issues carry the label {label!r}.")
        print("A lane nobody labelled cannot be asserted, and this gate would otherwise")
        print("report PASS over an empty set — the vacuous pass that hid Sprint 9's board")
        print("for four days. Label the sprint's KAN execution rows and their RCP")
        print("acceptance rows, then re-run.")
        sys.exit(1)
    print(f"lane census: {len(tagged)} issue(s) carry {label}")

# NOTE: Jira's `labels` field does NOT support wildcard matching — `labels ~ "sprint-*"`
# silently returns zero rows, which made an earlier version of this script report PASS
# while three sprint-4 rows sat right there. Enumerate labelled rows and filter here.
if not label:
    rows = jql("project = KAN AND labels IS NOT EMPTY ORDER BY created DESC", "labels")
    if not rows:
        print("FAIL(2): no labelled KAN issues returned at all — the query or credentials "
              "are wrong, not the board. Refusing to report a pass.", file=sys.stderr)
        sys.exit(2)
    nums = {int(l.split("-", 1)[1]) for i in rows for l in (i["fields"].get("labels") or [])
            if l.startswith("sprint-") and l.split("-", 1)[1].isdigit()}
    if not nums:
        print("PASS: no sprint-N labels in KAN — nothing to assert.")
        sys.exit(0)
    label = f"sprint-{max(nums)}"

rows = jql(f'project = KAN AND labels = "{label}" AND statusCategory != Done', "summary,issuelinks")
if not rows:
    print(f"PASS: no open KAN rows labelled {label}.")
    sys.exit(0)

orphans = []
for i in rows:
    linked_rcp = [
        (lk.get("inwardIssue") or lk.get("outwardIssue") or {}).get("key", "")
        for lk in (i["fields"].get("issuelinks") or [])
    ]
    if not any(k.startswith("RCP-") for k in linked_rcp):
        orphans.append((i["key"], i["fields"]["summary"][:64]))

print(f"lane check: {label} — {len(rows)} open KAN row(s), {len(orphans)} orphan(s)")
for k, s in orphans:
    print(f"  ORPHAN {k}  {s}")

if orphans:
    print(f"\nFAIL(1): {len(orphans)} open KAN row(s) labelled {label} have no linked RCP row.")
    print("The KAN/RCP lane is drifting (Sprint 4 risk R1). Either link them to their RCP")
    print("acceptance row, or drop the sprint label if the work is not sprint scope.")
    sys.exit(1)

print(f"PASS: every open KAN row labelled {label} is linked to an RCP row.")
PY
