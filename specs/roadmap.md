# Project Roadmap: v0.2 — Anti-Recipe Site

This roadmap outlines the strategic direction for v0.2, shifting focus to distribution by building a public, SSR-rendered, zero-fluff recipe site on top of our existing authenticated app.

## Vision: The Anti-Recipe Site

- **Speed as a feature:** <500ms full render.
- **Honest URLs:** `/r/thai-peanut-noodles` instead of messy tracking URLs.
- **Visuals:** One breathtaking AI-generated photo per recipe.
- **Conversion:** Low-friction "Save to cookbook" CTA.
- **SEO:** Perfect Schema.org JSON-LD per recipe.

## Phase 1: Data & Migration

- Add `is_public` (bool) and `slug` (string) columns to `Recipe` model.
- Create Alembic migration and backfill slugs for existing 85 recipes.
- Update Angular UI with a Publish toggle and slug editor.

## Phase 2: SSR & Routing

- Build Flask SSR routes: `/r/<slug>` (single recipe) and `/browse` (paginated listing).
- Update Express routing to proxy `/r/*`, `/browse`, and `/sitemap.xml` to Flask _before_ the Angular catch-all.
- Address image endpoint auth so public recipes have public images.

## Phase 3: Templates & SEO Polish

- Rewrite Jinja templates (`recipe.html`, `browse.html`, `base.html`) for a zero-fluff, print-friendly experience.
- Implement Schema.org `Recipe` JSON-LD, canonical URLs, OG tags, and Twitter Cards.
- Add Pinterest share button and auto-generated `sitemap.xml`.

## Phase 4: Conversion & Launch

- Implement "Save to your cookbook" CTA routing to the SPA guest session flow.
- Run `/plan-eng-review` to pressure-test architecture and rollout strategy.
- Cut `v0.2.0` release.

## Shipped (v0.2.0 → v0.2.5)

- **v0.2.0** (2026-04-29) — Anti-Recipe Site MVP: `is_public`/`slug` columns, `/r/<slug>` and `/browse` SSR routes, Jinja templates, JSON-LD, sitemap, Pinterest share, "Save to cookbook" CTA, Express proxy ordering.
- **v0.2.1** (2026-04-29) — Post-launch polish + agent tooling wiring.
- **v0.2.2** (2026-04-30) — Production hotfix: introduced `flask-backend-migrate` Cloud Run Job so DB migrations run before each Flask deploy. Closed the gap that caused the v0.2.0/v0.2.1 outage (schema-changing migrations had shipped without ever being applied).
- **v0.2.3** (2026-04-30) — Hotfix on top of v0.2.2: attached Cloud SQL instance to the migrate Job so it could actually reach the DB.
- **v0.2.4** (2026-05-04) — Bug-fix release: browser back button popstate mapping, AI image persistence on refresh, `is_public`/`slug` sync on recipe create/update (so public toggles actually flip the DB column), Backend test fixtures, planning docs moved into `specs/`, PM sync script.
- **v0.2.5** (2026-05-06) — Hotfix: Google OAuth callback tolerates Google's scope bundling for returning users (`OAUTHLIB_RELAX_TOKEN_SCOPE=1` + dropped `include_granted_scopes`). Backend submodule `397ba90`.

## v0.3 Priorities (open)

1. **Public-page SSR regression — P1.** The `/r/<slug>` and `/browse` Jinja templates appear to no longer render (or are not routed) for recipes toggled public _before_ v0.2.4. Recipes toggled after v0.2.4 work because the `is_public` column now syncs on create. Investigation needed: (a) confirm whether the SSR routes still hit the Jinja templates or whether Express is intercepting and falling through to Angular; (b) decide whether to keep the current SSR or restore the original `tasteslikegood.com` Jinja templates, which were better-formatted; (c) optionally backfill `is_public` for legacy recipes.
2. **Publishing rate limits.**
3. **LLM pre-publish quality filters.**
4. **Community moderation** (flag/report).
5. **Pantry-aware meal planner** and shopping list generation.
