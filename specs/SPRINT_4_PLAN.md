# Sprint 4 Plan — Walkthrough round-2 tail: publish collision, duplicate toast, dedup-suffix unpublish

_Chartered:_ 2026-07-26 · _Owner:_ Adam Schoen
_Jira epic:_ **RCP-54** (delivery/acceptance) · _Jira sprint:_ **"Sprint 4", id 43, board 168**
_Execution tickets:_ **KAN-155 · KAN-156 · KAN-157 · KAN-161** (KAN = execution, RCP = scope/acceptance)
_Status:_ ✅ **LOCKED via `/cs:grill-pm` — 7/7 branches confirmed by Adam, 2026-07-26.**
_Amended same day (see "Scope amendment" below):_ **KAN-161 added → WIP 4**, KAN-160 scheduled Sprint 5.
_Amended again 2026-07-30 (see "Grill amendment" below):_ **re-cut single-lane to KAN-155**, release
pulled in-box, **R7** added as the dominant risk, **KAN-181** filed as a behaviour-preservation charter.

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

## Grill amendment — 2026-07-30, single-lane re-cut

Second `/cs:grill-pm` pass, 6/6 branches confirmed by Adam. The charter below stands; what follows
amends how the remaining box is spent, and adds the risk that now dominates.

**Starting state, verified rather than assumed.** With ~1.5 days left in the box, all four committed
items had **zero implementation**. Every commit bearing `KAN-155/156/157/161` across `origin/dev`
and `origin/main` in **both** repos touches only `specs/SPRINT_*.md` and
`scripts/pm/check_sprint_lane.sh`. The engineering hours of 07-27→07-29 went to KAN-170/173/176 —
the P1 security preemption R4 reserved to Adam, correctly taken.

| #   | Amendment                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **Single-lane re-cut to KAN-155.** It is the only item breaking a user now. S2 is a cosmetic double toast, S3 is content hygiene, S4's own verification concluded exposure is **LATENT, not live** (see "KAN-161 — exposure verification", line 201). KAN-156/157/161 stay committed in sprint 43, are not pulled, and are **expected to roll** — recorded as a sizing data point per "Practical read on the timebox", line 38.                               |
| A2  | **No flow re-measure.** Over zero completions it returns the charter's own baseline. Two numbers only: KAN-155's **work item age — filed 2026-07-25, ~5 days against a p85 of 3 days, already an SLE breach**; and status reconciled first per charter row 2. **KAN-161 transitioned In Progress → To Do** — R2 drift, third occurrence, reporting WIP 4 when true WIP was 0.                                                                                 |
| A3  | **KAN-155 splits.** Agent-executable in-box: the R7 test pair, a distinct ownership-refusal signal instead of bare `None`, and an honest message replacing "Check your connection". **Blocked-on-Adam (a pause, not an attempt):** the true owner of prod row `62ccf6fc…`, and the ownership-repair policy. **Named trap: (a)+(b) alone make the P1 legible but still broken.** The close-out must not read "done" over a recipe that still will not publish. |
| A4  | **The release comes in-box** — and it is not a cost KAN-155 imposes. Cookbook `dev` is **13 commits ahead of `main`** with the KAN-170/173/176 posture work; the release was already owed. KAN-155 rides it.                                                                                                                                                                                                                                                  |
| A5  | **Review rounds are unbudgeted and unlimited, deliberately.** Capping them creates pressure to declare "ready" prematurely, which is the observed failure mode. The gate is on the failure instead: **"ready to merge" may not be said until every open thread on that PR has a posted reply.** Escalation trigger, not a cap — a **third round of substantive findings** on one PR means the change is wrong, not that review is slow.                       |

### Release train — Adam's corrected order (2026-07-30)

**Backend never fires a build on push to `main`. Only the cookbook tag push fires Cloud Build.**
Promoting the cookbook before Backend `main` therefore deploys a pointer to a SHA that is not on
Backend `main`.

```
1. Backend main → dev back-sync      (owed now: main is 1 ahead at 0de1e2b,
                                      and cookbook dev currently pins that main-only commit)
2. KAN-155 fix PR → Backend dev
3. Backend dev → main                 (NO build fires — lane move only)
4. Cookbook pointer bump → cookbook dev
5. Cookbook dev → main, v0.4.8        === tag → Cloud Build → deploy
```

**Forbidden anti-pattern, named because it already happened:** treating the Backend `main → dev`
back-sync as "too much trouble" and deferring Backend commits to the next tag. It is the cheapest PR
in the train, and skipping it is what puts the submodule pointer on `main`-only code.

Adam's ask for a ruleset blocking a cookbook merge to `main` without a tagged release is recorded on
**KAN-138**, which already owns release-train automation. Not built this sprint — charter row 7
forbids agent-initiated scope.

### R7 — the risk that now dominates

**The fix makes the symptom disappear by weakening the ownership check.** Six months later this
failed because `same_owner` at `db_recipe_repository.py:566-586` got relaxed, publish started
succeeding, the toast went away, the test went green, and we shipped a privilege escalation on
recipe rows. The ticket even supplies the rationale: one of its two candidate owners is a
legitimately-orphaned guest row; the other is a **different real human's account**. A fix that
cannot tell those apart is not a fix.

Mitigation is **two** tests, and the second is the load-bearing one:

- **(i)** orphaned guest row merged to this user at OAuth login → publish **succeeds**. Must **fail**
  on today's code.
- **(ii)** row owned by a **different authenticated account** → publish **still refused**, with the
  new distinct signal. Must pass **before and after** the fix, and must **fail** if `same_owner` is
  loosened.

Mutation-check both. With only (i), "green" and "correct" have come apart.

**R8** — the release carries 13 commits authored by other sessions. Read the actual payload before
step 5 and confirm the KAN-173/176 posture work is CI-only and cannot reach the deployed app at
runtime.

### KAN-181 — behaviour-preservation charter

Adam walked the full save → duplicate-toast → publish-refusal → unpublish → republish cycle live on
2026-07-29 and reported it **technically correct**. Filed as **KAN-181** (`Relates` → KAN-155,
labelled `not-sprint-4`, so it is outside committed scope and outside the lane assertion). Six
invariants INV-1…INV-6, all verified green in production.

**INV-4 is the one that binds this sprint:** when the row is owned by another account or session,
publish is **REFUSED** and no public page and no DB row is created. **The refusal is correct. Do not
loosen it.** In Adam's own scenario the refusal was right behaviour — the only defect on that path is
the message blaming his connection for a deliberate integrity refusal.

Adam's scope boundary, verbatim: _"KAN-155 is to check this cycle for a **new** recipe, not one that
predated the migrations that catch the loop in the first place."_ For rows predating the migrations,
the refusal is the designed trap firing as intended.

**No future change may loosen INV-1…INV-6 to make a symptom disappear.** Any PR relaxing an
ownership or duplicate check must show which invariant it preserves and how.

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

## Close-out — 2026-08-01

_Sprint 43 closed 2026-08-02T04:22Z. Box ran 2026-07-28T09:56Z → 2026-07-31T23:59Z._
**Result: 2 of 4 committed items delivered, 2 rolled. One of the two "delivered" has code behind it.**

| #      | Item                          | Jira             | Disposition                                                              |
| ------ | ----------------------------- | ---------------- | ------------------------------------------------------------------------ |
| **S1** | Publish "Recipe ID collision" | KAN-155 ↔ RCP-55 | ✅ **Delivered** — shipped in **v0.4.8**, 2026-07-30 21:25 PDT, in-box   |
| **S2** | Duplicate first-save toast    | KAN-156 ↔ RCP-56 | ✅ **Delivered** — walkthrough-verified by Adam; regression test owed    |
| **S3** | Dedup-suffix unpublish        | KAN-157 ↔ RCP-57 | ↩️ **Rolled** — in flight past the box (manual prod-data work)           |
| **S4** | IPv6 rate-limit keying        | KAN-161 ↔ RCP-58 | ↩️ **Rolled** — zero implementation                                      |

### What the gates said

Both machine gates from charter row 1 pass, and both were confirmed **failing before** the close-out
work started — a gate that already passes proves nothing.

- `bash scripts/pm/check_sprint_lane.sh sprint-4` → **exit 0**. **R1 did not recur**: the KAN/RCP lane
  held for a full sprint, the first time that is true. The assertion earned its keep.
- Close JQL `project in (KAN, RCP) AND labels = sprint-4 AND statusCategory != Done` → **zero rows**.

**The close JQL is answered by rolls, not by false Dones.** KAN-157/RCP-57 and KAN-161/RCP-58 shed
`sprint-4` and carry `rolled-from-sprint-4` + `sprint-5-candidate`. Dropping the label is what makes a
roll legible to the gate; keeping `rolled-from-sprint-4` is what stops the miss being erased. A rolled
item is no longer a Sprint 4 item — it is not a completed one.

### S1 — the one real delivery

Backend `9ceb360` split the ownership 409 into three client-actionable codes and added
`tests/test_recipe_ownership_publish.py` (118 lines); cookbook `b561a7d` stopped reporting a refused
publish as success, with `769a80f` / `31edf9c` fixing refusal copy and closing a weak verb-free
assertion. Promoted Backend `7b6347e` → cookbook pointer → **v0.4.8**.

**R7 held, and this is the sprint's most important negative result.** The dominant risk was that the
fix would make the symptom disappear by weakening `same_owner` — shipping a privilege escalation on
recipe rows. It did not. The refusal is **preserved**; what changed is that it is now *legible* and no
longer reported as success. INV-1…INV-6 are intact. The trap named in A3 — "the close-out must not read
'done' over a recipe that still will not publish" — is worth re-reading: for rows predating the
migrations, publish is still refused, **by design**.

### Evidence gaps — recorded, not smoothed over

1. **S2 is walkthrough-verified, and the regression test is still owed.** Adam confirmed he closed
   KAN-156 from a **live walkthrough** on 2026-08-01 — which is why the row moved To Do → Done directly,
   with no intermediate state, right after he set RCP-56 In Progress to work it. That is a legitimate
   close under charter row 7. What it is *not* is S2's chartered machine gate: no Vitest spec asserts
   "a first-time save emits exactly one toast", so nothing stops the duplicate toast returning the next
   time the save/publish signal path changes. **The test is carried into Sprint 5 as a retrospective
   action.** Recorded here because a walkthrough and a regression test are different guarantees, and the
   board shows both as "Done".
2. **RCP-55's title still asserts pre-amendment behaviour** — *"Publishing succeeds regardless of which
   account or guest session owns the row"* — which this sprint deliberately did **not** ship, and must
   not. Superseded by KAN-181 INV-4. Closed against amended acceptance; flagged for retitling on the
   ticket. Not retitled here, because rewriting an acceptance row to match what shipped is exactly the
   move that should require a human.

### Board correction — three rows were never committed scope

**RCP-64, KAN-194, KAN-195** carried the `sprint-4` label but were filed 2026-07-31 as walkthrough
round-3 findings. Charter **R4** sends round-3 findings to the backlog by default — that rule exists so
a sprint can close instead of absorbing every new finding, and it was silently violated by the labels.
Relabelled `walkthrough-round-3`. **All three remain open and unfixed**; only sprint membership changed.

**A correction worth keeping, because the mistake generalises.** RCP-57 read In Progress while
KAN-157 had no commits, and this close-out originally called that R2 status drift and reset RCP-57 to
To Do. **That was wrong.** Adam had set RCP-57 In Progress deliberately, because he was working the
item by hand: KAN-157 is manual production-data work, which produces **no commits no matter how much
of it is done**. The status was accurate and the reconciliation overwrote it. Both rows are now In
Progress, and the lane inconsistency was real but pointed the other way — KAN-157 should have moved
up, not RCP-57 down.

**Generalised rule: "no commits" is evidence of nothing for items whose deliverable is not code.**
Prod-data cleanups, console/IAM changes, business config and live walkthrough verification all look
identical to unstarted work in `git log`. Ask before inferring. R2's mitigation (KAN-97
auto-transition on PR merge) also cannot cover these items, since there is no PR to merge — a fact
worth carrying into the Sprint 5 design of it.

### The sizing data point — this board's first, and the only number worth quoting

**4 committed · 2 delivered · 1 with code.** KAN-155 was filed 2026-07-25 and shipped 2026-07-30:
**5 days work-item age against an SLE of p85 = 3 days — a breach**, and it was the single-lane priority.

**No forecast is quoted for Sprint 5, and that is the methodology holding rather than an omission.**
One sprint is not a distribution. The charter already withdrew a Monte Carlo forecast for borrowing
filtered KAN lifetime throughput to predict an **RCP** sprint — a lane with different granularity and
zero closed sprints. Sprint 4 produces exactly one data point against nothing. Say **"unavailable"**;
do not substitute a proxy. Trailing throughput remains contaminated by the 2026-07-26 batch
reconciliation and is still unusable.

**The honest read on the box:** four items sized at "roughly a day" produced one shipped fix in a
Tue→Fri box, while the engineering hours of 07-27→07-29 went to the KAN-170/173/176 security
preemption — the interruption R4 reserved to Adam, correctly taken. The sprint did not fail; the
estimate did. That is the signal A1 predicted when it recorded S2/S3/S4 as *expected to roll* with
~1.5 days left and zero implementation across all four.

### Risks — how they actually resolved

| ID     | Outcome                                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------------------------- |
| **R1** | **Did not recur.** Lane held a full sprint; `check_sprint_lane.sh` exit 0. Still a script, **not** a blocking CI gate.       |
| **R2** | **Recurred (4th time).** RCP-57 drifted from KAN-157. KAN-97 remains unbuilt — this is now a missing mechanism, not a lapse. |
| **R3** | **Held.** Hygiene stayed close-out work; the sprint closed on its committed set.                                            |
| **R4** | **Fired, correctly.** Round-3 findings (RCP-64/KAN-194/KAN-195) went to backlog — after a label correction, not by default.  |
| **R5** | **Not exercised** — KAN-157 never ran. The human approval gate on the exact 4 slugs carries forward untouched.               |
| **R6** | **Clear.** KAN-155 dragged no migration; single Alembic head throughout.                                                     |
| **R7** | **Held, and it mattered.** Ownership refusal made legible, not loosened. See S1.                                            |
| **R8** | **Cleared.** The v0.4.8 payload was read before promotion; KAN-173/176 posture work is CI-only.                             |

### Carried to Sprint 5

**KAN-157**, **KAN-161** (rolled, `sprint-5-candidate`) · **KAN-160** (chartered Sprint 5;
architectural, deliberately not sliced) · **KAN-97** auto-transition — the standing R2 fix, now four
occurrences overdue · **KAN-170** (P1 exposure; **blocks the value of KAN-161** — Express is not the
only metered path while Flask is directly addressable) · the S2 regression test, if Adam confirms
KAN-156 was closed from a live walkthrough.

Two label conventions to keep: `sprint-5-candidate` is **not** `sprint-5` — a `sprint-N` label asserts
membership in a sprint that has an RCP epic and an acceptance row, and Sprint 5 has neither yet. And
`rolled-from-sprint-4` is what makes the miss survive the close.
