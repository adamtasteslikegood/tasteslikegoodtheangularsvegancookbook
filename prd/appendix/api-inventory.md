# API Inventory

> **Source:** `Backend/blueprints/*.py`, `Backend/auth.py`, `server/index.ts`
> **Generated:** 2026-07-10

All browser traffic goes through Express (single origin). Express answers `/api/health` itself and proxies every other `/api/*` path to Flask unmodified. "Guest OK" means no login is required — requests are scoped to the authenticated `user_id` when present, otherwise to an auto-created guest `session_id` cookie (every non-static request gets one).

## Production API surface (used by the SPA)

### Auth — `/api/auth/*`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/auth/login` | none | Returns `{authorization_url, state}` for Google OAuth (PKCE; scopes openid/email/profile). 500 if OAuth env vars unset. |
| GET | `/api/auth/callback` | OAuth state cookie | Exchanges the code, upserts the User row (by google_id, then email), sets `session[user_id]` (DB int), **merges guest data** (recipes/cookbooks with the pre-login guest session id are reassigned to the user), then script-redirects to `FRONTEND_URL?auth=success`. Errors: 400 state-missing / email-required; 500 otherwise. |
| GET | `/api/auth/check` | none | Always 200: `{authenticated, user_id, email, name, picture}` or `{authenticated: false, user_id: null}`. |
| GET | `/api/auth/me` | session required | 401 without a session; 200 user info from DB (falls back to session data on DB failure). |
| POST | `/api/auth/logout` | none | Clears the whole session — **including the guest id**, so prior guest data is orphaned. Always 200. |

### AI generation

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/generate` | guest OK | Body `{prompt (10–500 chars required), model (default gemini-3.1-pro-preview)}`. Creates a pending recipe row (`status="generating"`, name "Generating..."), publishes to Pub/Sub topic `recipe-generation`, returns **202** `{recipe_id, status: "generating"}`. 400 on prompt validation; 500 on DB/publish failure (status set to `error`). Express rate-limits to 20/hr/IP. |
| POST | `/api/generate_image` | guest OK | Body `{recipe_id (required), force_regenerate (default false)}`. Returns 200 `{image_url}` if the image already exists and not forcing, else publishes to topic `image-generation` and returns **202** `{status: "generating_image"}`. 404 if the recipe isn't owner-visible. 20/hr/IP. |
| GET | `/api/recipes/<id>/status` | guest OK (owner-scoped) | Polling target: `{status: generating\|ready\|error, recipe: <data blob>}`. |
| GET | `/api/recipes/<id>/image` | public if recipe is public; else owner-scoped | Serves PNG (`Cache-Control: public, max-age=86400`). Source order: cache (currently a no-op stub) → GCS `images/<id>.png` → legacy base64 in the blob. Exempt from Express rate limiting. |
| GET | `/api/recipes/missing-images` | guest OK (owner-scoped) | `{recipes: [{id, name, ai_image_url}], count}` for recipes lacking image data. |

### Recipes CRUD — `/api/recipes`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/recipes` | guest OK | Owner's recipes, newest first: `{recipes: [{id, name, data, created_at, updated_at}], count, ...}`. |
| POST | `/api/recipes` | guest OK | Create or same-owner **upsert** (client-supplied UUID). Only `name` is required — client blobs are stored **without JSON-Schema validation**. This is the only path that writes the `slug` and `is_public` columns. Guests get `is_public` forced to false. Cross-owner ID collision → 500. 201 on success. |
| GET | `/api/recipes/<id>` | guest OK (owner-scoped) | Single recipe. 404 if not owned. |
| PUT | `/api/recipes/<id>` | guest OK (owner-scoped) | Updates `name` + the whole data blob. Does **not** update `slug`/`is_public`/`status` columns. (The SPA does not use PUT.) |
| DELETE | `/api/recipes/<id>` | guest OK (owner-scoped) | Hard delete. 404 if not owned. |
| GET | `/api/recipes/stats` | guest OK | `{total_recipes, ...}`. |
| GET | `/api/recipes/public/<slug>` | none | Public recipe JSON for the save-from-SSR flow; 404 unless `is_public`. |

### Collections (cookbooks) — `/api/collections`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/collections` | guest OK | Owner's cookbooks, newest first. |
| POST | `/api/collections` | guest OK | Body `{name (required), description, id (optional uuid), coverImage, recipeIds}`. 201. No validation that recipeIds reference real recipes. |
| GET | `/api/collections/<id>` | guest OK (owner-scoped) | Single cookbook. |
| DELETE | `/api/collections/<id>` | guest OK (owner-scoped) | Delete cookbook (recipes untouched). |
| POST | `/api/collections/<id>/recipes` | guest OK (owner-scoped) | Body `{recipe_id}`; appends if absent (idempotent). No existence/ownership check on the recipe id. |
| DELETE | `/api/collections/<id>/recipes/<rid>` | guest OK (owner-scoped) | Removes the id (idempotent). |

### Platform & misc

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/health` | none | **Answered by Express**, never proxied: `{status, timestamp, rateLimitStore}`. |
| GET | `/api/status` | none | Flask health: `{status, api_key_loaded, default_model, database}`. The DB probe uses a raw-string `execute("SELECT 1")` — likely always reports `error` under SQLAlchemy 2.x `[TBC]`. |
| GET | `/api/models` | none | Curated cached model list (gemini/gemma only, excludes embedding/imagen/veo/tts/etc., max 10, preferred-first). |
| POST | `/api/models/refresh` | dual-auth | Refreshes the model cache (session credentials → server API key fallback; 401 if neither). Cache file is per-instance/ephemeral. |
| GET | `/api/admin/image-audit` | `Bearer $ADMIN_API_TOKEN` | Audit image storage across **all** recipes. 403 without token (or when the env var is unset). |
| POST | `/api/admin/migrate-images` | admin bearer token | Migrates base64-in-DB images to GCS in batches of 100; fixes legacy URLs. |

### Async workers (Pub/Sub push targets — not browser-callable)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/worker/recipe` | Pub/Sub OIDC JWT (`email == PUBSUB_INVOKER_SA`, verified; `PUBSUB_AUTH_OPTIONAL=1` bypass for dev) | Generates recipe text: rebuilds the schema prompt, calls Gemini (server API key; temperature 0.7, JSON mime type), normalizes units, validates against the Draft-7 recipe schema, retries up to `GENERATION_MAX_ATTEMPTS` (default 3) in-process. Success → `status="ready"` + auto-queues image generation. Exhausted → `status="error"`. **Processing errors return 200** so Pub/Sub never redelivers a poison message. |
| POST | `/api/worker/image` | Pub/Sub OIDC | Generates the food photo with `imagen-4.0-generate-001` (prompt from name + image_keywords, "professional food photography… overhead shot"). GCS-first storage (`gs://$GCS_BUCKET_NAME/images/<id>.png`), base64-in-DB fallback when no bucket. Sets `ai_image_url=/api/recipes/<id>/image`. No retry; failures recorded in `ai_metadata.image_generation`. |

## SSR routes (proxied by Express; see [Public Recipe Pages](../pages/03-public-recipe-pages.md))

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/r/<slug>` | Public recipe HTML (404 unless published). |
| GET | `/browse` | Paginated public index (20/page). |
| GET | `/sitemap.xml` | Dynamic sitemap. |
| GET | `/static/*` | Flask template stylesheets (proxied after Angular assets). |
| GET | `/privacy-policy` | Static HTML served by Express itself. |

## Legacy / deprecated endpoints (registered in Flask but not reachable through Express, or superseded)

- `/auth/login|callback|profile|logout` — old redirect-based OAuth; sets `session[user_id]` to the **email string** (type mismatch with the DB-int convention), never creates DB users or merges guest data. Superseded by `/api/auth/*`.
- `/` , `/recipe/<filename>`, `/recipe/<filename>/json`, `/generate_recipe` — file-based SSR stack operating on the `recipes/` directory (ephemeral on Cloud Run).
- `/api/generate_image/<filename>`, `/api/regenerate_image/<filename>` — legacy synchronous file-based image generation to `static/images/`.
- `/api/report_recipe/<filename>` — appends to `user_reports.json` (file-based, not durable).
- `/api/migrate` — **unauthenticated** file-recipe migration endpoint (reachable through the Express `/api` proxy — flagged as a hardening gap).
- `/api/jokes` — returns jokes from a bundled CSV.

## Cross-cutting API rules

- **Ownership scoping:** authenticated → rows where `user_id` matches; guest → rows where `user_id IS NULL AND guest_session_id` matches. There is no admin override on the CRUD paths.
- **Sessions are client-side signed cookies** (`FLASK_SECRET_KEY`; Secure/SameSite=Lax/HttpOnly in production, shared across apex+www via `SESSION_COOKIE_DOMAIN`). A server-side session table was introduced and later dropped. OAuth tokens live inside the cookie, with `client_secret` deliberately excluded and re-injected from env at use time.
- **Rate limiting lives only in Express** (300/15 min general; 20/hr AI); Flask has none of its own.
- **No Express-layer request validation** — `server/validation.ts` does not exist; `express-validator` is an unused dependency. Flask validates AI prompts (10–500 chars) and requires `name` on recipe/cookbook creation; everything else in client blobs is stored as-is.
