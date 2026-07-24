# Sprint 3 Plan — Dedupe-first Prod Hygiene, then SPA↔SSR Flow Gaps

_Kickoff:_ 2026-07-24 · _Owner:_ Adam Schoen · _Jira epic:_ **KAN-136**
_Status:_ ✅ **LOCKED via `/cs:grill-pm` (6/6 branches, 2026-07-24).** Item A (dedupe) executed
same day — see close-out below. Item B (flow gaps) is the sprint's remaining committed work.

## Charter (locked decisions)

| #   | Branch                | Decision                                                                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Outcome / DONE**    | **(A)** Rule-based dedupe of duplicate-named recipe rows **owned by Adam's primary account (user 1) only** — dry-run listing → keep-one rule → one yes/no table approval → backup → delete → listing re-run exit 0. Cause disposition verified (recurrence + ownership audit, adversarial pass). **(B)** SPA↔SSR publish→save→view flow-gap burn-down: Adam enumerates the 3–4 gaps as the user; map to GH #3210/#3211/#3146/#3147; each gap verified-fixed (his walkthrough passes) or parked with reason. |
| 2   | **Identity principle** | **Scoped to CANONICAL public slugs curated by Adam** (`specs/canonical-recipes.json`): the canonical URL + recipe NAME are the stable identity, and the recipe content behind them may **version-bump in place** via Adam's curation — "Best Vegan Lasagne" never becomes `-2`; today's recipe may be upgraded under the same slug. For **regular user recipes**, `-N` suffix slugs are the **by-design** normalize-slug collision handling (legitimate same-name recipes exist, one author or many) — not a defect, and no version-bump flow is implied for users. This round's cleanup targeted unintentional same-author regeneration siblings in Adam's own test data; the suffix was merely a safe *filter heuristic* for that. Feeds #3147 (canonical slug stability on rename).                                                            |
| 3   | **Measurement**       | WIP ≤ 3, no story points; cumulative flow via `jira_snapshot_bridge.py --to flow`. >10 completed items now — p50/p85 range (~2–4 active days) is legitimate sizing input, range only, never a date.                                                                                                                                                                                |
| 4   | **Forecast honesty**  | Zero invented dates. Owner-set target (Adam's override): dedupe complete 2026-07-24 17:00 PT — **beaten: done 08:30 PT**. DD profiler: **DECIDED (Adam, 2026-07-24) — stays off**; env flip stands, DD code idle in container; re-enable = env var + DD service upgrade.                                                                                                          |
| 5   | **Ownership**         | Owner = Adam on all; agent executes. Reviewers: dedupe = Adam (rule + one-table approval, destructive human gate) + machine verify; cause audit = adversarial pass on any disposition claim; flow gaps = PR gate + Adam-as-user walkthrough acceptance. Reviewer never the author.                                                                                                 |
| 6   | **Risk (pre-mortem)** | (a) wrong-row deletion → dry-run + rule + backup export before delete (rows are disposable test output; identity is what matters); (b) human-gate stall → Adam's two inputs front-loaded; (c) cause-hypothesis wrong → audit checks `created_at` recurrence AND account ownership, adversarial pass required; (d) flow fixes regress SSR/SEO → canonical + crawl CI gates required; (e) walkthrough scope creep → commit ≤3, extras parked. |
| 7   | **Budgets**           | 3 attempts/task, 12 iterations/goal; escalation → Adam, reason written here; blockers threatening an owner-set target escalate immediately (no attempt-burning); agent runs scoped to committed items (no codebase-wide passes). Copilot spend now under a fixed blocking budget (Adam, 2026-07-24).                                                                                |

## Context carried from Sprint 2

C3's deferral was deliberate sequencing, not a stall: frontend causes shipped to prod first
(v0.4.x) so the DB cleanup happens once. The real Sprint-2 gate was UX — the "View" public-recipe
affordance buried below a full modal scroll. Rolled in: C3 (→ item A, done below), GH #3210,
#3211 (→ item B), #3209 (refactor, backlog).

## Imageless recipes (explicitly out of the dedupe round)

Disposition rules for imageless recipes get written **after** this dedupe round, based on how the
functioning UI/UX renders them — a follow-on decision item, not part of item A. (In the event, all
29 rows in the dedupe table had images, so the question never arose.)

---

## Item A close-out — dedupe executed 2026-07-24 (loop gates PLAN-OK → CLOSE-OK)

**Method:** read-only dry-run via one-off Cloud Run job (`flask-backend:77c915c` image + migrate-job
env, VPC path to Cloud SQL), keep/delete table generated by rule (keep public-slugged row → else
imaged → else oldest), **Adam approved the table as printed (17 deletes)**, then a second one-off
job: 17-row JSON backup → strict-assert delete (exists ∧ user_id=1 ∧ in approved list, else abort) →
dangling `cookbook.recipe_ids` cleanup → in-transaction re-verify. Both one-off jobs deleted after use.

**Results:**

- Prod totals at dry-run: 12 users, 46 cookbooks, 208 recipes. Duplicate **cookbook** groups: **0** (KAN-106 race-bug rows already gone). Duplicate **recipe** groups: 18 (12 owned by user 1, incl. 7× "vegan toaster oven air fryer french fries").
- **Deleted 17 rows / kept 12** (user 1 only). 15 dangling refs cleaned across 11 cookbooks.
- **VERIFY-CLEAN:** zero duplicate-named recipe rows remain for user 1.
- Live spot-check: keeper slugs 200 (`…french-fries`, `vegan-double-double`, `homemade-vegan-flour-tortillas`); deleted suffix URLs 404 (`…-3`, `…-2`, `…-4`) — correct, because these were unintentional regeneration siblings, not legitimate same-name recipes (the suffix mechanism itself is by-design; see charter row 2).
- Backup: `dedupe_backup_17rows.jsonl` (17 full-row JSON exports, session job dir).
- Untouched by charter scope: user 2 (Allison) 3 dup groups (incl. two junk `generating...` rows), guest-session 3 groups, duplicate-Adam accounts (users 3/7/8 — no dup groups).

**Cause disposition (adversarially reviewed):** the KAN-106 double-click race fix **holds** — no
post-fix duplicate pair shows a race signature (seconds apart); the one pre-fix pair that does
("kitchen catastrophe chili", 9 s apart, Mar 10) predates the fix. The other duplicates, including
**9 of the 17 deleted rows created after 2026-07-18**, came from the **generation/save flow behaving
as designed** — each regeneration during Adam's testing minted a new row with a `-N` collision slug
(minutes-to-days apart, some auto-published). Not a bug and not a regression: the rows were test
artifacts, and the `-N` handling is correct for users. What the sprint targets instead is item B's
UX gaps in publish→save→view plus #3146 (empty-slug 400 swallowed) and #3147 (canonical slug
stability on rename, per the identity principle in charter row 2).

**Also observed (not sprint scope):** the migrate-job env used by the one-off jobs still throws
`Valkey IAM auth failed: SSL CERTIFICATE_VERIFY_FAILED` (falls back gracefully) — the VALKEY_CA
wiring that fixed the *service* (#3176/Backend #222) apparently never reached the
`flask-backend-migrate` job config. Filed for follow-up consideration.

## Item B — SPA↔SSR flow-gap burn-down (open)

First action: Adam's walkthrough enumeration of the 3–4 gaps in publish → save → view → repeat
(the "View link buried below the modal scroll" class). Map to #3210 (isSaved lie on non-owned
deep links), #3211 (no "Sign in to publish" in recipe-detail), #3146, #3147; unmapped gaps become
new issues. Gate per gap: Adam-as-user re-runs the loop and accepts, plus PR gate; anything touching
`/r/` or slugs cites the canonical + crawl CI gates.

## Not in this sprint

Imageless-recipe disposition rules (post-dedupe decision item) · #3209 refactor · Phase-2 automated
rubric scoring · home-page redesign · Valkey KAN-16/KAN-17 · migrate-job VALKEY_CA wiring (filed).
