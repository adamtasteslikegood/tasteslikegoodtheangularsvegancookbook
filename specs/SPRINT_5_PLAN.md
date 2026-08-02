# Sprint 5 Plan — the deferred mechanisms: guest-merge correctness, rate-limit keying, and the process debt that keeps re-billing

_Chartered:_ 2026-08-01 · _Owner:_ Adam Schoen
_Jira epic:_ **RCP-65** (delivery/acceptance) · _Jira sprint:_ **"Sprint 5", id 46, board 168**
(created in `future` state — **activating it is Adam's call**, as it was for sprint 43)
_Execution tickets:_ **KAN-186 · KAN-161 · KAN-198 · KAN-160 · KAN-97 · KAN-183 · KAN-182**
(KAN = execution, RCP = scope/acceptance)
_Timebox:_ **2026-08-04 → 2026-08-08** (Mon → Fri), set by Adam at charter time.
_Status:_ **Chartered via the agent-harness loop, 2026-08-01.** Scope selected by Adam from the
Sprint 4 close-out's "Carried to Sprint 5" list plus the `proposed-sprint-5` backlog.

**This is the second real Jira sprint on board 168.** Sprint 4 (id 43) was the first, and the only
one with usable data. Sprints 1–3 were `sprint-N` labels on KAN board 34, which the Agile API refuses
to attach a sprint to (`{"errorMessages":["The board does not support sprints"]}`).

**The dominant fact about this sprint is its size.** Seven committed items against a chartered WIP of
≤3, in a five-day box, on a board whose single measured sprint delivered **2 of 4 in three days**.
That is recorded as **R1** below and as a **knowingly exceeded** cap in charter row 2 — not smoothed
over, and not quietly re-chartered. It is Adam's call as owner; what this file owes him is that the
arithmetic is visible before the box starts rather than explained afterwards.

## Charter (locked decisions)

| #   | Branch                | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Outcome / DONE**    | Two machine gates, both confirmed **failing before** the work starts. **(a) Sprint 4 close-out:** `project in (KAN, RCP) AND labels = sprint-4 AND statusCategory != Done` returns **zero rows** — done 2026-08-01. **(b) Sprint 5 planning:** this file carries all seven charter rows, epic RCP-65 exists with its seven committed acceptance children in the Sprint 5 box on board 168, `bash scripts/pm/check_sprint_lane.sh sprint-5` exits 0, and `python3 .claude/skills/harness-qa-loop/plan_qa.py` exits 0. Sprint 5 _delivery_ closes when S1–S7 each pass their own gate. |
| 2   | **Measurement**       | **WIP is 7. The chartered cap is ≤3, and it is knowingly exceeded** — recorded here rather than silently re-set, exactly as Sprint 4 recorded WIP 4. Same four mandatory measures, reported **filtered** (`daily-status`, `agentic-workflows`, `report` rows excluded — bot-filed). Measure **after** status reconciliation, never before: shipped work reading In Review leaves its cycle-time clock running. The filter moved p85 cycle time 78 d → 3 d in Sprint 4 and is not cosmetic.                                                                                        |
| 3   | **Forecast honesty**  | **No forecast. "Unavailable" is the answer, and it is the methodology holding rather than an omission.** Board 168 has exactly one measured sprint; one sprint is not a distribution. Sprint 4 withdrew a Monte Carlo for borrowing filtered KAN lifetime throughput to predict an **RCP** sprint, and that reasoning binds here unchanged. Trailing throughput is still contaminated by the 2026-07-26 batch reconciliation. The only number worth quoting is Sprint 4's actual: **4 committed · 2 delivered · 1 with code, in a 3-day box.** Do not substitute a proxy.        |
| 4   | **Ownership**         | Owner = Adam on all seven; agent authors; **reviewer is never the author.** Escalation → Adam, with the reason written into this file at the moment of escalation. `delivery_loop_gate.py` refuses a plan with an unnamed owner or reviewer. **Blocked-on-human is a pause, not an attempt** — S5 and S7 both have human-only steps (see the scope table).                                                                                                                                                                                                                     |
| 5   | **Jira lane**         | **RCP holds the sprint, KAN keeps execution.** Epic RCP-65 + seven acceptance rows, `Relates`-linked to the seven KAN rows, asserted by `scripts/pm/check_sprint_lane.sh`. Sprint 4 chartered "epic + ≤3 acceptance rows" and ran 4; **this sprint runs 7, the same knowingly-exceeded cap as charter row 2.** Label discipline carried forward: `sprint-5-candidate` is **not** `sprint-5` — the `sprint-N` label asserts membership in a sprint that has an epic and an acceptance row.                                                                                        |
| 6   | **Risk (pre-mortem)** | Eight owned risks, R1–R8, below. **R1 (the commitment is ~3.5× the demonstrated rate) is new and dominant.** R2 (lane collapse) and R3 (status drift) are **recurrences** — R3 has now fired four times, which is why its mechanism fix is committed scope this sprint rather than deferred a fifth time.                                                                                                                                                                                                                                                                       |
| 7   | **Budgets**           | 3 attempts/task · 12 iterations/goal · escalation reviewer Adam. Terminal states are exactly three: **verified-close, escalated, explicitly waived by Adam** — "looks done" is not one. Hygiene capped at one pass. **No agent-initiated scope.** Round-3 walkthrough findings (RCP-64/KAN-194/KAN-195) stay in the backlog by default; only a P1 production break may interrupt, and interrupting is Adam's call.                                                                                                                                                              |

## Committed scope — seven items

Ordered by what breaks a user soonest, not by convenience.

| #      | Item                                                                             | Jira             | Why it is in                                                                                                                            |
| ------ | -------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **S1** | Guest→login merge must run the duplicate-recipe check (INV-1), not carry rows over | KAN-186 ↔ RCP-61 | **Highest** priority open row in either project. Silent duplicate creation on every guest→login merge; it is the only S-item breaking a user today. |
| **S2** | Rate limiters key on raw `req.ip`, not IPv6-safe                                  | KAN-161 ↔ RCP-58 | **Rolled from Sprint 4 with zero implementation.** Exposure verified **LATENT, not live** (no `AAAA`; 1000/1000 sampled requests IPv4).  |
| **S3** | Regression test for the duplicate first-save toast                                | KAN-198 ↔ RCP-66 | **Owed from Sprint 4.** KAN-156 closed on a live walkthrough; no Vitest spec asserts "a first-time save emits exactly one toast".        |
| **S4** | One general route/request-classification contract (Valkey config + routing)       | KAN-160 ↔ RCP-67 | Sprint 4's decision log: **GO → Sprint 5**, architectural, deliberately not sliced. The "fourth instance" build trigger was met.         |
| **S5** | Auto-transition on PR merge                                                       | KAN-97 ↔ RCP-39  | **The standing R3 fix, now four occurrences overdue.** Deferred every sprint since Sprint 3; committed here so the drift stops being re-paid by hand. |
| **S6** | AI review workflows exclude `synchronize`                                         | KAN-183 ↔ RCP-68 | Commits pushed after the first review are **never reviewed, silently, on both repos**. It defeats the review loop the PR lifecycle depends on. |
| **S7** | No dev/staging environment                                                        | KAN-182 ↔ RCP-69 | Verification of user-facing behaviour is only possible in production, which serialises every fix behind a release. Root cause behind S3's "walkthrough instead of test". |

**S5 carries a known limit, from Sprint 4's close-out, and the design must account for it up front:**
auto-transition on PR merge **cannot cover items whose deliverable is not code**. KAN-157 was manual
production-data work and produced no commits no matter how much of it was done. Prod-data cleanups,
console/IAM changes, business config and live walkthrough verification all look identical to unstarted
work in `git log`. A rule that infers status from PRs will mark those items wrong in the other
direction. **Generalised rule to encode, not just to remember: "no commits" is evidence of nothing for
non-code items.**

## Owned risks (pre-mortem)

| ID     | Risk                                                                                                                                                                                                            | Mitigation                                                                                                                                                                                                                                                     |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1** | **The commitment is ~3.5× the demonstrated rate — dominant, new.** 7 items / 5 days against a measured 2 items / 3 days. Most likely failure is not one item failing but **six items in flight and none finished**. | Single-lane discipline: **S1 first, alone, to a merged PR** before S2–S7 open in parallel. Sprint 4's own lesson was that four simultaneous items produced one shipped fix. If the box ends with >2 rolled, that is a **sizing verdict**, not a failed sprint. |
| **R2** | **The KAN/RCP lane collapses** — it did once, then **held a full sprint** in Sprint 4. Structural pull unchanged: team-managed KAN is one `createJiraIssue` away for an agent.                                     | Assert it: `check_sprint_lane.sh sprint-5` in the close gate. **Honest limit, unchanged: this is a script, NOT a blocking CI gate.** Wiring it into `pr-gate.yml` + `gate.needs` is what would make it one.                                                     |
| **R3** | **Status drifts a fifth time.** Fired 07-24, 07-26, and twice more through Sprint 4. It is now a **missing mechanism, not a lapse**.                                                                              | The mechanism is **committed scope this sprint (S5)**. Until it lands, reconcile before measuring, never after. Note S5's own blind spot for non-code items, above.                                                                                             |
| **R4** | **S4 (KAN-160) gets sliced after all.** Sprint 4 chartered it as deserving its own sprint; it now shares a box with six other items — the exact partial-slice outcome that decision refused.                      | S4's gate is the **contract existing and being adopted by ≥2 call sites**, not "some patches generalised". If the box runs out, S4 **rolls whole**. A half-migrated classification contract is worse than none — two conventions instead of one.                |
| **R5** | **S7 (staging env) has unbounded scope** — "no dev/staging environment" is an infrastructure programme, not a ticket, and can absorb the entire box.                                                              | S7's in-box deliverable is a **written, costed plan with one decision for Adam**, not a running environment. Building it is explicitly out of scope and needs its own charter.                                                                                  |
| **R6** | **Round-3 findings never let the sprint close.** RCP-64/KAN-194/KAN-195 are open and unfixed, and were already mislabelled into Sprint 4 once.                                                                    | Charter row 7: backlog by default. Only a P1 production break interrupts, and that is Adam's call. The label correction that caught this in Sprint 4 is the precedent.                                                                                          |
| **R7** | **S2 hardens a door with an open window beside it.** KAN-170 is closed, but **KAN-176 (Path B defense-in-depth) is still open** — `flask-backend` runs on one guard.                                              | S2 remains correct — Express is the only metered path for ordinary users — but its gate must **not** claim the AI budget is un-bypassable. That claim belongs to KAN-176, which is **not** in this sprint.                                                      |
| **R8** | **A migration is dragged.** Any Backend-touching item can turn a hotfix into a release.                                                                                                                          | Check on **day one**, per item. Alembic single-head is a blocking pr-gate check since #3285; `train-verify.sh` covers cross-repo drift. If a migration is required it is a **release, not a hotfix**.                                                           |

## Not in this sprint

KAN-176 (Path B defense-in-depth — see R7) · KAN-175 / RCP-59 (published-artifact remediation, GitHub
support contact outstanding) · KAN-191 (submodule bump / train-verify Station 3) · KAN-138 (release-train
automation) · KAN-151 (Valkey response-cache read paths) · RCP-64 / KAN-194 / KAN-195 (walkthrough
round-3, backlog by R6) · RCP-47 (unpublish confirmation dialog) · RCP-49 (standing walkthrough story,
stays open) · the five stale v0.2 RCP rows RCP-3/1/7/20/4 · KAN-104/105 slug decisions · home-page
redesign.

## Close-out

_To be written at the end of the box. It must record: which of S1–S7 delivered, which rolled, what the
gates said (and that they were confirmed failing first), R1's verdict on sizing, and the second data
point for this board's throughput._
