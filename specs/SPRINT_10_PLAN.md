# Sprint 10 Plan — the launch sprint: Valkey fix, RUM, LCP, UI consistency, distribution

_Chartered:_ 2026-09-29 · _Owner:_ Adam Schoen
_Jira epic:_ **RCP-100** (delivery/acceptance)
_Acceptance rows:_ **RCP-98** (S1) · **RCP-101** (S2) · **RCP-102** (S3) · **RCP-103** (S4) · **RCP-104** (S5) · **RCP-105** (S6) · **RCP-106** (S7) · **RCP-107** (S8) · **RCP-108** (S9) · **RCP-109** (S10) · **RCP-110** (S11) · **RCP-111** (S12) · **RCP-112** (S13) · **RCP-113** (S14) · **RCP-114** (S15) · **RCP-115** (S16) · charter row **RCP-99**
_Delivery tickets:_ **KAN-268 · KAN-292 · KAN-293 · KAN-181 · KAN-294 · KAN-295 · KAN-296 · KAN-297 · KAN-298 · KAN-277 · KAN-299 · KAN-300 · KAN-301 · KAN-302 · KAN-303 · KAN-304** (KAN = execution, RCP = scope/acceptance); charter execution row **KAN-269**
_Jira sprint:_ **Sprint 10** — id **85** on board **168**, started 2026-09-29, box ends 2026-10-20 (America/Los_Angeles)
_Timebox:_ **No single-point date.** The sprint box is the timebox; the forecast below is a range.
_Status:_ **Active.** Chartered via `/cs:grill-pm`, 2026-09-29, on top of the locked product grill.
_Inputs:_ [`specs/discovery/sprint10/product-grill-2026-09-29.md`](./discovery/sprint10/product-grill-2026-09-29.md) (PR #3538; amends the [09-06 grill](./discovery/sprint10/product-grill-2026-09-06.md)) · [`specs/discovery/sprint10/ost.json`](./discovery/sprint10/ost.json) (`ost_linter.py`: STRUCTURALLY-SOUND, 11 opportunities, 0 violations) · [Sprint 9 Retrospective — 2026-09-29](https://tasteslikegood.atlassian.net/wiki/spaces/TLG/pages/81657858) (Confluence 81657858)

## Why this sprint exists

v0.5.0–v0.5.2 shipped the SEO audit work (KAN-270) outside any sprint, and the
duplicate loop that made the main CTA produce duplicate recipes is closed (KAN-265,
KAN-288, KAN-289). That removes the reason the site was held pre-launch. What stands
between the site and a launch post is now narrow and measurable:

1. **One production defect** gates the performance number: the Flask Valkey client
   fails IAM auth on ~51% of connects, putting image p95 at 9.6–11 s (KAN-268).
2. **No field measurement.** Nothing can grade a launch without RUM, and the
   privacy policy requires it behind consent.
3. **Mobile LCP is 3.1 s** on `/r/<slug>` and `/browse` against the 2.5 s exit number
   (down from 7.6 / 7.7 s on 2026-09-06).
4. **The site is inconsistent across the SPA/SSR boundary:** different nav, no visible
   breadcrumbs, unpaged lists, one-up cards on phones, no filter/sort.
5. **Nobody outside the author knows the site exists** (SEO audit B1).

## Committed scope — 16 SIs (11 chartered + S12–S16 added 2026-09-29)

| SI      | Grill # | Lane           | Summary                                                                                  | KAN     | Acceptance |
| ------- | ------- | -------------- | ---------------------------------------------------------------------------------------- | ------- | ---------- |
| **S1**  | 1       | Gates          | Flask Valkey IAM auth fix · **non-droppable**                                            | KAN-268 | RCP-98     |
| **S2**  | 2       | Gates          | Datadog RUM behind consent, SPA + SSR; live ≥ 7 days before launch                       | KAN-292 | RCP-101    |
| **S3**  | 3       | Gates          | Mobile LCP ≤ 2.5 s on `/r` and `/browse`, measured after S1                              | KAN-293 | RCP-102    |
| **S4**  | 5       | Gates          | KAN-181 INV-1…INV-9 re-walked on current production                                      | KAN-181 | RCP-103    |
| **S5**  | 6       | UI consistency | Header and footer nav parity across SPA and SSR                                          | KAN-294 | RCP-104    |
| **S6**  | 7       | UI consistency | Visible breadcrumbs in the SPA                                                           | KAN-295 | RCP-105    |
| **S7**  | 8       | UI consistency | Numbered pagination on `/browse` and tag hubs                                            | KAN-296 | RCP-106    |
| **S8**  | 9       | UI consistency | Mobile 2-up card layout                                                                  | KAN-297 | RCP-107    |
| **S9**  | 10      | UI consistency | Filter/sort: Kitchen client-side; `/browse?sort&tag` canonical to `/browse`              | KAN-298 | RCP-108    |
| **S10** | 13      | Distribution   | Owned-property links audited and completed + 3–5 articles under the grill Q6 rubric      | KAN-277 | RCP-109    |
| **S11** | 14      | Distribution   | Launch post — last, behind the four launch gates                                         | KAN-299 | RCP-110    |
| **S12** | —       | Process        | Workflow `secrets.*` references gated against `gh secret list`, wired into `pr-gate.yml` | KAN-300 | RCP-111    |
| **S13** | —       | Process        | CLAUDE.md PR lifecycle: read `pulls/<n>/reviews` bodies in full (suppressed findings)    | KAN-301 | RCP-112    |
| **S14** | —       | Process        | Delete the copied required-checks list from CLAUDE.md; name the live rulesets command    | KAN-302 | RCP-113    |
| **S15** | —       | Process        | Pre-work branch preflight: commits-behind `origin/dev` + Backend-pointer ancestry        | KAN-303 | RCP-114    |
| **S16** | —       | Process        | CLAUDE.md CI section: platform-vs-code discriminator                                     | KAN-304 | RCP-115    |

**No stretch items. No pre-authorised drops.** "Grill #" is the row number in the
product grill's scope table, kept so either document can be read against the other.

### S12–S16 were added at charter — 2026-09-29

The five undelivered Sprint 8 retro actions (carried as Sprint 9 retro action c).
**Adam ticketed all five into Sprint 10** rather than declining any. Each has its own
KAN row and acceptance row under RCP-100, both labelled `sprint-10`, and each is in
sprint 85. "Grill #" is "—" because they come from the retros, not the product grill.

### Cut before charter — Adam, 2026-09-29

| Grill # | Item                             | Disposition                                                                                                                                                                                                                                                                                                               |
| ------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4       | Recycle bin and delete integrity | **Dropped.** The recycle bin is dropped as a feature; delete and unpublish confirmations shipped in v0.5.2 (KAN-289). Bin code is still on `dev` (`kitchen.component.*`, `persistence.service.ts`); removing it is not Sprint 10 work.                                                                                    |
| 11      | Settings tab (model picker)      | **Deferred.** Not UI-consistency work. The 09-06 Q7 eval spec stands for when it is scheduled.                                                                                                                                                                                                                            |
| 12      | Duplicate hygiene                | **Dropped.** Adam unpublished the actual duplicates and curates competing recipes by hand. **Slug suffixing is unchanged:** two authors' distinct recipes whose slugs collide still get `-2`, including against a slug retired to the KAN-288 tombstone table. KAN-275 stays open as a follow-up audit of recipe hygiene. |

Also declined in the grill, in writing: KAN-227 per-PR preview URLs, canonical-recipes
phase 2 rubric scoring, and on-site article/blog pages.

### On the item count — read this before citing it as velocity

Sixteen rows (eleven product SIs plus the five process carry-overs) is a **tracking granularity, not a load signal** (Adam, 2026-09-29). Each
UI item has its own row so each can be accepted on its own evidence; earlier sprints
carried a whole category as one SI. Comparing row counts across sprints compares
bookkeeping, not work. No item was bundled to fit a cap (R-4).

## Charter (locked decisions)

The six `/cs:grill-pm` branches. Branch 1 was locked with Adam in the product grill;
branches 2–6 are locked by this project's standing conventions and are open to
override by Adam without re-chartering.

| #   | Branch      | Decision                                                                                                                                                                                                                                                                                                                                 | How locked                       |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| D1  | Outcome     | Exit number: **mobile LCP ≤ 2.5 s** (Lighthouse 12, simulated slow-4G) on `/r/<slug>`, `/browse`, `/`. Second tier (leading): non-brand GSC impressions ≥ 100 per 28 days; tag hubs + `/about` indexed per URL Inspection. North Star: recipes kept per week. **Done** = every acceptance row closed on its evidence + both gates below. | Confirmed (product grill Q1)     |
| D2  | Measurement | Flow measured before any forecast (next section): WIP, throughput, cycle time, age.                                                                                                                                                                                                                                                      | Convention; run 2026-09-29       |
| D3  | Forecast    | No single-point dates. The box is the timebox; the forecast is a p50/p85 range and changes attention, not scope.                                                                                                                                                                                                                         | Convention (Sprint 9 D3)         |
| D4  | Ownership   | **Adam owns and accepts every SI.** Agents execute; every PR is reviewed by Copilot and the Independent Claude review, and Adam merges. Rows move only with evidence on the ticket, AC by AC (retro action a).                                                                                                                           | Convention                       |
| D5  | Risk        | Pre-mortem below, each risk with an owner and a pre-stated response.                                                                                                                                                                                                                                                                     | This charter                     |
| D6  | Budgets     | **3 attempts per task, 12 iterations per goal, WIP ≤ 3.** Exhausted budgets escalate to Adam via `claude-code-agent-recipe-one@agentmail.to` with the evidence, never by silent retry.                                                                                                                                                   | Convention (WIP ≤ 3 / caps 3–12) |

## Forecast check (D2/D3) — run at charter time, 2026-09-29

`jira_snapshot_bridge.py --to flow --forecast 11` over KAN (resolved since 2026-07-01
or still open; 235 items):

| Measure                              | Value                                       |
| ------------------------------------ | ------------------------------------------- |
| WIP (open, started)                  | 18                                          |
| Throughput                           | 5.26 items/week over 27 weeks               |
| Cycle time (created → resolved)      | p50 4 d · p85 36 d · p95 106 d              |
| SLE (p85)                            | 36 d, 85.2% conformance                     |
| Monte Carlo, 11 items                | p50 2 weeks · p85 3 weeks · p95 4 weeks     |
| Monte Carlo, 16 items (with S12–S16) | **p50 2 weeks · p85 4 weeks · p95 5 weeks** |

The box is 3 weeks. The 11 product SIs sit at p85; **with S12–S16 the p85 is 4 weeks, one past the box.** The forecast counts items, not size: S12–S16 are three CLAUDE.md edits and two small scripts, so the real overrun risk is smaller than the item count says, but it is stated here rather than hidden. Sprint 9 closed 10 of 10.

**Caveats.** Cycle time is created→resolved, because the export carries no in-progress
timestamp, so it overstates active time. Throughput counts every KAN item, including
automation and report rows that are not sprint work. S2's 7-day RUM window and S11's
7-day readout are **calendar time no throughput can compress**: the launch post cannot
land before day 8 of RUM, and the readout lands 7 days after the post. If S2 is not
live by the end of week 1, the readout moves past the box. That is a known roll, not a
failure, and the close-out must say so in writing.

**WIP is 18 against a WIP limit of 3.** Most of it is stale (next section). The process
lane clears it; it is not sprint scope.

## Aging table (standing artifact — Sprint 6 retro action)

Committed and adjacent items, ages as of 2026-09-29 (created → today):

| Key     | Status      | Age | Note                                                                                                                |
| ------- | ----------- | --- | ------------------------------------------------------------------------------------------------------------------- |
| KAN-181 | In Progress | 61  | S4. Last invariant evidence 2026-08-01, before KAN-265/288/289                                                      |
| KAN-250 | In Progress | 35  | Process lane (retro f): close against the Sprint 9 S3 amendment                                                     |
| KAN-268 | To Do       | 23  | S1. Filed at the 09-06 grill; no fix on Backend `dev`                                                               |
| KAN-269 | In Progress | 23  | Charter row; closes with RCP-99                                                                                     |
| KAN-277 | In Progress | 16  | S10. README link shipped v0.5.0; the rest is open                                                                   |
| KAN-271 | In Review   | 16  | Process lane (retro d): close on v0.5.0 evidence; S3 carries the residual                                           |
| KAN-272 | In Review   | 16  | Process lane (retro d)                                                                                              |
| KAN-273 | In Review   | 16  | Process lane (retro d)                                                                                              |
| KAN-274 | In Review   | 16  | Process lane (retro d)                                                                                              |
| KAN-276 | In Review   | 16  | Process lane (retro d)                                                                                              |
| KAN-275 | To Do       | 16  | Grill #12, dropped from Sprint 10; kept open as a follow-up audit of recipe hygiene (`follow-up` label)             |
| KAN-290 | To Do       | 1   | Grill #4, dropped from Sprint 10; kept open as a follow-up audit of the recycle-bin/delete path (`follow-up` label) |

## Launch gates and the pre-registered 7-day readout (grill Q2 + Q5)

**The launch post (S11) goes last, behind four gates, all evidenced on their rows:**

1. S1 / KAN-268 fixed (RCP-98 Done).
2. S2 RUM live **≥ 7 consecutive days** (RCP-101 Done).
3. S4 KAN-181 re-walk done on current production (RCP-103 Done).
4. The UI-consistency lane S5–S9 done (RCP-104…RCP-108 Done).

**Pre-registered readout** — written here before the post, graded 7 days after it.
Nothing below may be changed once the post is live.

| Kind       | Measure                                                                | Healthy              | Failing     |
| ---------- | ---------------------------------------------------------------------- | -------------------- | ----------- |
| Grade      | Recipes kept in the 7 days after launch vs the pre-launch RUM baseline | Above baseline       | At or below |
| Grade      | View → save on `/r/<slug>` for launch-referred sessions                | ≥ 2 %                | < 0.5 %     |
| Diagnostic | Referral sessions by source; GSC non-brand impressions                 | Reported, not graded | —           |
| Guardrail  | Field LCP p75                                                          | ≤ 2.5 s              | > 2.5 s     |
| Guardrail  | Image endpoint p95                                                     | < 2 s                | ≥ 2 s       |
| Guardrail  | New statistically identical public pair (sitemap sweep)                | None                 | Any         |

**Minimum sample (pre-registered):** view → save is graded only if the window holds ≥ 100 launch-referred `/r/<slug>` views; below that it is reported as **inconclusive** with its n. Recipes kept is graded against the baseline only if the baseline week is non-zero; otherwise both counts are reported and the grade is inconclusive. Raw visits and upvotes are not the grade.

## Risks and committed mitigations (pre-mortem, D5)

_"It is three weeks from now and Sprint 10 failed. Why?"_

| #   | Risk                                                                                                                                             | Owner | Response (pre-stated)                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | KAN-268's root cause is not the token window, and the fix slips — S1 gates S3 and the launch                                                     | Adam  | S1 starts day 1 as the only Gates-lane WIP. Root cause is written on KAN-268 before the fix merges (RCP-98 AC).                                                                                                                                                                                                                                                       |
| R2  | The RUM consent UI grows past half a day and holds S2's 7-day clock                                                                              | Adam  | Pre-stated flip: ship analytics opt-in only; do not hold the launch for consent-UI polish.                                                                                                                                                                                                                                                                            |
| R2a | Datadog RUM is a new billed product (no free tier; no RUM app existed on 2026-09-29) and cost scales with sessions, peaking with the launch post | Adam  | **Cost accepted, S2 re-accepted as written (Adam, 2026-09-29).** RUM Measure only: $0.15 per 1k sessions annual, about $0.22 on-demand; Investigate and Session Replay are not used. A session sample rate is the lever if the launch spike needs capping. Declined alternatives: first-party web-vitals + save-referrer logging, Cloudflare Web Analytics (both $0). |
| R3  | S1 alone fixes LCP, and S3 turns into invented work to justify its row                                                                           | Adam  | Pre-stated flip: S3 closes evidence-only on a Lighthouse run showing ≤ 2.5 s.                                                                                                                                                                                                                                                                                         |
| R4  | UI items land in both the SPA and SSR templates and conflict, or regress LCP                                                                     | Adam  | Lane map below keeps S5–S9 serial per surface; S8 re-runs Lighthouse on `/browse` (RCP-107 AC).                                                                                                                                                                                                                                                                       |
| R5  | A PR merges to `dev` while a release PR is open and ships silently, outside the CHANGELOG                                                        | Adam  | Re-list open PRs before every release decision; the release freeze opens at the version bump (RUNBOOK step 6).                                                                                                                                                                                                                                                        |
| R6  | Rows move without evidence again (the Sprint 9 retro's main finding)                                                                             | Adam  | Retro action (a): the closing comment lists every AC number with a link. The full hard gate is read at close, not the charter mode.                                                                                                                                                                                                                                   |
| R7  | The launch post goes out before a gate is actually green                                                                                         | Adam  | RCP-110's first AC is the four gate rows Done; KAN-299 does not start until they are.                                                                                                                                                                                                                                                                                 |

## Lane map (assign before any parallel session)

WIP ≤ 3, one session per lane:

| Lane             | SIs, in order                                           | Surface                                     |
| ---------------- | ------------------------------------------------------- | ------------------------------------------- |
| A — Gates        | S1 → S3 → S4; S2 in parallel                            | Backend (S1), `index.html`/SSR base (S2)    |
| B — UI           | S5 → S6 → S7 → S8 → S9                                  | SPA shell + SSR templates, serial by design |
| C — Distribution | S10 through the sprint → S11 last                       | Off-site; no repo conflicts                 |
| D — Process      | S14 → S13 → S16 (CLAUDE.md, serial); S15, S12 (scripts) | CLAUDE.md, `scripts/git/`, `pr-gate.yml`    |

## Execution order

1. **Day 1:** S1 (KAN-268) and S2 (RUM) start. S2's 7-day clock is the long pole.
2. **Lane B** starts in parallel with S5, because nav parity touches every later UI item.
3. **After S1 releases:** S3 is measured (flip R3), then S4 re-walks production.
4. **S10** ships deliverables as they are ready. KAN-277 is the parent; **every owned-property link and every article gets its own child KAN row** (see S10 acceptance below).
5. **S11** starts only when the four gates are Done.
6. **S12–S16** fill WIP slack. S15 (the preflight) goes first, because it protects every later branch.

## Acceptance criteria

Each SI's acceptance lives on its RCP row, which is authoritative. The summaries below
are for reading, not for closing. A row closes AC by AC, with evidence per AC.

- **S1 / RCP-98:** Backend fix merged, promoted, pinned, released; Datadog production 24 h: `redis.command` error rate < 1 %, PING p50 < 50 ms, image p95 < 2 s; root cause written on KAN-268.
- **S2 / RCP-101:** zero RUM requests before consent (unit test + production network capture); RUM sessions visible for SPA and SSR views; ≥ 7 consecutive days live before S11.
- **S3 / RCP-102:** Lighthouse 12 mobile slow-4G LCP ≤ 2.5 s on `/r/<slug>`, `/browse`, `/`, measured on the release that includes S1.
- **S4 / RCP-103:** INV-1…INV-9 each walked on current production, with pass/fail and evidence per invariant on KAN-181; any failure filed as its own bug.
- **S5 / RCP-104:** a test asserts identical header/footer link sets in the SPA shell and SSR base template; production check across SPA and SSR routes.
- **S6 / RCP-105:** visible breadcrumb on SPA recipe detail and collection views, matching the SSR `BreadcrumbList`.
- **S7 / RCP-106:** SSR numbered `?page=N` anchors, self-canonical per page, out-of-range behaviour decided and tested.
- **S8 / RCP-107:** two cards per row at 360 and 414 px on `/browse`, a tag hub and `/kitchen`, with no horizontal scroll; S3 LCP not regressed.
- **S9 / RCP-108:** Kitchen filter/sort works; `/browse?sort&tag` returns 200 with `rel=canonical` to `/browse`; `/browse/tag/<tag>` keeps its own canonical.
- **S10 / RCP-109:** KAN-277 is the **parent**. The owned-property audit lists every property, and **each missing link and each article gets its own child KAN row**, labelled `sprint-10` and Relates-linked to both KAN-277 and RCP-109. The README link shipped in v0.5.0 does not count. Per child: the source contains the link and the link resolves 200 to the canonical URL; articles also carry the completed Q6 rubric. S10 is complete only when the audit is complete, every missing link is shipped or explicitly dispositioned, and 3–5 articles pass Q6. **How the child set is verified:** `check_sprint_lane.sh` fails on any `sprint-10` KAN child not linked to an RCP row, so no child can exist untracked; RCP-109 closes only with a comment listing every child key against the audit list, each with its Done evidence, and the JQL `issue in linkedIssues(RCP-109) AND project = KAN AND statusCategory != Done` returning nothing (KAN-277 included). The hard gate sees only the parent, so it is not the check for children.
- **S11 / RCP-110:** four gate rows Done before posting; post URL(s) recorded; readout written 7 days later against the table above.
- **S12 / RCP-111:** a check greps workflows for `secrets.[A-Z_]+`, diffs against `gh secret list`, is wired into `pr-gate.yml` and `gate.needs`, and has been seen to fail once for the reason it exists.
- **S13 / RCP-112:** CLAUDE.md's PR lifecycle requires reading `pulls/<n>/reviews` bodies in full before a PR is declared review-debt-zero.
- **S14 / RCP-113:** CLAUDE.md enumerates no required-check list; it names `gh api repos/{owner}/{repo}/rulesets` as the source of truth.
- **S15 / RCP-114:** one `scripts/git/` preflight reports commits-behind `origin/dev` and fails on a Backend-pointer rollback; seen to fail on a stale branch and pass on a fresh one; referenced from the session-start steps.
- **S16 / RCP-115:** CLAUDE.md's CI section documents the platform-vs-code discriminator with its two API calls.

## Sprint 9 retro actions — row-by-row disposition

Verbatim from the [Sprint 9 Retrospective](https://tasteslikegood.atlassian.net/wiki/spaces/TLG/pages/81657858), "Actions for Next Sprint":

| #   | Action (verbatim, abridged only where marked …)                                                                                                                                                                                      | Success measure                                                                                                            | Disposition                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | Close an acceptance row AC by AC. The Done comment enumerates every numbered AC with its evidence; an AC without evidence keeps the row open or is amended in writing by Adam.                                                       | Every Sprint 10 acceptance row's closing comment lists each AC number with a link or command output.                       | **Committed.** D4 + R6; every acceptance row created 2026-09-29 carries it in its description.                                                                          |
| b   | Write the retro in the close-out session. No close-out checkbox is ticked without a link to the thing it claims.                                                                                                                     | Sprint 10 retro page exists under 50298881 on the day Sprint 10 closes; every ticked close-out box links its evidence.     | **Committed.** Close-out checklist below.                                                                                                                               |
| c   | Ticket the undelivered Sprint 8 actions or decline them explicitly — secrets-reference gate (4), CLAUDE.md suppressed-comment step (3), delete the copied checks list (5), Backend-pointer preflight (6), platform-vs-code note (7). | Each of the five is either a KAN row labelled sprint-10 or named as declined, with a reason, in `specs/SPRINT_10_PLAN.md`. | **Committed (Adam, 2026-09-29): all five ticketed into Sprint 10** as S12–S16 (KAN-300…304, RCP-111…115). None declined.                                                |
| d   | Charter before shipping. Charter Sprint 10 under KAN-269 and fold the unsprinted SEO work in: move KAN-271/272/273/274/276 to Done against the v0.5.0–v0.5.2 release evidence.                                                       | Sprint 10 exists on board 168 with its epic and acceptance rows; no KAN-27x SEO row is In Review for work already live.    | **Half done at charter.** Sprint 10 (id 85), RCP-100 and the acceptance rows exist. KAN-271…276 close in the process lane, each on its own release evidence (AC by AC). |
| e   | KAN-268 first — the defect S2's skipped measurement would have found. Already rank 1 in the Sprint 10 grill (RCP-98).                                                                                                                | Production: Valkey AuthenticationError rate ~0 over 7 days and image endpoint p95 < 2 s (RCP-98's own bar).                | **Committed as S1.**                                                                                                                                                    |
| f   | Clear Sprint 9 board residue: KAN-250 closed against the amendment (Cloud Deploy work lives on KAN-227); RCP-58 closed on KAN-161's evidence; delete duplicate page 67108866.                                                        | Zero sprint-9 rows not Done; RCP-58 resolved; page 67108866 gone.                                                          | **Process lane.**                                                                                                                                                       |
| g   | Fix harness check T9's repo scope before reusing the harness — Backend-only tickets need `-R adamtasteslikegood/tasteslikegood.com`.                                                                                                 | `SPRINT_10_HARNESS_PLAN.json` artifact checks for Backend-only tickets pass `-R`; `plan_qa.py` passes.                     | **Process lane**, and only if a Sprint 10 harness plan is compiled. The charter's gates (below) do not depend on the harness.                                           |

## Process lane (no SI slot)

| Item                                                                                                                                                                                                                                                                                                                                                                                                                                               | Source        | Status                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------- |
| Close KAN-271/272/273/274/276 on v0.5.x evidence                                                                                                                                                                                                                                                                                                                                                                                                   | Retro d       | Open                                                            |
| KAN-250 closed against the S3 amendment; RCP-58 on KAN-161's evidence; page 67108866 deleted                                                                                                                                                                                                                                                                                                                                                       | Retro f       | Open                                                            |
| Harness T9 `-R` scope                                                                                                                                                                                                                                                                                                                                                                                                                              | Retro g       | Open, conditional                                               |
| S8 action 4 — secrets-reference gate                                                                                                                                                                                                                                                                                                                                                                                                               | Retro c       | Ticketed as S12 (KAN-300); tracked in committed scope, not here |
| S8 action 3 — CLAUDE.md suppressed-comment step                                                                                                                                                                                                                                                                                                                                                                                                    | Retro c       | Ticketed as S13 (KAN-301); tracked in committed scope, not here |
| S8 action 5 — delete the copied checks list                                                                                                                                                                                                                                                                                                                                                                                                        | Retro c       | Ticketed as S14 (KAN-302); tracked in committed scope, not here |
| S8 action 6 — Backend-pointer preflight                                                                                                                                                                                                                                                                                                                                                                                                            | Retro c       | Ticketed as S15 (KAN-303); tracked in committed scope, not here |
| S8 action 7 — platform-vs-code note                                                                                                                                                                                                                                                                                                                                                                                                                | Retro c       | Ticketed as S16 (KAN-304); tracked in committed scope, not here |
| Follow-up audits, outside Sprint 10 (Adam, 2026-09-29): KAN-290 — state of recycle-bin delete (where bin code still lives, what DELETE does for private/published/reserved-slug rows, whether the recorded defects reproduce); KAN-275 — state of recipe hygiene (sitemap sweep for identical pairs, competing clusters, every public `-<digit>` slug checked as distinct or copy). Each ends in a state report; fixes are filed as their own rows | Grill #4, #12 | Open, not labelled `sprint-10`                                  |
| KAN-259's overdue NAT measurements                                                                                                                                                                                                                                                                                                                                                                                                                 | Grill         | Open                                                            |
| PR #3537 (KAN-291 follow-ups)                                                                                                                                                                                                                                                                                                                                                                                                                      | Grill         | Open PR                                                         |

## Gates

Both run at charter and again at close. Each was made to fail first:

```bash
bash scripts/pm/check_sprint_lane.sh                        # lane: every sprint-10 KAN row linked to RCP
python3 scripts/harness/sprint10_hard_gate.py --charter     # day 1: sprint active, members, board-rendered rows
python3 scripts/harness/sprint10_hard_gate.py               # close: the above AND nothing in To Do
```

`sprint10_hard_gate.py` is the Sprint 10 successor of `sprint9_hard_gate.py`: same
rules, Sprint 10 constants, no pre-authorised drops, plus `--charter`. Rule 3 (nothing
in To Do) is the close gate by design, so on day 1 it is **expected red**.
`--charter` runs rules 1, 2 and 4 with the sprint required `active`.

**Day-1 evidence, 2026-09-29:**

| Run                                  | Before the sprint existed / started                                                     | After start (sprint 85 active)                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `sprint10_hard_gate.py --charter`    | exit 1 — "Sprint 10 does not exist on board 168"; then exit 1 — "Sprint 10 is 'future'" | **exit 0** — 11 acceptance rows board-rendered; re-run after S12–S16: 16                                                              |
| `check_sprint_lane.sh`               | —                                                                                       | **exit 0** — 24 members carry `sprint-10`, 12 open KAN rows, 0 orphans; re-run after S12–S16: 34 members, 17 open KAN rows, 0 orphans |
| `sprint10_hard_gate.py` (close form) | —                                                                                       | exit 1 — 21 items in To Do (expected on day 1)                                                                                        |

## Close-out

Not done until every box links its evidence (retro action b):

- [ ] Every acceptance row closed AC by AC, or amended in writing by Adam
- [ ] `sprint10_hard_gate.py` (close form) exit 0; `check_sprint_lane.sh` exit 0 — output pasted
- [ ] Exit number measured: Lighthouse LCP on `/r/<slug>`, `/browse`, `/`
- [ ] Launch readout written against the pre-registered table (or its roll stated, per the forecast caveat)
- [ ] Aging table updated with final dispositions
- [ ] Process-lane rows closed or carried with a reason
- [ ] Sprint 10 retrospective page created under Confluence 50298881 from template 50495489, on close-out day
