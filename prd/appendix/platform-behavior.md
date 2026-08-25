# Appendix: Platform, Runtime, and Deployment Behavior

- **Target:** v0.4.12
- **Evidence date:** 2026-08-24

## 1. Runtime topology

```text
Internet browser or crawler
          |
          v
Google edge plus public Express Cloud Run
  - canonical host and indexing policy
  - Helmet and CSP, validation, logs, rate limits
  - Angular static build and SPA fallback
  - static Privacy, robots, and icons
  - API, Flask static, and SSR proxy
          |
          | Google Cloud Run ID token
          v
Private Flask Cloud Run
  - Google OAuth and session
  - recipe and cookbook JSON APIs
  - public SSR and public JSON
  - generation enqueue and Pub/Sub workers
  - admin and compatibility routes
      |              |                 |
      v              v                 v
Cloud SQL        Pub/Sub push         Cloud Storage
PostgreSQL       recipe and image     generated images
      ^
      |
Valkey or Memorystore
Flask response and image cache plus Express rate-limit counters
```

Express is the only browser-facing application service. Flask has Cloud Run invoker IAM checks enabled and no anonymous grant. Express mints a Google-signed ID token for the Flask audience and forwards it in `X-Serverless-Authorization`; it does not trust a browser-supplied service token. User session cookies remain a separate application identity.

## 2. Angular SPA

### 2.1 Technology and boot

- Angular 22 standalone application, bootstrapped from `index.tsx`.
- Angular Router owns `/`, `/kitchen`, `/recipe/:id`, `/chunk-error`, and wildcard redirect.
- Signals and `provideZonelessChangeDetection()` require immutable state updates for dependable rendering.
- Kitchen and Recipe Detail are lazy-loaded routes and preloaded after boot.
- Production calls the backend through same-origin relative `/api` URLs.

### 2.2 Shared state

- Auth service checks Flask session and manages guest or Google projection.
- Persistence service uses local storage for fast continuity and synchronizes owner-scoped API data.
- Recipe state service owns current recipe and image URL, saved status, and pending image recipe IDs.
- Modal and toast services provide global interaction surfaces.
- Component destruction and navigation do not cancel backend jobs by default.

### 2.3 SSR entry bridge

SSR returns to Angular through URLs rather than shared memory:

- `/?save=<slug>#kitchen`: public-copy acquisition.
- `/?auth=success`: OAuth completion and merge hydration.
- `/#kitchen`: legacy route normalization.

The Angular entry guard and service consume these intents before settling the router URL.

## 3. Express edge and proxy

### 3.1 Request order

1. Trust exactly the first Cloud Run or GFE proxy for client IP.
2. Redirect apex `tasteslikegood.org` to canonical `www` for all paths: `301` for GET or HEAD, `308` when method and body must be preserved.
3. Apply environment indexing behavior and health route.
4. Apply request logging, Helmet and CSP, rate limits, and AI request validation.
5. Proxy `/api`, `/static`, `/r/*`, `/browse`, and `/sitemap.xml` to Flask.
6. Serve Angular and standalone assets.
7. Catch remaining browser routes: missing asset-like paths return `404`; other paths receive Angular shell.

### 3.2 Proxy behavior

- Preserves method, query, relevant headers, cookies, status, and streaming response.
- Sets target Host and communicates original forwarded host and protocol.
- Buffers and validates the two AI request bodies before proxying, then replays validated bytes.
- Obtains a Cloud Run ID token asynchronously and fails safely if Flask is unreachable.
- Preserves intended Pub/Sub authorization semantics while preventing browser header spoofing.
- Browser code never needs the private Flask URL.

### 3.3 Route classification

One route manifest distinguishes API, SSR, Flask static, standalone, SPA, and asset paths. Named `/sitemap.xml` and `/favicon.ico` win over extension rules. Missing JavaScript, CSS, maps, JSON, fonts, images, icons, and manifests never receive Angular HTML.

## 4. Security controls

### 4.1 Headers

Helmet supplies HSTS and content type, frame, and referrer protections plus scoped CSP:

- Default, script, and connect: self.
- Styles: self, Angular inline component styles, Google Fonts CSS.
- Fonts: self and Google Fonts files.
- Images: self, data, blob, and HTTPS recipe image sources.
- Objects: none; frame ancestors: none; base and form action: self.
- One hashed Angular critical-CSS `onload` handler is allowed; arbitrary inline handlers are not.

Production HTML gets `X-Robots-Tag: index, follow`. Staging gets `noindex, nofollow` on every response and a disallow-all `robots.txt`.

### 4.2 Rate limits

| Class        | Default                          | Important skips                             |
| ------------ | -------------------------------- | ------------------------------------------- |
| API          | 300 per 15 minutes per client IP | Health and recipe image-serving path        |
| Public page  | 300 per 15 minutes per client IP | Static subresources and recognized crawlers |
| Expensive AI | 20 per hour per client IP        | No ordinary generation exemption            |

API and page counters use distinct Valkey prefixes. With Valkey unavailable, Express falls back to process-memory limits and health reports store state. Crawler exemption does not bypass data authorization or the expensive limiter.

### 4.3 Application security

- Flask independently validates schema, owner scope, provenance, publication, and role.
- Logs sanitize control and newline characters.
- Client responses use stable safe messages and codes rather than exception internals.
- OAuth uses state and PKCE; production forbids insecure transport and fails startup without a stable secret.
- Worker endpoints verify Pub/Sub OIDC signature, audience, and service-account email; missing production configuration fails closed.
- Admin routes require server-side bearer authorization.
- Credentials come from runtime secrets and never Angular bundles.

## 5. Asynchronous recipe generation

```text
POST /api/generate
  -> validate 10 to 500 character prompt
  -> create Recipe(status=generating)
  -> publish recipe Pub/Sub message
  -> 202 plus recipe ID

Pub/Sub push /api/worker/recipe
  -> verify OIDC
  -> decode envelope and claim lease
  -> build vegan schema prompt
  -> call Gemini 3.7 Flash by default
  -> retry transient failures, default max 3
  -> parse and schema validate
  -> persist ready or error
  -> queue image on success
```

`GEMINI_DEFAULT_MODEL` overrides the default. Gemini HTTP timeout defaults to 540 seconds; worker stale window defaults to 600 seconds, with per-attempt budget derived to fit. Acknowledgement behavior distinguishes terminal handled failure from retryable infrastructure or model errors.

## 6. Asynchronous image generation

```text
ready recipe or regeneration request
  -> record current request and enqueue metadata
  -> publish image Pub/Sub message

Pub/Sub push /api/worker/image
  -> verify OIDC
  -> claim current image work
  -> call Gemini 3.1 Flash Image via generate_content
  -> extract and MIME-check image bytes
  -> write versioned GCS object
  -> persist current reference, metadata, and ready status
  -> invalidate cache and clean eligible stale object
```

`GEMINI_IMAGE_MODEL` overrides the default. Imagen `generate_images` is not the v0.4.12 product contract. Repository comments and schema descriptions that still say Imagen are stale documentation.

Safety blocks and empty responses become controlled failures. Expected-state and claim tokens prevent a late old job from overwriting newer regeneration. Terminal image failure restores top-level `ready` and records failure metadata. The SPA polls approximately every two seconds and imposes a separate five-minute experience timeout.

The canonical image endpoint and browser cache-busting URL are separate state. The SPA may append `?_t=<epoch>` to force refreshed bytes, but must not store or POST that derived URL. Current merged code persists the display URL in local session state, so regenerate followed by later save/edit can contaminate canonical `ai_image_url`; this is a known v0.4.12 conformance defect requiring the normalization and regression coverage defined in the main acceptance criteria.

## 7. Persistence and caching

### 7.1 Cloud SQL

- PostgreSQL holds users, recipes, cookbooks, publication and provenance, job status, and recipe JSON.
- SQLAlchemy and Alembic define production constraints.
- SQLite is local and test fallback, not deployed authority.

### 7.2 Browser local storage

- Stores client kitchen continuity and local recycle snapshots.
- Avoids credentials and large embedded AI image data.
- Does not override server ownership, provenance, or duplicate refusals.

### 7.3 Valkey

- Express: shared rate counters across instances.
- Flask: owner-scoped recipe, stats, and collection response cache plus image bytes.
- TTLs: five minutes for stats and lists, ten minutes for individual objects, one day for image bytes.
- Mutations invalidate affected keys; cache faults fall through to Cloud SQL or GCS.
- Production uses Memorystore or Valkey with IAM and TLS CA configuration.

### 7.4 GCS

- Generated images use versioned object names and references.
- Image API authorizes owner or public visibility before returning cached or stored bytes.
- Public bytes may cache for one day; private bytes use `no-store`.

## 8. Public SSR and discovery

Flask renders public pages from a public-only database projection. This is server-side HTML, not Angular SSR.

- `/r/<slug>`: one public recipe, safe body, canonical, social, and Recipe JSON-LD.
- `/browse`: newest public recipes, 20 per page.
- `/sitemap.xml`: home, browse, and public slugs.
- `/static/*`: public-template assets.

Express protects and proxies these routes before Angular fallback. Search and social bots receive page content and images without user authentication only when the recipe is public.

## 9. Production deployment

Cloud Build release order:

1. Build Express and Flask container images.
2. Push commit SHA and semantic version tags to Artifact Registry.
3. Deploy a one-task `flask-backend-migrate` Cloud Run Job with the new Flask image.
4. Execute `flask db upgrade`; stop if it fails and leave the old service revision active.
5. Deploy or update the scheduled image-repair job, without executing it on every build.
6. Deploy private Flask first, attached to Cloud SQL and VPC with runtime secrets.
7. Deploy public Express after Flask succeeds.
8. Probe canonical production `/api/health` and fail if distributed Valkey rate-limit state is unhealthy.

The image-repair job finds missing-image rows, canonical first then public, and enqueues through the same async path. Its stale comments should say Gemini 3.1 Flash Image after terminology cleanup.

Production services run in `us-central1`. Flask has minimum instances and 1 GiB memory; Express may scale from zero. Datadog serverless tracing and labels are wired in production.

## 10. Staging behavior

Staging is isolated in its own GCP project and reuses tagged images from production Artifact Registry. Observed on 2026-08-24:

- Public `express-frontend-staging` served the SPA, browse, public recipe JSON and HTML, robots, static CSS, and health.
- Private `flask-backend-staging` rejected anonymous direct access.
- Every staging response carried `X-Robots-Tag: noindex, nofollow`; robots disallowed crawling.
- The staged Flask revision exercised the v0.4.12 image-generation fix path according to the release evidence.

The checked-in staging deploy script uses a staging database secret backed by Railway PostgreSQL, optional staging OAuth, and deliberately omits Gemini keys, GCS, Pub/Sub, Valkey, and Datadog. Its repeatable checked-in role is deterministic route, data, content, and security acceptance; local generation emulation covers non-billed job flow. If v0.4.12 requires repeatable live model execution in isolated staging, provisioning isolated Gemini, Pub/Sub, and GCS is a separate approved infrastructure change **[TBC]**. This PRD nevertheless treats the requested 3.7 Flash and 3.1 Flash Image production behavior as shipped.

## 11. Health, observability, and failure

- Express `/api/health` is local and cheap and includes timestamp, environment, and rate-limit store state.
- Request logs include method, path, status, and duration with injection sanitation.
- Express and Flask log server detail but return generic client text.
- Datadog tracing is present in production containers.
- Queue and job status is persisted, not inferred only from logs.
- Valkey failure degrades caching or limit distribution but not data authority; production health turns silent degradation into a release failure.
- Flask or proxy outage yields `502` or safe service error, not Angular HTML.
- Pub/Sub retries retryable worker failure; leases prevent duplicate or stale corruption.

Product analytics, KPI instrumentation, and dashboards are not established by this contract **[TBC]**.

## 12. Release verification

Minimum machine and user-path verification:

- Homepage and Angular kitchen, recipe detail or guarded behavior, and chunk recovery.
- `/api/health` with expected environment and store posture.
- `/browse`, a known `/r/<slug>`, matching public JSON, and sitemap.
- Public and private image authorization and content type.
- Unknown SPA route versus missing asset-like `404`.
- Canonical apex redirect and production security and indexing headers.
- Staging noindex and robots, private Flask denial, browse data, public JSON, and static CSS.
- Generation, model metadata and status, automatic image, navigation persistence, timeout, and failure.
- Regenerate, navigate/reload, then save/edit/export without persisting the `?_t=` display cache token.
- Owner or guest, duplicate save, source-copy lock, manual and canonical lock, and private-note exclusion.
- Migration job, tests, build, and production-content checks.

## 13. Operational invariants

1. Browser traffic enters Express and Flask stays private.
2. Cloud SQL and migrations, not blob or client assumptions, define durable identity.
3. Publication and provenance are server-controlled.
4. Queue delivery may repeat and workers are idempotent.
5. Background job lifetime is independent of SPA focus.
6. Public data is an allowlist, never a private object minus guessed fields.
7. Production deploy order is migration, Flask, Express, then health verification.
8. Staging and production do not accidentally share mutable application data or secrets.
