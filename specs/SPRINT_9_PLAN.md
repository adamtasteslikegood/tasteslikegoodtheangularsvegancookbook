# Sprint 9 Plan — tune-up, cache restore, and the staging→GCP cutover

_Chartered:_ 2026-08-27 · _Owner:_ Adam Schoen
_Jira epic:_ **RCP-88** (delivery/acceptance)
_Acceptance rows:_ **RCP-89** (S1a) · **RCP-90** (S1b) · **RCP-92** (S2) · **RCP-93** (S3) · **RCP-94** (S4) · **RCP-95** (S5) · **RCP-96** (S6) · **RCP-67** (S7) · **RCP-91** (S8)
_Execution tickets:_ **KAN-255 · KAN-256 · KAN-257 · KAN-151 · KAN-249/250 · KAN-248 · KAN-209 · KAN-195 · RCP-67 · KAN-176**
(KAN = execution, RCP = scope/acceptance)
_Jira sprint:_ **Sprint 9** — id **52** on board **168**, active.
_Timebox:_ **No single-point date.** Sprint box is the timebox.
_Status:_ **Chartered via `/cs:grill-pm`, 2026-08-27.** All six branches locked by Adam.

## Why this sprint exists

Three things converge.

First, **v0.4.12 shipped the image nav-away fix but only half the failure.** KAN-243
moved the image-generation _spinner_ into `RecipeStateService` so it survives component
destruction. It did not move the _data_. Navigating away still leaves the client copy of
the recipe holding pending/null image metadata — visible the moment you export a single
recipe as JSON. Two further navigation defects were reported alongside it.

Second, **KAN-151 has never been fixed.** The response cache has populated exactly one
key since merge `07123c2` on 2026-04-12. `4d55694` restored the cache _infrastructure_
and closed GH #143 while touching zero blueprints, so four of five read endpoints still
hit Postgres on every call. Backend PR #299 is written and draft-held.

Third, **the deploy topology is half-migrated.** Production already deploys via a
GCP-side Cloud Build trigger on a `vX.Y.Z` tag. Staging was gated behind an explicit
`staging-v*` trigger on 2026-08-26, but still _builds_ on a GitHub runner. Two
overlapping staging build paths are live — `staging-deploy.yml` and the unmerged
`cloudbuild.staging.yaml` on #3441. The Sprint 8 retro flagged the overlap and it has
not been reconciled.

## Committed scope — 9 items

| SI      | Ticket            | Summary                                                                    |
| ------- | ----------------- | -------------------------------------------------------------------------- |
| **S1a** | KAN-255 + KAN-256 | Generator/recipe lifecycle state across navigation                         |
| **S1b** | KAN-257           | Recipe-detail bounces to `/kitchen`; `replaceUrl` kills Back               |
| **S2**  | KAN-151           | Valkey response cache — re-wire recipe/stats/collection reads · **ANCHOR** |
| **S3**  | KAN-249 / KAN-250 | Staging build moves to a GCP-side Cloud Build trigger                      |
| **S4**  | KAN-248           | Model-selection tail + **v0.4.13 release cut** · **gates S2**              |
| **S5**  | KAN-209           | Revisit the RESP2 pin in `server/valkey.ts`                                |
| **S6**  | KAN-195           | Regenerated image blocked 24h by stale `Cache-Control`                     |
| **S7**  | RCP-67            | Route/request classification as one general contract                       |
| **S8**  | KAN-176           | flask-backend defence-in-depth — second guard beyond invoker IAM           |

**No stretch items.**

### On the item count — read this before citing it as velocity

Nine items against a measured throughput of ~3.6 (18 delivered across 5 sprints). This
**overrides Sprint 8 retro action 1**, deliberately, and the reason is not optimism:

> The real alternative on the table was collapsing the cache/middleware cluster into a
> single SI. That is **R-4, constraint-shaped bundling** — the named failure mode that
> corrupts the work _and_ the retro data through a self-reinforcing cycle. Nine tracked
> items is the honest count of what is being worked. One bundled item would have been a
> smaller number describing the same work, less well.
>
> — Adam, 2026-08-27: _"it was between that or calling them all one SI. Only if it's
> this way is it tracked correctly. Focus on what needs done, not how PM looks — save
> that for when the website works, there's 10 sprints with real data, and the board and
> repo are housekept."_

**This count is a tracking decision, not a forecast.** Flow metrics over the current
board are not yet signal: ~21 of the KAN rows are agentic-workflow bot noise (KAN-168),
four PRs are rolled forward from Sprint 8, and the repo carries 22 git worktrees. The
Housekeeping lane below exists to make later measurement mean something. Until it is
done, do not read this sprint's throughput as a rate.

## Aging table (standing artifact — Sprint 6 retro action)

| Item    | Filed      | Age (d) | Sprint history          | Disposition                   |
| ------- | ---------- | ------- | ----------------------- | ----------------------------- |
| KAN-255 | 2026-08-27 | 0       | New                     | **Commit — S1a**              |
| KAN-256 | 2026-08-27 | 0       | New                     | **Commit — S1a**              |
| KAN-257 | 2026-08-27 | 0       | New                     | **Commit — S1b**              |
| KAN-151 | 2026-07-24 | 34      | Rolled S7→S8→S9         | **Commit — ANCHOR**           |
| KAN-249 | 2026-08-25 | 2       | New (Sprint 8 residual) | **Commit**                    |
| KAN-250 | 2026-08-25 | 2       | New (Sprint 8 residual) | **Commit**                    |
| KAN-248 | 2026-08-24 | 3       | Rolled S8→S9            | **Commit**                    |
| KAN-209 | 2026-08-07 | 20      | Never committed         | **Commit — half-day timebox** |
| KAN-195 | 2026-07-31 | 27      | Never committed         | **Commit**                    |
| RCP-67  | 2026-08-01 | 26      | Never committed         | **Commit — half-day timebox** |
| KAN-176 | 2026-07-28 | 30      | Never committed         | **Commit — half-day timebox** |

## Mid-sprint reconcile — 2026-09-01

Harness run over `specs/harness/SPRINT_9_HARNESS_PLAN.json` from a checkout synced to
`origin/dev`. The **membership-only** hard gate reports green: the sprint endpoint
returns 12 issues and none is in To Do. That does **not** establish board honesty.
Board 168 filters to `project = RCP`, yet its sprint endpoint renders only RCP-67,
omitting RCP-88 as well as all ten KAN issues. The table below records artifact-backed
work status; it is not a list of rows visible on board 168.

| Item                    | Jira status | Where the work actually is                                            |
| ----------------------- | ----------- | --------------------------------------------------------------------- |
| KAN-151 (S2)            | In Review   | Merged. Backend #299 → promoted #301 → pinned `f64174d`               |
| KAN-195 (S6)            | In Review   | Merged. Backend #300 → promoted #301 → pinned `f64174d`               |
| KAN-209 (S5)            | In Review   | Merged. Pin removed `67e503c` / #3465                                 |
| KAN-249 (S3)            | Done        | Merged. `cloudbuild.staging.yaml` split out, #3441                    |
| KAN-176 (S8)            | Done        | Cutover applied to the live project; repo record in v0.4.13 CHANGELOG |
| KAN-258 (S4)            | In Review   | **Half done.** Model tail merged (#3439); the v0.4.13 cut is not made |
| KAN-250 (S3)            | In Progress | Unmerged PR #3449 (`BEHIND`)                                          |
| KAN-255 / KAN-256 (S1a) | In Progress | Unmerged PR #3450 (`BEHIND`)                                          |
| KAN-257 (S1b)           | In Progress | Unmerged PR #3452 (`BEHIND`)                                          |
| RCP-67 (S7)             | In Progress | Unmerged PR #3451 (`BEHIND`)                                          |

Nothing was dropped under D6 — S5, S7 and S8 all produced work rather than exercising
their pre-authorised drop.

### Board-visibility defect — the hard gate previously passed vacuously

Sprint 52 contains **12 issues: 2 RCP and 10 KAN**. The table above has 10 rows covering
the 11 execution tickets (KAN-255 and KAN-256 share one row); the twelfth issue is the
delivery epic RCP-88. Board 168 is filtered to `project = RCP ORDER BY Rank ASC`, so the
Agile API accepts the KAN sprint memberships while the board cannot render those rows.
The two reads therefore disagree:

```
GET /rest/agile/1.0/sprint/52/issue             -> 12 issues
GET /rest/agile/1.0/board/168/sprint/52/issue   -> 1 issue (RCP-67)
```

The current `sprint9_hard_gate.py` checks only the first endpoint. Its green result means
only “no assigned issue is in To Do”; it does not prove that committed work is visible
on the board. Sprint 8 used the intended model: one epic plus six board-visible RCP
acceptance stories paired to the KAN execution tickets. Sprint 9 created RCP-88 but no
acceptance stories and assigned the KAN tickets directly.

Two follow-ups were left open by that docs-only reconcile. **Both are now closed** —
2026-09-01, later the same day.

1. **Acceptance rows filed.** The Sprint 8 model was kept, not changed. Nine SIs now
   have a board-visible RCP row: `RCP-89` (S1a) · `RCP-90` (S1b) · `RCP-92` (S2) ·
   `RCP-93` (S3) · `RCP-94` (S4) · `RCP-95` (S5) · `RCP-96` (S6) · `RCP-67` (S7,
   already an RCP row) · `RCP-91` (S8). Each is parented to `RCP-88`,
   `Relates`-linked to its execution ticket(s), labelled `acceptance` + `sprint-9`,
   and carries its evidence as a comment posted **before** the status moved (D4).
   **Board 168 now renders 9 rows for Sprint 9, up from 1.**

2. **Gate extended — but deliberately NOT as specified here.** This entry proposed
   comparing the board-scoped and sprint-scoped sets and failing on hidden rows. That
   rule is wrong, and would be **red on Sprint 8** — the one sprint that got this
   right. Sprint 8 is 13 members and 6 rendered: its KAN execution rows are _supposed_
   to be sprint members (the gate's own rule 2 requires it) and structurally can never
   render, and the epic renders in the epic panel rather than a column. A delta rule
   would also reward deleting KAN rows from the sprint to go green, breaking rule 2.

   Rule 4 instead asserts what Sprint 8 actually did: **every committed SI has a named
   RCP acceptance row present in the board-scoped result.** Epics are never required
   there; a D6-dropped SI is exempt exactly as under rule 3.

**A third defect, not previously recorded, was the reason nobody was told for four
days.** `scripts/pm/check_sprint_lane.sh` — wired into `pr-gate.yml` and in
`gate.needs` since Sprint 5 S8 — is the gate that exists precisely to catch a
collapsed KAN/RCP lane. It passed on every Sprint 9 PR because **zero issues carried
`sprint-9`**, so its label discovery fell back to the newest label it could see,
`sprint-8`, whose rows are all Done and filtered out. Vacuous twice: nothing to check,
and the wrong sprint checked. It now resolves the label from board 168's **active
sprint** and fails when nothing carries it. All 20 sprint-52 members are now labelled.

Both gates were run red before the fix and green after — `check_sprint_lane.sh`
exit 1 → 0, `sprint9_hard_gate.py` exit 1 (8 violations) → 0.

The table above keys S4 to **KAN-258**, not the **KAN-248** cited in the scope table.
That is deliberate and is not a typo in either place: `KAN-248` is _"Migrate staging DB
from Railway Postgres to CloudSQL"_, a subtask of KAN-244 that genuinely completed on
2026-08-24. The model-selection tail and the v0.4.13 cut are tracked as `KAN-258`, filed
2026-08-27. See `specs/harness/README.md` § _KAN-248 is not the S4 ticket_. The charter
rows and the two PR titles still carry the old key and want re-keying — left alone here
so this reconcile stays a status update rather than a scope edit.

### Board corrections made, with evidence

Both went through `sprint9_board.py transition`, which posts the evidence as a comment
before moving the row (D4).

- **KAN-195 `In Progress` → `In Review`.** The row understated the work: Backend #300 is
  merged, promoted and pinned. The prior status was set by `Automation for Jira` on branch
  creation, not by a human decision.
- **KAN-258 `Done` → `In Review`.** The row overstated the work. Its acceptance covers the
  model tail **and** the v0.4.13 cut; only the first landed. The `Done` was written
  `2026-08-28T06:12:21Z`, **8 seconds** after #3439 merged at `06:12:13Z` — the
  `jira-auto-transition.yml` signature described in `specs/harness/README.md`, which
  authenticates with Adam's personal token and so reads as "Adam Schoen".

### `reset-truth` was run as a dry run and deliberately **not** applied

`reset-truth --dry-run --github-correlate` proposed pushing KAN-255, KAN-257, KAN-250,
KAN-195 and RCP-67 back to **To Do**, by restoring the human statuses of
`2026-08-27T18:30`. That repair is correct only against the corruption it was written for.
Four days of genuine work have landed since, so applying it now would erase real progress
and break the hard gate it exists to serve. **`reset-truth` is a snapshot tool — check the
age of the sweep before applying it.**

### Blocking the close

1. **v0.4.13 is not tagged.** Release PR #3468 (`dev` → `main`) is open and `CLEAN`;
   `train-verify.sh --for-release` exits 0. Merging it pushes the tag, and the tag is the
   deploy. Reserved to a human by the runbook.
2. **S2's production acceptance is gated on that deploy** — staging has no Valkey, so the
   cache restore cannot be proved anywhere but production.
3. **Four SIs sit in unmerged PRs, all `BEHIND`.** Merging any of them into `dev` while
   #3468 is open ships them silently inside v0.4.13: a `dev` → `main` PR merges the live
   tip of `dev`. Hold until after the tag and back-sync.
4. **The retrospective page does not exist yet** under Confluence parent `50298881`.

### Harness plan defect — T9's artifact check cannot pass

T9 verifies KAN-195 with `gh pr list --state all --search 'KAN-195 in:title'`, which
searches **this** repo. KAN-195 shipped entirely in the Backend repo (#300, #301), so the
check returns 0 and fails regardless of the work. T1 gets this right by passing
`-R adamtasteslikegood/tasteslikegood.com`; T9 does not. Left unedited — a check is not
repaired by the run it blocks.

## Forecast check (D3) — run at charter time, 2026-08-27

Throughput samples, one per sprint, Sprints 4–8: **[3, 3, 3, 3, 6]** — 18 items, mean 3.6.
Sampling with replacement for 9 items:

| Sprint boxes | P(all 9 delivered) |
| ------------ | ------------------ |
| 1            | 0%                 |
| 2            | 36%                |
| 3            | 100%               |

**p50 = 3 boxes. p85 = 3 boxes.** To fit one box at p85, committed scope would be ~3 items.

**Caveats.** Five samples is a thin history, the boxes were not equal length (Sprint 8
closed early), and Sprint 8's own 6 was delivered by a rescue push rather than by flow —
so the mean is flattered. Treat this as an order-of-magnitude read, not a probability.

**What this changes: nothing about scope.** Scope is a tracking decision already ruled on
(see "On the item count"). What it does change is where the attention goes — this is a
~3-box scope in a 1-box container, so the load-shedding mechanisms are the sprint's real
safety margin, not a formality:

- The **half-day timeboxes on S5, S7, S8 must actually fire.** Under D6 a drop is a valid
  outcome; a roll is not.
- **Lane A (S2 + S4) cannot be shed.** D6 pre-authorises drops only for S5, S7,
  and S8; dropping S1a, S1b, S3, or S6 requires an explicit charter update.
- Re-run this check at mid-sprint against actuals. If Lane A has not cleared the Backend
  promotion by then, the forecast is not the problem — the critical path is.

## Charter (locked decisions)

| #   | Branch             | Decision                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **Outcome / DONE** | Each SI passes its acceptance criteria below. **S2 and S4 are coupled** — S2 cannot be Done until v0.4.13 is live in production, because staging has no Valkey. Gate passes on every PR (`npm test && cd Backend && uv run pytest`, `Gate — all checks passed` SUCCESS).                                                                                                                                           |
| D2  | **Measurement**    | Aging table stays the standing artifact. Four Kanban measures read off PRs: WIP, throughput, cycle time, item age.                                                                                                                                                                                                                                                                                                 |
| D3  | **Forecast**       | **No dates.** 18 delivered items crosses Vacanti's 10-item minimum, so a p50/p85 range is permitted for the first time — but it is a **five-minute cut-list check, not a reporting artifact**. Run it once at charter time and once mid-sprint. If p85 exceeds the box, that is cut evidence. Never publish a single date.                                                                                         |
| D4  | **Ownership**      | Owner **Adam**; executor **agent**; reviewers (1) `Gate — all checks passed`, (2) Copilot, (3) **Adam**. Escalation via AgentMail (`claude-code-agent-recipe-one@agentmail.to`). **Mandatory:** read `pulls/<n>/reviews` **bodies** in full before declaring any PR review-debt-zero; assign lanes before parallel sessions; link named evidence before moving any AC row. Zero unfixed Copilot findings on merge. |
| D5  | **Risk**           | Four risks R1–R4 below, all four mitigations committed.                                                                                                                                                                                                                                                                                                                                                            |
| D6  | **Budgets**        | No artificial retry cap on S1a/S1b/S2/S3/S4. Review rounds: 2 minimum, 3 cap on standard PRs; no cap on cross-repo or P1 security PRs. **S5, S7, S8 are half-day timeboxed with a pre-authorised drop — and the drop fires.** Sprint 8's D3 pre-authorised dropping KAN-161 and it rolled a fifth time instead; that will not repeat.                                                                              |

## Risks and committed mitigations

| #   | Risk                                                                  | Mitigation (all committed)                                                                                                                                                                      |
| --- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **S2/S4 coupling is the critical path.** One slip kills two SIs.      | Start the chain on **day 1**, before any UI work. Backend `dev` is 14 ahead of `main` with no promotion PR open — that is the first blocker, not the last.                                      |
| R2  | **S3's GCP trigger is config with no repo record.** Passes vacuously. | S3 is not Done until one `staging-v*` tag is **watched** deploying end-to-end, and the trigger config is captured in a repo doc or script.                                                      |
| R3  | **Parallel-session collisions.** Sprint 8 produced 3 duplicate fixes. | Lane map (below) written before work starts. An undeliverable coordination channel is a **blocker**, not a nuisance.                                                                            |
| R4  | **Stale branch / Backend pointer rollback.** Cost 4 sessions.         | Retro action 6's preflight script (commits-behind `origin/dev` + Backend-pointer ancestry) runs before working any PR. This session hit the same trap on 2026-08-27 — the branch was 47 behind. |

## Lane map (R3 mitigation — assign before any parallel session)

| Lane  | Owns                        | Repos                                | Must not touch                      |
| ----- | --------------------------- | ------------------------------------ | ----------------------------------- |
| **A** | S2 + S4 (the release chain) | Backend + cookbook                   | `src/`, `server/valkey.ts`          |
| **B** | S1a + S1b + S6              | cookbook `src/`, Backend image paths | `cloudbuild*`, `.github/workflows/` |
| **C** | S3                          | `cloudbuild*`, `.github/workflows/`  | `src/`, `Backend/blueprints/`       |
| **D** | S5 + S7 + S8 (timeboxed)    | `server/`, Backend posture           | the release chain                   |

Lane A runs first and alone on day 1. B, C, D may run in parallel after A's Backend
promotion PR is open.

## Execution order

1. **Day 1 — Lane A only.** Backend #298 → merge. #299 un-draft → review → merge.
   Promote Backend `dev` → `main`. Back-sync. Pin Backend `main`'s **own SHA** in the
   cookbook. This unblocks S2 and every other cookbook PR.
2. Lanes B, C, D open once A's promotion PR exists.
3. **v0.4.13 cut** (S4) once S2's code is on Backend `main` and pinned.
4. **S2 closes last** — after prod verification and the latency measurement.

## Acceptance criteria

### S1a — Generator/recipe lifecycle state across navigation (KAN-255 + KAN-256)

Two symptoms, one root cause: component-scoped state plus detached async surviving
component destruction. Grouped as one SI on that root-cause argument — a **recorded
deviation from R-4**, which says one SI per bug. See "On the item count" above.

1. **Day-1 repro** on staging: generate a recipe, navigate away during image generation,
   return, export the single recipe as JSON. Record the exact fields that read
   pending/null/background-worker.
2. **Image metadata re-syncs.** After nav-away and return, the client copy of the recipe
   carries the same image metadata the server row has.
   `generator.component.ts:57-74` writes only `ai_image_url` via `updateRecipeField`; the
   remaining image fields are written server-side by the Pub/Sub worker and never
   re-read. Exported JSON must match the API's row.
3. **Generator resets on route entry.** Navigating _to_ the generator shows an empty
   form. `clearRecipe()` currently fires inside `onGenerate()` — on submit, not on entry
   (`generator.component.ts:34`).
4. Gate passes.

### S1b — Recipe-detail bounces to `/kitchen`; Back is broken (KAN-257)

1. Returning to, or deep-linking, a recipe that is still `generating` lands **on the
   recipe** with a spinner — not silently on `/kitchen`.
2. Where a redirect is genuinely correct (true 404), **Back still works** —
   `replaceUrl: true` at `recipe-detail.component.ts:49,61` erases the history entry.
3. A transient network error on tab-resume does not discard the route.
4. Gate passes.

### S2 — Valkey response cache restore (KAN-151) · ANCHOR

**Staging cannot prove this item.** Staging has no Memorystore; Flask falls back to
in-process SimpleCache (`VALKEY_HOST > REDIS_URL > SimpleCache`). Staging proves
_functional_ correctness only. Production proves it is Valkey-backed.

1. Backend #299 un-drafted, reviewed, merged to Backend `dev`.
2. **Staging — functional proof** against SimpleCache: hit/miss on all four endpoints,
   the full invalidation map, and the guest→user merge edge (`invalidate_identity()`).
3. Backend `dev` → `main` promoted and back-synced.
4. Cookbook pins Backend `main`'s **own SHA** (not `--remote`, which resolves to `dev`).
5. v0.4.13 tagged; Cloud Build deploys; production live.
6. **Production** `/api/health` reports a Valkey-backed cache, not `memory`.
7. **Latency delta measured** on the four read endpoints in production.
8. **Adam's ack** on the read-above-repo ordering divergence.

### S3 — Staging build moves to GCP Cloud Build (KAN-249 / KAN-250)

Target topology, symmetric with production:

```
git tag staging-v0.5.0 && git push  ->  GCP trigger ^staging-v.*                 ->  cloudbuild.staging.yaml
git tag v0.5.0         && git push  ->  GCP trigger ^v[0-9]+\.[0-9]+\.[0-9]+$    ->  cloudbuild.yaml
```

1. `cloudbuild.staging.yaml`, `.gcloudignore.staging`, the `cloudbuild.yaml`
   PRODUCTION-ONLY header and the `cloudbuild-config` gate job land (PR #3441, rebased).
2. A GCP-side Cloud Build trigger on `^staging-v.*` exists and its configuration is
   captured in a repo doc or script — **R2 mitigation**.
3. **One `staging-v*` tag is observed deploying end-to-end through the trigger**: build,
   push, migrate Job, deploy, verify. Watched, not inferred.
4. `.github/workflows/staging-deploy.yml` is deleted (−287 lines).
5. `verify-staging.sh` exits 0 against the trigger-deployed revision.
6. Gate passes.

### S4 — Model-selection tail + v0.4.13 release cut (KAN-248)

1. Cookbook #3439 rebased and merged; Backend #298 merged.
2. Backend promotion + back-sync complete; pointer pins Backend `main`'s own SHA.
3. `train-verify.sh --for-release` exits 0.
4. `v0.4.13` tagged; Cloud Build deploys; **verified by content** — grep every served
   asset for a string new in this release and absent from v0.4.12. Pick the marker
   **before** merging; the absence half is unverifiable afterwards.
5. Production serves `gemini-3.7-flash` (text) and `gemini-3-pro-image` (images).

### S5 — RESP2 pin revisit (KAN-209) · half-day, drop fallback

1. RESP3 exercised against a real Valkey outside production, or the pin at
   `server/valkey.ts:134` is documented as permanent with the handshake rationale.
2. **Drop fallback:** if unresolved in half a day, drop with rationale "RESP3 not
   exercisable outside prod; pin retained deliberately". Do not roll.

### S6 — Regenerated image blocked 24h by stale `Cache-Control` (KAN-195)

1. A regenerated image reaches the public SSR page without a 24-hour wait.
2. Shares S1a's repro — coordinate through Lane B to avoid a duplicate fix (R3).
3. Gate passes.

### S7 — Route/request classification contract (RCP-67) · half-day, drop fallback

1. Route and request classification expressed **once** as a general contract, not as
   per-incident patches.
2. **Drop fallback:** if it exceeds half a day, drop with rationale and file the design
   note. Do not roll.

### S8 — flask-backend second guard (KAN-176) · half-day, drop fallback

1. flask-backend no longer depends on invoker IAM alone. Ingress is the differentiator,
   not IAM — `invoker-iam-disabled=true` silently voids `--no-allow-unauthenticated`.
2. **Drop fallback:** if it exceeds half a day, drop with rationale "single guard
   accepted, ingress restriction deferred". Do not roll.

## Sprint 8 retro actions — row-by-row disposition

Required input, not a summary. All nine rows, with the one not committed named.

| #   | Retro action                                             | Disposition                                                                                                                                                                   |
| --- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Right-size commitment to measured throughput             | **NOT COMMITTED — deliberately overridden.** 9 SIs at rate 3.6. The alternative was one bundled SI, which is R-4. Tracking correctness beats cap adherence. Adam, 2026-08-27. |
| 2   | Make retro actions first-class sprint items              | **Committed** — Process lane. Each row gets a KAN ticket. Not SI slots: 9 more SIs would take the sprint to 18.                                                               |
| 3   | Suppressed-comment sweep on the merge checklist          | **Committed** — D4 mandatory + Process lane (write into CLAUDE.md's PR lifecycle section).                                                                                    |
| 4   | Gate workflow secret refs against the secrets that exist | **Committed** — Process lane. Must be **observed to fail once** for the reason it exists.                                                                                     |
| 5   | Delete the copied required-checks list from CLAUDE.md    | **Committed** — Process lane. Replace with `gh api repos/{owner}/{repo}/rulesets`.                                                                                            |
| 6   | Pre-work branch preflight                                | **Committed** — R4 mitigation. Script in `scripts/git/`, run before any PR.                                                                                                   |
| 7   | Platform-vs-code discriminator                           | **Committed** — Process lane. Document in CLAUDE.md's CI section with both API calls.                                                                                         |
| 8   | Outcome evidence for any AC that names it                | **Committed** — D1 + D4. No acceptance row moves without its named evidence linked.                                                                                           |
| 9   | Lane ownership before parallel sessions                  | **Committed** — R3 mitigation. Lane map above, written before work starts.                                                                                                    |

## Process lane (ticketed, no SI slot)

The nine retro actions above. Each gets a KAN ticket so it is tracked and ageable, but
none occupies a committed SI slot.

## Housekeeping lane — precondition for measurement, run alongside

Adam's condition for treating flow data as signal: _"when the website works, there's 10
sprints with real data, and the board and repo are housekept."_ This lane is that
housekeeping. It is evidence-based closure and cleanup, not new work.

- Rebase and merge rolled-forward PRs: cookbook **#3439**, **#3441** (both BEHIND);
  Backend **#298**. Unblock **#3443** (BLOCKED).
- Close **RCP-58** on KAN-161's evidence — PR #3422 landed;
  `origin/dev:server/security.ts:1` imports `ipKeyGenerator` and all three limiters use
  `rateLimitKeyGenerator`.
- Keep **RCP-63** open: Backend #286 implements KAN-215 on Backend `dev`, but #3432
  does not ship it. Close only after the Backend promotion, cookbook pointer bump, and
  deployment validation are linked.
- Triage the ~21 agentic-workflow bot rows (**KAN-168**) — they corrupt every flow read.
- Prune stale git worktrees (22 present; most are finished Sprint 4–8 lanes, each holding
  a full Backend clone).
- De-duplicate the Sprint 8 retro pages: canonical is Confluence **67207169**; the
  Rovo-generated **67108866** is a duplicate.
- Fast-forward local `dev` in the main checkout (25 behind at charter time).

## Close-out

Sprint 9 is closed when:

1. Every committed SI passes its acceptance criteria, or is dropped with a written
   rationale under D6's timebox. **Dropped is a valid outcome; rolled is not.**
2. Gate passes on all PRs; zero unfixed Copilot findings, verified by reading
   `pulls/<n>/reviews` bodies in full.
3. v0.4.13 is live in production and verified by content.
4. Aging table updated with final dispositions.
5. Jira tickets transitioned with evidence linked — no row moves on a merge alone.
6. Retrospective page created on Confluence under parent `50298881`, titled
   `Sprint 9 Retrospective — <YYYY-MM-DD>`, with its **Actions for Next Sprint** table.
