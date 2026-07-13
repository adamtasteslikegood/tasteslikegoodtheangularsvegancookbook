# Counts after Phase 2 — GATE 2 reconciliation (2026-07-12)

All numbers server-verified via `/search/approximate-count` after the last
mutation. Reconciliation rule: after-total = before-total + clones created
into that project; nothing deleted anywhere.

## Totals

| Project | Before | Clones in | After | Verified |
| --- | --- | --- | --- | --- |
| RCP | 37 | +1 (RCP-38 ← dev TO-36) | 38 | OK |
| KAN | 40 | +13 (KAN-83…95 ← TO-76…121) | 53 | OK |
| PLZG | 69 | 0 | 69 | OK |
| TO-main | 48 | 0 | 48 | OK |
| TOSVC (was dev TO) | 41 | 0 | 41 | OK |
| **Total** | **235** | **+14** | **249** | **OK** |

## Open (statusCategory != Done)

| Project | Open | Notes |
| --- | --- | --- |
| RCP | 31 | RCP-38 closed on arrival (historical record) |
| KAN | 30 | 17 prior + 13 migrated arrivals |
| PLZG | 37 | untouched this phase |
| TO-main | **0** | plaza-only shell; every recipe item closed (moved or noise) |
| TOSVC (dev) | 32 | frozen in place; TO-36 closed as migrated |

## Migration mapping (full JSON: moves-2026-07-12.json)

TO-76→KAN-83, TO-77→KAN-84, TO-78→KAN-85, TO-79→KAN-86, TO-80→KAN-87,
TO-82→KAN-88, TO-114→KAN-89, TO-115→KAN-90, TO-117→KAN-91, TO-118→KAN-92,
TO-119→KAN-93, TO-120→KAN-94, TO-121→KAN-95, dev-TO-36→RCP-38 (Done).
Each clone carries original labels + `migrated-from-TO` and a "Migrated from
<KEY>" description line; each original carries `triage-moved-2026-07-12`, a
comment naming its clone, and status Done.

## dev-TO freeze (2.3)

- Project renamed: key `TO` → `TOSVC`, name "SERVICE-HOLD — do not use
  (frozen 2026-07-12)", banner description pointing to the main site.
- Dev site project list now: DEMO, JIA, TOSVC — **no project keyed TO**;
  the duplicate-key confusion is gone. Old TO-nn issue URLs still resolve
  (Jira aliases re-keyed issues to TOSVC-nn).
- 2.2 was a NO-OP by classification: zero misfiled plaza items exist on the
  main site; the 17 plaza items on dev are all duplicates of PLZG/TO-main
  content and freeze in place.

GATE 2: PASSED. counts-after = counts-before + 14 clones, no item lost,
dev-TO frozen and de-keyed.
