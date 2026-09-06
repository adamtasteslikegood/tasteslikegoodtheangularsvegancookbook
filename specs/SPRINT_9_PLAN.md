# Sprint 9 Plan — tune-up, cache restore, and the staging→GCP cutover

_Chartered:_ 2026-08-27 · _Owner:_ Adam Schoen
_Jira epic:_ **RCP-88** (delivery/acceptance)
_Acceptance rows:_ **RCP-89** (S1a) · **RCP-90** (S1b) · **RCP-92** (S2) · **RCP-93** (S3) · **RCP-94** (S4) · **RCP-95** (S5) · **RCP-96** (S6) · **RCP-67** (S7) · **RCP-91** (S8) · **RCP-97** (S9, added 2026-09-02)
_Execution tickets:_ **KAN-255 · KAN-256 · KAN-257 · KAN-151 · KAN-249 · KAN-250 · KAN-258 · KAN-209 · KAN-195 · RCP-67 · KAN-176 · KAN-265**
(KAN = execution, RCP = scope/acceptance)
_Jira sprint:_ **Sprint 9** — id **52** on board **168**, closed 2026-09-05 America/Los_Angeles (`completeDate` 2026-09-06 UTC).
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

## Committed scope — 10 items (9 chartered + S9 added 2026-09-02)

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
| **S9**  | KAN-265           | Recipes duplicate on guest-session merge; duplicate is unpublishable       |

**No stretch items.**

### S9 was added mid-sprint — 2026-09-02

Added on Adam's instruction, not by the charter. Acceptance row **RCP-97**, epic
**RCP-88**, both labelled `sprint-9`; KAN-265 labelled `sprint-9` and linked to RCP-97.

**It is a different bug from KAN-186, not a regression of it** — Adam, 2026-09-02:

> the duplicated recipe only happens on guest merge sessions and DOESN'T allow
> re-publishing. also the schema is a different version and so is the codebase so a
> new ticket is acceptable.

So this is a new defect on a new surface. Do not close it by reopening KAN-186, and do
**not** loosen the publish refusal to make the symptom go away — that refusal is correct
INV-1..INV-6 behaviour (KAN-155, KAN-181) and it is the only thing currently killing the
loop. The defect is that the duplicate row is created at all.

**S9 is a release blocker and is not droppable** — it carries no D6 timebox. It enters
the sprint in **To Do** and needs Adam's live repro before it can be worked, so
`sprint9_hard_gate.py` now fails with **two violations — KAN-265 and its acceptance row
RCP-97** (the acceptance-row To Do rule landed concurrently). Those are one fact
reported twice, not two problems: S9 is unstarted. **That red is correct and
deliberate:** the gate is stricter, not broken. Do not transition either row or delete
the gate entry to green it — they move when the work and its named evidence exist.

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

| Item    | Filed      | Age (d) | Sprint history          | Disposition                                        |
| ------- | ---------- | ------- | ----------------------- | -------------------------------------------------- |
| KAN-255 | 2026-08-27 | 9       | New                     | **Done** — PR #3450, shipped v0.4.13               |
| KAN-256 | 2026-08-27 | 9       | New                     | **Done** — PR #3450, shipped v0.4.13               |
| KAN-257 | 2026-08-27 | 9       | New                     | **Done** — PR #3452, shipped v0.4.13               |
| KAN-151 | 2026-07-24 | 43      | Rolled S7→S8→S9         | **Done** — Backend #299/#301, shipped v0.4.13      |
| KAN-249 | 2026-08-25 | 11      | New (Sprint 8 residual) | **Done** — PR #3441, shipped v0.4.13               |
| KAN-250 | 2026-08-25 | 11      | New (Sprint 8 residual) | **Deferred** — PR #3449 closed, rethinking for S10 |
| KAN-258 | 2026-08-27 | 9       | New (replaces KAN-248)  | **Done** — PR #3483, shipped v0.4.13               |
| KAN-209 | 2026-08-07 | 29      | Never committed         | **Done** — PR #3465, shipped v0.4.13               |
| KAN-195 | 2026-07-31 | 36      | Never committed         | **Done** — Backend #300/#301, shipped v0.4.13      |
| RCP-67  | 2026-08-01 | 35      | Never committed         | **Done** — PR #3451, shipped v0.4.13               |
| KAN-176 | 2026-07-28 | 39      | Never committed         | **Done** — cutover applied, shipped v0.4.13        |
| KAN-265 | 2026-09-02 | 3       | Added mid-sprint (S9)   | **Done** — PR #3472, shipped v0.4.13               |

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
2026-08-27. See `specs/harness/README.md` § _KAN-248 is not the S4 ticket_. At the time of this mid-sprint reconcile, the committed-scope S4 row/heading and the
two PR titles still carried the old key and wanted re-keying; they were left alone here
so the reconcile stayed a status update rather than a scope edit.

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
