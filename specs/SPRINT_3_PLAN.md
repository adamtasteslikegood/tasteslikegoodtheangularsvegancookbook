# Sprint 3 Plan — Dedupe-first Prod Hygiene, then SPA↔SSR Flow Gaps

_Kickoff:_ 2026-07-24 · _Owner:_ Adam Schoen · _Jira epic:_ **KAN-136**
_Status:_ ✅ **LOCKED via `/cs:grill-pm` (6/6 branches, 2026-07-24).** Item A (dedupe) executed
same day — see close-out below. Item B (flow gaps) is the sprint's remaining committed work.
_Re-planned 2026-07-24 evening (`/cs:pm-loop`, PLAN-OK):_ item B's first wave is fully merged;
the remaining committed scope is **B1–B3 below**, batched into one release, closed by walkthrough
round 2. Adam's scope picks and the hold-the-release decision are recorded in that section.
**Wave-2 progress (2026-07-24): B1 ✅ · B3 ✅ · B2 open** — then v0.4.5 and walkthrough round 2.

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

**Also observed (not sprint scope) — since RESOLVED:** the migrate-job env used by the one-off jobs
threw `Valkey IAM auth failed: SSL CERTIFICATE_VERIFY_FAILED` (falling back gracefully), because the
VALKEY_CA wiring that fixed the _service_ (#3176/Backend #222) had not yet reached the
`flask-backend-migrate` job config at the time of the dedupe run. **#3253 wired it and shipped**
(`7cf0641`, an ancestor of `main`) — verified live 2026-07-24: `flask-backend-migrate` now carries
`VALKEY_CA_CERT` via secretKeyRef, as does `flask-backend-image-repair`. Nothing left to file.

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

| #      | Item                                                   | Jira        | Proving gate (machine-checkable unless noted)                                                                                                                                          | Reviewer |
| ------ | ------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **B1** | ✅ **DONE** — Image-repair job: Scheduler + sanity run | KAN-141     | `gcloud scheduler jobs describe` returns the trigger AND `gcloud run jobs executions list --job=<repair>` shows ≥1 execution with status Succeeded — **both met, see close-out below** | Adam     |
| **B2** | Codex P2s from KAN-140                                 | KAN-143/144 | one PR closing GH #3255 + #3256; `Gate — all checks passed` SUCCESS; `npm test` exit 0                                                                                                 | Adam     |
| **B3** | ✅ **DONE** — Shared-method extraction (#3209)         | KAN-126     | `togglePublic` defined exactly 1× under `src/` (was 2×); `npm test` exit 0; `Gate — all checks passed` SUCCESS — **all three met, see close-out below**                                | Adam     |

**Release decision (Adam, 2026-07-24):** _hold_ — do not cut v0.4.5 for KAN-149 alone. Batch B1–B3
onto `dev` first, then one release. Trade-off accepted knowingly: the walkthrough gate waits on that
release, and the release blast radius grows.

### B1 close-out — image-repair Scheduler + sanity run (2026-07-24)

**Scheduler `flask-backend-image-repair-daily`** (us-central1): `0 3 * * *` America/Los_Angeles,
ENABLED, POST → the Cloud Run Admin API `jobs/flask-backend-image-repair:run`, OAuth SA
`746675616486-compute@developer.gserviceaccount.com`. That SA was granted `roles/run.invoker`
**scoped to this job only** — the job had no IAM bindings at all before this. Verified live rather
than merely configured: a forced run set `lastAttemptTime` 2026-07-25T00:03:39Z with no error code;
next fire 2026-07-25T10:00:04Z.

**Runs — 4/4 succeeded, 0 failed:** `vh58t` (`--dry-run`, 10 found / 0 enqueued) · `4nhz5` (manual,
10/10 enqueued) · `b9fsh` (**scheduler-triggered**, 10/10 enqueued) · `ggsp7` (direct API POST while
isolating the trigger path — redundant in hindsight, harmless).

**Findings:** 10 imageless recipes, **zero canonical** (all 7 curated slugs have images). One was
**public** — `vegan-english-breakfast-with-oven-dried-tomatoes`, a live blank hero/OG. The other 9
were private. The backlog exceeds one run's limit of 10, so successive daily runs will drain it.

**End-to-end proof:** that public recipe now serves a real image —
`GET /api/recipes/48b3856c-…/image` → `HTTP 200, image/png, 1,930,022 bytes`; `/r/<slug>` 200 with
og:image pointing at it. **Adam visually confirmed the hero rendering live on the SSR page.**

### B3 close-out — shared recipe methods extracted (2026-07-24)

PR **#3268** merged to `dev` as `1974f4d`, closing GH #3209.

`GeneratorComponent` and `RecipeDetailComponent` carried ~13 byte-identical methods, so every fix
landed twice — the `togglePublic` redundant-save bug (`da445b3`) and the KAN-149 immutability fix
both did, and #3265 grew the duplication further. Both reviewers on #3265 flagged it.

Shared state and behaviour now live in `src/components/shared/recipe-view.base.ts`, which both
components extend. **−515 lines across the two components, +16.** Each keeps what is genuinely its
own: prompt/generation state on the generator, routing and the cold deep-link fetch on recipe-detail.

**The one genuine divergence is now an explicit seam.** The two `togglePublic` copies were identical
_except_ that a guest activating the toggle gets the auth modal in the generator, while recipe-detail
stays silent (its template renders a dedicated "Sign in to publish" button, #3211). Collapsing them
would have dropped that silently; it is now the `protected onPublishDenied()` hook — default silent,
overridden in the generator.

**Testing — the real risk here was that `GeneratorComponent` had no test file at all**, so its half
of this logic was unprotected before the move. Net first, then the refactor: 10 generator tests
pinning behaviour through its surface, plus 5 tests on the base's own contract. The generator tests
were **mutation-checked** — collapsing the guest branch onto recipe-detail's silent version, exactly
the mistake this extraction could make, fails the first test. Suite **190 → 205 passing**; lint,
`format:check`, `type-check` and build clean.

**Bundle (measured by stash-and-rebuild, since the base is imported by the _eager_ generator):**
initial 885.64 → 885.78 kB (+0.14 kB); `recipe-detail` lazy chunk 21.19 → **16.81 kB (−21%)**, as it
no longer carries a duplicate copy. The 500 kB initial-budget warning is pre-existing on `dev`.

Left alone deliberately: `kitchen.component.ts` also has an `exportRecipe()`, but it exports the
whole cookbook — a different function that merely shares a name, not duplication.

### Close gate for Sprint 3

1. ~~B1~~ ✅ · ~~B3~~ ✅ · **B2** merged to `dev`.
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
Backend dependabot PR #243 (actions bump, unrelated to sprint).

---

## Sprint 3 CLOSE-OUT — 2026-07-26 (epic KAN-136 → Done)

Closed via `/cs:pm-loop` after `/cs:grill-pm` locked 7/7 branches with Adam the same day.
Close gate as written above, item by item:

| Gate | Result |
| --- | --- |
| 1. B1 · B3 · **B2** merged to `dev` | ✅ B2 = `a10d8a5` (PR #3271, KAN-143/144) |
| 2. Release cut, tag fired, both services live-verified | ✅ **overshot** — v0.4.5 *and* v0.4.6 shipped; prod `200` |
| 3. Walkthrough round 2 | ✅ ran 2026-07-25 — cited in the CHANGELOG v0.4.6 preamble |
| 4. Epic KAN-136 → Done with the close-out written here | ✅ this section |

**Walkthrough round 2 produced six tickets, not ≤3** — the gate allowed "accept, or file ≤3 new
gaps." Three were fixed inside the sprint and shipped in v0.4.6; three carry forward as Sprint 4's
committed scope. That overrun is recorded rather than smoothed over: the acceptance gate has now
generated a sprint's worth of work twice running (round 1 → KAN-149; round 2 → six tickets), which
is why Sprint 4 carries **R4** — round-3 findings go to the backlog by default.

| Round-2 finding | Disposition |
| --- | --- |
| KAN-154 · public SSR pages 429 during normal browsing | shipped v0.4.6 — `4f57907` (PR #3281) |
| KAN-158 · promote orange-chicken seitan to canonical (cap → 8) | shipped v0.4.6 — `af87c001` (PR #3283) + pointer `ccf7c7a` (PR #3284) |
| KAN-159 · SPA deep-link reload returns a blank, dead page | shipped v0.4.6 — `3be0216` (PR #3282) |
| KAN-155 · publish fails "Recipe ID collision" on foreign-owned rows | → **Sprint 4** committed |
| KAN-156 · duplicate "you already have this recipe" toast | → **Sprint 4** committed |
| KAN-157 · unpublish 4 dedup-suffixed public recipes | → **Sprint 4** committed |

### Board reconciliation — the third occurrence, and what it cost

Every sprint-3 child had shipped code on `origin/main` while the board read In Review / In Progress.
Ten rows were transitioned to Done, each carrying its landing SHA, PR and release tag as a comment
(`git tag --contains <sha>` verified per row, not asserted):

| Issue | Landed | PR | Released |
| --- | --- | --- | --- |
| KAN-126 | `1974f4d` | #3268 | v0.4.5 |
| KAN-137 | `d747b6e` | #3244 | v0.4.3 |
| KAN-139 | `e40f14b` | #3250 (+ Backend #239) | v0.4.4 |
| KAN-140 | `7c6d732` | #3252 (+ Backend #240) | v0.4.4 |
| KAN-143 | `a10d8a5` | #3271 | v0.4.5 |
| KAN-144 | `a10d8a5` | #3271 | v0.4.5 |
| KAN-149 | `f0ef889` | #3265 | v0.4.5 |
| KAN-154 | `4f57907` | #3281 | v0.4.6 |
| KAN-158 | `af87c001` | #3283 | v0.4.6 |
| KAN-159 | `3be0216` | #3282 | v0.4.6 |

KAN-141 was already Done. **KAN-155/156/157 were deliberately NOT closed** — they have zero commits
in either repo, so closing them would have been a false Done in the opposite direction. They were
re-labelled `sprint-3` → `sprint-4`.

This is the second hand-reconciliation in three days (the 07-24 re-plan closed eight such rows).
Two occurrences is a system property, not bad luck. The real fix already exists as an unbuilt
backlog row — **KAN-97** "auto-transition on PR merge" (twin: RCP-39) — and is now named, accepted
and scheduled for Sprint 5 rather than silently re-paid a third time (Sprint 4 **R2**).

### The KAN/RCP lane was structurally broken, not just neglected

Adam raised this during the grill; verified against the Agile API rather than the docs:

```
GET /rest/agile/1.0/board/34/sprint      (KAN)
  → {"errorMessages":["The board does not support sprints"]}

id=34  simple  KAN board        project=KAN
id=166 scrum   RCP board        project=RCP
id=168 scrum   RCP Scrum Board  project=RCP
  sprint id=9 "RCP Sprint 1"  state=ACTIVE  2026-04-28 → 2026-05-12   (11 weeks overdue)
  sprint id=3 "RCP Sprint 1"  state=future                             (duplicate)
```

**No work this project has ever called a sprint has been a Jira sprint.** Sprints 1–3 were
`sprint-N` labels on a board the API refuses to attach a sprint to — which is why every flow
measure has to be hand-rolled through `jira_snapshot_bridge.py` and why no burndown or velocity
report has ever existed. `docs/guides/agile/SCRUM_BOOTSTRAP_AND_BOARD_PLAN.md` recorded "Sprint
support: not supported by this board" on 2026-04-27 and recommended a Scrum board; that
recommendation was never executed.

The cause is structural, not discipline: KAN's issue types carry `scope: {PROJECT, 10034}`
(team-managed — one `createJiraIssue` away for an agent), RCP's carry none (company-managed, shared
schemes). The easier project pulled the work.

Actions taken: stale sprint **id 9 closed** (its 5 incomplete rows returned to the RCP backlog,
nothing deleted), duplicate future sprint **id 3 deleted**, and a real sprint **"Sprint 4"
(id 43) created on board 168**. Five shadow RCP rows were reconciled to the same evidence standard
as KAN — RCP-44 (→ KAN-137/KAN-149, v0.4.3/v0.4.5), RCP-46 (→ KAN-140 + KAN-141, v0.4.4),
RCP-51 (→ KAN-139, v0.4.4), RCP-52 (→ KAN-118 `2cb90e1` PR #3207, v0.4.2) → Done; **RCP-43 closed
as a duplicate of KAN-156**, not as delivered, so the pair collapses onto one live row. RCP-49
(manual toggle/unpublish/delete field-test loop) stays open deliberately — it *is* the walkthrough.

### Found but deliberately not acted on

Closing sprint 9 surfaced five more RCP rows describing the **v0.2 Anti-Recipe Site**, which has
been live in production for months: **RCP-3** (the v0.2 epic), **RCP-1**, **RCP-7**, **RCP-20**,
**RCP-4**. They are stale in exactly the way this close-out just fixed elsewhere. They were left
alone under the sprint's own budget rule — hygiene is capped at one pass and agents may not
self-authorize scope. Filed here as the first Sprint 5 candidate.

### Flow metrics, measured after the reconciliation (never before)

Measuring before transitioning would have left ten shipped items' cycle-time clocks still running.
Raw vs. filtered (`daily-status`, `agentic-workflows`, `report` excluded — 21 bot-filed rows of 125):

| Measure | Raw (125 rows) | Filtered (104 rows) |
| --- | --- | --- |
| Done / WIP | 57 / 4 | 49 / 4 |
| Cycle time p50 | 1 d | 1 d |
| **Cycle time p85** | **78 d** | **3 d** |
| SLE @ p85 (conformance) | 78 d (86.0%) | 3 d (85.7%) |

The bot rows were not a rounding error — they moved p85 cycle time by a factor of 26 and would have
set the Service Level Expectation at 78 days. Filtered is the real number.

**Throughput is now contaminated by this very close-out and must not be used to forecast.** Batch-
closing ten rows dated today, for work delivered across four releases, reads as 32 resolved/week
(7-day) and 18.5/week (14-day) against a 2.77/week lifetime average. That spike is an artifact of
the reconciliation, not capacity. See Sprint 4's forecast section for how that was handled instead
of quietly using the flattering number.
