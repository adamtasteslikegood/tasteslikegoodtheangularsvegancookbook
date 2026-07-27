# Sprint 4 Plan — Walkthrough round-2 tail: publish collision, duplicate toast, dedup-suffix unpublish

_Chartered:_ 2026-07-26 · _Owner:_ Adam Schoen
_Jira epic:_ **RCP-54** (delivery/acceptance) · _Jira sprint:_ **"Sprint 4", id 43, board 168**
_Execution tickets:_ **KAN-155 · KAN-156 · KAN-157** (KAN = execution, RCP = scope/acceptance)
_Status:_ ✅ **LOCKED via `/cs:grill-pm` — 7/7 branches confirmed by Adam, 2026-07-26.**
Charter only. **No implementation started this session** by explicit scope bound.

**This is the first real Jira sprint this project has ever had.** Sprints 1–3 were `sprint-N`
labels on KAN board 34, which the Agile API refuses to attach a sprint to
(`{"errorMessages":["The board does not support sprints"]}`). See the Sprint 3 close-out for the
full finding and the lane repair.

## Charter (locked decisions)

| #   | Branch                 | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Outcome / DONE**     | Two machine gates. **(a) Sprint 3 close-out:** `project in (KAN, RCP) AND labels = sprint-3 AND statusCategory != Done` returns **zero rows** — done 2026-07-26. **(b) Sprint 4 planning:** this file carries all six charter rows, epic RCP-54 exists with ≤3 committed children in sprint 43, and `python3 .claude/skills/harness-qa-loop/plan_qa.py` exits 0. Sprint 4 *delivery* closes when KAN-155/156/157 each pass their own gate below.                                                                                                                                                     |
| 2   | **Measurement**        | WIP ≤ 3, no story points. Four mandatory measures reported **filtered** — `daily-status`, `agentic-workflows` and `report` rows excluded (21 of 125 KAN rows are bot-filed). Measure **after** status reconciliation, never before: shipped work reading In Review leaves its cycle-time clock running. The filter is not cosmetic — it moved p85 cycle time from **78 d → 3 d** and would otherwise have set the SLE at 78 days.                                                                                                                                                                     |
| 3   | **Forecast honesty**   | Zero invented dates, and **no trailing-throughput forecast this sprint** — see the amendment below. Monte Carlo over lifetime throughput (filtered, 10k trials, seed 42): **p50 3 weeks · p70 4 · p85 7 · p95 10** for 3 items. Range only, never a date. Sprint 43 was created with **no start/end dates**; setting the timebox is Adam's call and is recorded as his override.                                                                                                                                                                                                                     |
| 4   | **Ownership**          | Owner = Adam on all three; agent authors; **reviewer is never the author.** Per-item reviewers in the scope table below. Escalation → Adam, reason written into this file at the moment of escalation. `delivery_loop_gate.py` refuses a plan with an unnamed owner or reviewer.                                                                                                                                                                                                                                                                                                                    |
| 5   | **Jira lane**          | **RCP holds the sprint, KAN keeps execution** — the model `docs/ATLASSIAN_PM_LINK.md` already specified and practice had abandoned. Hard cap: RCP gets this epic + ≤3 acceptance rows per sprint, nothing else. Acceptance rows RCP-55/56/57 are `Relates`-linked to KAN-155/156/157.                                                                                                                                                                                                                                                                                                               |
| 6   | **Risk (pre-mortem)**  | Six owned risks, R1–R6, below. R1 (the lane collapses again) and R2 (status drifts a third time) are both **recurrences**, not hypotheticals.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 7   | **Budgets**            | 3 attempts/task · 12 iterations/goal · escalation reviewer Adam. Terminal states are exactly three: **verified-close, escalated, explicitly waived by Adam** — "looks done" is not one. **Blocked-on-human is a pause, not an attempt.** Hygiene capped at one pass. **No agent-initiated scope.** Copilot/Codex spend stays under the fixed blocking budget set 2026-07-24.                                                                                                                                                                                                                        |

## Committed scope — WIP ≤ 3

All three are the tail of walkthrough round 2 (2026-07-25). Each has **zero commits** in either
repo, verified by `git log --grep` across `origin/main` and `origin/dev` in both repos.

| #      | Item                                                                                              | Jira                | Proving gate (machine unless noted)                                                                                                                                        | Reviewer                                            |
| ------ | ------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **S1** | Publish fails **"Recipe ID collision"** when the row is owned by another account or a guest session — P1, breaks the core publish path | KAN-155 ↔ RCP-55 | `Gate — all checks passed` SUCCESS **+** a regression test that **fails on today's code** (mutation-checked, per the KAN-126 precedent)                                     | machine + **Adam-as-user, reproducing the collision *before* the fix** |
| **S2** | Duplicate "you already have this recipe" toast fires after a **successful first-time save**        | KAN-156 ↔ RCP-56 | Vitest asserts a first-time save emits **exactly one** toast; `npm test` exit 0; PR gate                                                                                    | machine + PR gate                                   |
| **S3** | Unpublish 4 dedup-suffixed public recipes competing with their originals — **prod data**           | KAN-157 ↔ RCP-57 | dry-run listing → **Adam approves the exact 4 slugs as printed** → backup → strict-assert → re-verify: the 4 `/r/<slug>` resolve per Adam's call, originals still 200, canonical + crawl CI gates green | **Adam as explicit human gate** + machine re-verify  |

S1 sequencing lock: this is likely Backend ownership/slug logic → **Backend PR into Backend `dev`
first, then a cookbook pointer-bump PR.** Per CLAUDE.md no path ships Backend code without the
cookbook PR. S3 reuses the Sprint 3 dedupe pattern verbatim, because it is the same class of action:
irreversible writes to production rows.

## Forecast — and why the flattering number was refused

The charter's original forecast statement cited trailing throughput of ~12 items/week (24 items /
14 days), measured **before** the Sprint 3 reconciliation. That number is now unusable, and the
reason matters more than the number:

closing ten stale rows on 2026-07-26 — for work actually delivered across v0.4.3, v0.4.4, v0.4.5 and
v0.4.6 — injected ten resolutions dated today. Trailing throughput consequently reads **32/week
(7-day)** and **18.5/week (14-day)** against a **2.77/week** lifetime average. That is an artifact of
board hygiene, not capacity. Forecasting from it would have been the mirror image of the defect this
sprint just fixed: letting Jira timestamps stand in for what actually shipped when.

**Forecast of record (verbatim):** _"3 committed items. Monte Carlo over filtered lifetime weekly
throughput (10k trials, seed 42): p50 3 weeks, p70 4, p85 7, p95 10. This is deliberately the
pessimistic basis — trailing throughput is contaminated by the 2026-07-26 batch reconciliation and
is not used. No delivery date is promised; the range is re-derived after each item completes, and
trailing throughput becomes usable again once the batch ages out (~2 weeks) or is recomputed from
release dates rather than Jira resolution dates."_

Flow baseline at charter time (filtered, 104 rows): Done 49 · WIP 4 · cycle time p50 1 d / **p85 3 d**
· SLE 3 d at 85.7% conformance.

## Owned risks

| ID     | Risk                                                                             | Mitigation                                                                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1** | **The KAN/RCP lane collapses again** — highest probability; it already did once, and the structural pull (team-managed KAN is one `createJiraIssue` away) is unchanged | Assert it, don't exhort it: the close JQL spans both projects, and `scripts/pm/check_sprint_lane.sh` fails when a non-Done `sprint-N` KAN row has no linked RCP row. Honest limit: this is a script, **not yet a blocking CI gate** |
| **R2** | **Status drifts a third time** — hand-reconciled 07-24 and again 07-26; two occurrences in three days is a system property | Real fix exists unbuilt: **KAN-97** auto-transition on PR merge (twin RCP-39). Named, accepted, **scheduled Sprint 5** rather than silently re-paid                                                |
| **R3** | **Sprint 4 becomes a board-hygiene sprint and ships nothing for users**           | Hygiene is close-out work, **not committed scope**, one pass, time-boxed. If hygiene is unfinished when KAN-155/156/157 are done, **the sprint still closes**                                      |
| **R4** | **Walkthrough round 3 never lets the sprint close** — round 1 → KAN-149; round 2 → six tickets | Round-3 findings go to the **backlog by default**. Only a P1 production break may interrupt, and interrupting is Adam's call                                                                       |
| **R5** | **KAN-157 unpublishes the wrong production rows**                                 | Sprint 3 proven pattern: dry-run table → approve **as printed** → backup → strict-assert (exists ∧ expected owner ∧ in approved list, else abort) → in-transaction re-verify                        |
| **R6** | **KAN-155 drags a migration**                                                    | Check on **day one**. If a migration is required this is a **release, not a hotfix**. Alembic single-head is a blocking pr-gate check since #3285; `train-verify.sh` covers cross-repo drift        |

## Decision item awaiting Adam — not started

**KAN-160 and KAN-161 are both labelled `held` by Adam's own instruction, and KAN-161's hold
condition has lapsed.**

- **KAN-161** — rate limiters key on raw `req.ip`, so one IPv6 /56 client can bypass per-IP limits
  including the 20/hr AI budget. The hold was explicitly _"until after the current release"_;
  **v0.4.6 shipped 2026-07-25**, so that condition is satisfied. Security-relevant.
- **KAN-160** — the board finding that per-incident URL/request-classification patches would keep
  recurring. v0.4.6's KAN-154 fix was another one (`isPageSubresource()` allowlist), which is the
  predicted fourth instance of the pattern. The board's own trigger for building it was "a fourth
  instance appears."

Both are Adam's go/no-go. Neither is in Sprint 4 scope and neither has been started.

## Not in this sprint

KAN-160 / KAN-161 (held, above) · KAN-97 auto-transition (Sprint 5, R2) · the bot-noise source fix
(filed as its own row; see close-out) · the five stale v0.2 RCP rows RCP-3/1/7/20/4 (Sprint 5
candidate) · RCP-47 unpublish-confirmation dialog · RCP-49 (standing walkthrough story, stays open)
· KAN-151 Valkey response-cache read paths · KAN-104/105 (#3146/#3147 slug decisions) · imageless-
recipe disposition rules · home-page redesign.
