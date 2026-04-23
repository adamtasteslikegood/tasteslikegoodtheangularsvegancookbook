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
- Update Express routing to proxy `/r/*`, `/browse`, and `/sitemap.xml` to Flask *before* the Angular catch-all.
- Address image endpoint auth so public recipes have public images.

## Phase 3: Templates & SEO Polish
- Rewrite Jinja templates (`recipe.html`, `browse.html`, `base.html`) for a zero-fluff, print-friendly experience.
- Implement Schema.org `Recipe` JSON-LD, canonical URLs, OG tags, and Twitter Cards.
- Add Pinterest share button and auto-generated `sitemap.xml`.

## Phase 4: Conversion & Launch
- Implement "Save to your cookbook" CTA routing to the SPA guest session flow.
- Run `/plan-eng-review` to pressure-test architecture and rollout strategy.
- Cut `v0.2.0` release.

## Future Horizons (v0.3+)
- Publishing rate limits.
- LLM pre-publish quality filters.
- Community moderation (flag/report).
- Pantry-aware meal planner and shopping list generation.
