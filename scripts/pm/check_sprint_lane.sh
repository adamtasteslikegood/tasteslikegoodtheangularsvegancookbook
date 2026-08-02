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
# TWO LIMITS THAT REMAIN, both deliberate and neither fixed by the wiring:
#   1. It passes VACUOUSLY when no row carries the label — "every open sprint-N row
#      is linked" is trivially true over an empty set. It detects lane DRIFT, not a
#      missing sprint. Pair it with a membership census if you need the latter.
#   2. Fork PRs (including Dependabot) cannot read repository secrets, so the job is
#      SKIPPED there and `gate` counts skipped as passing. Same documented carve-out
#      as the release-train job. A fork PR is therefore not lane-checked.
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
import base64, json, os, sys, urllib.error, urllib.parse, urllib.request

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


# Discover the newest sprint-N label in KAN unless one was named.
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
