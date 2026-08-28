# Page PRD: Public Browse

- **Route:** `/browse?page=N`
- **Rendering:** Flask SSR proxied through Express
- **Users:** Public visitors and crawlers
- **Source:** `Backend/blueprints/public_bp.py`, public browse and base templates

## Purpose

The discovery index lists safe published vegan recipes and links each card to its canonical `/r/<slug>` page without requiring Angular.

## Query contract

- 20 recipes per page, newest public first.
- Non-integer, zero, and negative page values normalize to page 1.
- Beyond-range values clamp to last available page when results exist.
- Only public, usable-slug rows enter the result.

## Layout

- Shared SSR brand/Browse/My Kitchen modal and Privacy footer.
- Discovery heading/description.
- Responsive card grid.
- Cards include verified image/fallback, name, optional description, timing, optional byline, and first three tags.
- Crawlable `/r/<slug>` card links.
- Previous/Next only where available plus current/total page context.
- Empty state links to generation.

## Safety/SEO

- No `personalNotes`, owner/session/worker fields, or private images.
- Image deliverability check prevents broken previews.
- Production canonical/indexable metadata and sitemap linkage.
- Staging edge sets `noindex, nofollow` and disallow-all robots.
- Known crawlers skip only public-page rate limiting, not authorization.

## Performance/resilience

- SSR requires no Angular boot/client fetch.
- Pagination bounds database/render load.
- Missing optional field/image degrades card-by-card.
- SSR status codes do not fall into Angular fallback.
- Page limit defaults to 300/15 minutes/IP in its own Valkey keyspace.

## Actions/relationships

Card opens [Public Recipe](04-public-recipe.md); My Kitchen/home enters [Kitchen](02-my-kitchen.md)/[Generator](01-recipe-generator.md); Privacy opens [policy](06-privacy-policy.md). Publish/unpublish changes membership.

## Acceptance

1. Only public slug-addressable rows, newest first, at 20/page.
2. Invalid/range queries resolve safely.
3. Cards remain useful with missing optional content.
4. Canonical links are crawlable and private data absent.
5. Empty/multi-page states render valid HTML.
6. Production indexes and staging does not.
