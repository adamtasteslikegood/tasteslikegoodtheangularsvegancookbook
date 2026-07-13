# Platform Behavior — Express Layer, Security, Deployment

> **Source:** `server/index.ts`, `server/proxy.ts`, `server/security.ts`, `server/valkey.ts`, `Dockerfile`, `cloudbuild.yaml`
> **Generated:** 2026-07-10

Everything the browser touches goes through a single public Express service. It serves the Angular SPA, proxies all `/api/*` traffic to the private Flask backend, proxies the server-rendered public pages, and enforces rate limits and security headers. No business logic lives here.

## Route map (mount order matters)

| # | Route | Handled by | Purpose |
|---|-------|-----------|---------|
| 1 | `GET /api/health` | Express itself | `{status, timestamp, rateLimitStore: 'valkey'\|'memory'}` — health + rate-limit-store diagnostic. Never proxied. |
| 2 | `/api/*` | Rate limiter | General: 300 req / 15 min / IP. |
| 3 | `/api/generate`, `/api/generate_image` | Rate limiter | AI tier: 20 req / hour / IP. With Valkey both endpoints share one bucket per IP (same key prefix); with the in-memory fallback they count separately. |
| 4 | (all) | Helmet + X-Robots-Tag | Security headers (see below). |
| 5 | `/api/*` | **Flask proxy** | Mounted **before** `express.json()` so request bodies stream raw to Flask (Flask parses its own bodies). |
| 6 | (all) | `express.json({limit: '50kb'})` | Defense-in-depth only — no Express route after the proxy reads a body. |
| 7 | static | Angular `dist/` | SPA assets. |
| 8 | `GET /privacy-policy` | Static file | `server/public/privacy-policy.html`; mounted before the SPA fallback. |
| 9 | `GET /r/*`, `GET /browse`, `GET /sitemap.xml`, `GET /static/*` | Flask SSR proxy | Server-rendered public recipe pages, browse index, sitemap, and Flask template stylesheets. `/static/*` proxying was added after a real incident (v0.3.1): without it, stylesheets fell through to the SPA fallback as `text/html` and `nosniff` left public pages unstyled. GET-only by design. |
| 10 | `GET *` | SPA fallback | `dist/index.html`. Rate-limited 300/15 min. |
| 11 | (errors) | Error handler | Logs details server-side; returns generic `{error: 'An unexpected error occurred on the server.'}`. |

`trust proxy: 1` is set so rate limiting keys on the real client IP behind Cloud Run.

## Security

- **Helmet with CSP explicitly disabled** — Angular's build output relies on inline styles/handlers and dynamic script loading; the code comments delegate CSP to CDN/proxy level `[TBC: nothing in this repo configures that]`. All other Helmet defaults active (nosniff, X-Frame-Options, HSTS, Referrer-Policy).
- **`X-Robots-Tag: index, follow`** on HTML responses only when `NODE_ENV=production` — preview deploys are not indexable.
- **Rate limit exemptions:** `/api/health` and recipe-image serving (`/api/recipes/<id>/image`) are exempt from the general limiter so image-heavy pages don't burn quota.
- **429 responses:** general — "Too many requests, please try again later."; AI — "Rate limit exceeded for this operation. Please try again later." RFC `RateLimit-*` headers enabled.
- **Request logging:** one line per request (timestamp, method, path, status, duration). No bodies or PII.
- **No Express-layer input validation.** `express-validator` is a declared dependency but is imported nowhere; `server/validation.ts` does not exist (project docs describing it are stale). All input validation is Flask's responsibility.

## Distributed rate limiting (Valkey)

- When `VALKEY_HOST` is set and reachable, limits are shared across all Express replicas via Valkey (Redis-compatible), using GCP IAM tokens as passwords when `VALKEY_AUTH_MODE=iam` (auto-refreshed every 45 min), with TLS via a Google-managed CA cert (`VALKEY_CA_CERT`).
- If Valkey is absent or down, limiters **silently fall back to per-instance in-memory stores** — a scaled-out deployment effectively multiplies the quota. Known edge cases tracked in GH #163/#162 (KAN-16/17). `/api/health` reports which store is live.

## Proxy behavior

- Dependency-free streaming proxy (Node `http`/`https`). Target: `FLASK_BACKEND_URL` (default `http://localhost:5000`), read once at startup.
- Forwards method, full URL, and all headers; rewrites `Host` to the Flask target and sets `X-Forwarded-Host` (browser's original host) + `X-Forwarded-Proto` so Flask's `ProxyFix` generates correct external URLs (OAuth redirects).
- Fully streaming both directions — no buffering, no explicit timeout (long AI generations rely on this).
- Flask unreachable → **502** `{error: 'Backend service unavailable', ...}`; mid-stream failures cut the response off.

## Startup / shutdown

- Port `PORT` (default **8080**). Startup: connect Valkey (or fall back) → mount routes → listen; fatal errors exit(1).
- Graceful shutdown on SIGTERM/SIGINT: drain HTTP, stop IAM-token refresh, quit Valkey with a 3 s force-disconnect fallback (fits Cloud Run's 10 s window).
- Dev mode bypasses Express entirely: Angular dev server on :3000 with `proxy.conf.json` forwarding only `/api/auth`, `/api/recipes`, `/api/collections` to Flask `[TBC: /api/generate* is not in the dev proxy config — dev AI calls appear to require the full Express path or fail]`.

## Deployment (Cloud Run, us-central1)

Pipeline (`cloudbuild.yaml`), triggered by version tags matching `^v[0-9]+\.[0-9]+\.[0-9]+$`:

1. Init Backend submodule; build + push both Docker images (`$SHORT_SHA` + version tag).
2. **Run `flask-backend-migrate` Cloud Run Job** (`flask db upgrade`, blocking, 600 s timeout). Failure aborts the deploy; the old revision keeps serving.
3. Deploy `flask-backend` — private (`--no-allow-unauthenticated`), min 1 instance, VPC-attached (Cloud SQL private IP, Valkey at 10.128.0.11), secrets from Secret Manager (`GOOGLE_API_KEY`, `FLASK_SECRET_KEY`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL`). `FRONTEND_URL=https://www.tasteslikegood.org`, `SESSION_COOKIE_DOMAIN=.tasteslikegood.org`.
4. Deploy `express-frontend` — the only public service, min 0 instances, secrets `GEMINI_API_KEY`, `VALKEY_CA_CERT`. Deployed after Flask so a new frontend never serves against an old API. Its env vars (e.g. `FLASK_BACKEND_URL`) persist from prior revision settings, configured out-of-band `[TBC]`.

## Test-only elements (not product behavior)

- The HTTP listener is skipped under `VITEST`/`NODE_ENV=test`; tests boot the app themselves.
- `server/routes.test.ts` uses a stub Flask server; `server/server.test.ts` mocks ioredis/google-auth.
- `createAuthProxy()` is an unused backward-compat alias.
- Most of `server/types.ts` (`SecurityConfig`, `ValidationError`) is unreferenced scaffolding for a validation layer that was never built.
