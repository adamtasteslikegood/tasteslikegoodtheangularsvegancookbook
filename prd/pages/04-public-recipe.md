# Page PRD: Public Recipe

- **Route:** `/r/<slug>`
- **Rendering:** Flask SSR proxied through Express
- **Users:** Anonymous visitors, search and social crawlers
- **Source:** `Backend/blueprints/public_bp.py`, `Backend/templates/public/recipe.html`, `Backend/templates/public/base_public.html`

## Purpose

The canonical share/search page for one published recipe. It must be fast, readable without JavaScript, safe for anonymous access, rich in metadata, and able to create a private copy without granting source-row edit rights.

## Routing/visibility

- Server-generated normalized collision-safe slug.
- `200` only for matching `is_public=true` row.
- Missing/private/malformed/unavailable slug returns `404` and never SPA fallback.
- Express proxies status, headers, and body from private Flask.

## Layout

- Public brand/home and Browse navigation.
- My Kitchen action opens accessible explanatory modal before SPA handoff.
- Editorial high-contrast page without advertising clutter.
- Name, description, byline when available, prep/cook time, servings.
- Verified hero image or no-image state.
- Save to My Cookbook primary CTA.
- Pinterest only when a remotely fetchable image exists.
- Grouped ingredients, ordered method, generated notes, and tags.
- Privacy footer.

Never render `personalNotes`, guest/current-holder identifiers, worker state, or private provenance internals.

## Save handoff and provenance

1. CTA navigates `/?save=<slug>#kitchen` with “Opening your kitchen…” feedback.
2. Angular validates slug and fetches `/api/recipes/public/:slug`.
3. Mapper creates a new private `origin=saved` recipe.
4. Server resolves/stores immutable `source_recipe_id` and link-compatible `source_slug`.
5. Save finishes in `/kitchen` with success/duplicate/error.

The source ID is never reused as writable copy identity. Client-supplied provenance cannot erase or override server-known provenance.

### Saved-copy invariants

- Private edits never mutate source.
- Copy cannot publish even if a request sends `is_public=true` or omits `sourceSlug`.
- Every SPA surface shows the same source lock.
- View returns to source `/r/<sourceSlug>`.
- Repeat save returns `409 RECIPE_ALREADY_SAVED`; SPA treats it as existing success.
- Dedup uses persisted source identity, never title similarity.

## SEO/sharing

- Unique title and description.
- Canonical `https://www.tasteslikegood.org/r/<slug>`.
- Production index/follow.
- Open Graph and Twitter title/description/URL/image when deliverable.
- Recipe JSON-LD with applicable author/dates, prep/cook/total time, yield, ingredients, `HowToStep`, keywords/category, and verified image.
- Escaped metadata from public allowlist only.
- Staging edge overrides with `noindex, nofollow`.

## Images

- `/api/recipes/:id/image` authorizes owner or public row.
- MIME sniffing allows supported image bytes (JPEG/PNG/WebP/GIF).
- Public response cache up to one day; private is `no-store`; cache invalidates on regeneration.
- SSR advertises an image only when GCS/base64/stock source is actually deliverable.
- No Pinterest action without a fetchable image.

## Accessibility/resilience

- Complete recipe works without JS.
- Semantic heading/list/instruction structure.
- My Kitchen modal traps focus, closes with Escape, and restores focus.
- Text-labeled controls and meaningful image alt.
- Missing optional data degrades without template crash.

## Relationships

Listed on [Browse](05-public-browse.md); created/unpublished from [Generator](01-recipe-generator.md) or [Recipe Detail](03-recipe-detail.md); CTA enters [My Kitchen](02-my-kitchen.md); included in sitemap while public.

## Acceptance

1. Public slug returns safe `200`; private/missing returns `404`.
2. Complete recipe and metadata render without private notes.
3. Image/share markup appears only for deliverable image.
4. Save creates an owner-scoped provenance copy, never source edit access.
5. Copy remains unpublishable through UI/direct API.
6. Repeat save leaves one copy and benign message.
7. Page works without JS and on mobile.
8. Production indexes; staging does not.
