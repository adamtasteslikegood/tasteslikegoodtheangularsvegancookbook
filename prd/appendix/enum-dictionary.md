# Enum & Constant Dictionary

> **Generated:** 2026-07-10

## Recipe status (`recipe.status`, String(20) — no DB enum)

| Value | Meaning | Set by |
|-------|---------|--------|
| `ready` | Recipe content is complete (default) | Worker on successful generation; default for client-saved recipes |
| `generating` | Async Gemini generation queued/in progress | `POST /api/generate` |
| `error` | Generation failed after all retries (or queueing failed) | Worker / generate endpoint |

## Auth providers (frontend `AuthProvider`)

| Value | Meaning |
|-------|---------|
| `google` | Google OAuth via Flask |
| `guest` | Local guest session ("Guest Chef") |

## Ingredient groups

`wet`, `dry` (required by the AI schema), `other` (optional). The manual-entry wizard offers exactly these three. Extra group names are schema-legal but never produced by the UI.

## Ingredient types in manual entry

`wet` | `dry` | `other` — default `dry`.

## Canonical ingredient units (normalization, fuzzy-match cutoff 0.8; missing unit → `qty`)

`cup, tsp, Tbsp, oz, g, kg, ml, l, lb, pinch, qty, to taste`

## Amount display fractions (frontend)

0.25 → `1/4`, 0.33 → `1/3`, 0.5 → `1/2`, 0.66 → `2/3`, 0.75 → `3/4` (±0.01 tolerance); array amounts render as `a - b`.

## Portion multipliers

`0.5x`, `1x` (default), `2x` — display-only scaling.

## AI models

| Constant | Value | Used by |
|----------|-------|---------|
| Default text model | `gemini-3.1-pro-preview` (no `models/` prefix) | `POST /api/generate` |
| Legacy form default | `models/gemini-2.5-flash` | Legacy `/generate_recipe` |
| Image model | `imagen-4.0-generate-001` | Image worker + legacy image endpoints |
| Preferred-model sort order | `models/gemini-2.5-pro`, `models/gemini-2.5-flash`, `models/gemini-2.0-flash`, `models/gemini-2.0-flash-exp`, `models/gemini-3-pro-preview`, `models/gemini-2.0-flash-lite`, `models/gemini-exp-1206`, `models/gemini-pro-latest`, `models/gemini-flash-latest` | `/api/models` |
| Model filter | only `gemini`/`gemma`; excludes names containing `embedding, imagen, veo, live, tts, audio, robotics, aqa`; max **10** returned | `/api/models` |

## Limits & thresholds

| Limit | Value | Where |
|-------|-------|-------|
| Prompt length | 10–500 chars | Flask `/api/generate` (and legacy form) |
| General API rate limit | 300 req / 15 min / IP | Express, `/api/*` |
| AI rate limit | 20 req / hour / IP | Express, `/api/generate*` (shared bucket with Valkey; separate with in-memory fallback) |
| Generation retries | `GENERATION_MAX_ATTEMPTS`, default 3 | Recipe worker (in-process) |
| Generation temperature | 0.7 | Gemini calls |
| Images per generation | 1 | Imagen |
| Image polling interval | 2 s | Frontend status polling |
| Hydration retries | 2 (1 s apart) | Frontend `loadFromApi` |
| Browse page size | 20 | `/browse` |
| Admin image migration batch | 100 | `/api/admin/migrate-images` |
| Image cache header | `public, max-age=86400` | `/api/recipes/<id>/image` |
| Express JSON body limit | 50 KB (post-proxy routes only) | Express |
| localStorage quota strategy | base64 `data:` URLs stripped before write | Frontend |
| Report reason | truncated to 500 chars | Legacy `/api/report_recipe` |
| Column lengths | user.email 120, user.name 100, google_id 100; recipe.name 200, status 20, slug 255, guest_session_id 64; cookbook.name 200, description 500, cover_image 500 | DB |

## Session keys (Flask signed cookie)

`session_id` (guest identity), `state`, `code_verifier` (OAuth PKCE), `credentials` (tokens, minus client_secret), `user_info`, `user_id` (DB int), `db_user`.

## Infrastructure names

| Item | Value |
|------|-------|
| Pub/Sub topics | `recipe-generation`, `image-generation` |
| GCS objects | `images/<recipe_id>.png`; prod bucket `tasteslikegood-recipe-images` |
| Cloud Run services | `express-frontend` (public, :8080), `flask-backend` (private), `flask-backend-migrate` (job) |
| Rate-limit key prefixes | `rl:api:`, `rl:expensive:` (Valkey) |
| Cache key scheme (currently no-op) | `vgc:{u:<uid>\|g:<sid>}:r:<rid>`, `...:rstats`, `...:colls`, `...:c:<cid>`, `vgc:img:<rid>` |
| localStorage key | `vegan_genius_session` |
| Deploy tag pattern | `^v[0-9]+\.[0-9]+\.[0-9]+$` (pre-release/metadata tags do not deploy) |

## OAuth scopes

`openid`, `https://www.googleapis.com/auth/userinfo.email`, `https://www.googleapis.com/auth/userinfo.profile`
