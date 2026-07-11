# Public Recipe Pages (SSR)

> **Routes:** `/r/<slug>`, `/browse`, `/sitemap.xml` (+ JSON companion `/api/recipes/public/<slug>`)
> **Module:** Recipe Distribution (v0.2 "anti-recipe-site" pages)
> **Source:** `Backend/blueprints/public_bp.py`, `Backend/templates/public/`; proxied by Express (`server/index.ts` SSR routes)
> **Generated:** 2026-07-10

## Overview

Published recipes get real server-rendered HTML pages so search engines, social cards, and no-JS visitors see full content instead of the empty SPA shell. Express proxies `GET /r/*`, `/browse`, `/sitemap.xml`, and `/static/*` (template stylesheets) to Flask; everything else falls through to the SPA. Only recipes explicitly published by a **signed-in** owner appear here.

## Pages

### Recipe page — `GET /r/<slug>`

- Renders the recipe where `slug` matches AND `is_public` is true; anything else is a 404 (unpublished, guest-owned, unknown slug).
- Content: recipe name, description, hero image, timing/servings, ingredients formatted as `amount units name (notes)` (ranges as `a–b`), numbered instructions, tags.
- Image selection order: `ai_image_url` → the image-serving endpoint (when GCS/base64 data exists) → `stock_image_url`; all made absolute against `FRONTEND_URL`.
- SEO: canonical URL, meta description, and **schema.org Recipe JSON-LD** — name, description, author (user's name, else Organization "TastesLikeGood"), datePublished/Modified, prep/cook/total time as ISO-8601 durations, recipeYield, recipeIngredient, recipeInstructions (HowToStep list), keywords from tags, `recipeCategory: "Vegan"`. Empty/null fields are stripped.
- Sharing: Pinterest share link.
- CTAs into the SPA: "Save to Cookbook" → `/?save=<slug>#kitchen` (triggers the SPA save flow — see [Page Relationships](../appendix/page-relationships.md)), plus deep-links to the generator/kitchen.

### Companion JSON — `GET /api/recipes/public/<slug>`

Powers the SPA's save-from-SSR flow. Returns `{id, name, description, prepTime, cookTime, servings, ingredients, instructions, notes, tags, stock_image_url, ai_image_url, image, slug, is_public}`; 404 when not found or not public. The SPA saves a **copy under a fresh ID** — the visitor's cookbook entry is independent of the source recipe.

### Browse index — `GET /browse`

Paginated list of all public recipes, newest first, **20 per page**, `?page=n` (out-of-range values clamped). Each entry links to its `/r/<slug>` page. Canonical URL in meta.

### Sitemap — `GET /sitemap.xml`

Dynamic XML sitemap: `/` (priority 1.0, daily), `/browse` (0.9, daily), and every public recipe with a slug as `/r/<slug>` (0.8, weekly) with `lastmod` from the recipe's update date.

## Interactions

### Publishing lifecycle (cross-page)

1. A signed-in user flips the Public toggle in the SPA detail view; the frontend generates a slug from the recipe name if none exists (lowercase, hyphenated, punctuation stripped) and saves via `POST /api/recipes` (upsert).
2. The POST-upsert path is the **only** API path that writes the `slug` and `is_public` database columns (PUT updates only the JSON blob). Since the SPA always saves recipes via POST, publish/unpublish works; an API client using PUT could not change publish state `[TBC: likely unintentional asymmetry]`.
3. Slug uniqueness is enforced by a unique index; the SPA does not currently surface a duplicate-slug error specially (the save fails, is logged to console, and the toggle reverts).
4. Once public: the page is live at `/r/<slug>`, listed on `/browse`, included in `/sitemap.xml`, and its image endpoint becomes publicly readable (ownership check skipped for public recipes so crawlers can load images).
5. Unpublishing (toggle off + POST) returns the page to 404.

### Guest gating

Guests can never publish. Enforced at three layers:

- **UI:** guests see "Sign in to publish" instead of the toggle (shown only after the recipe is saved, so an OAuth redirect never strands an unsaved recipe).
- **API:** the repository forces `is_public=false` on create and update for any request without an authenticated `user_id` (logged as a warning).
- **Data migration:** pre-gate guest-published rows were reassigned to a designated account (`GUEST_PUBLIC_REASSIGN_EMAIL`, keeping indexed URLs alive) or unpublished; an unmatched email aborts the deploy.

Rationale: a public page needs an accountable identity behind it for moderation.

## Robots / indexability

Express adds `X-Robots-Tag: index, follow` to HTML responses only in production, so staging deploys aren't indexed.

## Page Relationships

- **From SPA:** the slug field's open-in-new-tab link on the recipe detail view.
- **To SPA:** "Save to Cookbook" CTA (`/?save=<slug>#kitchen`) and nav links; the SPA validates the slug (`^[a-z0-9-]+$` after normalization), fetches the public JSON, saves a copy, and lands on My Kitchen.
- **To each other:** `/browse` → `/r/<slug>`; `/sitemap.xml` → both.

## Business Rules

- Public pages are read-only; there is no commenting, rating, or forking beyond "save a copy".
- `recipeCategory` is always "Vegan" — the product's core promise is baked into structured data.
- Legacy file-based SSR routes (`/`, `/recipe/<filename>`, `/generate_recipe` on Flask) still exist but are **not reachable through Express in production** (Express serves the SPA at `/` and only proxies `/r/*`, `/browse`, `/sitemap.xml`, `/static/*`); they operate on an ephemeral `recipes/` directory and predate the database. Treat them as deprecated.
