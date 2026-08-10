# Sprint 6 Plan — the duplicate invariant moves into the database

_Chartered:_ 2026-08-08 · _Owner:_ Adam Schoen
_Jira epic:_ **RCP-71** (delivery/acceptance)
_Acceptance rows:_ **RCP-72 · RCP-39 · RCP-73** · _Execution tickets:_ **KAN-213 · KAN-97 · KAN-218**
(KAN = execution, RCP = scope/acceptance) · `check_sprint_lane.sh sprint-6` exits 0
_Jira sprint:_ **"Sprint 6", id 47, board 168** — created and activated 2026-08-08.
_Timebox:_ **2026-08-08 → 2026-08-13** (six days, including the chartering day). Set by Adam once
the duplicate count came back — see "Hard precondition", which is now **resolved**.
_Status:_ **Chartered via `/cs:grill-pm`, 2026-08-08.** All six branches locked; scope selected by Adam.
**S1 data phase complete 2026-08-09** — both purge gates return zero rows (constraint blockers §5b,
public name collisions §5c), so the migration is unblocked and S1 is now a code task.

**This sprint commits to three items.** Scope opened from one to three on Adam's call, 2026-08-08,
after the grill closed — KAN-97 and KAN-218 were added deliberately, not absorbed. Three at this
board's measured rate (0.50–0.67 items/day) is roughly a 5–6 day box. The original single-outcome
framing, and the reasoning that produced it, is kept below because it is what the sizing rests on.

**The anchor is still one outcome.** That is not modesty about the item's size — it is the only
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

| #   | Branch                | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Outcome / DONE**    | **Anchor outcome (S1): a duplicate recipe cannot be persisted, because the database refuses it.** S2 and S3 were added by Adam after the grill and carry their own gates. Constraint keys on **`source_slug`, not title** — see the scope table for why that distinction is load-bearing. DONE = migration adds both partial unique indexes **and** a test firing two concurrent `POST /api/recipes` with the same `source_slug` asserts one row persisted plus **a 409 reaching the client**, confirmed **failing on today's code first**, plus `Gate — all checks passed` SUCCESS. **A full rewrite of the site was raised and rejected** — see "Rejected options". |
| D2  | **Measurement**       | **Build no flow tooling.** There is none in this repo (`jira_snapshot_bridge.py`, cited by the PM canon, does not exist here), and a three-item sprint has no forecasting or queueing decision for it to inform: cycle time is three numbers read off three PRs. **S2 is the exception that proves the rule** — it does not _measure_ flow, it fixes the substrate flow data is read from, which is why Adam committed it. **Use item age instead — it costs nothing and is already decisive.** An item that ages without ever _starting_ is being declined, not rolled; its disposition is pulled-first or dropped, never re-committed. See the aging table.         |
| D3  | **Forecast honesty**  | **No date. No forecast.** Two sprints and six delivered items is far under the ≥10 completed items a distribution needs. Sprint 4 `[DECIDED]` this, Sprint 5 held it, nothing has changed. **The timebox is deliberately unset at charter time** — the read-only duplicate count (R2) is what bounds this work, and it has not run. Single digits → S1 is a 1–2 day item. Hundreds → the backfill _is_ the sprint and the constraint is Sprint 7. The number decides, not an estimate.                                                                                                                                                                                |
| D4  | **Ownership**         | Owner **Adam**; author **agent**; **reviewer is never the author** — (1) machine: the concurrent-POST test confirmed failing first, plus `Gate — all checks passed`; (2) Adam. Escalation → Adam, reason written into this file at the moment of escalation. As Sprint 5 recorded: **this is a convention, not a mechanically enforced gate** — nothing in this repo refuses a plan with an unnamed owner. **Adam holds the go/no-go on running the backfill against production.**                                                                                                                                                                                    |
| D5  | **Risk (pre-mortem)** | Four risks, R1–R4 below. **R1 is dominant: the new constraint surfaces as a raw 500 rather than a 409.** R1's first draft named the wrong mechanism and was corrected on review — see the note under R1. R2 (the count never runs) is the most _likely_. R3 folds into D1's definition of done. R4 is a scope rule.                                                                                                                                                                                                                                                                                                                                                   |
| D6  | **Budgets**           | 3 attempts/task · 12 iterations/goal as a non-binding backstop · escalation reviewer **Adam**. Terminal states are exactly three: verified-close, escalated, explicitly waived by Adam. Two sprint-specific stop rules: **blocked prod access escalates immediately and does not retry** (KAN-182 documents four blocks in one session from exactly this); **scope growth escalates rather than absorbing** — S1/S2/S3 are the commitment; anything discovered inside them that grows the work is Adam's decision, not a silent expansion. Scope moved 1 → 3 **once, deliberately, by the owner**; that is not licence for it to drift further.                       |

## Committed scope — three items

| #      | Item                                                                     | Jira             | Why it is in                                                                                                                                                                                                                                                                                                                                                                                      |
| ------ | ------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S1** | Recipe create has no server-side duplicate check — DB enforces it        | KAN-213 ↔ RCP-72 | The seventh ticket in a six-ticket cluster that has never had a root-cause fix attempted. It is the only item that ends the cluster.                                                                                                                                                                                                                                                              |
| **S2** | Auto-transition on PR merge                                              | KAN-97 ↔ RCP-39  | **26 days old, never started, six occurrences overdue.** Committed on Adam's reasoning: it is an easy win _and_ the precondition for the board carrying trustworthy data — without it, statuses lag merged work, which is exactly what corrupts the throughput and cycle-time figures D3 refuses to forecast from. Closing the aging item and fixing the measurement substrate are the same task. |
| **S3** | Legitimate traffic and verified crawlers still 429 on the public surface | KAN-218 ↔ RCP-73 | **Committed on live evidence: Adam was rate-limited himself during Sprint 5 auditing.** Filed 2026-08-08. The likely mechanism is our own crawl gate — `check_canonical_recipes.sh --live` curls ~140 `/r/<slug>` URLs unthrottled against a 300 req/15 min per-IP budget. Crawlers have no exemption at all, which is an SEO failure that raises no alarm.                                       |

### S3 is not KAN-161, and the distinction is why it is here

KAN-161 was the item Adam asked to commit, on the reasoning that rate limiting might be "affecting
crawlers or limiting traffic." **It is not.** The two are opposite defects:

|               | KAN-161                                                  | **S3 / KAN-218**                                        |
| ------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| Failure       | an IPv6 client rotating within a /64 **bypasses** limits | legitimate clients are **refused**                      |
| Limiter is    | too **permissive** for IPv6                              | too **strict** for shared IPs and crawlers              |
| Fix direction | mask IPv6 → /64, i.e. **stricter**                       | exempt or raise for legitimate traffic, i.e. **looser** |
| Protects      | the 20/hr AI budget, and spend                           | the public surface, and SEO                             |

KAN-161's fix does nothing for the 429 Adam hit, and /64 masking marginally worsens it by bucketing
a whole household allocation. **KAN-161 stays in the backlog** — a genuine but LATENT cost-exposure
fix: the customer path publishes no `AAAA` record, so it cannot fire today.

Recorded at this length because committing KAN-161 would have shipped a fix that changed nothing
about the observed failure — the exact shape of KAN-156, where the ticket that sounded right was not
the one that fixed the problem.

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

### Hard precondition — RESOLVED 2026-08-08, and it is small

A unique index **cannot be applied to a table that already holds duplicates**; the migration simply
fails. The count ran via Cloud SQL Studio (KAN-217 opened that path in the same session):

| Scope                                     | Result                                    |
| ----------------------------------------- | ----------------------------------------- |
| Authenticated — `(user_id, source_slug)`  | **2 groups × 2 rows**, both `user_id = 1` |
| Guest — `(guest_session_id, source_slug)` | **0 rows**                                |

**4 rows involved, 2 to delete.** The guest partial index needs no backfill at all, so R3 costs
nothing. D3's stated branch — "single digits → S1 is a 1–2 day item" — is the one taken, which is
what set the six-day box.

**One reading nearly went wrong and is worth recording.** Re-running the query without its two
`WHERE` clauses reported `user_id 1 → 112`. That is not 112 duplicates: `GROUP BY user_id,
source_slug` collapses every `NULL` `source_slug` into a single bucket, so it counted "user 1 has 112
recipes with no source". The `WHERE` clauses are load-bearing, not decoration. The same artifact made
three guest rows look duplicated when they were different guests each saving one public recipe —
legitimate behaviour, confirmed by the guest query returning zero.

All queries, the survivor rule, and a one-statement-at-a-time purge — with a preview `SELECT`,
an `is_canonical = false` write guard, and a zero-row verify after each mutation — live in
**`specs/KAN-213_DEDUP_QUERIES.md`**. (The runbook previously wrapped the purge in
`BEGIN…ROLLBACK`; Cloud SQL Studio does not honour those blocks reliably, so §5 was rewritten
to guard each mutation individually — see the §5 preamble.)

```sql
-- authenticated rows
SELECT user_id, source_slug, count(*) AS dupes
FROM recipe
WHERE source_slug IS NOT NULL AND user_id IS NOT NULL
GROUP BY user_id, source_slug
HAVING count(*) > 1
ORDER BY dupes DESC;

-- guest rows (R3 — these must be counted too, or the guest index cannot be created)
SELECT guest_session_id, source_slug, count(*) AS dupes
FROM recipe
WHERE source_slug IS NOT NULL AND guest_session_id IS NOT NULL
GROUP BY guest_session_id, source_slug
HAVING count(*) > 1
ORDER BY dupes DESC;
```

The grouping key must also appear in the `SELECT` list — otherwise the result identifies only _how
many_ duplicates exist, not _which_ `source_slug` values they are, and the backfill has nothing to
act on. (Caught by review on PR #3373; the first draft grouped by `source_slug` without selecting
it, and filtered NULLs in `HAVING` rather than `WHERE`.)

**Survivor rule, pre-decided so the backfill runs unattended:** keep oldest `created_at`; if exactly
one row is `is_public`, keep that one instead.

**Blocker, open at charter time:** Cloud SQL `vegangenius-db` is **private-IP only**
(`ipv4Enabled: False`), there is no `cloud-sql-proxy` on the dev machine, and `DATABASE_URL` is
commented out in `Backend/.env`. Reaching it needs either a Cloud Run Job in the VPC (the
`flask-backend-migrate` pattern) or a lower-friction path — Cloud SQL Studio, or IAM database
authentication — **which Adam has asked be investigated first, since a read-only count should not
require deploying a job.** That investigation starts when this charter's PR merges.

### S1 also carries a one-time public-surface purge — ✅ COMPLETE 2026-08-09

Added on Adam's direction, 2026-08-08: _"the public site has duplicates — this run is removing rows
created BEFORE the fix that will stop duplicates from getting published."_

This is **separate from the 4 rows above.** §2's count unblocks the migration; the public purge
cleans what visitors actually see. Adam's test for a real duplicate is **same name AND same image**,
with name alone giving the candidate list.

**There is no image column** — image lives in the `data` JSON blob (`ai_image_url`,
`stock_image_url`, `image`), so the comparison reaches into JSON.

**KAN-194 interacts, and it changes the survivor rule.** `togglePublic()` never backfills the image
from the source recipe, so publish-toggle duplicates have **no image at all**. Their pairs are
(original _with_ image, duplicate _without_), which means a strict same-name-AND-same-image match
**will not find them** — they surface only in the name-only list. They are also the rows rendering a
blank hero and blank OG on the public site. So for public rows:

> ~~**Keep the row with an image; delete the imageless twin.** Fall back to oldest `created_at` only
> when both have images or neither does. Never delete `is_canonical`.~~
>
> **Retired 2026-08-08, before it was ever applied — the data killed it.** Kept struck through
> because the reasoning above is what the sizing rested on, and deleting it would hide that this was
> a prediction, not a finding.

**What replaced it, and why.** The rule above was written before the table was read. `§3a` of the
runbook found there is no image to compare: every row's image resolves to
`/api/recipes/<its own id>/image`, **derived from the row id**, so no two rows can ever match on
image — duplicate or not. The image test is structurally incapable of returning a row, which also
makes the "imageless twin" asymmetry unobservable. The revised rule keys on provenance instead:

> **Keep the row with `source_slug IS NULL`** — the author's original; a saved copy should never
> have been public. **Exception:** when the copy is the canonical row, the copy wins (Cornbread —
> the canonical holds the clean slug while the original holds a typo slug). Fall back to oldest
> `created_at` only when neither rule decides. **Never touch `is_canonical = true`.**

The action changed too: public rows are **unpublished, not deleted** (§5a) — a live `/r/<slug>` that
is deleted becomes a hard 404 on a possibly-indexed URL, while a surviving _private_ row causes no
SEO harm and is reversible. Only the two constraint-blocking rows were deleted (§5b), because
unpublishing does not clear them — the index keys on `source_slug` regardless of `is_public`.

`source_slug` turned out to be a cleaner signal than image would have been. Full derivation, the
dead-end queries kept as a record, and the purge itself: `specs/KAN-213_DEDUP_QUERIES.md` §3–§5.

**Result, 2026-08-09.** 6 public rows unpublished across 5 name groups, 2 constraint-blocking rows
deleted, and the last group (Cornbread) closed by Adam through the app's publish toggle rather than
SQL. Both gates now return zero rows. The public-name gate was verified **without database access**,
from the surface it describes: `/browse` and `/sitemap.xml` independently list the same **76** public
recipes with **76 distinct names**. The drafted `source_slug = NULL` follow-up was **not run** — the
code shows it would have changed no rendered output while shrinking the new index's coverage; see
runbook §5c.

**Scope guard:** this is a one-time purge of rows predating the guard. Slug-suffixing behaviour going
forward is unchanged — a genuinely different recipe still gets `-2`, per Adam's requirement.

### Known coverage limit — D1 does not make the table duplicate-free

The indexes are **partial**: rows with `source_slug IS NULL` are not constrained.

An earlier draft called those "the large majority of the table", which understated it. Adam's
correction, 2026-08-09: generated and manually entered recipes are not a majority, they are
essentially the whole table. `origin` is `manual | generated | saved`, and only `saved` rows carry a
`source_slug`. So:

> **The constraint covers only copies a user took from someone else's public page. It does not
> constrain a single recipe a user authored.**

The one recorded number: user 1 held **112** `NULL`-source rows against **4** in `source_slug`
duplicate groups — roughly **3%** coverage for that user.

That corner is still the right one, and not by rationalisation: a saved copy is the only case where
"these two rows are the same recipe" is a **machine-checkable fact**, because the copy records what
it was copied from. Two separately generated recipes have no such identity — a name-based constraint
was **rejected** because two genuinely different recipes may share a title.

And the evidence says the corner is where the duplicates were: all 11 public duplicate rows carried a
`source_slug`, and both constraint blockers were `source_slug` pairs. **100% of confirmed duplicates
lived in that ~3%** — which KAN-220 explains rather than leaves to luck, since the ghost-session path
produces `source_slug`-bearing rows by construction.

Probing that blind spot returned 4 same-name groups among `NULL`-source rows, of which only 2 are
confirmed same-user (`user_id = 2`); the other 2 were the same `NULL`-grouping artifact described
above. **Same name is not the same recipe**, so this is a candidate list, not a defect count.
Enforcing uniqueness there would require a normalized **content-hash column** — a schema change worth
costing only against evidence, as a Sprint 7 ticket. **Not Sprint 6 scope**, and explicitly not
justified by the misread "112".

## Sprint 5 retrospective — actions table walked row by row

Per CLAUDE.md, the retro's actions table is a **required input**, and every row not committed must
be named with a reason. Source:
[Sprint 5 Retrospective — 2026-08-09](https://tasteslikegood.atlassian.net/wiki/spaces/TLG/pages/54558724)
(page `54558724`, authored by Rovo from board data alone).

| Retro action                                                                | Committed?          | Reason                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Finish RCP-39 / KAN-97 — auto-transition on PR merge                        | **YES** — S2        | Surfaced as a D2 tension (26 days old, never started, six occurrences); **Adam decided to commit it**, on the reasoning that it is both an easy win and the precondition for the board carrying data worth forecasting from. D2's disposition rule is satisfied — the item was **pulled first**, which is one of the two dispositions it allows. |
| Close one repeated roll-forward story — RCP-58/KAN-161 or RCP-69/KAN-182    | **PARTLY** — S3     | Adam committed to the rate-limiting problem, but the ticket that matches his stated reason is **KAN-218, not KAN-161** — see "S3 is not KAN-161" above. KAN-161 and KAN-182 stay in the backlog. The retro's intent is served; its named ticket is not the one that serves it.                                                                   |
| Separate architecture, verification and process work explicitly in planning | **YES** — in effect | Three items, three distinct categories, each with its own acceptance row and gate: data integrity (S1), process plumbing (S2), production behaviour (S3). Architecture (KAN-160) and the staging environment (KAN-182) remain explicitly out.                                                                                                    |

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

**R1 — the new constraint surfaces as a raw 500 instead of a 409. _Dominant._**
Nothing in the write path converts an `IntegrityError` from a _new_ unique index into a client-legible
refusal, so the first duplicate save after the migration lands breaks loudly and unhelpfully.
_Mitigation:_ the acceptance test asserts a **409 reaching the client**, not "one row exists" — and
the write path gains explicit handling that maps the `(user_id, source_slug)` /
`(guest_session_id, source_slug)` violation to a 409, leaving every other integrity failure alone.

> **Corrected on review (PR #3373).** R1's first draft claimed
> `_commit_publish_retrying` (`Backend/repositories/db_recipe_repository.py`) would catch the new
> `IntegrityError` and "helpfully create the duplicate under `-2`", making the constraint decorative.
> **That was wrong**, and the mitigation it implied — "teach the retry loop to distinguish slug
> collision from duplicate-source refusal" — was work that does not need doing. Verified against
> Backend `origin/dev`: the retry fires only when `lost_slug_race` is true, which requires
> `recipe_data["is_public"]` **and** another row already owning `Recipe.slug == attempted_slug`. A
> `source_slug` violation leaves the slug uncontested, so `lost_slug_race` is `False` and the code
> re-raises immediately; on a non-public save it short-circuits earlier still. The docstring says so
> outright: _"Every other integrity failure … re-raises immediately rather than being retried."_
>
> The retry path is deliberately narrow and correct. **The charter mischaracterised safe code as
> dangerous, which would have sent S1 implementation at the wrong target.** The DONE criterion is
> unchanged; only its motivation and the size of the work are. Recorded rather than silently edited,
> because "the plan named the wrong root cause" is exactly the failure this sprint exists to end.

**R2 — the count never runs. ~~_Most likely._~~ RETIRED 2026-08-08, before the box opened.**
The risk was that prod DB access friction would stall the sprint exactly where KAN-182 predicts.
It did not: Cloud SQL Studio reaches the private-IP instance with no infrastructure change, and the
count ran the same day. KAN-217 (IAM database auth, deletion protection) was completed opportunistically
alongside it and is **not** sprint scope.
_Residual:_ none for S1. The path is documented in `specs/KAN-213_DEDUP_QUERIES.md` §0 so the next
production question does not re-pay the discovery cost.

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

KAN-160 · **KAN-161** · KAN-182 · KAN-194 · KAN-209 · KAN-90.

**KAN-161 is the notable exclusion**, because it was explicitly asked for and then withdrawn on
evidence: it does not fix the 429 Adam hit, and KAN-218 does. See "S3 is not KAN-161". It remains a
real cost-exposure fix, verified LATENT — no `AAAA` record on the customer path — so it cannot fire
today.

KAN-160 and KAN-182 keep `rolled-from-sprint-5` and sit in the backlog until pulled deliberately.
Parking them in this epic to look complete would be re-committing them a third time, which D2
identifies as the failing mechanism. **KAN-97 was the opposite case** — it was pulled first, which is
the disposition D2 prescribes for an aged item, rather than rolled again.

## Worked outside the sprint, on Adam's call

Recorded for visibility, **explicitly not counted** as sprint scope:

- **KAN-216** — CLAUDE.md claimed sprint retrospectives were generated by a Jira/Atlassian
  automation. Verified false: both plausible triggers were fired (RCP-65 epic closed, then Jira
  sprint 46 closed via the Agile API) and no page appeared in 7.5 minutes. Sprint 4's retro was
  agent-authored. Replaced with the procedure the agent must now follow at every sprint close.
- **KAN-212** — `#3372`, merged: no "source" link when `sourceSlug` is the recipe's own slug.

## Gates

| Gate                 | Command                                          | State                                                                         |
| -------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| Sprint 5 close       | Jira sprint 46 `state=closed`                    | ✅ closed 2026-08-09T01:10:41Z                                                |
| Sprint 6 lane        | `bash scripts/pm/check_sprint_lane.sh sprint-6`  | ✅ exit 0 — 1 open KAN row, 0 orphans                                         |
| Sprint 6 planning    | This file + RCP-71 epic + RCP-72 acceptance row  | ✅                                                                            |
| S1 delivery          | Concurrent-POST test **confirmed failing first** | ✅ Backend #273 merged to `dev` 2026-08-09 — all 13 CI checks pass            |
| Duplicate count (R2) | read-only query against prod                     | ✅ RESOLVED 2026-08-08 — 4 rows, 2 deleted, both purge gates return zero rows |
| S1 acceptance (D1)   | RCP-72 three DONE conditions                     | ✅ **MET 2026-08-09** — see assessment below                                  |

**Note the lane gate passes _vacuously_ over an empty set** and only checks the newest `sprint-N`
label — its own header says so. It detects lane drift, not a missing sprint.

## S1 acceptance assessment — 2026-08-09

**Decision: S1 code meets RCP-72 acceptance criteria. Confirmed by Adam.**

Backend PR #273 (`feat/kan-213-source-slug-unique-index`), merged to Backend `dev`
2026-08-09T20:35:27Z (`61a8a42`). RCP-72's three DONE conditions:

1. **Migration adds both partial unique indexes** — ✅ `c8f3b71d20a4`. Stronger than
   charter spec: uses `COALESCE(source_slug, slug)` after Codex review caught a hole in
   source_slug-only (an owner re-saving their own published recipe).
2. **Concurrent-POST test → one row + 409, confirmed failing first** — ✅
   `test_source_slug_unique.py:148`, structurally red-green by construction.
3. **Gate — all checks passed** — ✅ All 13 Backend CI checks pass.

**KAN-221 (split user_id into author/saved-to) → Sprint 7.** D6 scope guard, ticket's own
description, and the charter all agree. The limitation it addresses is documented ("Known
coverage limit" above) and accepted: 100% of confirmed duplicates were in the constrained
corner. KAN-221 "supersedes the shape rather than contradicting it."

**Remaining S1 work is release-train, not acceptance:** Backend dev→main promotion,
cookbook pointer bump, production migration, production verification.
