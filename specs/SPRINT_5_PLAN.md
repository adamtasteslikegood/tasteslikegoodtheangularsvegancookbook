# Sprint 5 Plan — the deferred mechanisms: guest-merge correctness, rate-limit keying, and the process debt that keeps re-billing

_Chartered:_ 2026-08-01 · _Owner:_ Adam Schoen
_Jira epic:_ **RCP-65** (delivery/acceptance) · _Jira sprint:_ **"Sprint 5", id 46, board 168**
(activated 2026-08-02 on Adam's call: "we're starting today")
_Execution tickets:_ **KAN-186 · KAN-161 · KAN-198 · KAN-160 · KAN-97 · KAN-183 · KAN-182 · KAN-200**
(KAN = execution, RCP = scope/acceptance)
_Timebox:_ **2026-08-01 → 2026-08-08** (Sat → Sat, eight days), set by Adam at charter time.
**The box starts the day it was chartered** — Adam's call: "today is Saturday and we're starting today."

The first draft of this file said "2026-08-04 → 2026-08-08 (Mon → Fri)", which is **not a real week** —
those dates are Tue → Sat. Caught in review on PR #3332 by two independent reviewers. Recorded rather
than quietly corrected, because the error originated in the charter question itself: the option Adam
was asked to choose was _labelled_ "Mon → Fri" while _carrying_ Tue → Sat dates, so the answer could not
have been consistent whichever way he picked. **A charter question with a self-inconsistent option is a
defect in the charter, not a typo in the file.**
_Status:_ **Chartered via the agent-harness loop, 2026-08-01.** Scope selected by Adam from the
Sprint 4 close-out's "Carried to Sprint 5" list plus the `proposed-sprint-5` backlog.

**This is the second real Jira sprint on board 168.** Sprint 4 (id 43) was the first, and the only
one with usable data. Sprints 1–3 were `sprint-N` labels on KAN board 34, which the Agile API refuses
to attach a sprint to (`{"errorMessages":["The board does not support sprints"]}`).

**The dominant fact about this sprint is its size.** Eight committed items — seven at charter, plus
**S8 added 2026-08-02** — against a chartered WIP of ≤3, in an eight-day box, on a board whose single
measured sprint delivered **2 of 4 in three days**.
That is recorded as **R1** below and as a **knowingly exceeded** cap in charter row 2 — not smoothed
over, and not quietly re-chartered. It is Adam's call as owner; what this file owes him is that the
arithmetic is visible before the box starts rather than explained afterwards.

## Charter (locked decisions)

| #   | Branch                | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Outcome / DONE**    | Two machine gates, both confirmed **failing before** the work starts. **(a) Sprint 4 close-out:** `project in (KAN, RCP) AND labels = sprint-4 AND statusCategory != Done` returns **zero rows** — done 2026-08-01. **(b) Sprint 5 planning:** this file carries all seven charter rows, epic RCP-65 exists with its committed acceptance children (seven at charter, eight after S8) in the Sprint 5 box on board 168, `bash scripts/pm/check_sprint_lane.sh sprint-5` exits 0, and `python3 .claude/skills/harness-qa-loop/plan_qa.py` exits 0. Sprint 5 _delivery_ closes when S1–S8 each pass their own gate.                                                                                                                                                                                                                                 |
| 2   | **Measurement**       | **WIP is 8 (7 at charter, +S8 on 2026-08-02). The chartered cap is ≤3, and it is knowingly exceeded** — recorded here rather than silently re-set, exactly as Sprint 4 recorded WIP 4. Same four mandatory measures, reported **filtered** (`daily-status`, `agentic-workflows`, `report` rows excluded — bot-filed). Measure **after** status reconciliation, never before: shipped work reading In Review leaves its cycle-time clock running. The filter moved p85 cycle time 78 d → 3 d in Sprint 4 and is not cosmetic.                                                                                                                                                                                                                                                                                                                      |
| 3   | **Forecast honesty**  | **No forecast. "Unavailable" is the answer, and it is the methodology holding rather than an omission.** Board 168 has exactly one measured sprint; one sprint is not a distribution. Sprint 4 withdrew a Monte Carlo for borrowing filtered KAN lifetime throughput to predict an **RCP** sprint, and that reasoning binds here unchanged. Trailing throughput is still contaminated by the 2026-07-26 batch reconciliation. The only number worth quoting is Sprint 4's actual: **4 committed · 2 delivered · 1 with code, in a 3-day box.** Do not substitute a proxy.                                                                                                                                                                                                                                                                         |
| 4   | **Ownership**         | Owner = Adam on all eight; agent authors; **reviewer is never the author.** Escalation → Adam, with the reason written into this file at the moment of escalation. **This rule is a convention, not a mechanically enforced one — nothing in this repo refuses a plan with an unnamed owner or reviewer.** Sprint 4's charter row 4 claimed `delivery_loop_gate.py` did; that script is not in this repository and was never run against either sprint (it ships inside a machine-local agent-skill bundle). The claim was inherited verbatim into this file's first draft and caught in review on PR #3332. **Do not describe a convention as a gate until it is one** — the same rule `check_sprint_lane.sh` states about itself. **Blocked-on-human is a pause, not an attempt** — S5 and S7 both have human-only steps (see the scope table). |
| 5   | **Jira lane**         | **RCP holds the sprint, KAN keeps execution.** Epic RCP-65 + eight acceptance rows, `Relates`-linked to the eight KAN rows, asserted by `scripts/pm/check_sprint_lane.sh` — which **S8 turns into a blocking CI gate**, so this row stops being self-policed. Sprint 4 chartered "epic + ≤3 acceptance rows" and ran 4; **this sprint runs 8, the same knowingly-exceeded cap as charter row 2.** Label discipline carried forward: `sprint-5-candidate` is **not** `sprint-5` — the `sprint-N` label asserts membership in a sprint that has an epic and an acceptance row.                                                                                                                                                                                                                                                                      |
| 6   | **Risk (pre-mortem)** | Eight owned risks, R1–R8, below. **R1 (the commitment is 4× the count Sprint 4 delivered, ~1.5× by rate) is new and dominant.** R2 (lane collapse) and R3 (status drift) are **recurrences** — R3 has now fired four times, which is why its mechanism fix is committed scope this sprint rather than deferred a fifth time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 7   | **Budgets**           | 3 attempts/task · 12 iterations/goal · escalation reviewer Adam. Terminal states are exactly three: **verified-close, escalated, explicitly waived by Adam** — "looks done" is not one. Hygiene capped at one pass. **No agent-initiated scope** — S8 was added by Adam, not self-authorized. Round-3 walkthrough findings (RCP-64/KAN-194/KAN-195) stay in the backlog by default; only a P1 production break may interrupt, and interrupting is Adam's call.                                                                                                                                                                                                                                                                                                                                                                                    |

## Committed scope — eight items

Ordered by what breaks a user soonest, not by convenience.

| #      | Item                                                                               | Jira             | Why it is in                                                                                                                                                                                                    |
| ------ | ---------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S1** | Guest→login merge must run the duplicate-recipe check (INV-1), not carry rows over | KAN-186 ↔ RCP-61 | **Highest** priority open row in either project. Silent duplicate creation on every guest→login merge; it is the only S-item breaking a user today.                                                             |
| **S2** | Rate limiters key on raw `req.ip`, not IPv6-safe                                   | KAN-161 ↔ RCP-58 | **Rolled from Sprint 4 with zero implementation.** Exposure verified **LATENT, not live** (no `AAAA`; 1000/1000 sampled requests IPv4).                                                                         |
| **S3** | Regression test for the duplicate first-save toast                                 | KAN-198 ↔ RCP-66 | **Owed from Sprint 4.** KAN-156 closed on a live walkthrough; no Vitest spec asserts "a first-time save emits exactly one toast".                                                                               |
| **S4** | One general route/request-classification contract (Valkey config + routing)        | KAN-160 ↔ RCP-67 | Sprint 4's decision log: **GO → Sprint 5**, architectural, deliberately not sliced. The "fourth instance" build trigger was met.                                                                                |
| **S5** | Auto-transition on PR merge                                                        | KAN-97 ↔ RCP-39  | **The standing R3 fix, now four occurrences overdue.** Deferred every sprint since Sprint 3; committed here so the drift stops being re-paid by hand.                                                           |
| **S6** | AI review workflows exclude `synchronize`                                          | KAN-183 ↔ RCP-68 | Commits pushed after the first review are **never reviewed, silently, on both repos**. It defeats the review loop the PR lifecycle depends on.                                                                  |
| **S7** | No dev/staging environment                                                         | KAN-182 ↔ RCP-69 | Verification of user-facing behaviour is only possible in production, which serialises every fix behind a release. Root cause behind S3's "walkthrough instead of test".                                        |
| **S8** | Wire `check_sprint_lane.sh` into `pr-gate.yml` + `gate.needs`                      | KAN-200 ↔ RCP-70 | **Added 2026-08-02 on Adam's call**, from the Sprint 4 retro's actions table. Retro success measure verbatim: _"a PR orphaning a `sprint-N` row fails CI."_ Makes R2's mitigation real instead of aspirational. |

**S5 carries a known limit, from Sprint 4's close-out, and the design must account for it up front:**
auto-transition on PR merge **cannot cover items whose deliverable is not code**. KAN-157 was manual
production-data work and produced no commits no matter how much of it was done. Prod-data cleanups,
console/IAM changes, business config and live walkthrough verification all look identical to unstarted
work in `git log`. A rule that infers status from PRs will mark those items wrong in the other
direction. **Generalised rule to encode, not just to remember: "no commits" is evidence of nothing for
non-code items.**

## Retrospective actions carried in — and two that are NOT committed

Source: **[Sprint 4 Retrospective — 2026-08-01](https://tasteslikegood.atlassian.net/wiki/spaces/TLG/pages/51019869)**
(Confluence TLG). Its "Actions for Next Sprint" table names five actions targeted at Sprint 5. This
charter was drafted from `SPRINT_4_PLAN.md`'s close-out section **without reading that page**, so the
mapping below was reconstructed afterwards. Three actions were already covered by accident; **two were
missed outright.**

| Retro action                                                      | Status here                                                      |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| Build KAN-97 auto-transition on PR merge                          | ✅ **committed — S5**                                            |
| File the regression test owed by KAN-156                          | ✅ **committed — S3** (KAN-198)                                  |
| Charter Sprint 5 with an epic + acceptance rows                   | ✅ **done** — RCP-65, sprint 46                                  |
| **Wire `check_sprint_lane.sh` into `pr-gate.yml` + `gate.needs`** | ✅ **committed 2026-08-02 — S8** (KAN-200 ↔ RCP-70), Adam's call |
| **Retitle RCP-55** (title asserted pre-amendment behaviour)       | ✅ **settled 2026-08-02** — retitled on Adam's approval          |

Both misses were verified still open at the time, not assumed. A `grep` for `check_sprint_lane` across
`.github/workflows/` returned nothing, and `gate.needs` listed eleven jobs, none of them the lane check;
RCP-55 was still titled _"Publishing succeeds regardless of which account or guest session owns the
row"_, which is the behaviour Sprint 4 deliberately did **not** ship.

**Both resolved 2026-08-02.** Adam committed the lane-gate wiring as **S8** (WIP moves 7 → 8,
knowingly exceeded by five over the chartered cap, on the same terms as charter row 2) and approved the
RCP-55 retitle. **The Sprint 4 retro's actions table is now fully accounted for** — three delivered
into scope, one done at charter time, one settled directly.

**RCP-55 — settled, and the distinction is worth keeping.** Its _status_ was already `Done`
(resolution Done, 2026-08-01) and that was correct; status and title are different things, and closing
a row does not fix what it claims. It now reads _"Publishing a recipe owned by another account or guest
session is refused with a distinct, actionable reason — never reported as success (INV-4)"_, which is
what v0.4.8 actually shipped: the ownership refusal **preserved and made legible**, not loosened. The
old wording described the flattering outcome that would have required weakening `same_owner` — Sprint
4's dominant risk R7.

The previous title is recorded verbatim in a comment on the ticket rather than erased, because Sprint
4's close-out was right that _"rewriting an acceptance row to match what shipped is exactly the move
that should require a human."_ The rule held: it waited for Adam, and the amendment is auditable.

**The lesson is about where a retrospective lives.** The close-out section inside `SPRINT_4_PLAN.md`
and the Confluence retro are two different documents with two different action lists, and only the
repo one is visible to an agent working from a checkout. A charter built from the repo alone will
silently miss retro actions every time. **Read the Confluence retro when chartering, and treat its
actions table as an input, not a summary.**

## Owned risks (pre-mortem)

| ID     | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **R1** | **The commitment is 4× the count Sprint 4 delivered — dominant, new.** 8 items / 8 days against a measured 2 items / 3 days. Stated two ways, because they differ and only one is flattering: **4× by count** (8 committed vs 2 delivered), but only **~1.5× by rate** (1.0 items/day vs 0.67). The longer box absorbs most of the overcommit; it does not absorb the coordination cost. Most likely failure is not one item failing but **six items in flight and none finished**. | Single-lane discipline: **S1 first, alone, to a merged PR** before S2–S8 open in parallel. Sprint 4's own lesson was that four simultaneous items produced one shipped fix. If the box ends with >2 rolled, that is a **sizing verdict**, not a failed sprint.                                                                                                                                                                                                                                                                                                                                                                                         |
| **R2** | **The KAN/RCP lane collapses** — it did once, then **held a full sprint** in Sprint 4. Structural pull unchanged: team-managed KAN is one `createJiraIssue` away for an agent.                                                                                                                                                                                                                                                                                                      | **Mitigation committed as S8** — `check_sprint_lane.sh` is wired into `pr-gate.yml` as the `sprint-lane` job and added to `gate.needs`, so an orphaned `sprint-N` row fails the required check. Proven failing first: a transient orphan produced `exit 1 / ORPHAN KAN-191`. **Two limits survive the wiring** and are not to be mistaken for coverage: it passes **vacuously** when no row carries the label, and it is **skipped on fork PRs** (no secrets), which `gate` counts as passing. **Blocked until `ATLASSIAN_EMAIL`/`ATLASSIAN_API_TOKEN` exist as GitHub secrets** — they do not today, and the job fails closed without them by design. |
| **R3** | **Status drifts a fifth time.** Fired 07-24, 07-26, and twice more through Sprint 4. It is now a **missing mechanism, not a lapse**.                                                                                                                                                                                                                                                                                                                                                | The mechanism is **committed scope this sprint (S5)**. Until it lands, reconcile before measuring, never after. Note S5's own blind spot for non-code items, above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **R4** | **S4 (KAN-160) gets sliced after all.** Sprint 4 chartered it as deserving its own sprint; it now shares a box with six other items — the exact partial-slice outcome that decision refused.                                                                                                                                                                                                                                                                                        | S4's gate is the **contract existing and being adopted by ≥2 call sites**, not "some patches generalised". If the box runs out, S4 **rolls whole**. A half-migrated classification contract is worse than none — two conventions instead of one.                                                                                                                                                                                                                                                                                                                                                                                                       |
| **R5** | **S7 (staging env) has unbounded scope** — "no dev/staging environment" is an infrastructure programme, not a ticket, and can absorb the entire box.                                                                                                                                                                                                                                                                                                                                | S7's in-box deliverable is a **written, costed plan with one decision for Adam**, not a running environment. Building it is explicitly out of scope and needs its own charter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **R6** | **Round-3 findings never let the sprint close.** RCP-64/KAN-194/KAN-195 are open and unfixed, and were already mislabelled into Sprint 4 once.                                                                                                                                                                                                                                                                                                                                      | Charter row 7: backlog by default. Only a P1 production break interrupts, and that is Adam's call. The label correction that caught this in Sprint 4 is the precedent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **R7** | **S2 hardens a door with an open window beside it.** KAN-170 is closed, but **KAN-176 (Path B defense-in-depth) is still open** — `flask-backend` runs on one guard.                                                                                                                                                                                                                                                                                                                | S2 remains correct — Express is the only metered path for ordinary users — but its gate must **not** claim the AI budget is un-bypassable. That claim belongs to KAN-176, which is **not** in this sprint.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **R8** | **A migration is dragged.** Any Backend-touching item can turn a hotfix into a release.                                                                                                                                                                                                                                                                                                                                                                                             | Check on **day one**, per item. Alembic single-head is a blocking pr-gate check since #3285; `train-verify.sh` covers cross-repo drift. If a migration is required it is a **release, not a hotfix**.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Completed after the Sprint 4 box closed — deliberately absent from both lists

**KAN-157 ↔ RCP-57** (dedup-suffix unpublish) is **Done**, resolution Done, both rows closed
2026-08-01 — _after_ the Sprint 4 close-out was written, which is why that document lists it under
"Carried to Sprint 5". It is therefore neither committed scope nor deferred, and appears in neither
list below. Recorded explicitly because its absence is otherwise indistinguishable from an omission —
a reviewer reading the Sprint 4 close-out expected it here and said so on PR #3332.

Its `sprint-5-candidate` label was **stale and actively misleading** on a Done row; dropped from both
KAN-157 and RCP-57 as part of that review. `rolled-from-sprint-4` is kept, per the Sprint 4 close-out's
rule that the roll must survive the close.

**The general trap:** an item that rolls and then completes in the gap between close-out and the next
charter belongs in neither sprint's lists, and will read as forgotten unless it is named. Check the
board state, not the previous close-out's prose, when carrying items forward.

## Not in this sprint

KAN-176 (Path B defense-in-depth — see R7) · KAN-175 / RCP-59 (published-artifact remediation, GitHub
support contact outstanding) · KAN-191 (submodule bump / train-verify Station 3) · KAN-138 (release-train
automation) · KAN-151 (Valkey response-cache read paths) · RCP-64 / KAN-194 / KAN-195 (walkthrough
round-3, backlog by R6) · RCP-47 (unpublish confirmation dialog) · RCP-49 (standing walkthrough story,
stays open) · the five stale v0.2 RCP rows RCP-3/1/7/20/4 · KAN-104/105 slug decisions · home-page
redesign.

## Close-out

_Written 2026-08-07, with the box's final day (2026-08-08) still open._ Nothing below is a forecast
for that day: it records what is true at the time of writing. **If anything lands on 08-08 this
section must be amended, not supplemented** — a close-out with a second, later addendum is how
Sprint 4's roll list ended up disagreeing with the board.

### Delivered — 4 of 8

| #      | Item                          | Jira             | Evidence                                                                                                |
| ------ | ----------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------- |
| **S1** | Guest→login merge runs INV-1  | KAN-186 ↔ RCP-61 | Backend #267 → Backend `dev`; cookbook pointer #3344. **Not in production yet** — see the caveat below. |
| **S3** | Duplicate first-save toast    | KAN-198 ↔ RCP-66 | #3358 — three Vitest specs, suite 281 → 284. Gate **confirmed failing first**.                          |
| **S6** | AI review on `synchronize`    | KAN-183 ↔ RCP-68 | #3334                                                                                                   |
| **S8** | `check_sprint_lane.sh` gating | KAN-200 ↔ RCP-70 | #3336 — `sprint-lane` job in `pr-gate.yml`, added to `gate.needs`                                       |

### Rolled — 4 of 8

**S2** (KAN-161 · rate-limit IPv6 keying) — **rolls a second consecutive sprint with zero
implementation.** Two sprints carrying an item that never starts is a signal about the item, not the
box; it should not be re-committed a third time without deciding why it keeps losing. Exposure
remains verified LATENT, not live.
**S4** (KAN-160 · route/request classification contract) — rolls **whole**, exactly as R4 required.
No partial slice was taken.
**S5** (KAN-97 · auto-transition on PR merge) — the standing R3 fix, now **five** occurrences overdue.
**S7** (KAN-182 · staging-environment plan) — not started. Its absence has a cost this sprint made
concrete: see the S1 caveat.

### S1 is delivered but not deployed — and that distinction is the sprint's sharpest finding

The KAN-186 fix is merged on Backend `dev` and pinned by cookbook `dev`. It is **not on Backend
`main`, and therefore not in production.** The promotion PR (Backend #271) was open at the time of
writing. So the only committed item that was breaking a user today is fixed in the repo and still
broken for users.

That gap is not a process slip; it is the structural cost of having no environment between `dev` and
production — **which is S7, the item that rolled.** The sprint produced its own evidence for the item
it deferred.

### Gates — and the one that was confirmed failing first

Charter row 1's planning gates both held: this file carries the charter rows, RCP-65 exists with its
eight acceptance children, and the lane check is now a blocking CI job rather than a script.

**S3's gate is the one worth recording, because it was proven failing before the fix and the failure
contradicted the ticket.** KAN-156 was triaged _"Low priority — cosmetic, no data impact."_ The test
written to assert "a first-time save emits exactly one toast" failed on `saveRecipe` being called
**twice** — the race persists a **duplicate recipe row**; the extra toast is a symptom, not the bug.
A row closed on a live walkthrough had its impact recorded wrong, and only writing the test surfaced
it. That is the general argument for S3's whole category, made concrete.

Second-order finding, recorded because it generalises past this row: the existing suite mocked
`saveRecipe` as `vi.fn().mockResolvedValue(true)` — resolving without recording state. **A mock that
returns success without persisting cannot catch a read-after-write race**, so the duplicate was
unreproducible by construction. This suite has that shape in several places.

### R1's verdict on sizing — the commitment was too large, and the rate says so

R1 predicted the dominant failure would be "six items in flight and none finished". **That did not
happen.** Single-lane discipline held: S1 went first and alone to a merged PR, and the four delivered
items were each finished rather than left partial. R1's stated mitigation worked.

R1's arithmetic still lost. Charter row 2 recorded WIP 8 against a chartered cap of ≤3, knowingly
exceeded, and 4 rolled — double the ">2 rolled is a sizing verdict" threshold R1 set for itself.
**The verdict is: the commitment was too large.**

Stated the unflattering way, which is the way that is true:

| Sprint | Box    | Committed | Delivered | Delivered/day |
| ------ | ------ | --------- | --------- | ------------- |
| 4      | 3 days | 4         | 2         | **0.67**      |
| 5      | 8 days | 8         | 4         | **0.50**      |

Delivered count doubled — on a box **2.67× longer**. The per-day rate **fell**, 0.67 → 0.50. The
longer box did not absorb the overcommit; it diluted it. Do not quote "4 delivered, up from 2"
without the denominator.

### Second data point for this board's throughput

Board 168 now has **two** measured sprints: 4 committed / 2 delivered in 3 days, and 8 committed / 4
delivered in 8 days. Two points is still not a distribution, so **charter row 3 stands unchanged: no
forecast.** What two points do support is a bound — nothing in this board's history shows a rate
above ~0.67 items/day, and Sprint 5 came in below it. A Sprint 6 committing more than ~4 items in a
week is committing above everything measured so far.

### Worked outside the sprint, on Adam's call

Recorded here so it is visible in the numbers' context but **explicitly not counted** as sprint
scope — KAN-138 is listed under "Not in this sprint" above and stays there:

- **KAN-138** (#3359) — audited `RUNBOOK.md`'s eleven steps against `train-run.sh`. The checklist
  declared ten steps and only ever marked four, so six read `[ ]` forever and a completed release
  still showed a mostly empty checklist. Fixed by deriving marks from observable state, plus a
  step-5 `--bump` assist and RUNBOOK step 10.
- **KAN-208** (#3357) — `Dependency Review`, a required check, blocked every `vite` bump on
  `lightningcss` (MPL-2.0). Exempted per-package.
- **KAN-209** — filed, not worked: the RESP2 pin added when taking ioredis 6 (#3353), because
  RESP3's `HELLO` handshake injects a `default` username that Memorystore IAM auth does not use.

### Carried to Sprint 6

KAN-161 (S2 — decide _why_ it keeps rolling before re-committing) · KAN-160 (S4, whole) · KAN-97
(S5, five overdue) · KAN-182 (S7 — S1 supplied fresh evidence for it) · KAN-209 · KAN-90 (the
protobufjs sibling of KAN-208).
