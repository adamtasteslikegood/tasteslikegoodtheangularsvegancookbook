# Sprint 7 Plan — the publish guard and the contracts that were never written

_Chartered:_ 2026-08-10 · _Owner:_ Adam Schoen
_Jira epic:_ **RCP-75** (delivery/acceptance)
_Acceptance rows:_ **RCP-76** (S1) · **RCP-77** (S2) · **RCP-78** (S3) · _Execution tickets:_ **RCP-74 · KAN-221 · KAN-160 · KAN-182**
(KAN = execution, RCP = scope/acceptance)
_Jira sprint:_ **Sprint 7** (ID 49) — activated 2026-08-10.
_Timebox:_ **6 days from activation** (no single-point date — see D3).
_Status:_ **Chartered via `/cs:grill-pm`, 2026-08-10.** All six branches locked; scope confirmed by Adam.

**This sprint commits to three items.** The board's measured rate across three sprints
(0.67, 0.50, 1.00 items/day) supports 3 items per sprint. Sprint 6 proved the model:
3 committed, 3 delivered, 0 rolled. Sprint 7 holds the discipline.

## Why this sprint exists

Sprint 6 closed the duplicate-recipe cluster at the database layer (KAN-213). But the
_user-facing_ behaviour is still wrong: saving a recipe from someone else's cookbook
leaves the publish toggle active, and clicking it produces a `-2` slug with no image.
Adam reproduced this on live v0.4.9 (2026-08-10).

Meanwhile, two tickets have rolled through four sprints without starting — KAN-160
(recurring Valkey/routing defect contracts) and KAN-182 (no staging environment). The
Sprint 6 retro explicitly required their disposition: "pull-first into Sprint 7 or drop
from the backlog with reason." Adam chose pull-first for both.

## Committed scope

| SI     | Items            | Summary                                                                   |
| ------ | ---------------- | ------------------------------------------------------------------------- |
| **S1** | RCP-74 + KAN-221 | Saved-recipe publish guard + author/owner schema split                    |
| **S2** | KAN-160          | Recurring-defect contracts (Valkey config-factory + route classification) |
| **S3** | KAN-182          | Staging environment (minimal viable: same images, no Gemini, `noindex`)   |

**Stretch:** KAN-161 (IPv6 rate-limit bypass) — only pulled if S1–S3 close early.
If not pulled, explicitly dispositioned at close: pull-first into Sprint 8 or drop
with "no AAAA, latent risk accepted."

**Uncommitted backlog:** KAN-215 (imageless published copy) — blocked behind RCP-74's
403 guard, which prevents the imageless-page scenario. Becomes a nice-to-have once
the guard ships.

## Aging table (retro action: standing artifact)

| Item    | Filed      | Age (days) | Sprint history           | Disposition                            |
| ------- | ---------- | ---------- | ------------------------ | -------------------------------------- |
| RCP-74  | 2026-08-10 | 0          | New                      | **Anchor — commit**                    |
| KAN-221 | 2026-08-09 | 1          | New (Sprint 6 close-out) | **Commit — design decision in-sprint** |
| KAN-160 | 2026-07-25 | 16         | Rolled S4→S5→S6→S7       | **Pulled — Adam's go-ahead today**     |
| KAN-182 | 2026-07-30 | 11         | Rolled S5→S6→S7          | **Pulled — Adam's go-ahead today**     |
| KAN-161 | 2026-07-25 | 16         | Rolled S4→S5→S6→S7       | Stretch — pull if S1–S3 close early    |
| KAN-215 | 2026-08-08 | 2          | New                      | Uncommitted — blocked by RCP-74        |

## Charter (locked decisions)

| #   | Branch                | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **Outcome / DONE**    | **Anchor outcome (S1): a saved recipe from another user's cookbook cannot be published.** The publish toggle is disabled in the SPA when `source_slug` is non-null. The Backend returns 403 on `PUT /api/recipes/<id>` with `is_public: true` when `source_slug` is non-null. KAN-221's schema split (`user_id_author` + `user_id_saved_to`) ships in the same SI, with the row-vs-join-table design decision resolved via `/plan-eng-review` on day 1. DONE = (1) `npm test && cd Backend && uv run pytest` pass with the publish-guard test and schema migration, (2) browser verification of disabled toggle on a saved recipe, (3) `Gate — all checks passed` SUCCESS. S2: one Valkey config-factory + route-classification manifest + CI test asserting unrecognized paths 404. S3: staging Cloud Run pair serves 200 at a non-indexed URL. |
| D2  | **Measurement**       | **No flow tooling. Use item age.** Three sprints and 9 delivered items — still under the 10-item minimum for a distribution. The aging table is now a standing artifact (Sprint 6 retro action). Item age exposes declined items; cycle time is read off PRs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D3  | **Forecast honesty**  | **No date. No forecast.** 9 completed items across 3 sprints is still under the minimum. 6-day timebox from activation. If S3 isn't done by day 6, it rolls with evidence — not a failure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D4  | **Ownership**         | Owner **Adam**; author **agent**; reviewers: (1) machine — `Gate — all checks passed`, (2) `/codex` review (independent diff review, replaces codex-connector), (3) **Adam**. Escalation → Adam, reason written into this file. **Process commitment (retro action):** agent checks `pulls/<n>/comments` + `pulls/<n>/reviews` bodies before declaring any PR reviewed. Zero unfixed Copilot findings on merge.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D5  | **Risk (pre-mortem)** | Four risks, R1–R4 below. R1 (design decision stalls) is dominant and time-boxed. R2 (S3 scope creep) mitigated by defining minimal viable staging. R3 (S2 vague acceptance) mitigated by writing machine-checkable criteria before starting. R4 (missed review findings) mitigated by the process commitment in D4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D6  | **Budgets**           | 3 attempts per task (retry = changed approach). 12 loop iterations per goal. Exhausted budgets escalate to Adam — never reported as success. S1 design decision time-boxed to day 1: if no decision by EOD 1, RCP-74 guard ships standalone and KAN-221 rolls (escalation to Adam).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Risks

| #   | Risk                                               | Likelihood | Impact | Mitigation                                                                                                                                                    |
| --- | -------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | KAN-221 design decision stalls (row vs join-table) | Medium     | High   | Time-box to day 1 via `/plan-eng-review`. If no decision, ship RCP-74 guard alone — it works without the schema split (RCP-74 ticket says so). KAN-221 rolls. |
| R2  | S3 (staging env) scope creeps                      | High       | Medium | Define minimal viable staging: same images, SQLite (not a second Cloud SQL), no Gemini, `noindex`. Ship that; iterate later.                                  |
| R3  | S2 (KAN-160) has vague acceptance                  | Medium     | Medium | Write machine-checkable acceptance before starting: one Valkey config source, fail-fast healthcheck in cloudbuild.yaml, CI test for unrecognized-path 404.    |
| R4  | Agent reviews miss inline findings (again)         | Low        | Low    | `pulls/<n>/comments` + `pulls/<n>/reviews` bodies checked before every merge. Sprint 6 retro action.                                                          |

## S1 — Saved-recipe publish guard + schema split (RCP-74 + KAN-221)

### Acceptance criteria

1. **SPA toggle disabled.** The publish toggle is disabled (greyed out) for any recipe
   where `source_slug` is non-null. A read-only link to the original public URL replaces
   the toggle action.
2. **Backend 403.** `PUT /api/recipes/<id>` with `is_public: true` returns 403 when
   `source_slug` is non-null and the recipe's author is not the requesting user.
   Defense-in-depth — the SPA gate alone is insufficient.
3. **Toast suppressed.** The duplicate-save toast does not fire when saving from a public
   page (that's the intended flow, not a duplicate).
4. **Schema split (KAN-221).** `recipe.user_id` split into `user_id_author` (immutable,
   set at creation) and `user_id_saved_to` (the saving user). Migration backfills via
   `source_slug` → source row's owner. Design decision (row vs join-table) resolved via
   `/plan-eng-review` before code starts.
5. **Gate passes.** `npm test && cd Backend && uv run pytest` pass. `Gate — all checks
passed` SUCCESS.

### Fix points (from RCP-74 debug report)

- `src/utils/public-link.ts` — `publishToggleKind()` returns `'source'` for saved copies
  but the template doesn't disable the toggle.
- `src/components/recipe-detail/recipe-detail.component.html:90-94` — `aria-disabled`
  only checks `'locked'`/`'manual'`, not `'source'`.
- `src/components/shared/recipe-view.base.ts:252-261` — `togglePublic()` confirm dialog
  allows publishing saved copies. Replace with early-return toast.
- `Backend/repositories/db_recipe_repository.py:450-464` — `_gate_is_public()` only
  gates on `user_id is None`. Add `source_slug` check for 403.

## S2 — Recurring-defect contracts (KAN-160)

### Acceptance criteria

1. **Valkey config-factory.** One shared config source per language (Express + Flask),
   consumed by all Cloud Run surfaces. No more hand-mirroring env vars per service in
   `cloudbuild.yaml`.
2. **Fail-fast healthcheck.** Deploy-time Valkey round-trip that hard-fails the build on
   an unauthenticated connection, instead of silently degrading to SimpleCache.
3. **Route-classification manifest.** Convert `isPageSubresource()` allowlist into a
   general contract. CI test asserting unrecognized paths never return 200 as
   `text/html` from the SPA catch-all.
4. **Gate passes.**

### Source

Board finding from 2026-07-25 (`/cs:boardroom`). Held action items released by Adam
today (2026-08-10).

## S3 — Staging environment (KAN-182)

### Acceptance criteria

1. **Staging Cloud Run pair.** `express-frontend-staging` and `flask-backend-staging` in
   `us-central1`, serving the current images.
2. **Non-indexable.** `noindex` meta tag, `robots.txt` deny, no real user OAuth.
3. **Seeded data.** Sanitized snapshot with real row shapes — orphaned guest rows,
   multi-account ownership edges. No real emails.
4. **Accessible.** Staging URL returns 200 on `/`, `/browse`, `/r/<slug>`.
5. **No Gemini/Imagen.** Stubs or disabled — staging does not incur AI generation costs.
   (Adam holds the budget decision; stubs are the default.)

### Open design questions (to resolve before code)

- Per-PR staging vs shared persistent staging? (Deciding axis from KAN-182 ticket.)
- Own Cloud SQL instance or SQLite? (Minimal viable = SQLite.)
- Wired into the release train (`train-run.sh`)? (Stretch — not required for MVP.)

## Stretch — KAN-161 (IPv6 rate-limit bypass)

Rewrite `getClientIp()` in `server/security.ts` to use express-rate-limit's
`ipKeyGenerator()` helper for IPv6 masking. Delete the three `(req) => getClientIp(req)`
wrappers that suppress the validator. One change, one test, all three call sites move
together. ~Half a day if pulled.

**Exposure:** LATENT — no AAAA DNS record in production today.
