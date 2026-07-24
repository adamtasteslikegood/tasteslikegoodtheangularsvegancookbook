# Sprint 3 Plan — Dedupe-first Prod Hygiene, then SPA↔SSR Flow Gaps

_Kickoff:_ 2026-07-24 · _Owner:_ Adam Schoen · _Jira epic:_ **KAN-136**
_Status:_ ✅ **LOCKED via `/cs:grill-pm` (6/6 branches, 2026-07-24).** Item A (dedupe) executed
same day — see close-out below. Item B (flow gaps) is the sprint's remaining committed work.
_Re-planned 2026-07-24 evening (`/cs:pm-loop`, PLAN-OK):_ item B's first wave is fully merged;
the remaining committed scope is **B1–B3 below**, batched into one release, closed by walkthrough
round 2. Adam's scope picks and the hold-the-release decision are recorded in that section.

## Charter (locked decisions)

| #   | Branch                 | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Outcome / DONE**     | **(A)** Rule-based dedupe of duplicate-named recipe rows **owned by Adam's primary account (user 1) only** — dry-run listing → keep-one rule → one yes/no table approval → backup → delete → listing re-run exit 0. Cause disposition verified (recurrence + ownership audit, adversarial pass). **(B)** SPA↔SSR publish→save→view flow-gap burn-down: Adam enumerates the 3–4 gaps as the user; map to GH #3210/#3211/#3146/#3147; each gap verified-fixed (his walkthrough passes) or parked with reason.                                                                                                                                                                                                                                                                            |
| 2   | **Identity principle** | **Scoped to CANONICAL public slugs curated by Adam** (`specs/canonical-recipes.json`): the canonical URL + recipe NAME are the stable identity, and the recipe content behind them may **version-bump in place** via Adam's curation — "Best Vegan Lasagne" never becomes `-2`; today's recipe may be upgraded under the same slug. For **regular user recipes**, `-N` suffix slugs are the **by-design** normalize-slug collision handling (legitimate same-name recipes exist, one author or many) — not a defect, and no version-bump flow is implied for users. This round's cleanup targeted unintentional same-author regeneration siblings in Adam's own test data; the suffix was merely a safe _filter heuristic_ for that. Feeds #3147 (canonical slug stability on rename). |
| 3   | **Measurement**        | WIP ≤ 3, no story points; cumulative flow via `jira_snapshot_bridge.py --to flow`. >10 completed items now — p50/p85 range (~2–4 active days) is legitimate sizing input, range only, never a date.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 4   | **Forecast honesty**   | Zero invented dates. Owner-set target (Adam's override): dedupe complete 2026-07-24 17:00 PT — **beaten: done 08:30 PT**. DD profiler: **DECIDED (Adam, 2026-07-24) — stays off**; env flip stands, DD code idle in container; re-enable = env var + DD service upgrade.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 5   | **Ownership**          | Owner = Adam on all; agent executes. Reviewers: dedupe = Adam (rule + one-table approval, destructive human gate) + machine verify; cause audit = adversarial pass on any disposition claim; flow gaps = PR gate + Adam-as-user walkthrough acceptance. Reviewer never the author.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 6   | **Risk (pre-mortem)**  | (a) wrong-row deletion → dry-run + rule + backup export before delete (rows are disposable test output; identity is what matters); (b) human-gate stall → Adam's two inputs front-loaded; (c) cause-hypothesis wrong → audit checks `created_at` recurrence AND account ownership, adversarial pass required; (d) flow fixes regress SSR/SEO → canonical + crawl CI gates required; (e) walkthrough scope creep → commit ≤3, extras parked.                                                                                                                                                                                                                                                                                                                                            |
| 7   | **Budgets**            | 3 attempts/task, 12 iterations/goal; escalation → Adam, reason written here; blockers threatening an owner-set target escalate immediately (no attempt-burning); agent runs scoped to committed items (no codebase-wide passes). Copilot spend now under a fixed blocking budget (Adam, 2026-07-24).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

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
wiring that fixed the _service_ (#3176/Backend #222) apparently never reached the
`flask-backend-migrate` job config. Filed for follow-up consideration.

## Item B — SPA↔SSR flow-gap burn-down

First action was Adam's walkthrough enumeration of the gaps in publish → save → view → repeat
(the "View link buried below the modal scroll" class). Gate per gap: Adam-as-user re-runs the loop
and accepts, plus PR gate; anything touching `/r/` or slugs cites the canonical + crawl CI gates.

### Wave 1 — merged (2026-07-24)

| Item        | What                                                                       | Ship state                                                      |
| ----------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **KAN-137** | Saved-copy publish-state cluster; absorbed #3210 + #3211                   | **live** — v0.4.3 (PR #3244)                                    |
| **KAN-139** | `is_canonical` + `source_slug` columns, server-truth recipe rows           | **live** — v0.4.4 (Backend #239, #3250)                         |
| **KAN-140** | Manual recipes not publishable — origin column + publish gate, notes split | **live** — v0.4.4 (Backend #240, #3252)                         |
| **KAN-141** | Image-repair Cloud Run Job + wiring                                        | **live** — v0.4.4 (Backend #241, #3257); job never yet fired    |
| **KAN-149** | Post-v0.4.4 field-test cluster: #3262 / #3263 / #3264                      | **on `dev`, unreleased** — PR #3265 merged `f0ef889` 2026-07-24 |

Walkthrough round 1 (Adam's zucchini-poppers field test) is what produced KAN-149. Its three fixes
are the reason a release is still owed before the sprint can close.

### Wave 2 — committed remaining scope (Adam's picks, 2026-07-24)

WIP ≤ 3 still holds — these are the only committed items; everything else stays parked.

| #      | Item                                     | Jira        | Proving gate (machine-checkable unless noted)                                                                                                      | Reviewer |
| ------ | ---------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **B1** | Image-repair job: Scheduler + sanity run | KAN-141     | `gcloud scheduler jobs describe` returns the trigger AND `gcloud run jobs executions list --job=<repair>` shows ≥1 execution with status Succeeded | Adam     |
| **B2** | Codex P2s from KAN-140                   | KAN-143/144 | one PR closing GH #3255 + #3256; `Gate — all checks passed` SUCCESS; `npm test` exit 0                                                             | Adam     |
| **B3** | Shared-method extraction (#3209)         | KAN-126     | `togglePublic` defined exactly 1× under `src/` (was 2×); `npm test` exit 0; `Gate — all checks passed` SUCCESS                                     | Adam     |

**Release decision (Adam, 2026-07-24):** _hold_ — do not cut v0.4.5 for KAN-149 alone. Batch B1–B3
onto `dev` first, then one release. Trade-off accepted knowingly: the walkthrough gate waits on that
release, and the release blast radius grows.

### Close gate for Sprint 3

1. B1–B3 merged to `dev`.
2. **v0.4.5** cut `dev` → `main`, tag fires, both Cloud Run services live-verified.
3. **Walkthrough round 2** — Adam re-runs publish → save → view on ≥2 recipes (≥1 generated,
   ≥1 manually entered), explicitly including the #3264 View-link/image overlap, which shipped
   "verified by analysis" only. Accept, or file ≤3 new gaps.
4. Epic KAN-136 → Done with the close-out written into this file.

## Board hygiene done during this re-plan (2026-07-24)

Eight KAN rows were sitting in To Do whose work had already shipped or was superseded — they were
corrupting the flow metrics. All closed with code-level or PR-level evidence on the ticket:

- **KAN-125** (#3208 guard timeout) → PR #3214 · **KAN-127** (#3210) + **KAN-128** (#3211) → PR #3244 /
  v0.4.3 · **KAN-129** (`is_canonical`) → KAN-139 / v0.4.4
- **KAN-142** (Codex second opinion) → ran, gate PASS, no P1s; its two P2s are B2 above
- **KAN-146 / 147 / 148** → auto-filed twins of #3262/#3263/#3264, superseded by KAN-149

KAN-149, KAN-126, KAN-143 and KAN-144 were re-parented under KAN-136 so the epic rolls up the whole
sprint (8 children). KAN-143/144 had placeholder summaries of literally "P2" — retitled.

## Not in this sprint

Imageless-recipe disposition rules (post-dedupe decision item) · #3147 canonical-slug-on-rename
decision · Phase-2 automated rubric scoring · home-page redesign · Valkey KAN-16/KAN-17 ·
migrate-job VALKEY_CA wiring (filed) · Backend dependabot PR #243 (actions bump, unrelated to sprint).
