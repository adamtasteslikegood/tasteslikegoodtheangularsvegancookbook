# VeganGenius Chef — Product Requirements Document

> Reverse-engineered from the codebase on 2026-07-10 (app version 0.3.2).
> Repos: `tasteslikegoodtheangularsvegancookbook` (frontend + Express) and the `Backend/` submodule (`tasteslikegood.com`, Flask).
> Production: https://www.tasteslikegood.org

## System Overview

**VeganGenius Chef** is an AI-powered vegan recipe generator and personal cookbook. A visitor types what they're craving; Google Gemini generates a complete, schema-validated vegan recipe, and Imagen generates a professional food photo for it. Recipes are saved into a personal "Kitchen" that can be organized into named cookbooks, edited, imported/exported as JSON, and — for signed-in users — published as server-rendered public pages with full SEO markup.

The product is deliberately **guest-first**: everything except publishing works without an account. Guest data is stored in browser localStorage for instant UI and simultaneously in the backend database, scoped to an anonymous server session. Signing in with Google merges the guest's recipes and cookbooks into the account, making them available across devices. Publishing is reserved for authenticated users because a public page needs an accountable identity behind it.

Architecturally it is a three-tier system: an Angular 22 SPA (Signals, zoneless, **no router** — two views switched by signal + history state), a Node/Express reverse proxy that is the only public service (static hosting, rate limiting, security headers, streaming proxy), and a private Flask API (OAuth, recipe/cookbook CRUD, AI generation orchestrated asynchronously through Pub/Sub push workers). PostgreSQL (Cloud SQL) is authoritative; images live in Google Cloud Storage.

## Module Overview

| Module | Pages / Surfaces | Core Functionality |
|--------|------------------|--------------------|
| Recipe Generation | Generator view | Prompt → async Gemini recipe (202 + status polling) → auto Imagen photo; scaling, notes editing, export |
| Cookbook Management | My Kitchen view | Saved-recipe grid, cookbooks (collections), manual 3-step recipe wizard, JSON import/export, client-side recycle bin |
| Distribution | `/r/<slug>`, `/browse`, `/sitemap.xml` | Publish toggle + slug, SSR pages with schema.org Recipe JSON-LD, save-to-cookbook CTA back into the SPA |
| Identity | Auth modal, profile card | Google OAuth (PKCE) with guest fallback; guest-data merge on login |
| Platform | Express layer | Single-origin proxy, rate limiting (Valkey-distributed), Helmet, Cloud Run deploy with blocking migration job |

## Page Inventory

| # | Page | Route | Module | Doc |
|---|------|-------|--------|-----|
| 1 | Recipe Generator / Recipe Detail | `/` | Recipe Generation | [→](pages/01-recipe-generator.md) |
| 2 | My Kitchen | `/#kitchen` | Cookbook Management | [→](pages/02-my-kitchen.md) |
| 3 | Public Recipe Pages (SSR) | `/r/<slug>`, `/browse`, `/sitemap.xml` | Distribution | [→](pages/03-public-recipe-pages.md) |

Modals (Auth, Create Cookbook, Manual Entry wizard, Add to Cookbook, Delete/Empty-Bin confirmations) are documented inside their triggering page's file.

## Appendices

| Doc | Contents |
|-----|----------|
| [api-inventory.md](appendix/api-inventory.md) | Every endpoint (live, worker, admin, legacy) with params, errors, and business rules |
| [data-model.md](appendix/data-model.md) | DB tables, recipe JSON schema, localStorage shape, image storage strategy |
| [enum-dictionary.md](appendix/enum-dictionary.md) | All statuses, model names, limits, units, infrastructure names |
| [page-relationships.md](appendix/page-relationships.md) | Navigation graph, SSR⇄SPA flows, data coupling |
| [platform-behavior.md](appendix/platform-behavior.md) | Express routes, security, rate limiting, proxy, deployment pipeline |

## Global Notes

### Permission model

There are exactly three actor levels — there is no role system:

1. **Guest** (default) — full generate/save/organize capability, scoped to an anonymous server session + localStorage. Cannot publish (enforced in UI, repository layer, and by data migration).
2. **Authenticated user** (Google OAuth) — everything guests have, plus cross-device sync and publishing. Login merges guest data into the account.
3. **Machine actors** — Pub/Sub workers (OIDC-verified service account) and admin image-maintenance endpoints (`Bearer $ADMIN_API_TOKEN`).

### Common interaction patterns

- **localStorage-first writes:** every mutation updates local state before the API call; the UI never blocks on the network. API failures are logged, rarely surfaced.
- **Async AI with polling:** generation endpoints return 202 immediately; the client polls `/api/recipes/<id>/status` every 2 s. Recipe generation retries up to 3× server-side; image generation does not retry.
- **Idempotent saves:** recipe POST is an upsert for the same owner; a 409/duplicate is treated as success client-side.
- **Destructive actions confirm first:** recipe delete (modal, soft), cookbook delete (native confirm), cookbook-membership removal (inline confirm), empty recycle bin (modal, permanent).
- **Soft delete is client-side only:** the recycle bin lives in localStorage; the server hard-deletes immediately and restore re-creates the row.

### Known gaps & stale-doc corrections (found during analysis)

- `server/validation.ts` **does not exist**; `express-validator` is an unused dependency. Project docs claiming Express-layer validation are stale. All validation is Flask-side (and recipe blobs from clients are stored unvalidated).
- Flask's "Valkey cache" (`extensions.cache`) is a **no-op stub** — docstrings claim 24 h caching that doesn't happen. Only Express uses Valkey (rate limiting).
- `PUT /api/recipes/<id>` never updates the `slug`/`is_public`/`status` columns; publishing works only because the SPA saves via POST-upsert.
- `POST /api/migrate` (legacy file migration) is unauthenticated and reachable through the proxy — hardening gap.
- With the in-memory rate-limit fallback (Valkey down), limits multiply per Cloud Run instance (GH #163/#162, KAN-16/17).
- Legacy surfaces still registered in Flask: redirect-based `/auth/*` (sets `user_id` to an email string, never touches the DB) and the file-based recipe/SSR stack. Treat both as deprecated; they are not reachable through Express except via `/api/*` legacy endpoints.
- `/api/status`'s DB probe likely always reports `error` under SQLAlchemy 2.x (raw-string `SELECT 1`) `[TBC]`.
- Frontend "Export All" exports all recipes regardless of the selected cookbook `[TBC: possibly unintended]`.

### Reconstruction guidance

An engineer or agent rebuilding this product should read the three page docs for exact fields and interaction contracts, `api-inventory.md` + `data-model.md` for the backend contract (including the ownership-scoping and publish-gating invariants), and `platform-behavior.md` for the proxy/rate-limit/deploy envelope. The recipe JSON schema in `data-model.md` is the single source of truth for generated-recipe shape.
