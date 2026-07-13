# Counts before any mutation — Phase 0.2 / 0.3

Captured: 2026-07-11. All counts verified against a second, independent server
query (`/rest/api/3/search/approximate-count` with `project="<KEY>"`) at export
time — all five matched exactly.

## Jira issues (exported to triage/issues-*.json)

| Export label | Site | Project | Count |
| ------------ | ---- | ------- | ----- |
| RCP     | tasteslikegood.atlassian.net     | RCP  | 37 |
| KAN     | tasteslikegood.atlassian.net     | KAN  | 40 |
| PLZG    | tasteslikegood.atlassian.net     | PLZG | 69 |
| TO-main | tasteslikegood.atlassian.net     | TO   | 48 |
| TO-dev  | tasteslikegood-dev.atlassian.net | TO   | 41 |
| **Total in scope** | | | **235** |

Not exported (discovered during 0.1, outside PLAN.md scope — needs Adam's
call): main-site DR + TT service desks, dev-site DEMO + JIA service desks.

## Confluence pages (trees in triage/confluence-*.md)

| Space | Site | Pages |
| ----- | ---- | ----- |
| TLG  | main | 120 |
| PLZA | main | 3   |
| SD   | main | 20  |
| TWC  | main | 10  |
| SD   | dev  | 19  |

Export field set per issue: key, summary, description (first 2000 chars,
ADF→text), type, status, labels, created, updated, resolution, parent.

Gotcha for anyone re-running JQL: `TO` is a JQL reserved word — always quote it
(`project="TO"`), unquoted queries 400.
