# Sprint 11 Plan — the readiness sprint: stability, UI, crawl discovery, recipe feedback

_Chartered:_ 2026-10-09 · _Owner:_ Adam Schoen
_Jira epic:_ **RCP-123** (delivery/acceptance)
_Acceptance rows:_ **RCP-125** (S1) to **RCP-147** (S23) in order · **RCP-117** (S24) · **RCP-148** (S25) · **RCP-149** (S26) · **RCP-150** (S27) · charter row **RCP-124**
_Delivery tickets:_ listed per SI in [Committed scope](#committed-scope--27-sis) (KAN = execution, RCP = scope/acceptance); charter execution row **KAN-350**
_Jira sprint:_ **Sprint 11** — id **121** on board **168**, started 2026-10-09, box ends 2026-10-23
_Timebox:_ **No single-point date.** The sprint box is the timebox; the forecast below is a range.
_Status:_ **Open.**
_Inputs:_ `/cs:grill-pm` with Adam, 2026-10-09 (six branches, locked below) · [Sprint 10 Retrospective — 2026-10-09](https://tasteslikegood.atlassian.net/wiki/spaces/TLG/pages/89456659) (Confluence 89456659) · [`specs/SPRINT_10_PLAN.md`](./SPRINT_10_PLAN.md) close-out · [`docs/seo/SEO_DRIVER_REVIEW_2026-10-03.md`](../docs/seo/SEO_DRIVER_REVIEW_2026-10-03.md) (KAN-325) · [`docs/designs/recipe-feedback.md`](../docs/designs/recipe-feedback.md)

## Why this sprint exists

Sprint 10 closed with production fast and stable (v0.5.8), and with the launch post
still unpublished. Three things stand between the site and sending strangers to it:

1. **Saves can fail without saying so.** A generator save during a slow startup auth
   check reports success and stores nothing (KAN-306). Cookbook membership, manual
   entry and duplicate saves do the same when a sync fails (KAN-333). A launch post
   sends traffic straight into these paths.
2. **Google has not crawled the tag hubs.** On 2026-10-09 `/browse/tag/breakfast` was
   "Discovered – currently not indexed", never crawled, with 0 referring URLs. The hubs
   return 200, are self-canonical and are in the sitemap; nothing Google visits links
   them. The home page links 0 hubs and a recipe page links 1.
3. **Nobody who cooks a recipe can say so on the site.** The recipe-feedback design was
   approved on 2026-10-04 and then stopped: the security hotfix took its eng-review
   session, and it had no Jira ticket until this charter (KAN-345).

Sprint 10 held the launch post and the articles in the same sprint as this work, and
Adam's read at the grill was that the pressure was too high: "a story item that is too
big is an epic in disguise". So the work is split. **Sprint 11 makes the site ready
for traffic. Sprint 12 writes the articles and publishes the launch post**, under epic
RCP-119, chartered when this sprint closes.

## Committed scope — 27 SIs

SI numbers are tracking numbers. The order of work is in [Ordered list](#ordered-list).
Size is a sort, not an estimate: **Q** quick, **S** standard, **M** major.

| SI      | Lane      | Size | Summary                                                                                      | KAN                       | Acceptance |
| ------- | --------- | ---- | -------------------------------------------------------------------------------------------- | ------------------------- | ---------- |
| **S1**  | Crawl     | Q    | Footer and home page link the tag hubs in the first HTML response                            | KAN-319                   | RCP-125    |
| **S2**  | Crawl     | S    | Public recipe pages link the hubs at the top and the bottom                                  | KAN-349                   | RCP-126    |
| **S3**  | Crawl     | M    | Home page newest-recipes row, ordered by `first_published_at`                                | KAN-348                   | RCP-127    |
| **S4**  | Stability | S    | A generator save during the deferred startup auth check is persisted                         | KAN-306                   | RCP-128    |
| **S5**  | Stability | S    | Saves that fail to reach the server say so (cookbook membership, manual entry, duplicate)    | KAN-333                   | RCP-129    |
| **S6**  | Stability | S    | Rate-limiter follow-up from the v0.5.8 review (detail on the ticket)                         | KAN-335                   | RCP-130    |
| **S7**  | UI        | Q    | Recipe view has a labelled Add to Cookbook button                                            | KAN-341                   | RCP-131    |
| **S8**  | UI        | Q    | Public recipe pages have Previous and Next links                                             | KAN-342                   | RCP-132    |
| **S9**  | UI        | Q    | Browse pages carry a plain-text page-number nav in the header                                | KAN-343                   | RCP-133    |
| **S10** | UI        | Q    | Profile menu "Switch user" signs in through Google's account chooser                         | KAN-344                   | RCP-134    |
| **S11** | Stability | Q    | Publish toggle shows the server's state; legacy manual rows get the right explanation        | KAN-334                   | RCP-135    |
| **S12** | Stability | S    | Backend review follow-ups from the publish-gate release                                      | KAN-336                   | RCP-136    |
| **S13** | Stability | S    | Publish-audit and write-pause operations are in the deploy; the runbook matches the day      | KAN-337                   | RCP-137    |
| **S14** | Stability | M    | Recycle bin survives reloads, logouts and devices; failed deletes show; restore unpublished  | KAN-290                   | RCP-138    |
| **S15** | SEO       | Q    | Recipe JSON-LD carries the Google-recommended fields                                         | KAN-320                   | RCP-139    |
| **S16** | SEO       | S    | Recipe pages are not crawl dead-ends; the seven rich-result warnings each filled or declined | KAN-273                   | RCP-140    |
| **S17** | SEO       | Q    | Home page ships as the generator landing page (ship criteria)                                | KAN-272                   | RCP-141    |
| **S18** | SEO       | Q    | Tag hubs ship: 200, self-canonical, in the sitemap (ship criteria)                           | KAN-274                   | RCP-142    |
| **S19** | SEO       | Q    | SPA-only routes are served `noindex` (ship criteria)                                         | KAN-276                   | RCP-143    |
| **S20** | SEO       | S    | Crawl-evidence instrument: verified Googlebot fetches by path prefix, weekly                 | KAN-347                   | RCP-144    |
| **S21** | Process   | Q    | gh-aw upgraded and the three agentic workflows recompiled                                    | KAN-323                   | RCP-145    |
| **S22** | Links     | Q    | Docker Hub, YouTube and the owned Meta profiles link the site                                | KAN-311, KAN-312, KAN-313 | RCP-146    |
| **S23** | Proof     | M    | Tested-recipe marker and authorship on `/about` (code half of E1)                            | KAN-346                   | RCP-147    |
| **S24** | Links     | Q    | Pinterest pin variant as a 1:1 centre crop, no blurred bars                                  | KAN-309                   | RCP-117    |
| **S25** | Feedback  | S    | Recipe feedback: pre-build steps (eng review, design review, R3-3 to R3-8, the Assignment)   | KAN-345                   | RCP-148    |
| **S26** | Exit      | S    | Readiness walk on production; mobile LCP medians; hub-link counts                            | KAN-351                   | RCP-149    |
| **S27** | Feedback  | M    | Recipe feedback Phase 1 build: cooked entry, stars, held notes, public summary               | KAN-356                   | RCP-150    |

**No stretch items. No pre-authorised drops.** No item was bundled to fit a count. S22
is one deliverable (every owned property links the site) with one execution row per
property.

### Changed during chartering — 2026-10-09 (Adam)

- **S27 (KAN-356) added.** The grill had the feedback build "decided at the Sprint 12
  charter". A side note pointed out that the people Adam invites to cook now would have
  nowhere to leave feedback, and that the launch could go out before the feature exists.
  Adam: "feedback should be built add it as a row to sprint 11". S25 keeps the pre-build
  steps and comes first; the build PR opens only after both reviews are linked on RCP-148.
  RCP-148's "no build PR in Sprint 11" criterion is replaced on the ticket.
- **S2's reading is open.** KAN-349 assumes both readings of "every recipe should link to
  all hubs, top and bottom": the recipe's own tag hubs, and the full row of 12 hubs. Adam
  confirms or narrows it on KAN-349 before the build PR opens. S26's hub-link number for
  recipe pages follows that answer.

### What is not in Sprint 11

These stay under **RCP-119** for Sprint 12. The hard gate fails if one is in the sprint.
Jira sprint **Sprint 12** (id **122**, board 168) exists as a future sprint, not started,
and holds these rows, so work that does not finish in Sprint 11 has somewhere to land
(Adam, 2026-10-09; Sprint 10 retro action 1).

| Ticket            | What                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| KAN-277 / RCP-109 | The 3 to 5 articles under the Q6 rubric. The links half is S22.                                                                           |
| KAN-299 / RCP-110 | Launch post and 7-day readout. The pre-registered readout table in the Sprint 10 plan is unchanged.                                       |
| KAN-352           | Cooking half of the tested-recipe proof: 10 to 15 recipes cooked, noted, photographed. Split from KAN-346; Adam starts cooking in week 1. |

### On the item count

Twenty-seven rows is tracking granularity, not load (Adam, 2026-09-29). S16 to S19
shipped in Sprint 10 and need evidence, not a build. S7, S8 and S10 are built and need
review and a release. Five rows are major: S3, S14, S23, S27, and S2 if the full-row
reading holds.

## Charter (locked decisions)

The six `/cs:grill-pm` branches, each confirmed by Adam on 2026-10-09.

| #   | Branch      | Decision                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Outcome     | **The readiness walk passes on production** (S26): one scripted stranger journey, on a phone and on a desktop, with zero silent failures, run after S4, S5 and S6 are Done on production. Plus the **median of 5** mobile Lighthouse runs per page is at most 2.5 s, and the home page and recipe pages link the hubs. **Done** = every acceptance row closed on its evidence, and both gates below exit 0. |
| D2  | Measurement | Flow measured before any forecast (next section): WIP, throughput, cycle time, age.                                                                                                                                                                                                                                                                                                                         |
| D3  | Forecast    | No single-point dates, no estimates. The forecast is a p50/p85 range and changes attention, not scope. Items are sorted quick, standard, major. There is one ordered list. **An unplanned level-1 production item displaces work from the bottom of that list, and the displaced items are named in this plan the same day.**                                                                               |
| D4  | Ownership   | **Adam owns and accepts every SI.** Agents execute; every PR is reviewed by Copilot and an independent Claude review, and Adam merges. Rows move only with evidence on the ticket. The pieces only Adam can do have dates in week 1 ([Dated list](#dated-list)).                                                                                                                                            |
| D5  | Risk        | Pre-mortem below, each risk with a pre-stated response.                                                                                                                                                                                                                                                                                                                                                     |
| D6  | Budgets     | **3 attempts per task, 12 iterations per goal.** Exhausted budgets escalate to Adam via `claude-code-agent-recipe-one@agentmail.to` with the evidence. **WIP ≤ 3 counts only items an agent is actively building.** An item waiting on a date or on Adam sits on the dated list and holds no slot.                                                                                                          |

**A silent failure** is a save that reports success and is absent after a reload.

## Forecast check (D2/D3) — run at charter time, 2026-10-09

`jira_snapshot_bridge.py --to flow --as-of 2026-10-09 --forecast 28 --seed 11` over KAN
(resolved since 2026-07-01 or still open; 289 items). 28 is the 27 SIs plus the charter.

| Measure                         | Value                                       |
| ------------------------------- | ------------------------------------------- |
| WIP (open, started)             | 19                                          |
| Throughput                      | 6.3 items/week over 28.4 weeks              |
| Cycle time (created → resolved) | p50 4 d · p85 33 d · p95 106 d              |
| SLE (p85)                       | 33 d, 85.5% conformance                     |
| Monte Carlo, 28 items           | **p50 3 weeks · p85 4 weeks · p95 6 weeks** |

**The box is 2 weeks and the p50 is 3.** By count, the box is more likely than not to
close with rows still open. That is stated here, not hidden, and it changes attention,
not scope: the ordered list says what is worked first, so what is left at the box's end
is the bottom of that list. The count overstates the load in one way (seven rows are
shipped or built) and understates it in another (five are major, and S27 was added
after the box was set). Sprint 10 closed 19 of 19 in 11 days, with about 80% of its
effort on an unplanned security hotfix.

**Caveats.** Cycle time is created→resolved, because the export carries no in-progress
timestamp. Throughput counts every KAN item, including automation and report rows.
Google's crawl is calendar time no throughput can compress, which is why S1, S17, S18
and S19 close on ship criteria and the Google checks have their own dated rows.

**WIP is 19.** The oldest started items are not sprint work: KAN-188 (71 d), KAN-199
(69 d), KAN-212 (62 d), KAN-261 (39 d). They are in the process lane below.

## Aging table (standing artifact — Sprint 6 retro action)

Committed items that existed before this charter, ages as of 2026-10-09 (created → that
day). Rows filed on 2026-10-09 (KAN-345 to KAN-356) are age 0.

| Key                    | Status      | Age | Note                                                         |
| ---------------------- | ----------- | --- | ------------------------------------------------------------ |
| KAN-272, 273, 274, 276 | In Review   | 26  | S16 to S19. Shipped in v0.5.x; carried from Sprint 10        |
| KAN-290                | To Do       | 11  | S14. Not started                                             |
| KAN-306                | To Do       | 10  | S4. Orphaned in Sprint 10; first stability precondition      |
| KAN-309, 311, 312, 313 | To Do       | 10  | S24, S22. Carried to RCP-119 on 2026-10-01, now in Sprint 11 |
| KAN-319                | To Do       | 8   | S1                                                           |
| KAN-320                | In Progress | 8   | S15                                                          |
| KAN-323                | To Do       | 8   | S21                                                          |
| KAN-333 to KAN-337     | To Do       | 2   | S5, S11, S6, S12, S13. From the v0.5.8 reviews               |
| KAN-341, 342, 344      | In Progress | 1   | S7, S8, S10. Built; Backend half merged 2026-10-08           |
| KAN-343                | To Do       | 1   | S9                                                           |

## Ordered list

One list, worked top to bottom. A row lower down starts only when a slot is free.

| Rank | SI                 | Why here                                                                                                                                                    |
| ---- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | S1 → S2 → S3       | Crawl-discovery lane. One session, in this order: all three change the same SSR templates and `index.html`. Google's clock starts only when these are live. |
| 2    | S4, S5, S6         | Stability preconditions of the readiness walk and of the launch post.                                                                                       |
| 3    | S25                | The two reviews start in week 1 because S27 waits on them. The Assignment is Adam's, dated below.                                                           |
| 4    | S21                | Process lane, worked in week 1 (retro action 4): planned to start by 2026-10-13.                                                                            |
| 5    | S7, S8, S10, S9    | Built or small. They ride the first release after Adam's staging checks.                                                                                    |
| 6    | S27                | Starts when both reviews are linked on RCP-148.                                                                                                             |
| 7    | S16, S15           | S16's fill-or-decline (Adam, dated) sets S15's scope.                                                                                                       |
| 8    | S20                | The only crawl evidence available inside the box.                                                                                                           |
| 9    | S14, S23           | Major; each starts with a recorded design decision or review.                                                                                               |
| 10   | S17, S18, S19      | Evidence only.                                                                                                                                              |
| 11   | S22                | Adam's profile edits, dated below; agents verify.                                                                                                           |
| 12   | S11, S12, S13, S24 | **The bottom of the list. An unplanned level-1 item displaces from here upward.**                                                                           |
| —    | S26                | The exit check. Run when S4, S5 and S6 are Done on production. Never displaced.                                                                             |

**Displaced items:** none as of 2026-10-09.

**Releases.** Backend work is batched: S1 to S3, S8, S9, S15 and S24 touch Backend, and
each Backend release costs a promotion, a back-sync and a pointer PR. Plan for few
releases, each named on the rows it closes.

## Dated list

Calendar items. None holds a WIP slot. Dates for Adam's pieces are **proposed at
charter and are Adam's to move**; a moved date is edited here the same day.

| Date                                                  | Who   | What                                                                           | Row           |
| ----------------------------------------------------- | ----- | ------------------------------------------------------------------------------ | ------------- |
| 2026-10-10                                            | Adam  | The Assignment: invite the inner circle to sign in, save and cook              | S25 / RCP-148 |
| 2026-10-11, then ongoing                              | Adam  | First recipe cooked for the tested-recipe proof                                | KAN-352       |
| 2026-10-12                                            | Adam  | Profile edits: Docker Hub, YouTube, owned Meta profiles                        | S22 / RCP-146 |
| 2026-10-12                                            | Adam  | Fill or decline each of the seven Recipe rich-result warnings                  | S16 / RCP-140 |
| 2026-10-13                                            | Adam  | KAN-344 two-account check on staging                                           | S10 / RCP-134 |
| 2026-10-13                                            | Adam  | KAN-342 order check on staging                                                 | S8 / RCP-132  |
| Day after S1 is live (planned 2026-10-14, 2026-10-15) | Adam  | Request Indexing for `/browse` and the 12 hubs, about 10 a day                 | KAN-354       |
| 2026-10-16                                            | Agent | Google check for KAN-276                                                       | KAN-355       |
| 2026-10-23                                            | Agent | Google check for KAN-272                                                       | KAN-353       |
| 2026-10-23                                            | Agent | Count of invited cooks who signed in and saved                                 | S25 / RCP-148 |
| 2026-10-30 and 2026-11-13                             | Agent | Google check for KAN-274 and KAN-319: hubs crawled and indexed, each out of 12 | KAN-354       |
| 4 weeks after S27 ships                               | Agent | The feedback design's success criteria, on a row filed at release              | to file       |

The launch post is not on this list. It moved to Sprint 12 (retro action 8).

## Risks and committed responses (pre-mortem, D5)

_"It is two weeks from now and Sprint 11 failed. Why?"_ R1 to R6 were confirmed by Adam
at the grill. R7 was added with S27 and is **proposed, for Adam to confirm**.

| #   | Risk                                                                                       | Owner | Response (pre-stated)                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | An unplanned level-1 production item takes the sprint, as the hotfix took 80% of Sprint 10 | Adam  | D3's rule: it displaces from the bottom of the ordered list, and the displaced rows are named here the same day.                                                                                                                                          |
| R2  | Traffic meets a defect                                                                     | Adam  | This is the sprint's purpose. S4, S5 and S6 are preconditions of the walk, and the walk is a precondition of the launch post in Sprint 12.                                                                                                                |
| R3  | The hubs are still unindexed at the box's end                                              | Adam  | Ship criteria close the tickets. The Google checks are dated rows outside the commitment (KAN-353, 354, 355). S20 reports whether Googlebot fetched the hubs at all.                                                                                      |
| R4  | The launch post and articles crowd out the engineering                                     | Adam  | Removed by the split: both are in Sprint 12.                                                                                                                                                                                                              |
| R5  | The crawl-discovery rows collide in the same templates, or Backend releases multiply       | Adam  | S1 to S3 run in one session, serially. Backend changes are batched into few releases.                                                                                                                                                                     |
| R6  | S25 drifts into "comments", or the Assignment falls short                                  | Adam  | RCP-148 lists only the pre-build steps. The count of cooks is reported as a count; fewer than five is a finding, not a failure. The design is "I cooked this" entries, not open comments.                                                                 |
| R7  | S27 is a major build added to a box already past its p50, and it waits on two reviews      | Adam  | If both reviews are not linked on RCP-148 by 2026-10-14, the build is unlikely to finish inside the box. It then rolls to Sprint 12 **first in order, ahead of the launch post**, and the post waits for it. Phase 1 only; Phase 2 and 3 are not started. |

## Acceptance criteria

Each SI's acceptance lives on its RCP row, which is authoritative. A row closes
criterion by criterion, with evidence per criterion, pasted the day the check is done.
Every measured criterion names its statistic:

- **S26 / RCP-149, LCP:** the **median of 5** Lighthouse mobile runs per page, on `/`,
  `/browse` and one `/r/<slug>`; each median at most 2.5 s. Sprint 10 closed at 1.09 s,
  2.00 s and 2.20 s, so this is a check that the sprint's changes did not regress it.
- **S26 / RCP-149, hub links:** counted in the first HTML response (curl, no
  JavaScript). `/` links **at least 6** distinct hubs. For recipe pages, the **minimum**
  over a sample of 10 pages equals the number set on KAN-349.
- **S16 / RCP-140:** the **minimum** number of links to other recipes over a sample of 10
  recipe pages is at least 4.
- **S12 / RCP-136:** the **count per day**, over 7 days, of the locked-row log lines.
- **S20 / RCP-144:** the **sum over 7 days** of verified Googlebot requests per path prefix.
- **S25 / RCP-148:** the **count** of invited cooks who signed in and saved by 2026-10-23.
- **KAN-354:** the **count** of hubs with a last-crawl date and the count indexed, each out of 12.

## Sprint 10 retro actions — row-by-row disposition

Abridged from the [Sprint 10 Retrospective](https://tasteslikegood.atlassian.net/wiki/spaces/TLG/pages/89456659),
"Actions for Next Sprint". The Confluence page is authoritative for the wording.

| #   | Action (abridged)                                                                 | Disposition                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Create the next sprint and its RCP rows before carried work starts                | **Done at charter.** Sprint 121, epic RCP-123 and 28 acceptance rows existed and were board-rendered before any Sprint 11 branch was opened.                         |
| 2   | Split Google-wait criteria from ship criteria; dated checks for KAN-272, 274, 276 | **Committed.** S17, S18 and S19 close on ship criteria. The Google checks are KAN-353, KAN-354 and KAN-355, each with its date.                                      |
| 3   | Name the statistic in every measured criterion                                    | **Committed.** See the list above; each is on its RCP row.                                                                                                           |
| 4   | Work the process lane in week one, with dates                                     | **Committed.** S21 is planned to start by 2026-10-13, and the process lane below carries dates.                                                                      |
| 5   | Record any difference from a ticket's recorded decision at merge                  | **Committed.** Every acceptance row filed at this charter carries the "differs from the recorded decision" line.                                                     |
| 6   | File evidence the day the check is done                                           | **Committed.** On every acceptance row, and S26's walk results are pasted the same day.                                                                              |
| 7   | Decide which of the seven Recipe rich-result warnings to fill (KAN-273)           | **Committed as S16**, with Adam's decision dated 2026-10-12. It sets S15's scope.                                                                                    |
| 8   | Decide whether the launch post is still the goal                                  | **Decided (Adam, 2026-10-09): yes, in Sprint 12.** KAN-299 and its pre-registered 7-day readout are unchanged and stay under RCP-119. Sprint 11's goal is readiness. |

**Follow-through items from the retro:** the KAN-344 two-account check and the KAN-342
order check are on the dated list (S10, S8). The open Dependabot PRs are in the process
lane. No retro action is declined.

## Process lane (no SI slot)

| Item                                                                                                           | Source              | Planned                                       |
| -------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------- |
| Open Dependabot PRs: merge or close each with a reason                                                         | Sprint 10 retro     | by 2026-10-13                                 |
| Stale started items KAN-188, KAN-199, KAN-212, KAN-261, KAN-287: close, re-scope or return to To Do            | Flow check (WIP 19) | by 2026-10-16                                 |
| Harness plan and driver for Sprint 11 (`specs/harness/`), with the D6 rule that a dated item holds no WIP slot | D6                  | follow-up PR under KAN-350, opened 2026-10-09 |
| Charter Sprint 12 under RCP-119 when Sprint 11 closes                                                          | Grill, 2026-10-09   | at close                                      |
| Sprint 11 retrospective page under Confluence 50298881                                                         | CLAUDE.md           | at close                                      |

The charter's gates do not depend on the harness plan. The ordered list above is the
order of work; the harness plan ([`specs/harness/`](./harness/README.md)) enforces part
of it and says which part.

## Gates

Both run at charter and again at close:

```bash
bash scripts/pm/check_sprint_lane.sh                        # lane: every sprint-11 KAN row linked to RCP
python3 scripts/harness/sprint11_hard_gate.py --charter     # day 1: sprint active, members, board-rendered rows
python3 scripts/harness/sprint11_hard_gate.py               # close: the above AND nothing in To Do
```

`sprint11_hard_gate.py` is the Sprint 11 successor of `sprint10_hard_gate.py`: the same
rules with Sprint 11 constants and no pre-authorised drops. Its `NOT_IN_SPRINT` map
fails the gate if a Sprint 12 row (the table above) is in the sprint or on the board.
Rule 3 (nothing in To Do) is the close gate, so on day 1 it is expected red.

**Day-1 evidence, 2026-10-09:**

| Run                                  | Result                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `sprint11_hard_gate.py --charter`    | **exit 0** — 28 acceptance rows board-rendered (27 SIs and the charter row)       |
| `check_sprint_lane.sh`               | **exit 0** — all 59 sprint members carry `sprint-11`; 30 open KAN rows, 0 orphans |
| `sprint11_hard_gate.py` (close form) | exit 1 — 49 rows in To Do (expected on day 1)                                     |
| `test_sprint11_hard_gate.py`         | 18 tests pass; wired into `pr-gate.yml`'s harness-tests job                       |

## Close-out

Not done until every box links its evidence:

- [ ] Every acceptance row closed criterion by criterion, or amended in writing by Adam
- [ ] `sprint11_hard_gate.py` exit 0; `check_sprint_lane.sh` exit 0, output pasted here
- [ ] Readiness walk results (S26): the journey on phone and desktop, the LCP medians, the hub-link counts
- [ ] Rows not finished inside the box named here, each with its reason and where it went
- [ ] Aging table and dated list updated with final dispositions
- [ ] Process-lane rows closed or carried with a reason
- [ ] Sprint 12 chartered under RCP-119
- [ ] Sprint 11 retrospective page created under Confluence 50298881 from template 50495489, on close-out day
