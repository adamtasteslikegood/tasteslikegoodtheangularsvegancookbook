# Execution Plan: v0.2 Anti-Recipe Site

> **Status (2026-05-06):** v0.2.0 shipped on 2026-04-29 and has since received five corrective releases (v0.2.1 → v0.2.5). All implementation checkboxes below describe the originally-merged code. See `roadmap.md` for the shipped list and `planning_notes.md` for the post-launch findings (migrations-not-running outage, `is_public` column never wired, OAuth scope bundling, and the open public-page SSR formatting regression).

This tactical plan covers the immediate engineering tasks to implement the v0.2 Anti-Recipe Site distribution layer, as defined in the latest CEO review.

## 1. Data Model & Migrations

- [x] **Schema Update:** Add `is_public` (Boolean, default `False`) and `slug` (String, unique, indexed) to `Backend/models/recipe.py`.
- [x] **Alembic Migration:** Generate migration script for the new columns.
- [x] **Data Backfill:** Write script to backfill `slug` for the 85 existing recipes based on their titles. Handle collision suffixes (`-2`, `-3`).

## 2. Backend (Flask) & SSR Routes

- [x] **Flask Routes:** Implement `/r/<slug>` for viewing a single public recipe and `/browse` for a paginated list of public recipes.
- [x] **Image Access:** Modify `/api/recipes/<id>/image` (or create a new public route) to allow unauthenticated access to images for `is_public=True` recipes.
- [x] **Jinja Templates:** Rewrite `Backend/templates/recipe.html`, `browse.html`, and `base.html` to consume SQLAlchemy models instead of flat JSON. Ensure zero-fluff design, Playfair Display font, and print-friendly CSS (`@media print`).

## 3. Express Proxy Configuration

- [x] **Route Ordering:** Update `server/proxy.ts` (or equivalent) to proxy `/r/*`, `/browse`, and `/sitemap.xml` to Flask. Ensure these are mounted _before_ the Angular `{*path}` catch-all.

## 6. Design & Information Architecture

- [x] **Responsive & Accessibility:**
  - **Mobile:** `< 768px` breakpoints collapse the 3-step preview into a single scrolling container. "Save to Cookbook" CTA becomes full-width at the bottom of the viewport.
  - **A11y:** CTA minimum touch target is `44px` tall. High contrast ratio enforced by true black/white design. `aria-label` tags required on the Pinterest share button and any form toggles.
- [x] **Anti-AI Slop Design Tokens (from Claude Design Handoff):**
  - **Typography:** `Playfair Display` for headings (display, serif). `Lato` for body text. `Courier New` (mono) for labels, ingredients, steps, and tags to evoke a terminal feel.
  - **Borders & Shadows:** Stark black lines (`1px solid #000`), square corners (`border-radius: 0`), NO drop shadows (`box-shadow: none`).
  - **Semantic Colors:** True black (`#000`) text on true white (`#FFF`) background. `stone-50` (`#fafaf9`) for page backgrounds.
- [ ] **User Journey & Emotional Arc:**
  ```text
  STEP | USER DOES                   | USER FEELS             | PLAN SPECIFIES?
  -----|-----------------------------|------------------------|----------------
  1    | Lands from Google on /r/..  | Relief (it's fast!)    | <500ms render, no popups.
  2    | Reads the recipe preview    | Trust (beautiful image)| Hero image takes center stage.
  3    | Clicks "Save to Cookbook"   | Curiosity/Action       | Instant transition to SPA.
  4    | SPA Guest Flow authenticates| Empowered              | Kept in context of recipe.
  ```
- [ ] **Interaction State Coverage:**
  ```text
  FEATURE            | LOADING      | EMPTY / INACTIVE | ERROR         | SUCCESS      |
  -------------------|--------------|------------------|---------------|--------------|
  Publish Toggle     | Spinner swap | Toggle Off       | Toast & Reset | Toast ("Live")|
  Slug Editor        | Debounce UI  | Placeholder hint | Red border    | Green check  |
  /browse Page       | Skeleton UI  | Warm "Coming soon"| Standard 500  | Full Grid    |
  Save Cookbook CTA  | Button spin  | Normal CTA       | Toast ("Oops")| Toast ("Saved")|
  ```
- [ ] **`/r/<slug>` Information Hierarchy:**
  1. Primary: Breathtaking 100vw Hero Image (top) & Recipe Title overlay.
  2. Secondary: 3-step visible preview + "Save to your cookbook" CTA.
  3. Tertiary: Ingredients list, full steps, and Pinterest share. No backstory or ads.
  ```text
  +--------------------------------+
  |        [ HERO IMAGE ]          |
  |     RECIPE TITLE (H1)          |
  +--------------------------------+
  | Time: 30m | [ Save to Cookbook]|
  +--------------------------------+
  | INGREDIENTS  | INSTRUCTIONS    |
  | - item 1     | 1. step 1       |
  | - item 2     | 2. step 2       |
  +--------------------------------+
  ```
- [ ] **`/browse` Grid Hierarchy:**
  1. Primary: High-contrast Image grid.
  2. Secondary: Bold Recipe Titles overlaid or directly below.
  3. Tertiary: Minimal pagination controls.

## 4. Frontend (Angular) Updates

- [x] **Editor UI:** Add a "Publish" toggle and "Slug" text input to the recipe view/edit surface.
- [x] **Landing Page:** Implement a high-contrast hero for the homepage (`/`) featuring a single scrolling preview of public recipes.

## 5. SEO & Distribution

- [x] **JSON-LD:** Add Schema.org `Recipe` JSON-LD to `recipe.html`. Convert prep/cook times to ISO 8601 durations (e.g., `PT30M`).
- [x] **Meta Tags:** Add canonical URLs, OG image tags (using the AI-generated image), Twitter Cards, and meta descriptions.
- [x] **Sharing & Discovery:** Add Pinterest share button to `recipe.html` and implement auto-generating `/sitemap.xml` listing all public recipes.
- [x] **Conversion CTA:** Add "Save to your cookbook" button that routes users to the SPA guest session flow to save the recipe locally.

## Next Steps

1. Run `/plan-eng-review` on this plan to validate architecture, error handling (e.g., HTTP 410 Gone for unpublished recipes), migration safety, and testing strategy before implementation begins.
2. After eng review passes, implement on a feature branch (`feat/v0.2-public-recipes`).

## Post-launch status (2026-05-06)

The four originally-unchecked items in §6 (User Journey, Interaction State Coverage, `/r/<slug>` Information Hierarchy, `/browse` Grid Hierarchy) are still open — **not** because they were deferred but because the public-page SSR is currently formatting/routing incorrectly in production. The Jinja templates from the original `tasteslikegood.com` repo were a better realization of these specs than what currently ships. Decision needed in `/plan-eng-review` for v0.3:

- (a) Re-investigate the SSR routing — confirm whether `/r/<slug>` and `/browse` still hit the Jinja templates or whether Express is serving the Angular catch-all by mistake. Start at `server/proxy.ts` route ordering and `Backend/blueprints/recipes_api_bp.py` SSR handlers.
- (b) Decide whether to keep the current Angular-rendered preview path or restore the original Jinja-only path (per Adam's review, the original Jinja was better-formatted).
- (c) Once routing is correct, complete the four §6 design items against actual rendered output.
