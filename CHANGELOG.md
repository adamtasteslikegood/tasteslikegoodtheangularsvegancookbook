# Changelog

All notable changes to Vegangenius Chef are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.0] - 2026-04-29

### Added

- Anti-Recipe Site distribution layer — public recipe pages reachable without auth (#2868)
- Phase 4 Pub/Sub async AI generation — recipe + image jobs run in background workers (#2869)
- Pub/Sub HTTP push workers with OIDC-signed invocation; `PUBSUB_INVOKER_SA` and `GCP_PROJECT_ID` wired into Flask runtime (#2870, #2892)
- Server-side rendering for public recipe routes; SSR submodule integrated into the Express layer (#2893)
- Branching strategy doc (`BRANCHING_STRATEGY.md`) — all changes branch off `dev` (#2888)
- `alirez-claude-skills` and `gemstack` registered as proper git submodules (#2867)
- PM daemon (`alirez-claude-skills/pm-daemon`) watches v0.2 plan files recursively and gains a `--watch-only` mode
- Junie GitHub Actions workflow (#2884)
- `Related Issues` section in the PR template (#2865)

### Fixed

- Catch `shutdownValkey()` failures inside `createValkeyClient()` so a broken `quit()` cannot prevent reinitialization or fallback to in-memory rate limiting ([TAS-48](https://linear.app/tasteslikegood/issue/TAS-48/catch-quit-failures-before-reinitializing-valkey-client))
- On startup, clear the cached authenticated user when the Flask session is gone instead of downgrading it to guest — prevents the header showing "Sign In" while Kitchen still lists the previously authenticated user's recipes ([TAS-2725](https://linear.app/tasteslikegood/issue/TAS-2725/bug-ui-shows-logged-out-state-login-button-while-still-displaying), #2860)
- Preserve cached auth state on transient auth-check failures so a single network blip doesn't drop the user to guest
- Replace bare label with `aria-labelledby` on the toggle button for keyboard/screen-reader accessibility (#2890)
- Polish merged keyboard accessibility and finalize auth + keyboard handling
- Drop the sensitive `cloud-platform` scope from user OAuth — Backend services use their own service-account credentials for GCP API access
- Resolve Qodana template ESLint findings

### Changed

- Repoint `gemstack` submodule url to `adamtasteslikegood/gemstack` and dedupe entries (#2894 prep)
- Mark all `inject()` service references as `readonly` across Angular components and services ([TAS-2707](https://linear.app/tasteslikegood/issue/TAS-2707/find-a-small-improvement-copy))
- Use `Number.parseInt()` instead of global `parseInt()` in `server/valkey.ts` for consistency with the rest of the codebase
- Add descriptive context to bare `console.error()` in recipe import error handler
- Expand `.dockerignore` and `.gcloudignore` to exclude planning, PM, AI/agent tooling, and non-runtime submodules from the Cloud Run build context (smaller images, faster builds)

### Removed

- Delete broken `dependency-submission.yml` workflow — GitHub natively detects npm dependencies from `package-lock.json`, so no submission action is needed ([TAS-2713](https://linear.app/tasteslikegood/issue/TAS-2713/snapshot-github-action-failing-still))
- Remove 38 MB of stray ImageMagick PostScript dumps from repo root (#2887)

## [0.1.0] - 2026-04-13

### Added

- Angular 21 SPA with Signals API — recipe generation, AI food photos, personal cookbook
- Google OAuth 2.0 authentication with guest-session fallback (localStorage)
- Express reverse proxy with Helmet, rate limiting (Valkey / in-memory fallback), request logging
- Flask API with modular blueprint architecture: auth, generation, recipes, collections
- AI recipe generation via Google Gemini; AI food photography via Imagen
- Cloud SQL (PostgreSQL) persistence with Alembic migrations; SQLite for local dev
- Dual-auth pattern: user OAuth credentials → server `GOOGLE_API_KEY` fallback
- Guest-to-authenticated session merge on OAuth login
- Privacy policy page at `/privacy-policy` (KAN-5)
- Valkey IAM auth with periodic token refresh and 3-second graceful shutdown timeout (KAN-16)
- `generation_api_bp` blueprint registered in Flask app (KAN-23)
- `OAUTHLIB_INSECURE_TRANSPORT` guarded behind non-production env check (KAN-29)
- `FLASK_SECRET_KEY` fail-fast on startup in production (KAN-29)
- `client_secret` removed from session cookie; injected at runtime from Secret Manager (KAN-24)
- HTTP 500 error messages sanitized — no internal details exposed to clients (KAN-24)
- Two Cloud Run services: `express-frontend` (public) and `flask-backend` (private VPC) in us-central1
- Cloud Build pipeline with SemVer image tagging (`$SHORT_SHA` + `$_VERSION`) (KAN-32)
- Deploy ordering: Flask backend deploys before Express frontend to prevent version skew (KAN-30)
- Automated CI: PR gate (`pr-gate.yml`) with lint, type-check, build, test, and CHANGELOG checks
- Automated release pipeline (`release.yml`): git tag + GitHub Release + Cloud Build on merge to main
- Branch strategy: `main` (production), `dev` (integration), `fix/KAN-XX` / `feat/KAN-XX` feature branches

### Security

- KAN-23: `generation_api_bp` blueprint registration fix (AI endpoints were unreachable)
- KAN-24: Sanitized all Flask 500 responses; removed `client_secret` from session storage
- KAN-16: Valkey shutdown timeout prevents Cloud Run SIGTERM window exhaustion
- KAN-29: `FLASK_ENV=production` activates production-only guards in Cloud Run

---
