# Sprint 2 Plan — Canonical Curation, GSC Checkpoint & UX-Backlog Burn-down — **DRAFT, NOT LOCKED**

_Kickoff:_ 2026-07-20 (directed by Adam at Sprint-1 close) · _Owner:_ Adam Schoen · _Jira epic:_ **KAN-118**
_Status:_ 🟡 **DRAFT — charter not locked.** Run `/cs:grill-pm` on this file to lock the sprint
branches (outcome/DONE, measurement, ownership, risk, budgets) before driving any item.
Sprint-1 discipline carries forward as the default: **WIP ≤ 3 in flight**, proving command written
_before_ work, 3 attempts/task, 12 iterations/goal, adversarial gate on agent output, this file is
source-of-truth (closing an item means editing it).

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
| C1  | **KAN-116 — canonical `r/<recipe>` promotion, Phase 0/1**: Adam picks 3–5 slugs, tracked candidate file + CI validator per `CANONICAL_RECIPES_ROLLOUT.md`; settles the cornbread-variants question (ux-backlog #5)                                                                         | rolled from Sprint 1                         | candidate file exists + CI check green + anchors serve the approved slugs live                                      |
| C2  | **GSC indexing checkpoint** — 1-week recrawl verification after the 07-19 sitemap submission (59 URLs) + v0.4.0 home anchors                                                                                                                                                               | Sprint-1 parked list                         | GSC "Last update" > 2026-07-20 AND indexed-page delta recorded in this file (finding is the deliverable either way) |
| C3  | **Prod content hygiene** — dedupe the race-bug duplicate rows on Adam's personal cookbooks (`Dooypkiitts`, `zzz-racetest-*` are his real cookbook names — dedupe extras only, every deletion his explicit pick), run `unpublish_slugs.py`, fix/unpublish the 2 remaining imageless recipes | ux-backlog #3 + #4                           | no duplicate cookbook rows remain AND zero published recipes with imageless heroes                                  |
| C4  | **Webview-fallback live verification** — real Pinterest-arrival test of the #3186 panel; optional impression analytics                                                                                                                                                                     | ux-backlog #1 residual                       | documented repro on live site showing fallback panel (screenshot/log)                                               |
| C5  | **Pinterest Rich Pins** — Recipe Rich Pin metadata + domain verification (`pintrest-research.md`)                                                                                                                                                                                          | Sprint-1 parked list                         | Pinterest validator passes on 2+ recipe URLs                                                                        |
| C6  | **Valkey broken-connection edge cases** — KAN-16/KAN-17 (GH #162/#163)                                                                                                                                                                                                                     | long-standing                                | repro tests green under fault injection                                                                             |
| C8  | **iOS: public-recipe View link hidden for guests/webview** — split view-gating from publish-gating (`canPublish()` gates the link at `app.component.html:402`; viewing a public page needs no auth)                                                                                        | Adam field report 2026-07-20 + ux-backlog #6 | signed-out iOS visit shows the View link on a published recipe                                                      |
| C7  | **Leftover-ASKs write-up**                                                                                                                                                                                                                                                                 | Adam, deferred post-gate                     | doc exists + reviewed                                                                                               |

**Recommended commit (pending grill):** C1 + C2 + C3 (C8 is small enough to ride with C3's pass) — C1 is owner-directed and time-sensitive
(hardcoded anchors already live), C2 is a timed checkpoint that matures mid-sprint on its own, and
C3 clears everything a new visitor can see. C4 folds into C1's live-verification pass cheaply.

## Human decisions to front-load (the Sprint-1 lesson)

1. **Adam picks canonical slugs** (3–5) in `CANONICAL_RECIPES_ROLLOUT.md` — blocks C1.
2. **Adam hand-picks the duplicate rows to remove** (his personal cookbooks — nothing is deleted without his explicit per-row pick) — blocks C3 (destructive, human-gated).
3. Grill-pm lock of this charter.

## Not in this sprint

Anything not committed above stays parked (C5–C7 unless swapped in at lock time), plus: full Phase-2
automated rubric scoring (KAN-116), home-page redesign, DORA deploy markers (optional, noted in
SI-1), Datadog profiler re-enable (trial ends ~2026-07-28 — decide before then or it decides itself).
