# Sprint 2 Plan — Canonical Curation, GSC Checkpoint & UX-Backlog Burn-down

_Kickoff:_ 2026-07-20 · _Owner:_ Adam Schoen · _Jira epic:_ **KAN-118**
_Status:_ ✅ **CLOSED 2026-07-24** — release gate MET (v0.4.2 live-verified, see close-out below);
epic KAN-118 → Done. Was locked via `/cs:grill-pm` (6/6 branches, 2026-07-20). Committed: **C1 + C2 +
C3 + C9** (WIP ≤ 3; C8 shipped pre-lock in v0.4.1; C9 added 2026-07-23 post-SPA merge, piggybacks
C1). C3 deferred → Sprint 3 by Adam's decision 2026-07-24.

## Charter (locked decisions)

| #   | Branch                | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Outcome / DONE**    | All three committed items hit their proving gate, verified in this file: **C1** candidate file + CI validator green + approved slugs serving live (`curl` home shell lists exactly the approved set) · **C2** GSC "Last update" crosses 2026-07-20 + indexed-page delta recorded here (the finding is the deliverable, either direction) · **C3** zero duplicate rows from Adam's pick-list AND zero imageless published heroes. No release-gating amendment unless Adam adds one; C1's live-serving criterion forces ≥1 ship. |
| 2   | **Measurement**       | WIP ≤ 3, no story points. Track WIP/throughput/cycle-time/age cumulatively across Sprints 1+2 (7 items done so far). **No date forecasting** until ~10 completed items — crossed mid-sprint, at which point a p50/p85 range becomes legitimate input for Sprint 3, not before.                                                                                                                                                                                                                                                 |
| 3   | **Forecast honesty**  | Zero committed dates. Two external clocks, labeled decision points not deadlines: GSC recrawl matures on Google's schedule; **Datadog profiler decision before trial end ~2026-07-28** (default = stays off).                                                                                                                                                                                                                                                                                                                  |
| 4   | **Ownership**         | Owner = Adam on all. Reviewers: C1 = PR gate + rubric checks + **Adam's slug approval (hard human gate before serving)** · C2 = machine gate (recorded delta + adversarial pass on any indexing claim) · C3 = **Adam's per-row pick list (destructive, human-gated)** + machine-verified end state. Agent executes; reviewer is never the author.                                                                                                                                                                              |
| 5   | **Risk (pre-mortem)** | (a) human-gate stall (Sprint 1's constraint) → both pick-decisions front-loaded as the sprint's first actions; (b) premature "indexing broken" call → finding-is-the-deliverable termination rule; (c) wrong-row deletion → dry-run listing + nothing beyond the pick list; (d) plan rot → this file is source-of-truth, closing an item = editing it.                                                                                                                                                                         |
| 6   | **Budgets**           | 3 attempts/task, 12 iterations/sprint-goal. Escalation reviewer = Adam, reason written to this file. Capped-out verification → the finding (incl. "inconclusive") is the deliverable.                                                                                                                                                                                                                                                                                                                                          |

## Front-loaded human decisions (the sprint's first two actions — nothing else blocks on them)

1. **C1 / KAN-116:** Adam picks 3–5 canonical slugs in `specs/CANONICAL_RECIPES_ROLLOUT.md`
   (drafted candidates there; picking `vegan-cornbread` settles the cornbread question with it).
2. **C3:** Adam's per-row dedupe pick list (his personal cookbooks — dry-run listing first,
   deletions limited to exactly the picked rows).

---

## What Sprint 1 taught us (first real flow data)

- 7 items: **6 verified-done, 1 rolled** (KAN-116 → this sprint). Charter → gate-closed in ~2 days.
- Release ship → live-verified: **7 minutes** (v0.4.0, Cloud Build `24382faa`, 7m42s).
- The constraint is **human gates** (acceptance, approvals), not agent execution. Sprint 2 should
  front-load Adam's decisions (slug picks, hygiene deletions) so agents aren't blocked mid-loop.
- Gotchas now in memory: Cyrus-authored PRs need workflow-run approval before required checks run;
  background sessions can't reauth `gcloud` interactively (verify via serving artifact + monitoring).

## Candidate pool (commit ≤3; everything else stays parked)

| #   | Candidate                                                                                                                                                                                                                                                                                  | Source                                       | Proposed proving gate (draft)                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| C1  | ✅ **KAN-116 — canonical `r/<recipe>` promotion, Phase 0/1**: Adam picks 3–5 slugs, tracked candidate file + CI validator per `CANONICAL_RECIPES_ROLLOUT.md`; settles the cornbread-variants question (ux-backlog #5) — **DONE** PR #3216 merged 2026-07-23; all 7 slugs approved, CI gate green, schema file added | rolled from Sprint 1                         | candidate file exists + CI check green + anchors serve the approved slugs live                                      |
| C2  | ✅ **GSC indexing checkpoint** — 1-week recrawl verification after the 07-19 sitemap submission (59 URLs) + v0.4.0 home anchors — **DONE 2026-07-23**: GSC "Last read" = Jul 23 2026, 68 pages discovered, Status = Success (see findings below)                                           | Sprint-1 parked list                         | GSC "Last update" > 2026-07-20 AND indexed-page delta recorded in this file (finding is the deliverable either way) |
| C3  | **DEFERRED → Sprint 3** — Prod content hygiene (dedupe race-bug duplicate rows on Adam's personal cookbooks, `unpublish_slugs.py`, imageless recipes). Blocked on Adam's per-row picks; deferred 2026-07-24 by Adam's decision | ux-backlog #3 + #4                           | no duplicate cookbook rows remain AND zero published recipes with imageless heroes                                  |
| C4  | **Webview-fallback live verification** — real Pinterest-arrival test of the #3186 panel; optional impression analytics                                                                                                                                                                     | ux-backlog #1 residual                       | documented repro on live site showing fallback panel (screenshot/log)                                               |
| C5  | **Pinterest Rich Pins** — Recipe Rich Pin metadata + domain verification (`pintrest-research.md`)                                                                                                                                                                                          | Sprint-1 parked list                         | Pinterest validator passes on 2+ recipe URLs                                                                        |
| C6  | **Valkey broken-connection edge cases** — KAN-16/KAN-17 (GH #162/#163)                                                                                                                                                                                                                     | long-standing                                | repro tests green under fault injection                                                                             |
| C8  | **iOS: public-recipe View link hidden for guests/webview** — split view-gating from publish-gating (`canPublish()` gates the link at `app.component.html:402`; viewing a public page needs no auth)                                                                                        | Adam field report 2026-07-20 + ux-backlog #6 | signed-out iOS visit shows the View link on a published recipe                                                      |
| C7  | **Leftover-ASKs write-up**                                                                                                                                                                                                                                                                 | Adam, deferred post-gate                     | doc exists + reviewed                                                                                               |
| C9  | ✅ **Guard timeout + blank-page UX on SSR save entry** — `Promise.race` timeout in ssrEntryGuard, fire handleSave in background so `/kitchen` paints instantly; differentiate 404 vs network error in deep-link fetch (#3208) — **DONE** PR #3214 merged 2026-07-23                        | SPA arch review deferred (PR #3207, 07-23)   | `/?save=<slug>` renders `/kitchen` within 100ms (no blank page); network failure shows retriable error, not "not found" |

**Recommended commit (pending grill):** C1 + C2 + C3 (C8 is small enough to ride with C3's pass) — C1 is owner-directed and time-sensitive
(hardcoded anchors already live), C2 is a timed checkpoint that matures mid-sprint on its own, and
C3 clears everything a new visitor can see. C4 folds into C1's live-verification pass cheaply.

**Mid-sprint addition (2026-07-23):** C9 added post-PR #3207 merge (SPA architecture upgrade).
The SSR save guard blocks the initial navigation with async I/O, leaving the user on a blank page
for 0.5–2s — directly undercuts C1's canonical-slug promotion where the SSR CTA is the entry path.
C9 piggybacks on C1's branch/verification; WIP stays ≤ 3 since C8 already shipped.

## C2 — GSC indexing checkpoint findings (2026-07-23)

**External state verified (machine-checkable):**

- Sitemap live at `https://www.tasteslikegood.org/sitemap.xml`: **68 URLs** (up from 59 at sprint start 07-19; +9 new recipes published since)
- All 7 canonical slugs return HTTP 200 with self-canonical and Recipe JSON-LD
- Home shell `<noscript>` anchors serve all 7 approved slugs (CI gate green)
- Sitemap `lastmod` dates span 2026-05-06 through 2026-07-21

**GSC data (confirmed by Adam 2026-07-23):**

| Field | Value |
|-------|-------|
| Sitemap URL | `https://www.tasteslikegood.org/sitemap.xml` |
| Submitted | Jul 19, 2026 |
| Last read | **Jul 23, 2026** (> 2026-07-20 threshold) |
| Status | Success |
| Discovered pages | **68** |
| Discovered videos | 0 |

**Indexed-page delta:** Sitemap grew from 59 → 68 URLs (+9 new recipes published since sprint start). GSC discovered all 68. Prior GSC snapshot was dated 07-09 — Google has now recrawled post-ship (v0.4.0 home anchors + canonical slugs).

**Proving gate: MET.** GSC "Last read" (Jul 23) > threshold (Jul 20). 68 pages discovered = 100% of submitted sitemap. Finding is positive: Google recrawled within 4 days of the v0.4.0 anchor deployment and discovered all URLs.

## Human decisions to front-load (the Sprint-1 lesson)

1. **Adam picks canonical slugs** (3–5) in `CANONICAL_RECIPES_ROLLOUT.md` — blocks C1.
2. **Adam hand-picks the duplicate rows to remove** (his personal cookbooks — nothing is deleted without his explicit per-row pick) — blocks C3 (destructive, human-gated).
3. Grill-pm lock of this charter.

## Not in this sprint

Anything not committed above stays parked (C5–C7 unless swapped in at lock time), plus: full Phase-2
automated rubric scoring (KAN-116), home-page redesign, DORA deploy markers (optional, noted in
SI-1), Datadog profiler re-enable (trial ends ~2026-07-28 — decide before then or it decides itself).

### SPA review deferrals (parked, Sprint 3 candidates)

From PR #3207 code review — tracked as GitHub issues under KAN-118:
- **#3210** — `viewRecipe` sets `isSaved=true` for non-owned deep-link recipes (UX lie, no data loss)
- **#3211** — missing "Sign in to publish" button in recipe-detail for guests (UX parity with generator)
- **#3209** — extract shared recipe methods to utility/mixin (pure refactor, backlog)

---

## Sprint 2 close-out (2026-07-24)

**Disposition:** 4/5 committed items verified-done, 1 deferred (C3 → Sprint 3).

| Item | Status | Evidence |
|------|--------|----------|
| C1 (KAN-116) | **Done** | PR #3216 merged 2026-07-23; 7 canonical slugs approved, `canonical_recipes.json` schema file, CI gate green (`check_canonical_recipes.sh` exit 0), `<noscript>` anchors in `index.html` |
| C2 (GSC) | **Done** | GSC Last read Jul 23 > threshold Jul 20; 68/68 pages discovered; finding positive — recorded above |
| C3 | **Deferred → Sprint 3** | Blocked on Adam's human decisions (per-row dedupe picks, imageless recipe disposition); deferred by Adam 2026-07-24 |
| C8 (KAN-119) | **Done** | Shipped in v0.4.1 (2026-07-20); Jira transitioned to Done 2026-07-24 (was stale) |
| C9 | **Done** | PR #3214 merged 2026-07-23; `/?save=<slug>` non-blocking, fetch timeout with retriable error |

**Jira transitions (2026-07-24):** KAN-116 To Do → Done, KAN-119 In Progress → Done.

**Release gate: MET** (verified 2026-07-24). v0.4.2 shipped (tag `v0.4.2`, release PR #3235 + review-feedback fix #3238). Production verification, machine-checked (`verify_live.sh` exit 0): home shell at `https://www.tasteslikegood.org/` anchors exactly the 7 approved canonical slugs (no extras), and every `/r/<slug>` returns HTTP 200. C1's live-serving criterion — the last open condition — is satisfied; sprint close is unconditional.

**Flow metrics (Sprints 1+2 cumulative):**
- Sprint 1: 7 items, 6 done + 1 rolled (KAN-116). ~2 days charter→gate.
- Sprint 2: 5 items, 4 done + 1 deferred (C3). ~4 days charter→close (2026-07-20 → 2026-07-24).
- Combined: 12 items, 10 done, 1 rolled+completed in S2, 1 deferred. Constraint = human gates.
- Throughput: ~10 items across ~5 days of active sprint work. Sprint 1 release: 7m42s.

**Rolled to Sprint 3:** C3 (prod content hygiene), #3210, #3211, #3209.
