# Sprint 4 Plan — Walkthrough round-2 tail: publish collision, duplicate toast, dedup-suffix unpublish

_Chartered:_ 2026-07-26 · _Owner:_ Adam Schoen
_Jira epic:_ **RCP-54** (delivery/acceptance) · _Jira sprint:_ **"Sprint 4", id 43, board 168**
_Execution tickets:_ **KAN-155 · KAN-156 · KAN-157 · KAN-161** (KAN = execution, RCP = scope/acceptance)
_Status:_ ✅ **LOCKED via `/cs:grill-pm` — 7/7 branches confirmed by Adam, 2026-07-26.**
_Amended same day (see "Scope amendment" below):_ **KAN-161 added → WIP 4**, KAN-160 scheduled Sprint 5.
Charter only. **No implementation started this session** by explicit scope bound.

**This is the first real Jira sprint this project has ever had.** Sprints 1–3 were `sprint-N`
labels on KAN board 34, which the Agile API refuses to attach a sprint to
(`{"errorMessages":["The board does not support sprints"]}`). See the Sprint 3 close-out for the
full finding and the lane repair.

## Charter (locked decisions)

| #   | Branch                | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Outcome / DONE**    | Two machine gates. **(a) Sprint 3 close-out:** `project in (KAN, RCP) AND labels = sprint-3 AND statusCategory != Done` returns **zero rows** — done 2026-07-26. **(b) Sprint 4 planning:** this file carries all six charter rows, epic RCP-54 exists with its committed children in sprint 43 (**4 after the amendment**), and `python3 .claude/skills/harness-qa-loop/plan_qa.py` exits 0. Sprint 4 _delivery_ closes when KAN-155/156/157/**161** each pass their own gate below.                      |
| 2   | **Measurement**       | WIP ≤ 3 as chartered, **amended to 4 on 2026-07-26** (Adam, see Scope amendment). No story points. Four mandatory measures reported **filtered** — `daily-status`, `agentic-workflows` and `report` rows excluded (21 of 125 KAN rows are bot-filed). Measure **after** status reconciliation, never before: shipped work reading In Review leaves its cycle-time clock running. The filter is not cosmetic — it moved p85 cycle time from **78 d → 3 d** and would otherwise have set the SLE at 78 days. |
| 3   | **Forecast honesty**  | Zero invented dates, and **no trailing-throughput forecast this sprint** (contaminated — see below). Monte Carlo over lifetime throughput (filtered, 10k trials, seed 42), re-derived for 4 items: p50 4 weeks · p70 6 · p85 8 · p95 13. **WITHDRAWN 2026-07-28 — see the override row below; do not quote these numbers.** Sprint 43 was created with **no start/end dates**; setting the timebox is Adam's call and is recorded as his override.                                                         |
| 4   | **Ownership**         | Owner = Adam on all four; agent authors; **reviewer is never the author.** Per-item reviewers in the scope tables below. Escalation → Adam, reason written into this file at the moment of escalation. `delivery_loop_gate.py` refuses a plan with an unnamed owner or reviewer.                                                                                                                                                                                                                           |
| 5   | **Jira lane**         | **RCP holds the sprint, KAN keeps execution** — the model `docs/ATLASSIAN_PM_LINK.md` already specified and practice had abandoned. Cap: RCP gets this epic + the sprint's acceptance rows and nothing else — chartered at ≤3, **now 4** (RCP-58 added with KAN-161). Acceptance rows RCP-55/56/57/58 are `Relates`-linked to KAN-155/156/157/161, asserted by `scripts/pm/check_sprint_lane.sh`.                                                                                                          |
| 6   | **Risk (pre-mortem)** | Six owned risks, R1–R6, below. R1 (the lane collapses again) and R2 (status drifts a third time) are both **recurrences**, not hypotheticals.                                                                                                                                                                                                                                                                                                                                                              |
| 7   | **Budgets**           | 3 attempts/task · 12 iterations/goal · escalation reviewer Adam. Terminal states are exactly three: **verified-close, escalated, explicitly waived by Adam** — "looks done" is not one. **Blocked-on-human is a pause, not an attempt.** Hygiene capped at one pass. **No agent-initiated scope.** Copilot/Codex spend stays under the fixed blocking budget set 2026-07-24.                                                                                                                               |

## Timebox — Adam's override, recorded 2026-07-28

Charter row 3 reserved the timebox to Adam. He set it, and rejected the forecast that row carried.

**Sprint 43 activated 2026-07-28T09:56:24Z, ending 2026-07-31T23:59:00Z — Friday of the same week.** Sprint goal updated at activation to name all four items rather than three.

**The Monte Carlo is withdrawn, and the reason generalises.** Adam's objection: _"the 4 items are a day's work — the data for previous sprints is not available, or the results of this space's 0 sprints history."_ That is correct and it is a methodology fault, not a disagreement about estimates. The p50-4-weeks figure was computed over **filtered lifetime KAN throughput** and then presented as a forecast for an **RCP** sprint. RCP has run **zero** sprints. Borrowing another lane's throughput — a lane with different item granularity, filed under a different working model — and reporting the output as this board's forecast is precisely the invented-confidence that row 3 exists to forbid. The row's own principle caught the row's own number.

Consequence: **Sprint 4 produces the first legitimate data point for this board, and there is nothing to compare it against.** No forecast should be quoted for Sprint 5 either — one sprint is not a distribution. Treat forecasting as unavailable until RCP has enough closed sprints of its own to sample, and say "unavailable" rather than substituting a proxy.

Practical read on the timebox: four items sized at roughly a day means a Tue→Fri box is a real deadline rather than a stretch, and if it rolls, that is signal about sizing rather than a failed sprint.

## Committed scope — WIP 4 (chartered ≤ 3, amended)

S1–S3 are the tail of walkthrough round 2 (2026-07-25); **S4 (KAN-161) was added by the scope
amendment below.** Each of the four has **zero commits** in either repo, verified by `git log --grep`
across `origin/main` and `origin/dev` in both repos.

| #      | Item                                                                                                                                   | Jira             | Proving gate (machine unless noted)                                                                                                                                                                     | Reviewer                                                               |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **S1** | Publish fails **"Recipe ID collision"** when the row is owned by another account or a guest session — P1, breaks the core publish path | KAN-155 ↔ RCP-55 | `Gate — all checks passed` SUCCESS **+** a regression test that **fails on today's code** (mutation-checked, per the KAN-126 precedent)                                                                 | machine + **Adam-as-user, reproducing the collision _before_ the fix** |
| **S2** | Duplicate "you already have this recipe" toast fires after a **successful first-time save**                                            | KAN-156 ↔ RCP-56 | Vitest asserts a first-time save emits **exactly one** toast; `npm test` exit 0; PR gate                                                                                                                | machine + PR gate                                                      |
| **S3** | Unpublish 4 dedup-suffixed public recipes competing with their originals — **prod data**                                               | KAN-157 ↔ RCP-57 | dry-run listing → **Adam approves the exact 4 slugs as printed** → backup → strict-assert → re-verify: the 4 `/r/<slug>` resolve per Adam's call, originals still 200, canonical + crawl CI gates green | **Adam as explicit human gate** + machine re-verify                    |

S1 sequencing lock: this is likely Backend ownership/slug logic → **Backend PR into Backend `dev`
first, then a cookbook pointer-bump PR.** Per CLAUDE.md no path ships Backend code without the
cookbook PR. S3 reuses the Sprint 3 dedupe pattern verbatim, because it is the same class of action:
irreversible writes to production rows.

## Scope amendment — 2026-07-26, WIP 3 → 4 (Adam)

Adam released the hold on **KAN-160 and KAN-161** the same day the charter was locked, having
confirmed the board's thesis in his own words: the temporary fix shipped for KAN-154 is _"based on a
growing allow-list."_ Both are GO. They are deliberately **not** landing together:

| #      | Item                                                                                                                        | Jira             | Proving gate                                                                                                                                       | Reviewer       |
| ------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **S4** | Rate limiters key on raw `req.ip`, so rotating inside one IPv6 allocation buys fresh budget — including the 20/hr AI budget | KAN-161 ↔ RCP-58 | a unit test proving two distinct `/128` addresses inside one `/64` share a bucket, **failing on today's code**; `Gate — all checks passed` SUCCESS | machine + Adam |

**KAN-160 → Sprint 5**, not squeezed in. It is architectural — a route-classification manifest plus a
CI test asserting unrecognized paths never `200` as `text/html`, plus the shared Valkey client/config
factory with a fail-fast deploy healthcheck. Half-doing it inside Sprint 4 would produce another
partial exemption, which is the defect it exists to kill.

KAN-160 carries the label **`sprint-5-candidate`, deliberately not `sprint-5`** — and that correction
came from the new lane assertion catching its own author. Labelling it `sprint-5` immediately made
`check_sprint_lane.sh` exit 1 with KAN-160 as an orphan, which was right: a `sprint-N` label asserts
membership in a sprint that has an RCP epic and an acceptance row, and Sprint 5 has not been
chartered. The candidate label is intentionally outside the assertion's `sprint-<digits>` pattern. It
becomes `sprint-5` when Sprint 5 is chartered and gets its epic. First live proof that R1's mitigation
does real work rather than decorating the plan.

**Two caps knowingly exceeded**, recorded rather than quietly broken: WIP is 4, not ≤ 3; and charter
row 5's "epic + ≤3 acceptance rows" in RCP is now 4 rows (RCP-58 added). Both are Adam's call as
owner. **R3 and R4 still bind** — the sprint closes on these four, and round-3 findings still go to
the backlog.

### KAN-161 — fix decision and the trap

**Keying: normalize to `/64` via express-rate-limit's own `ipKeyGenerator` helper.** `/64` is the
standard single-customer allocation, and using the library's helper satisfies the
`ERR_ERL_KEY_GEN_IPV6` check _by design_ rather than by suppressing it. `/56` was considered and
rejected as over-broad — it buckets a whole household and would limit genuinely separate devices
collaterally.

**Do not "simplify" the key generators.** The wrappers at `server/security.ts:94`, `:121` and `:140`
— `keyGenerator: (req) => getClientIp(req)` — are **load-bearing**: they suppress
express-rate-limit 8.6.0's source-text `ERR_ERL_KEY_GEN_IPV6` scan. Collapsing them to
`keyGenerator: getClientIp` trips it. Automated reviewers have proposed exactly that before and it
has been rejected each time.

Confirmed in code: `getClientIp` is `req.ip || req.socket.remoteAddress` under `trust proxy = 1`, so
an IPv6 client keys on its full `/128` across **all three** limiters — api 300/15m, page 300/15m, and
the 20/hr AI budget, which is the one with real money attached.

### KAN-161 — exposure verification (partial; the open question on the ticket)

The ticket asked whether production actually receives IPv6 client addresses today. Answer so far:

- **Latent on the customer path.** Neither `www.tasteslikegood.org` nor the apex publishes an `AAAA`
  record; both resolve to `34.8.251.224` only. An IPv6 request from a host with working IPv6 (3 global
  addresses, IPv6 → google.com `200`) fails outright — a server-side negative, not a local artifact.
- **Confirmed by request logs, 2026-07-27:** 1000 `express-frontend` request-log entries sampled over
  7 days returned **1000 IPv4, 0 IPv6, 0 unparseable.** Production receives no IPv6 client traffic.
- **The `*.run.app` bypass hypothesis is refuted for `express-frontend`.** Its ingress is
  `internal-and-cloud-load-balancing` and its `run.app` URL returns **404** from off-network — Google's
  frontend refuses to route, so the container never sees the request and no bucket is consumed. Worth
  having tested rather than assumed: that hostname _does_ publish `AAAA` and does answer at TLS.

**Resolved: exposure is LATENT, not live.** S4 stays a correctness/hardening item; its urgency is
lower than if traffic had been arriving.

### Surfaced while verifying: KAN-170 (P1), which reorders this

Verifying the above found a larger hole, filed as **KAN-170** and linked **blocks KAN-161**:
`flask-backend` is publicly invokable (`ingress=all` plus `invoker-iam-disabled=true`, which renders
`cloudbuild.yaml`'s `--no-allow-unauthenticated` inert), and `POST /api/generate` has **no Flask-side
auth and no Flask-side rate limiting** — `flask-limiter` is not even a dependency. The 20/hr AI budget
that S4 hardens is therefore defeatable without any IPv6 involvement, by addressing Flask directly.

S4 remains correct — Express is still the only metered path for ordinary users — but it guards a door
with an open window beside it. **Whether KAN-170 preempts this sprint is Adam's call** (R4 reserves
interruption for a P1 production break, and this is an exposure rather than an outage). Details,
severity calibration and three remediation options are on the ticket; nothing in production was
changed. The service hostname is deliberately kept out of this repo — both repos are public, and it
is currently absent from tracked files, CT logs (wildcard cert), response headers and the JS bundle.

## Forecast — and why the flattering number was refused

The charter's original forecast statement cited trailing throughput of ~12 items/week (24 items /
14 days), measured **before** the Sprint 3 reconciliation. That number is now unusable, and the
reason matters more than the number:

closing ten stale rows on 2026-07-26 — for work actually delivered across v0.4.3, v0.4.4, v0.4.5 and
v0.4.6 — injected ten resolutions dated today. Trailing throughput consequently reads **32/week
(7-day)** and **18.5/week (14-day)** against a **2.77/week** lifetime average. That is an artifact of
board hygiene, not capacity. Forecasting from it would have been the mirror image of the defect this
sprint just fixed: letting Jira timestamps stand in for what actually shipped when.

**WITHDRAWN 2026-07-28** — the paragraph below is retained as historical record of the number that
was refused; see the "Timebox — Adam's override" section above for the methodology reason. **Do not
quote these numbers.**

**~~Forecast of record~~ (verbatim, re-derived for 4 items after the scope amendment):** _"4 committed
items. Monte Carlo over filtered lifetime weekly throughput (10k trials, seed 42): p50 4 weeks, p70 6,
p85 8, p95 13 — superseding the 3-item range (p50 3 · p70 4 · p85 7 · p95 10). This is deliberately the
pessimistic basis — trailing throughput is contaminated by the 2026-07-26 batch reconciliation and
is not used. No delivery date is promised; the range is re-derived after each item completes, and
trailing throughput becomes usable again once the batch ages out (~2 weeks) or is recomputed from
release dates rather than Jira resolution dates."_

Flow baseline at charter time (filtered, 104 rows): Done 49 · WIP 4 · cycle time p50 1 d / **p85 3 d**
· SLE 3 d at 85.7% conformance.

## Owned risks

| ID     | Risk                                                                                                                                                                   | Mitigation                                                                                                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1** | **The KAN/RCP lane collapses again** — highest probability; it already did once, and the structural pull (team-managed KAN is one `createJiraIssue` away) is unchanged | Assert it, don't exhort it: the close JQL spans both projects, and `scripts/pm/check_sprint_lane.sh` fails when a non-Done `sprint-N` KAN row has no linked RCP row. Honest limit: this is a script, **not yet a blocking CI gate** |
| **R2** | **Status drifts a third time** — hand-reconciled 07-24 and again 07-26; two occurrences in three days is a system property                                             | Real fix exists unbuilt: **KAN-97** auto-transition on PR merge (twin RCP-39). Named, accepted, **scheduled Sprint 5** rather than silently re-paid                                                                                 |
| **R3** | **Sprint 4 becomes a board-hygiene sprint and ships nothing for users**                                                                                                | Hygiene is close-out work, **not committed scope**, one pass, time-boxed. If hygiene is unfinished when KAN-155/156/157/161 are done, **the sprint still closes**                                                                   |
| **R4** | **Walkthrough round 3 never lets the sprint close** — round 1 → KAN-149; round 2 → six tickets                                                                         | Round-3 findings go to the **backlog by default**. Only a P1 production break may interrupt, and interrupting is Adam's call                                                                                                        |
| **R5** | **KAN-157 unpublishes the wrong production rows**                                                                                                                      | Sprint 3 proven pattern: dry-run table → approve **as printed** → backup → strict-assert (exists ∧ expected owner ∧ in approved list, else abort) → in-transaction re-verify                                                        |
| **R6** | **KAN-155 drags a migration**                                                                                                                                          | Check on **day one**. If a migration is required this is a **release, not a hotfix**. Alembic single-head is a blocking pr-gate check since #3285; `train-verify.sh` covers cross-repo drift                                        |

## Decision log — resolved 2026-07-26

**Both holds released by Adam.** The hold rationale is now on record in his words: neither was held
on merit — they were held so as not to block the release, which shipped a temporary fix instead, and
that temporary fix "is based on a growing allow-list."

| Item        | Decision                                                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **KAN-161** | **GO → Sprint 4** (WIP 4). Hold condition _"after the current release"_ lapsed when v0.4.6 shipped 2026-07-25. Keying: `/64` via `ipKeyGenerator`. |
| **KAN-160** | **GO → Sprint 5.** Architectural; gets its own sprint rather than a partial slice. The board's build trigger ("a fourth instance appears") is met. |

The allowlist Adam described, as it stands in `server/security.ts` — two generations of named
exemption in one regex, `favicon.` from #3164 and `apple-touch-icon` from KAN-154:

```
SUBRESOURCE_PREFIX_RE = /^\/(?:static\/|favicon\.|apple-touch-icon)/
HASHED_BUNDLE_RE      = /(?:^|\/)[\w.-]+-[A-Z0-9]{8}\.(?:js|css)$/
shouldSkipRateLimiting = req.path === '/health' || IMAGE_SERVING_RE.test(req.path)
```

## Not in this sprint

KAN-160 (**GO, Sprint 5** — see decision log) · KAN-97 auto-transition (Sprint 5, R2) · the bot-noise source fix
(filed as its own row; see close-out) · the five stale v0.2 RCP rows RCP-3/1/7/20/4 (Sprint 5
candidate) · RCP-47 unpublish-confirmation dialog · RCP-49 (standing walkthrough story, stays open)
· KAN-151 Valkey response-cache read paths · KAN-104/105 (#3146/#3147 slug decisions) · imageless-
recipe disposition rules · home-page redesign.
