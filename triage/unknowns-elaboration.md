# The 11 unknowns + TO-36, elaborated (2026-07-12)

## The 10 GitGuardian tickets = 6 distinct incidents, 4 double-filed

A GitGuardian→Jira integration files each incident as a Jira task — and for a
while filed every incident into BOTH RCP and PLZG (two unrelated projects,
neither of which owns the scanned repos). All 10 are status To Do.

| Incident | Type | Repo / file | Filed as | Assessment |
| --- | --- | --- | --- | --- |
| 32538961 | Generic Password | gbrain `docker-compose.ci.yml:76` | RCP-33 **and** PLZG-95 | CI compose password — almost certainly a throwaway local/CI value; confirm on dashboard |
| 32538962 | Bearer Token | gbrain `test/eval-capture-scrub.test.ts:81` | RCP-34 **and** PLZG-94 | A *scrub* test — flagged token is very likely a deliberate fixture |
| 32538963 | PostgreSQL Credentials | gbrain `test/config.test.ts:28` | RCP-35 **and** PLZG-96 | Test config creds — likely fixture; worth a 30-second look since gbrain really does talk to Railway Postgres |
| 33617475 | Generic Password | alirez-claude-skills `spend_categorizer.py:49` | RCP-37 **and** PLZG-97 | Third-party skill collection; likely example/placeholder value |
| 34494493 | Bearer Token | gstack `test/redact-engine.test.ts:141` | PLZG-98 only | **CONFIRMED false positive** — checked the file on disk; it's a fake token used to test the scanner |
| 34494492 | Generic High Entropy Secret | gstack `test/redact-engine.test.ts:90` | PLZG-99 only | **CONFIRMED false positive** — same file, deliberate fixture |

Recommended disposition (pending Adam's OK):
1. Close all 10 in place with label `triage-security-alert-<verdict>` — none
   belong to either product's backlog regardless of validity. The two gstack
   ones can close as false-positive now; eyeball the 4 gbrain/alirez incidents
   on the GitGuardian dashboard first (links are in each ticket).
2. Fix the integration: point GitGuardian's Jira sync at ONE destination (or
   turn it off) — the RCP+PLZG double-filing is how 4 incidents became 8
   tickets.

## KAN-14

Created 2026-04-10, label `project:ops`, To Do. Its summary is literally a
prompt-template ("This work item will elaborate and refine the Jira issue
description…") and the description is the same boilerplate with placeholders
— an AI-generated filler task with no product content. Recommend: close with
label `triage-noise`.

## TO-36 (dev site) — the single dev-unique item

"Ship v0.3.0 — merge release PR #2981, tag, deploy to Cloud Run". Created
2026-07-01, To Do, labels CloudRun / DevOps / Release-v0.3.0 / Versioning.
It's the release umbrella for v0.3.0 with a checklist: merge fix PR #2843
(TAS-8), merge Backend PR #120 (catch main up to dev), verify the Cloud Build
tag-push trigger regex (#2898), merge release PR #2981, tag, deploy.

Reality check: every item on that checklist happened — the release train has
since shipped v0.3.0 → v0.3.3 (v0.3.3 live and verified 2026-07-11).
Recommend: clone to RCP as a historical record with a "Migrated from
TO-36 (tasteslikegood-dev)" marker, close it Done there with a note
("superseded by shipped v0.3.0–v0.3.3"), and let the original freeze with the
rest of dev-TO in Phase 2.3. That keeps the release audit trail on the main
site at zero risk.
