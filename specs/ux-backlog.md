# UX/UI Defect Backlog — from the 2026-07 field test (SI-2 / KAN-113)

_Source:_ Adam's first-person live-site field test (overall **6.5/10**, specific elements 7–8/10),
run on production via the Pinterest → recipe → save flow on iOS, plus the earlier live-site review
(`findings.md`, imageless-recipe findings). **Discovery only** — this file enumerates and ranks;
fixes are Sprint-2 candidates unless already shipped.

_Scoring note (honesty over vibes):_ the field test produced one overall score (6.5/10) and a 7–8/10
range for "specific elements"; per-element scores below marked _est._ are derived estimates anchored
to those stated numbers, not separately measured. Every entry carries a concrete repro — entries
without one were dropped.

Ranked by (severity at the conversion moment × reach). Status reflects 2026-07-20.

---

## 1. Google sign-in dead-end inside in-app webviews — **fix shipped in v0.4.0**

- **Element:** Auth modal / "Save to Cookbook" CTA (unauthenticated)
- **Current score:** 2/10 at time of test (hard dead-end for webview arrivals; drove the overall 6.5)
- **Target score:** 8/10 (graceful fallback; true fix impossible — Google policy blocks embedded webviews)
- **Repro:** iOS Pinterest app → any pin to tasteslikegood.org → recipe loads in in-app webview →
  "Save to Cookbook" → "Sign in with Google" → **Error 403: `disallowed_useragent`** (TAS-2899, Urgent).
- **Fix hypothesis:** UA-detect in-app browsers; swap the doomed button for "open in Safari/Chrome"
  panel + copy-link; short-circuit `onGoogleLogin()`. _(This is what #3186 shipped.)_
- **Effort:** M (shipped — PR #3186, v0.4.0). **Sprint-2 residual:** verify post-deploy on a real
  Pinterest arrival; consider analytics on fallback-panel impressions.

## 2. Home page is a zero-anchor SPA shell for crawlers/no-JS — **fix shipped in v0.4.0**

- **Element:** Home page server HTML (`/`)
- **Current score:** 3/10 for discoverability at time of test (crawl dead-end to `/browse` + `/r/*`)
- **Target score:** 7/10 (server-visible nav; full SSR home is out of scope)
- **Repro:** `curl -s https://www.tasteslikegood.org/ | grep -c 'href="/browse"'` → was 0 (TAS-2896).
- **Fix hypothesis:** `<noscript>` nav with `/browse` + 2 published `/r/<slug>` anchors in the shell.
  _(This is what #3185 shipped; canonical-slug promotion program continues as KAN-116/SI-4.)_
- **Effort:** S (shipped — PR #3185, v0.4.0). **Sprint-2 residual:** post-deploy `curl` gate + GSC
  recrawl checkpoint.

## 3. Duplicate cookbook rows from the race bug (content hygiene — Adam's personal cookbooks, NOT test data)

- **Element:** Cookbook rows on Adam's personal account — `Dooypkiitts` and `zzz-racetest-*` are HIS
  real cookbook names; the defect is only the _duplicate rows_ the KAN-106 race bug created under them
- **Current score:** 6/10 _est._ (reads as an unfinished site to a new visitor)
- **Target score:** 9/10 (only curated content public)
- **Repro:** list prod collections (`GET /api/collections` as the affected account / admin view) —
  duplicate-named rows with distinct `id`/`created_at` from the KAN-106 race investigation remain
  (`findings.md`).
- **Fix hypothesis:** dedupe only — Adam hand-picks which duplicate rows go; the cookbooks themselves
  stay. **Every deletion is his explicit pick**, listed as a
  Sprint-2 candidate in `SPRINT_1_PLAN.md`; server-side `(user_id, name)` uniqueness already tracked.
- **Effort:** S (manual deletion + confirmation), M if scripted with a dry-run.

## 4. Published recipes with missing hero/OG images

- **Element:** Public recipe page hero + social-share (OG) image
- **Current score:** 5/10 _est._ (blank hero on an otherwise polished page; broken share previews)
- **Target score:** 8/10
- **Repro:** 3 published recipes carry an `ai_image_url` with no stored bytes → blank hero and empty
  `og:image` (2026-07-17 live-site review; 1 of 3 was regenerated, 2 remain on non-primary accounts).
- **Fix hypothesis:** regenerate or unpublish the affected recipes; add a publish-time guard
  ("no image bytes → warn before publish").
- **Effort:** S for the data fix; M for the publish-time guard.

## 5. Duplicate near-identical recipes in the public sitemap (cornbread variants)

- **Element:** Public catalog curation (`/browse`, sitemap)
- **Current score:** 6/10 _est._ (three cornbread variants dilute the catalog and split any future
  ranking signal)
- **Target score:** 8/10 (one canonical variant public, others unpublished or differentiated)
- **Repro:** live sitemap contains `vegan-cornbread`, `good-day-vegan-cornbread`, and
  `adams-vegan-blueberry-cornbread`; `vegan-cornbread` is now also a hardcoded home-shell anchor
  (#3185), which makes the decision time-sensitive.
- **Fix hypothesis:** resolve via the KAN-116 canonical-promotion rubric (SI-4) — the "cornbread
  decision" already parked in the Sprint-2 candidate list.
- **Effort:** S once the rubric exists (KAN-116 Phase 0/1).

## 6. iOS: link to a recipe's public page hidden unless signed in (non-guest)

- **Element:** My Kitchen recipe card — the "View" affordance for `/r/<slug>`
- **Current score:** 4/10 _est._ (a published recipe offers no visible path to its own public page)
- **Target score:** 8/10
- **Repro:** Adam, live on iOS (2026-07-20, post-v0.4.0): browser still hides the link to the public
  recipe. Code-confirmed root cause: the View link renders only under
  `@if (canPublish() && r.is_public)` (`app.component.html:402`) and `canPublish()` requires a
  signed-in non-guest (`app.component.ts:968`) — so guests, and iOS webview visitors who _cannot_
  sign in (Google policy, see entry 1), never see the link even for already-public recipes.
- **Fix hypothesis:** split view-gating from publish-gating — render View whenever `r.is_public`
  (viewing needs no publish rights); keep the toggle behind `canPublish()`.
- **Effort:** S (condition change + test). Sprint-2 candidate under KAN-118.
- **✅ FIX MERGED TO DEV (2026-07-20, PR #3195, KAN-119 Done):** `isPublicViewable()` pure util +
  TDD spec; ships at the next release — live iOS re-check is the remaining proving gate.

---

## Adversarial pass — self-check applied before review

- Dropped: any entry with no reproducible observation (nothing from the 6.5 score was kept as a
  bare "feels off" item).
- Flagged: per-element scores are _est._ where the field test recorded only the overall number —
  reviewer (Adam) should correct any estimate that misstates what he saw.
- Items 1–2 are shipped-but-unverified in prod until the v0.4.0 deploy verification passes; their
  Sprint-2 residuals are the live entries.

**Review state:** compiled by the Sprint-1 close-out loop from TAS-2899, TAS-2896, `findings.md`,
and the 2026-07-17 live-site review; **awaiting Adam's acceptance** (KAN-113 stays In Review until
he accepts or amends).
