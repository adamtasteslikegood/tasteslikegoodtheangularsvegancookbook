# Appendix: API and Route Inventory

- **Target:** v0.4.12
- **Browser origin:** `https://www.tasteslikegood.org`
- **Transport boundary:** Browser-facing Express proxies product API and SSR requests to private Flask.

## 1. Identity conventions

| Caller         | Identity mechanism                                             | Scope                                             |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------- |
| Guest SPA      | `X-Guest-Session-ID` UUID plus browser local state             | Guest-owned recipes and cookbooks                 |
| Signed-in SPA  | Secure Flask session created by Google OAuth                   | User-owned recipes and cookbooks                  |
| Public visitor | No user identity                                               | Allowlisted public recipes, HTML, and images only |
| Express proxy  | Google-signed ID token in `X-Serverless-Authorization`         | Invocation permission on private Flask Cloud Run  |
| Pub/Sub        | Verified OIDC bearer token for configured push service account | `/api/worker/*` only                              |
| Administrator  | Server-validated admin bearer token                            | Image audit and migration operations              |

Express controls service-authorization headers and obtains its own private-service token. Browser session identity and Cloud Run invoker identity are distinct.

## 2. Product recipe and generation APIs

| Method   | Path                        | Caller                                  | Success                         | Contract and principal errors                                                                                                                            |
| -------- | --------------------------- | --------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/generate`             | Guest or user                           | `202` pending recipe            | `prompt` is trimmed 10–500 characters; optional model override. Persists row and publishes Pub/Sub. `400`, `429`, controlled queue/config failure.       |
| `POST`   | `/api/generate_image`       | Recipe owner/guest                      | `202` or current pending state  | Identifies recipe and optional force intent. Enqueues Gemini 3.1 Flash Image work. Ownership, validation, rate, and configuration refusals are explicit. |
| `GET`    | `/api/recipes/:id/status`   | Recipe owner/guest                      | `200` status and recipe data    | Returns owner-scoped top-level status plus recipe metadata. `404` for unavailable scope.                                                                 |
| `GET`    | `/api/recipes/:id/image`    | Owner/guest or anonymous for public row | Image bytes                     | Owner-or-public authorization, MIME sniffing, public one-day cache, private `no-store`; `404` when unavailable. Exempt from general API limit.           |
| `GET`    | `/api/recipes`              | Guest or user                           | Owner-scoped recipe rows        | Never returns another owner's private rows.                                                                                                              |
| `POST`   | `/api/recipes`              | Guest or user                           | Created or reconciled owner row | Validates owner, origin, provenance, publication, slug, and duplicate identity. Important `409` codes below.                                             |
| `GET`    | `/api/recipes/:id`          | Guest or user                           | Owner-scoped row                | `404` for missing or unavailable identifier.                                                                                                             |
| `PUT`    | `/api/recipes/:id`          | Owner guest/user                        | Updated row                     | Enforces immutable ownership, origin/provenance, and publication locks.                                                                                  |
| `DELETE` | `/api/recipes/:id`          | Owner guest/user                        | Deleted row                     | Canonical rows are locked; another owner's row is unavailable or refused.                                                                                |
| `GET`    | `/api/recipes/stats`        | Guest or user                           | Owner-scoped counts             | Five-minute cache, invalidated on recipe mutation.                                                                                                       |
| `GET`    | `/api/recipes/public/:slug` | Anonymous                               | Safe public payload             | `404` unless public. Allowlist excludes personal notes, session IDs, and private worker/ownership data.                                                  |

### 2.1 Recipe save refusal mapping

| HTTP and code                       | Meaning                                                | Client behavior                                                                  |
| ----------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `409 RECIPE_ALREADY_SAVED`          | Same provenance identity already exists in owner scope | Benign existing-recipe outcome; show “Good news — you already have this recipe.” |
| `409 OWNERSHIP_OTHER_ACCOUNT`       | Different signed-in account owns row                   | Stop; do not create or overwrite local copy under that ID                        |
| `409 OWNERSHIP_OTHER_GUEST_SESSION` | Different guest session owns row                       | Offer sign-in/recovery guidance; do not overwrite                                |
| `409 OWNERSHIP_ORPHANED_GUEST_ROW`  | Signed-in caller reached an unclaimed guest row        | Explain mismatch; do not silently claim                                          |
| `400` manual publication            | `origin=manual` cannot publish                         | Revert switch and explain                                                        |
| `403` saved-copy refusal            | Persisted source provenance forbids publication        | Revert or lock switch and link to source                                         |
| `400` canonical lock                | Canonical publication, slug, and deletion are locked   | Keep locked state                                                                |
| `400` public slug required          | No usable normalized slug can be produced              | Keep private and explain                                                         |

## 3. Cookbook APIs

Base blueprint: `/api/collections`.

| Method   | Path                                     | Caller           | Contract                                                                                                                 |
| -------- | ---------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET`    | `/api/collections`                       | Guest or user    | List owner-scoped cookbooks; five-minute list cache                                                                      |
| `POST`   | `/api/collections`                       | Guest or user    | Create trimmed named cookbook. Repeated/idempotent request may return existing object; database uniqueness closes races. |
| `GET`    | `/api/collections/:id`                   | Owner guest/user | Return one cookbook and membership data; ten-minute object cache                                                         |
| `DELETE` | `/api/collections/:id`                   | Owner guest/user | Delete cookbook only; recipes remain                                                                                     |
| `POST`   | `/api/collections/:id/recipes`           | Owner guest/user | Add owner-scoped recipe membership idempotently                                                                          |
| `DELETE` | `/api/collections/:id/recipes/:recipeId` | Owner guest/user | Remove membership; recipe remains                                                                                        |

Collection mutations invalidate collection list and object caches.

## 4. Authentication APIs

Base blueprint: `/api/auth`.

| Method | Path                 | Caller            | Contract                                                                                       |
| ------ | -------------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `GET`  | `/api/auth/login`    | Browser           | Create OAuth authorization request with state and PKCE; return authorization destination       |
| `GET`  | `/api/auth/callback` | Google redirect   | Verify state/PKCE, create or update user/session, merge guest state, redirect `/?auth=success` |
| `GET`  | `/api/auth/me`       | Signed-in browser | Return safe current-user profile and application state                                         |
| `POST` | `/api/auth/logout`   | Browser           | Clear session                                                                                  |
| `GET`  | `/api/auth/check`    | Browser           | Return explicit authenticated or guest state; transient SPA failure is not explicit logout     |

OAuth scopes are limited to `openid`, `userinfo.email`, and `userinfo.profile`. Embedded browsers known to block Google OAuth are handled by the SPA before navigation.

## 5. Public SSR routes

| Method | Path             | Auth      | Contract                                                                  |
| ------ | ---------------- | --------- | ------------------------------------------------------------------------- |
| `GET`  | `/r/<slug>`      | Anonymous | Render one public recipe or `404`; safe body, metadata, JSON-LD, save CTA |
| `GET`  | `/browse?page=N` | Anonymous | Public recipes newest first, 20 per page; normalized and clamped page     |
| `GET`  | `/sitemap.xml`   | Anonymous | Home, browse, and current public URLs with available last-modified data   |
| `GET`  | `/static/*`      | Anonymous | Flask SSR static assets proxied by Express                                |

## 6. Express-owned routes

| Method | Path                                         | Contract                                                                                     |
| ------ | -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `GET`  | `/api/health`                                | Low-cost JSON health with timestamp, environment, and rate-limit-store state; limiter exempt |
| `GET`  | `/privacy-policy`                            | Static standalone policy HTML                                                                |
| `GET`  | `/robots.txt`                                | Production crawling policy or staging disallow-all                                           |
| `GET`  | `/favicon.ico`, `/apple-touch-icon*`         | Static brand assets                                                                          |
| `GET`  | `/`, `/kitchen`, `/recipe/*`, `/chunk-error` | Serve Angular shell; Angular owns client routing                                             |
| `GET`  | Unknown non-asset path                       | Serve SPA shell; Angular wildcard redirects `/`                                              |
| Any    | Unknown asset-like path                      | `404`; never return `index.html` as an asset                                                 |

Recognized asset extensions include JavaScript, CSS, maps, JSON, fonts, SVG, raster images, icons, and web manifests. Named SSR and API routes take precedence over extension detection.

## 7. Worker APIs

Base blueprint: `/api/worker`. These are machine routes, not browser product APIs.

| Method | Path                 | Auth                                  | Contract                                                                                                                                                                                  |
| ------ | -------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/worker/recipe` | Verified Pub/Sub OIDC service account | Decode envelope, claim lease, call Gemini 3.7 Flash by default, validate schema, persist ready or error, enqueue image. Duplicate delivery is idempotent.                                 |
| `POST` | `/api/worker/image`  | Verified Pub/Sub OIDC service account | Claim current image request, call Gemini 3.1 Flash Image, validate bytes, write versioned GCS object, persist metadata/ready, invalidate cache. Retryable failures return retry response. |

If `PUBSUB_INVOKER_SA` is absent in a deployed non-optional environment, worker endpoints fail closed. `PUBSUB_AUTH_OPTIONAL=1` is controlled local/test behavior only.

## 8. Administrative and compatibility APIs

These source routes exist but are not primary consumer product flows.

| Method     | Path                                            | Role or status                                                     |
| ---------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| `GET`      | `/api/admin/image-audit`                        | Admin bearer; image metadata/object consistency                    |
| `POST`     | `/api/admin/migrate-images`                     | Admin bearer; legacy image migration                               |
| `GET`      | `/api/recipes/missing-images`                   | Operational inventory; deployed access must be restricted/verified |
| `GET`      | `/api/models`                                   | Legacy or developer model inventory                                |
| `POST`     | `/api/models/refresh`                           | Legacy or developer refresh                                        |
| `POST`     | `/api/generate_image/<filename>`                | Legacy file-recipe image flow                                      |
| `POST`     | `/api/regenerate_image/<filename>`              | Legacy file-recipe regeneration                                    |
| `POST`     | `/api/report_recipe/<filename>`                 | Legacy recipe report                                               |
| `GET`      | `/api/status`                                   | Legacy application status                                          |
| `POST`     | `/api/migrate`                                  | Legacy migration route; not production Cloud Run migration job     |
| `GET`      | `/api/jokes`                                    | Auxiliary compatibility endpoint                                   |
| `GET/POST` | `/generate_recipe`                              | Legacy Flask HTML and file-generation flow                         |
| `GET`      | `/recipe/<filename>`, `/recipe/<filename>/json` | Legacy file-backed pages and data                                  |
| `GET`      | `/auth/*`                                       | Legacy HTML auth blueprint alongside `/api/auth/*`                 |

The retirement and access-hardening boundary for legacy routes is **[TBC]**. New product behavior uses JSON APIs and the Cloud Run migration job.

## 9. Rate limits and validation

| Class                | Default                   | Exemptions and notes                                                   |
| -------------------- | ------------------------- | ---------------------------------------------------------------------- |
| General `/api`       | 300 per 15 minutes per IP | Health and recipe image-serving paths skipped                          |
| Public HTML page     | 300 per 15 minutes per IP | Static subresources and known crawlers skipped; separate Valkey prefix |
| Expensive generation | 20 per hour per IP        | Recipe and image generation                                            |

Valkey supplies distributed counters across Cloud Run instances; development or connection failure falls back to process memory. Express validates and buffers AI request bodies before proxying. Flask repeats schema, ownership, and domain validation.

## 10. Cache contract

| Data                            | TTL                | Invalidation and privacy                                    |
| ------------------------------- | ------------------ | ----------------------------------------------------------- |
| Recipe stats                    | 5 minutes          | Owner-scoped; invalidated on recipe mutation                |
| Collection list                 | 5 minutes          | Owner-scoped; invalidated on collection mutation            |
| Individual recipe or collection | 10 minutes         | Owner-scoped; invalidated on mutation                       |
| Recipe image bytes              | 24 hours           | Global key after authorization; invalidated on regeneration |
| Legacy file recipe list         | 60 seconds default | Compatibility path only                                     |

Cache failures fall through to the database or object store and do not fail the product request.

## 11. Response safety

- APIs return stable messages and codes rather than exception text or stack traces.
- User-controlled log content is sanitized against control and newline injection.
- Public projections are allowlisted separately from owner projections.
- Deployed browser calls remain same-origin through Express; Flask CORS is defense-in-depth.
- Recipe writes and exports canonicalize `ai_image_url`; the SPA's `?_t=` display cache token is never durable API data.
- No response or export contains service credentials, OAuth tokens, Cloud SQL secrets, Pub/Sub tokens, or worker claim tokens.
