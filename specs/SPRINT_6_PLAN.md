# Sprint 6 Plan — the duplicate invariant moves into the database

_Chartered:_ 2026-08-08 · _Owner:_ Adam Schoen
_Jira epic:_ **RCP-71** (delivery/acceptance) · _Acceptance row:_ **RCP-72** · _Execution ticket:_ **KAN-213**
(KAN = execution, RCP = scope/acceptance)
_Jira sprint:_ **not yet created on board 168** — see the timebox row below.
_Timebox:_ **NOT SET. Adam's call, and deliberately left open at charter time.**
_Status:_ **Chartered via `/cs:grill-pm`, 2026-08-08.** All six branches locked; scope selected by Adam.

**This sprint commits to one outcome.** That is not modesty about the item's size — it is the only
commitment this board's measured history supports. Sprint 4 delivered 2 of 4 in three days (0.67
items/day). Sprint 5 delivered 4 of 8 in eight days (0.50 items/day). The longer box did not absorb
the overcommit; it diluted it. Nothing in this board's history shows a rate above ~0.67/day.

## Why this sprint exists

Six duplicate-recipe tickets have been filed since 2026-07-18. Each was fixed. The bug is still open.

| Ticket      | Layer patched                             | State                        |
| ----------- | ----------------------------------------- | ---------------------------- |
| KAN-137     | re-publish creates duplicates             | Done                         |
| KAN-156     | duplicate toast (was a duplicate _row_)   | Done                         |
| KAN-157     | unpublish 4 dedup-suffixed recipes        | Done — by hand, in prod      |
| KAN-186     | guest→login merge runs INV-1              | Done                         |
| KAN-194     | publish-toggle duplicate has no image     | To Do                        |
| **KAN-213** | **no server-side duplicate check at all** | **To Do — filed 2026-08-08** |

Every one of them patched a symptom at the layer the symptom appeared in. None touched the schema.

The reason is in `Backend/models/recipe.py:16`: `slug` is globally `unique=True` and **nothing else
is constrained**. That constraint does not prevent a duplicate — it _manufactures_ one, by suffixing
`-2`, `-3`. KAN-157 was cleaning up rows the schema had generated. Meanwhile
`Backend/repositories/db_recipe_repository.py:217–277` carries ~60 lines of collision reservation,
retry-on-losing-slug and re-staging whose entire purpose is to make the duplicate succeed under a
new name.

The uniqueness invariant (INV-1) lives in client-side SPA code
(`src/services/ssr-entry.service.ts:67`). A client-side check cannot close a cross-context race by
construction — KAN-213 says so in its own filing.

**Sprint 6 moves the invariant into the database and stops there.**

## Charter (locked decisions)

| #   | Branch                | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Outcome / DONE**    | **One outcome: a duplicate recipe cannot be persisted, because the database refuses it.** Constraint keys on **`source_slug`, not title** — see the scope table for why that distinction is load-bearing. DONE = migration adds both partial unique indexes **and** a test firing two concurrent `POST /api/recipes` with the same `source_slug` asserts one row persisted plus **a 409 reaching the client**, confirmed **failing on today's code first**, plus `Gate — all checks passed` SUCCESS. **A full rewrite of the site was raised and rejected** — see "Rejected options". |
| D2  | **Measurement**       | **Build no flow tooling.** There is none in this repo (`jira_snapshot_bridge.py`, cited by the PM canon, does not exist here), and a single-outcome sprint has no forecasting or queueing decision for it to inform: WIP is 1 by construction, cycle time is one number read off a PR. **Use item age instead — it costs nothing and is already decisive.** An item that ages without ever _starting_ is being declined, not rolled; its disposition is pulled-first or dropped, never re-committed. See the aging table.                                                             |
| D3  | **Forecast honesty**  | **No date. No forecast.** Two sprints and six delivered items is far under the ≥10 completed items a distribution needs. Sprint 4 `[DECIDED]` this, Sprint 5 held it, nothing has changed. **The timebox is deliberately unset at charter time** — the read-only duplicate count (R2) is what bounds this work, and it has not run. Single digits → S1 is a 1–2 day item. Hundreds → the backfill _is_ the sprint and the constraint is Sprint 7. The number decides, not an estimate.                                                                                                |
| D4  | **Ownership**         | Owner **Adam**; author **agent**; **reviewer is never the author** — (1) machine: the concurrent-POST test confirmed failing first, plus `Gate — all checks passed`; (2) Adam. Escalation → Adam, reason written into this file at the moment of escalation. As Sprint 5 recorded: **this is a convention, not a mechanically enforced gate** — nothing in this repo refuses a plan with an unnamed owner. **Adam holds the go/no-go on running the backfill against production.**                                                                                                    |
| D5  | **Risk (pre-mortem)** | Four risks, R1–R4 below. **R1 is dominant and specific: existing code may route around the new constraint**, closing the sprint green while the bug lives. R2 (the count never runs) is the most _likely_. R3 folds into D1's definition of done. R4 is a scope rule.                                                                                                                                                                                                                                                                                                                 |
| D6  | **Budgets**           | 3 attempts/task · 12 iterations/goal as a non-binding backstop · escalation reviewer **Adam**. Terminal states are exactly three: verified-close, escalated, explicitly waived by Adam. Two sprint-specific stop rules: **blocked prod access escalates immediately and does not retry** (KAN-182 documents four blocks in one session from exactly this); **scope growth escalates rather than absorbing** — if R1 is real and the slug retry loop needs rework, that is Adam's decision, not a silent expansion of D1.                                                              |

## Committed scope — one item

| #      | Item                                                              | Jira             | Why it is in                                                                                                                         |
| ------ | ----------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **S1** | Recipe create has no server-side duplicate check — DB enforces it | KAN-213 ↔ RCP-72 | The seventh ticket in a six-ticket cluster that has never had a root-cause fix attempted. It is the only item that ends the cluster. |

### The constraint keys on `source_slug`, and that is what makes it safe

INV-1's existing semantics are a **provenance** check, not a title check
(`src/services/ssr-entry.service.ts:67`):

```ts
(r: Recipe) => r.sourceSlug === normalizedSlug || r.slug === normalizedSlug;
```

`source_slug` already exists as a real column (`Backend/models/recipe.py:24`). So:

```sql
CREATE UNIQUE INDEX ... ON recipe (user_id, source_slug) WHERE source_slug IS NOT NULL;
-- and the guest variant on (guest_session_id, source_slug)
```

**Both indexes ship together or neither** — `user_id` is nullable and guests key on
`guest_session_id`, which is exactly the KAN-186 path.

This satisfies Adam's stated requirement (2026-08-08) that the backfill is a **one-time purge, not a
change in behaviour going forward**:

- Two genuinely different recipes the same user authored with the same name → different or NULL
  `source_slug` → unaffected, still slug-suffixed `-2`. ✅
- Two different users with "Banana Bread" → unaffected, still `-2`. ✅
- The same recipe saved twice from two tabs or devices → refused. ✅

A `(user_id, normalized_title)` constraint was considered during the grill and **rejected**: it would
have blocked legitimate same-title variants, breaking that requirement. Recorded because the first
draft of D1 proposed it.

### Hard precondition — the count runs in the first hour

A unique index **cannot be applied to a table that already holds duplicates**; the migration simply
fails. Production is known to hold them and **nobody has counted them**.

```sql
SELECT user_id, count(*) FROM recipe
GROUP BY user_id, source_slug HAVING count(*) > 1 AND source_slug IS NOT NULL;
```

**Survivor rule, pre-decided so the backfill runs unattended:** keep oldest `created_at`; if exactly
one row is `is_public`, keep that one instead.

**Blocker, open at charter time:** Cloud SQL `vegangenius-db` is **private-IP only**
(`ipv4Enabled: False`), there is no `cloud-sql-proxy` on the dev machine, and `DATABASE_URL` is
commented out in `Backend/.env`. Reaching it needs either a Cloud Run Job in the VPC (the
`flask-backend-migrate` pattern) or a lower-friction path — Cloud SQL Studio, or IAM database
authentication — **which Adam has asked be investigated first, since a read-only count should not
require deploying a job.** That investigation starts when this charter's PR merges.

## Sprint 5 retrospective — actions table walked row by row

Per CLAUDE.md, the retro's actions table is a **required input**, and every row not committed must
be named with a reason. Source:
[Sprint 5 Retrospective — 2026-08-09](https://tasteslikegood.atlassian.net/wiki/spaces/TLG/pages/54558724)
(page `54558724`, authored by Rovo from board data alone).

| Retro action                                                                | Committed?          | Reason                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finish RCP-39 / KAN-97 — auto-transition on PR merge                        | **NO**              | **Direct tension with D2, surfaced rather than resolved.** KAN-97 is **26 days old with zero implementation** and has been deferred every sprint since Sprint 3 — six occurrences. D2 says an item that ages without ever starting gets pulled first or dropped, never re-committed a seventh time. **Adam's call**, not the agent's. |
| Close one repeated roll-forward story — RCP-58/KAN-161 or RCP-69/KAN-182    | **NO**              | Same class. KAN-161 has now rolled **two consecutive sprints with zero implementation** and carries both roll labels. Sprint 5's own close-out said it "should not be re-committed a third time without deciding why it keeps losing." That decision has not been made. **Adam's call.**                                              |
| Separate architecture, verification and process work explicitly in planning | **YES** — in effect | D1's single-outcome discipline is the strongest available form of this: Sprint 6 commits to exactly one category. Architecture (KAN-160), verification (KAN-182) and process plumbing (KAN-97) are all explicitly out.                                                                                                                |

**The committed outcome (S1) does not appear in the retro's actions table at all.** That is not an
oversight by the retro — KAN-213 was filed on 2026-08-08, after the board data the retro was written
from, and it is a KAN row rather than an RCP sprint row.

### What a board-only retrospective could not see

Recorded because it generalises past this sprint, and because Adam commissioned the outside read
specifically to learn this. Four gaps, all traceable to having board data only:

1. **No rate math.** The retro left `[Add sprint start and end dates from sprint 46]` unfilled, so it
   reports "4 of 8" with no denominator. The insider close-out's sharpest number — delivered/day
   **fell** 0.67 → 0.50 on a 2.67× longer box — is invisible. "4 delivered, up from 2" reads as
   improvement without it.
2. **Cannot distinguish _declined_ from _attempted_.** It frames RCP-39 as weak follow-through; the
   truth is it was never started. Status alone cannot tell "tried and did not finish" from "never
   touched", and that distinction is the whole of D2.
3. **Answered "did anything look complete before it was ready?" with "No direct evidence."** The real
   answer is yes, and it was Sprint 5's most important finding: KAN-156 was triaged _"cosmetic, no
   data impact"_ and was persisting a duplicate row; the existing mock resolved without persisting,
   making the race unreproducible by construction.
4. **Missed the deploy gap entirely** — that S1, Sprint 5's only user-facing fix, was Done on the
   board and **not in production**.

**Generalisable lesson: board-derived retrospectives are blind to the verify-and-deploy gap.** That
is KAN-182 and KAN-160 territory. A board-only retro is a good first draft and a bad only draft.

## Aging — the measure D2 commits to

Read at charter time. This is the answer to "problems that keep repeating themselves": these items
are not rolling, they are being **declined**, every sprint, by whatever gets pulled instead.

| Item        | Age, never started | History                                                       |
| ----------- | ------------------ | ------------------------------------------------------------- |
| **KAN-97**  | **26 days**        | deferred every sprint since Sprint 3 — six occurrences        |
| **KAN-160** | **14 days**        | HELD since 2026-07-25, never started                          |
| **KAN-161** | **14 days**        | rolled **two consecutive sprints**, zero implementation       |
| **KAN-182** | 9 days             | Sprint 5 generated fresh evidence for it, and it still rolled |

## Risks (pre-mortem)

**R1 — the constraint gets routed around by code that already exists. _Dominant._**
`Backend/repositories/db_recipe_repository.py:272` describes catching a lost slug race and
"re-stag[ing] with the next suffix." If that retry path catches the new `IntegrityError`, it will
helpfully create the duplicate under `-2` and the constraint becomes decorative — sprint closes
green, bug lives. Same shape as KAN-156, where a mock that resolved without persisting made the race
unreproducible **by construction**.
_Mitigation:_ the acceptance test asserts a **409 reaching the client**, not "one row exists"; and
the retry loop is explicitly taught to distinguish slug collision from duplicate-source refusal.

**R2 — the count never runs. _Most likely._** It needs prod DB access, which is friction, and the
sprint stalls exactly where KAN-182 says it will.
_Mitigation:_ **first hour, or S1 is declared unstartable.** Blocked access escalates immediately
per D6 — it does not retry.

**R3 — guest rows are missed.** `user_id` is nullable; guests key on `guest_session_id`, and guest
saves are the KAN-186 path.
_Mitigation:_ folded into D1 — both indexes ship together or neither.

**R4 — drift back to the symptom layer.** KAN-194 sits adjacent and will look cheap to fix along the
way. That impulse is how six symptom tickets happened.
_Mitigation:_ scope rule, not a risk. KAN-194 stays out; it becomes unreachable if S1 lands.

## Rejected options

**A full rewrite of the site from scratch.** Raised 2026-08-08 out of well-founded frustration —
three sprints and five releases had not fixed a duplicate bug in an app that is not architecturally
advanced. Rejected on its own test: what is broken is **where the invariant lives**, not the code
implementing it. A rewrite that again enforces uniqueness in application code reproduces this bug on
day one, and costs the parts that do work — auth, SSR, the release train. A rewrite would be correct
only if an invariant existed that this schema makes impossible to express; none was found.
_Adam confirmed the rewrite was an expression of frustration, not a proposed course of action._

**Curating public recipes as sprint scope.** Correctly identified by Adam as not a software
engineering task. KAN-157 proves the cost: unpublishing four recipes was chartered sprint scope,
rolled a sprint, and was finished by Adam by hand. The Sprint 6 backfill is different — it is a
migration prerequisite, so it is genuinely engineering scope — but **choosing which of two duplicate
rows survives** is pre-decided by rule precisely so it never becomes a curation task again.

## Explicitly not in this sprint

KAN-97 · KAN-160 · KAN-161 · KAN-182 (all four rolled from Sprint 5, all carrying
`rolled-from-sprint-5`) · KAN-194 · KAN-209 · KAN-90. Sprint 5's four undelivered rows were
deliberately **not** parented to this epic — parking them here would be re-committing them a third
time, which D2 identifies as the failing mechanism. They sit in the backlog until pulled
deliberately.

## Worked outside the sprint, on Adam's call

Recorded for visibility, **explicitly not counted** as sprint scope:

- **KAN-216** — CLAUDE.md claimed sprint retrospectives were generated by a Jira/Atlassian
  automation. Verified false: both plausible triggers were fired (RCP-65 epic closed, then Jira
  sprint 46 closed via the Agile API) and no page appeared in 7.5 minutes. Sprint 4's retro was
  agent-authored. Replaced with the procedure the agent must now follow at every sprint close.
- **KAN-212** — `#3372`, merged: no "source" link when `sourceSlug` is the recipe's own slug.

## Gates

| Gate                 | Command                                          | State at charter                      |
| -------------------- | ------------------------------------------------ | ------------------------------------- |
| Sprint 5 close       | Jira sprint 46 `state=closed`                    | ✅ closed 2026-08-09T01:10:41Z        |
| Sprint 6 lane        | `bash scripts/pm/check_sprint_lane.sh sprint-6`  | ✅ exit 0 — 1 open KAN row, 0 orphans |
| Sprint 6 planning    | This file + RCP-71 epic + RCP-72 acceptance row  | ✅                                    |
| S1 delivery          | Concurrent-POST test **confirmed failing first** | ⬜ not yet written                    |
| Duplicate count (R2) | read-only query against prod                     | ⬜ **blocked — private-IP Cloud SQL** |

**Note the lane gate passes _vacuously_ over an empty set** and only checks the newest `sprint-N`
label — its own header says so. It detects lane drift, not a missing sprint.
