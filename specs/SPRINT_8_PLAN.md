# Sprint 8 Plan — the proper fix and the bugs that accumulated while avoiding it

_Chartered:_ 2026-08-17 · _Owner:_ Adam Schoen
_Jira epic:_ **RCP-80** (delivery/acceptance)
_Acceptance rows:_ **RCP-81** (S1) · **RCP-82** (S2) · **RCP-83** (S3) · **RCP-84** (S4) · **RCP-85** (S5) · **RCP-86** (S6)
_Execution tickets:_ **KAN-241 · KAN-242 · KAN-243 · KAN-244 · KAN-161 · KAN-215**
(KAN = execution, RCP = scope/acceptance)
_Jira sprint:_ **Sprint 8** (ID 50) — not yet activated.
_Timebox:_ **No single-point date** — sprint box is the timebox (see D3).
_Status:_ **Chartered via `/cs:grill-pm`, 2026-08-17.** All six branches locked; scope confirmed by Adam.

**This sprint commits to six items.** The measured rate across four sprints
(50%, 50%, 100%, 100%) supports 3 items per sprint. Six items exceeds that rate
because two are retro carry-overs that have rolled repeatedly (KAN-161 five sprints,
KAN-215 one sprint), and two are new bugs Adam reported today. The item cap adjusts
to accommodate the work — the work never reshapes to fit the cap (see R-4).

## Why this sprint exists

Sprint 6 invested heavily in workaround layers to avoid a one-column migration for
the duplication flow. Those workarounds degraded behaviors that were tight before
v0.4.8. Sprint 7 added the proper schema columns (`user_id_author`,
`user_id_saved_to`, `source_recipe_id`) and the publish guard — the primitives the
workarounds were trying to approximate without schema support.

The columns are now live. This sprint uses them to fix the regressions the
workarounds introduced, while also addressing three bugs Adam reported today (ghost
cookbook modal, image generation nav-away, imageless published copy) and two items
that have rolled through multiple sprints without starting.

The framing matters: the workarounds caused the regressions, not the schema work.
Sprint 7's proper implementation is the fix, not the cause. Any retro or close-out
language that inverts this — "schema caused regression" or "Sprint 6 fixed X" — is
recording a false claim. The Sprint 7 retro's strikethrough corrections
(Confluence 58359810, comment 58654733) document this explicitly.

## Committed scope

| SI     | Ticket  | Summary                                                                 |
| ------ | ------- | ----------------------------------------------------------------------- |
| **S1** | KAN-241 | Duplication flow regression — proper fix with user_id columns           |
| **S2** | KAN-242 | Ghost cookbook double-entry in add-to-cookbook modal                    |
| **S3** | KAN-243 | Image generation nav-away — no image, re-generate doesn't land          |
| **S4** | KAN-244 | Staging env polish (release-train gate + CI image rebuild)              |
| **S5** | KAN-161 | IPv6 rate-limit bypass — half-day timebox, drop with rationale fallback |
| **S6** | KAN-215 | Imageless published copy                                                |

**No stretch items.** Six committed items at 2x the measured rate is already a
stretch from the cap. Adding stretch on top of that would conflate signal with noise
at close-out.

## Aging table (standing artifact — retro action from Sprint 6)

| Item    | Filed      | Age (days) | Sprint history                 | Disposition                         |
| ------- | ---------- | ---------- | ------------------------------ | ----------------------------------- |
| KAN-241 | 2026-08-17 | 0          | New                            | **Anchor — commit**                 |
| KAN-242 | 2026-08-17 | 0          | New                            | **Commit**                          |
| KAN-243 | 2026-08-17 | 0          | New                            | **Commit**                          |
| KAN-244 | 2026-08-17 | 0          | New (follow-up to KAN-182)     | **Commit — retro action**           |
| KAN-161 | 2026-07-25 | 23         | Rolled S4→S5→S6→S7→S8          | **Pulled — retro action, half-day** |
| KAN-215 | 2026-08-08 | 9          | Rolled S7→S8 (was uncommitted) | **Commit — retro action**           |

## Charter (locked decisions)

| #   | Branch                | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Outcome / DONE**    | **All six committed items pass acceptance on staging, verified in browser.** S1: day-1 repro on staging enumerating regressions, then restore named behaviors (cross-author toast per RCP-79, no duplicate rows, publish guard intact). S2: add-to-cookbook modal shows each cookbook exactly once. S3: image generation survives tab navigate-away; re-generate lands on the correct recipe. S4: `train-run.sh` gates on staging; staging images rebuild on merge. S5: `getClientIp()` replaced with `ipKeyGenerator()`, three wrapper sites updated, one test. S6: published copies carry the source recipe's image. Gate passes (`npm test && cd Backend && uv run pytest`, `Gate — all checks passed` SUCCESS). |
| D2  | **Measurement**       | **Skip ceremony, use aging table.** Four sprints and 12 delivered items — still under the minimum for a distribution. The aging table is the standing artifact (Sprint 6 retro action). Item age exposes declined items; cycle time read off PRs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D3  | **Forecast honesty**  | **No dates, no forecast.** 12 completed items across 4 sprints is still under the minimum. Sprint box is the timebox. KAN-161 half-day with drop fallback: if it doesn't close in half a day, drop with rationale "no AAAA DNS, latent risk accepted" — not rolled again.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D4  | **Ownership**         | Owner **Adam**; executor **agent**; reviewers: (1) machine — `Gate — all checks passed`, (2) Copilot review, (3) **Adam**. Escalation via **AgentMail** (`claude-code-agent-recipe-one@agentmail.to`). **Process commitment (retro action):** agent checks `pulls/<n>/comments` + `pulls/<n>/reviews` bodies before declaring any PR reviewed. Zero unfixed Copilot findings on merge.                                                                                                                                                                                                                                                                                                                              |
| D5  | **Risk (pre-mortem)** | Four risks, R1–R4 below. R1 (S5 rate-limiter change interfering with S1 verification) mitigated by ordering S1 before S5. R2 (S3 scope creep) mitigated by fixing the two named failures only. R3 (6 items above measured rate) mitigated by the rate being a guideline not a constraint. R4 (constraint-shaped bundling) is a named failure mode — see Risks section.                                                                                                                                                                                                                                                                                                                                              |
| D6  | **Budgets**           | No artificial retry cap — agent iterates until acceptance passes. KAN-161 timeboxed to half a day. **Review rounds:** 2 minimum, 3 cap for standard PRs. No cap for cross-repo or P1 security PRs. After review rounds, merge or elevate to Adam — not a push notification, a substantive escalation via AgentMail with context.                                                                                                                                                                                                                                                                                                                                                                                    |

## Risks

| #   | Risk                                                            | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | S5 rate-limiter change could interfere with S1 API verification | Low        | Low    | Order S1 before S5. S1 changes the save/publish flow (SPA + Flask); S5 rewrites `getClientIp()` in `server/security.ts`. No shared code files, but S1's API tests pass through S5's rate limiters. Completing S1 first avoids chasing false failures from a mid-flight rate-limiter rewrite.                                                                                                           |
| R2  | S3 (image nav-away) scope creeps into Pub/Sub rewrite           | Medium     | Medium | Fix the two named failures only: (1) generation result survives navigate-away, (2) re-generate lands on the recipe. If the root cause is deeper than expected, file a follow-up ticket rather than expanding S3.                                                                                                                                                                                       |
| R3  | Six items exceeds the measured 3-item rate                      | Low        | Low    | The rate is a guideline informed by velocity, not a constraint that reshapes the work. S5 is half-day. S2/S6 are likely small. If items roll, they roll with evidence — not a failure.                                                                                                                                                                                                                 |
| R4  | **Constraint-shaped bundling** (named failure mode)             | —          | —      | The item cap adjusts to the work; the work never reshapes to fit the cap. Each distinct bug gets its own ticket and SI regardless of count. Bundling corrupts both the work AND the retro data through a self-reinforcing cycle: bundled items take longer → data shows low-count cap is correct → reinforces bundling. See Sprint 7 retro, Adam's correction (Confluence 58359810, comment 58654733). |

## Retro action dispositions (Sprint 7 → Sprint 8)

The Sprint 7 retrospective's "Actions for Next Sprint" table (Confluence 58359810)
contained four items. Their disposition against this charter:

| Retro action                                                     | Disposition                                                                                  | Where                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------- |
| KAN-161 pulled into next sprint, half-day timebox, drop fallback | **S5 — committed** with the exact terms: half-day, drop with "no AAAA, latent risk accepted" | D3                    |
| KAN-215 committed                                                | **S6 — committed**                                                                           | Committed scope table |
| Staging train-run integration                                    | **S4 — committed** (KAN-244)                                                                 | Committed scope table |
| Staging CI image rebuild on merge                                | **S4 — committed** (KAN-244, second acceptance criterion)                                    | Committed scope table |

## S1 — Duplication flow regression (KAN-241)

### Acceptance criteria

1. **Day-1 repro on staging.** Enumerate the specific regressions introduced by
   Sprint 6's workaround layers, using staging data. This is the baseline — fix
   points flow from what the repro finds, not from assumptions.
2. **Cross-author toast.** Saving a recipe from another user's cookbook shows the
   "already saved" toast per RCP-79 (PR #3416). No silent duplicate creation.
3. **No duplicate rows.** A save-from-public-page flow produces exactly one recipe
   row per user per source recipe. Verified via API, not just UI.
4. **Publish guard intact.** The Sprint 7 publish guard (RCP-74) still prevents
   publishing saved copies. `PUT /api/recipes/<id>` with `is_public: true` returns
   403 when `source_slug` is non-null and the user is not the author.
5. **Gate passes.** `npm test && cd Backend && uv run pytest` pass. `Gate — all checks passed` SUCCESS.

### Why this is straightforward now

The `user_id_author`/`user_id_saved_to` columns distinguish the recipe creator from
the saver. The `source_recipe_id` column tracks provenance. These are the primitives
the Sprint 6 workarounds were trying to approximate without schema support. The
proper implementation is the fast lane — not the expensive option.

## S2 — Ghost cookbook double-entry (KAN-242)

### Acceptance criteria

1. **Single entry.** The add-to-cookbook sub-modal shows each cookbook exactly once.
   "Session Recipes" (or any guest cookbook) appears at most once.
2. **No duplicate cookbook entries of any kind** in the picker, regardless of
   auth state (authenticated, guest, expired-then-refreshed).
3. **Verified in browser on staging.**
4. **Gate passes.**

## S3 — Image generation nav-away (KAN-243)

### Acceptance criteria

1. **Generation survives navigate-away.** Start a recipe generation, navigate away
   from the tab for 30+ seconds, return. If the generation completed while away,
   the image is visible on the recipe.
2. **Re-generate lands.** If the original generation was lost, re-generating the
   image attaches it to the correct recipe and the image is visible.
3. **Two named failures only.** If the root cause is deeper than these two failures,
   file a follow-up ticket. Do not expand S3's scope.
4. **Verified in browser on staging.**
5. **Gate passes.**

## S4 — Staging environment polish (KAN-244)

### Acceptance criteria

Two separate criteria for retro-data separability (per R-4 logic):

1. **Release-train integration.** `train-run.sh --verify-only` includes a staging
   health check that blocks on staging returning 200 before proceeding to prod
   verification.
2. **CI image rebuild.** Staging images are rebuilt automatically on merge to dev
   (or on tag push). Verified by checking that staging serves code from a recent
   dev merge without manual intervention.
3. **Gate passes.**

## S5 — IPv6 rate-limit bypass (KAN-161)

### Acceptance criteria

1. **`getClientIp()` replaced.** Rewrite to use express-rate-limit's
   `ipKeyGenerator()` helper for IPv6 masking.
2. **Three wrappers removed.** Delete the `(req) => getClientIp(req)` wrappers in
   `server/security.ts` that suppress the IPv6 validator.
3. **One test.** Vitest spec asserting IPv6 addresses are properly masked/grouped.
4. **Half-day timebox.** If not closed in half a day, drop with rationale: "no AAAA
   DNS record in production, latent risk accepted." Not rolled again.
5. **Gate passes.**

**Exposure:** LATENT — no AAAA DNS record in production today.

## S6 — Imageless published copy (KAN-215)

### Acceptance criteria

1. **Published copies carry image.** When a recipe with `source_slug` is published,
   the published copy carries the source recipe's `ai_image_url` or
   `stock_image_url`. No blank hero/og image on the public page.
2. **Backfill at publish time.** The image fields are populated from the source
   recipe during the publish flow, not requiring a separate migration.
3. **Verified in browser on staging** — the `/r/<slug>` page shows the image.
4. **Gate passes.**

## Close-out

The sprint is closed when:

1. All six SIs pass their acceptance criteria on staging, verified in browser.
2. Gate passes on all PRs.
3. Aging table updated with final dispositions.
4. Jira tickets transitioned with evidence (PR links, Gate results).
5. Retrospective page created on Confluence (parent 50298881) with the "Actions
   for Next Sprint" table — the point of the retro, not a summary of the close-out.
