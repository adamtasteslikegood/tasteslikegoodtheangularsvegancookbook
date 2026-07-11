# Data Model

> **Source:** `Backend/models/*.py`, `Backend/migrations/versions/*.py`, `Backend/recipe_schema.json`, `src/recipe.types.ts`, `src/auth.types.ts`
> **Generated:** 2026-07-10

PostgreSQL (Cloud SQL) in production, SQLite locally. Three tables. Recipes store their full content as a JSON blob in a single column; cookbooks reference recipes by ID array (no join table, no FK).

## `user`

| Column | Type | Constraints |
|--------|------|-------------|
| id | Integer | PK, autoincrement |
| email | String(120) | UNIQUE, NOT NULL |
| name | String(100) | nullable |
| google_id | String(100) | UNIQUE, nullable |
| created_at | DateTime | NOT NULL, default now (UTC) |

Users exist only via Google OAuth — there is no password column and no local registration. Guests have **no** user row; their data hangs off a session id.

## `recipe`

| Column | Type | Constraints |
|--------|------|-------------|
| id | String(36) | PK — client- or server-generated UUID4 |
| user_id | Integer | FK → user.id, nullable (**NULL = guest-owned**) |
| guest_session_id | String(64) | nullable, indexed |
| name | String(200) | NOT NULL |
| status | String(20) | NOT NULL, default `ready` — values: `ready` / `generating` / `error` |
| slug | String(255) | nullable, **UNIQUE index** — public URL path segment |
| is_public | Boolean | NOT NULL, default false — gates `/r/<slug>`, `/browse`, sitemap |
| data | JSON (MutableDict) | NOT NULL — the full recipe blob (below) |
| created_at / updated_at | DateTime | NOT NULL, UTC defaults; updated_at auto-bumps |

**Ownership invariant:** exactly one of (`user_id`, `guest_session_id`) identifies the owner. On login, guest rows are migrated (`user_id` set, `guest_session_id` cleared). **Publish invariant:** `is_public` may only be true when `user_id` is non-NULL (repository-enforced; historical violations cleaned by migration `e91b47a2c5d3`).

## `cookbook` (API name: "collections")

| Column | Type | Constraints |
|--------|------|-------------|
| id | String(36) | PK (UUID string) |
| user_id | Integer | FK → user.id, nullable |
| guest_session_id | String(64) | nullable, indexed |
| name | String(200) | NOT NULL |
| description | String(500) | nullable, default `""` |
| cover_image | String(500) | nullable |
| recipe_ids | JSON | NOT NULL, default `[]` — plain array of recipe UUIDs, no referential integrity |
| created_at / updated_at | DateTime | NOT NULL |

API serialization uses camelCase: `coverImage`, `recipeIds`.

## Recipe `data` blob — JSON Schema (Draft-07, `recipe_schema.json`)

AI-generated recipes are validated against this schema before being marked ready. Client-saved recipes (manual entry, import, edits) are **not** validated server-side.

**Required:** `name` (string), `prepTime` (int, minutes), `cookTime` (int), `servings` (int), `ingredients`, `instructions`.

| Field | Type | Rules |
|-------|------|-------|
| ingredients | object of groups | Required groups `wet` and `dry`; optional `other`; arbitrary extra group names allowed. |
| ingredients.<group>[] | ingredient object | `name` (req), `amount` (number **or** number[] for ranges, req), `units` (string, req), `notes` (opt). |
| instructions | array | Each item: plain string OR `{step?: int ≥ 1, description: string}` (no extra keys). |
| description, notes | string | Optional. |
| tags | string[] | Optional. |
| image_keywords | string[] | Optional, 1–5 items — stock-photo search terms the generator must include. |
| stock_image_url, ai_image_url, image | uri or null | Optional. |
| user_id | string | Optional (legacy). |
| ai_metadata | object | `recipe_generation` (model, prompt, timestamp, success, user identity), `image_generation` (nullable; `{success: false, error, timestamp}` on failure), `stock_image_generation` (nullable), legacy `model`/`timestamp`/`prompt`, `images_working`. |

**Backend-written fields outside the schema** (top-level `additionalProperties` is open, so they pass): `id`, `ai_image_gcs` (GCS object name), `ai_image_data` (legacy base64 PNG), `stock_image_attribution`, `slug`, `is_public`.

## Frontend types (localStorage session record)

The Angular `User` object cached under localStorage key `vegan_genius_session`:

| Field | Notes |
|-------|-------|
| id | DB user id (authenticated) or client UUID (guest) |
| email, name, picture | From Google profile; guest name is "Guest Chef" |
| isGuest, authProvider | `google` \| `guest` |
| savedRecipes | Recipe[] — base64 `data:` image URLs stripped before write (5 MB quota) |
| cookbooks | `{id, name, description, recipeIds, coverImage?}` |
| deletedRecipes | `{recipe, deletedAt (ISO), cookbookIds?}[]` — the recycle bin, **client-side only** |

## Image storage strategy

1. **GCS (production):** `gs://$GCS_BUCKET_NAME/images/<recipe_id>.png` (prod bucket `tasteslikegood-recipe-images`); blob carries `ai_image_gcs` and `ai_image_url = /api/recipes/<id>/image`.
2. **Base64-in-DB (legacy/local):** `ai_image_data` in the blob when no bucket is configured. An admin endpoint migrates these to GCS.
3. Raw image bytes are stripped from API list/read responses and never stored in browser localStorage; clients always reference the serving endpoint.

## Sessions

Client-side signed cookies only (Flask default, `FLASK_SECRET_KEY`). Keys: `session_id` (guest identity, auto-created on every non-static request), `state` + `code_verifier` (OAuth/PKCE), `credentials` (OAuth tokens, minus client_secret), `user_info`, `user_id` (DB int), `db_user`. A `flask_sessions` server-side table was created (migration `e5a1b3c7d9f2`) and later dropped (`03da1e46c9a5`) — do not document server-side sessions as current behavior.
