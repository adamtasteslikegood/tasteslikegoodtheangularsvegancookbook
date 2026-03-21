# VeganGenius Chef — Current Status & Plan

**Updated:** 2026-03-21T19:32Z

---

## ✅ Completed Today

### Valkey IAM Auth — FIXED

- **Root cause:** `AUTH <sa-email> <token>` (two args) was wrong. Memorystore for Valkey expects `AUTH <token>` (
  password only).
- **Fix:** Removed broken `CredentialProvider`, use direct `password=token` auth.
- **Token refresh:** Background daemon thread refreshes every 50 min (tokens expire at 60 min).
- **Deployed:** `flask-backend-00040-gzk` — clean startup, no errors, no fallbacks.
- **Logs confirm:** `Valkey connection OK`, `Using Valkey session backend`, `Using Valkey/Redis cache backend`.

### Login Button Disappearing — FIXED

- **Root cause:** When Flask session expired, localStorage still had cached Google-authed user with `isGuest: false`.
  Template showed stale profile dropdown instead of Sign In button.
- **Fix:** `AuthService.init()` now downgrades stale non-guest users to guest when Flask says "not authenticated."
  Recipes preserved, merge back on re-login.
- **Deployed:** `express-frontend-00017-n49`.

### Earlier Today (from prior checkpoints)

- Container crash fix (Valkey graceful fallback)
- Flask-Caching crash fix (SimpleCache fallback)
- Image URL auto-set in `_strip_image_data()`
- `loadFromApi()` retry logic (2 retries, 1s delay)

---

## Current Architecture Status

| Component       | Status     | Notes                                             |
|-----------------|------------|---------------------------------------------------|
| Valkey sessions | ✅ Working  | IAM auth, TLS, token refresh thread               |
| Valkey cache    | ✅ Working  | Shares same client as sessions                    |
| GCS images      | ✅ Working  | New images go to GCS bucket                       |
| Cloud SQL       | ✅ Working  | Recipes, users, collections                       |
| OAuth login     | ✅ Working  | Google OAuth via Flask sessions in Valkey         |
| Login button    | ✅ Fixed    | Stale sessions downgraded to guest                |
| Image serving   | ⚠️ Partial | New images via GCS, old images still base64 in DB |

---

## Pending Work (prioritized)

### 1. `gcs-cleanup` — Remove legacy base64 image code

- Run `POST /api/admin/migrate-images` to move old base64 images to GCS
- Remove base64 fallback code paths in `generation_api_bp.py`
- Simplify `serve_recipe_image` to GCS-only
- **Impact:** Simpler code, consistent image serving

### 2. `redis-rate-limiting` — Valkey Rate Limiting

- Migrate Express rate limits from in-memory to Valkey
- Shared rate limiting across Cloud Run instances
- **Impact:** Proper rate limiting in production

### 3. `pubsub-async-generation` — Pub/Sub Async Generation (FUTURE)

- Async AI generation via Cloud Pub/Sub
- Decouple request from generation
- **Impact:** Better UX for slow generations

### 4. `sse-realtime` — SSE Real-time Updates (FUTURE/OPTIONAL)

- Server-Sent Events for real-time recipe updates
- **Impact:** Live collaboration features

---

## Key Technical Decisions

- **Valkey IAM auth:** Password-only (`AUTH <token>`), NOT `AUTH <username> <token>`
- **Token refresh:** Background thread, not CredentialProvider (redis-py protocol issue with Valkey TLS)
- **Stale session handling:** Downgrade to guest, preserve recipes locally
- **Image storage:** GCS for new images, migration endpoint ready for old ones
- **Session backend:** Valkey (primary), SQLAlchemy (fallback if Valkey unavailable)

---

## Deployed Revisions (Today)

| Revision                     | What                                          |
|------------------------------|-----------------------------------------------|
| `express-frontend-00017-n49` | Login button fix (stale session downgrade)    |
| `flask-backend-00040-gzk`    | Valkey token refresh, clean direct auth       |
| `flask-backend-00039-g9f`    | Valkey IAM auth fix (password-only)           |
| `flask-backend-00038-vlf`    | Image URL fix + graceful Valkey fallback      |
| `flask-backend-00037-z4k`    | Container crash fix (Valkey + cache fallback) |
