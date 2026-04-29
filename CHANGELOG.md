# Changelog

All notable changes to Vegangenius Chef are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [0.2.1] - 2026-04-29

Post-v0.2.0 polish: repo hygiene, Cloud Run image trimming, agent-tooling wiring. No user-facing app changes.

### Added

- `.mcp.json` registers the `pm-daemon` MCP server (from `alirez-claude-skills/pm-daemon` via `scripts/pm/run_pm_daemon.sh`) so Claude Code, Codex, and other agents auto-spawn the daemon on session start. The daemon watches plan files (`plan.md`, `roadmap.md`, `planning_notes.md`, `design-plan.md`, `SCRUM_BOOTSTRAP_AND_BOARD_PLAN.md`, `SPRINT_0_PLAN.md`, `ATLASSIAN_PM_LINK.md`) and syncs them to Confluence in the background. Deletes orphaned `auto_pm_mcp.json` (wrong filename — Claude Code reads `.mcp.json`).
- PM daemon (`alirez-claude-skills/pm-daemon`) gains recursive plan-file matching (uses `rglob`) and a `--watch-only` mode for running the watcher without MCP transport
- "Always check the `Backend/` submodule repo for PRs and changes" guidance in CLAUDE.md and AGENTS.md, with `gh pr list -R adamtasteslikegood/tasteslikegood.com` and `git -C Backend log` commands. Backend/ is roughly half the project; missed PRs there have caused integration drift on past releases.
- Cloud Build trigger regex documentation in CLAUDE.md — production deploys fire only on tags matching `^v[0-9]+\.[0-9]+\.[0-9]+$`, so pre-release tags like `v0.2.1-rc.1` or build-metadata tags like `v0.2.1+sha.abc` cannot accidentally trigger a production push.

### Changed

- Expand `.dockerignore` and `.gcloudignore` to keep planning, PM, AI/agent tooling (`.codex/`, `.gemini/`, `.junie/`, `.clawhub/`, `claude-code-tresor/`, `skills/`), Python venvs, and non-runtime submodules (`alirez-claude-skills/`, `gemstack/`) out of the Cloud Run build context. Smaller image, faster build, less surface area.
- Clean up `.gitignore`: resolve unresolved `<<<<<<<` / `>>>>>>>` merge conflict markers that had silently been there (likely a missed conflict during a previous merge from `origin/main`), dedupe entries, add Python bytecode patterns, and stop ignoring `AGENTS.md` so the agent-facing guidance is actually tracked in git.

### Fixed

- Bump `alirez-claude-skills` submodule pointer to pick up recursive plan-file watching and `--watch-only` mode in `pm_daemon.py` (was silently uncommitted in the parent for ~3 days)

## [0.2.0] - 2026-04-29

The "Anti-Recipe Site" release. Public recipes can now be shared via clean URLs that crawlers and JS-flaky in-app browsers (Facebook, Instagram) render correctly. Recipe and image generation moved off the request thread onto Pub/Sub workers, so the UI returns instantly instead of holding the connection open for 30+ seconds.

### Added

- Public recipes: toggle "Make Public" on a saved recipe and share `/r/<slug>` — server-rendered HTML with photo, ingredients, instructions, and a working CTA. Indexed by Googlebot. ([TAS-2718](https://linear.app/tasteslikegood/issue/TAS-2718))
- `/browse` index page lists every public recipe with author byline and pagination
- `slug` and `is_public` columns on recipes plus a backfill script for existing entries
- Async AI generation via Pub/Sub: `POST /api/generate` and `POST /api/generate_image` now return 202 instantly; recipes complete in the background and the UI polls for status
- `/api/worker/recipe` and `/api/worker/image` HTTP push endpoints with OIDC verification — Pub/Sub signs each push with a JWT that the endpoints validate against `PUBSUB_INVOKER_SA` before processing
- `scripts/gcloud/setup_pubsub.sh` and `scripts/gcloud/update_push_endpoints.sh` for one-time GCP infrastructure setup (topics, subscriptions, IAM, dead-letter queue)
- Branching guidance in CLAUDE.md, COPILOT.md, and GEMINI.md: always branch off `dev`, never commit directly to `dev` or `main`

### Changed

- SSR proxy routes (`/r`, `/browse`, `/sitemap.xml`) moved from `app.use()` to `app.get()` with rate limiting via `staticPageLimiter` — non-GET methods 404 cleanly, no bot POST spam reaches Flask
- "Make Public" toggle replaced with proper `<button role="switch">` + `aria-labelledby` for screen reader support and to satisfy `@angular-eslint/template/label-has-associated-control`
- `Recipe` model gains a `status` column (`pending`, `ready`, `error`) so the frontend can poll while async generation completes

### Fixed

- OAuth scope reduction: removed broad `cloud-platform` scope from user auth so the consent screen no longer triggers a Google security warning that was scaring away recipe-share recipients
- `Backend/blueprints/worker_api_bp.py` import was missing from `app.py` — the container would have crashed on startup with `NameError`
- Catch `shutdownValkey()` failures inside `createValkeyClient()` so a broken `quit()` cannot prevent reinitialization or fallback to in-memory rate limiting ([TAS-48](https://linear.app/tasteslikegood/issue/TAS-48/catch-quit-failures-before-reinitializing-valkey-client))
- On startup, clear the cached authenticated user when the Flask session is gone instead of downgrading it to guest — prevents the header showing "Sign In" while Kitchen still lists the previously authenticated user's recipes ([TAS-2725](https://linear.app/tasteslikegood/issue/TAS-2725/bug-ui-shows-logged-out-state-login-button-while-still-displaying))
- `.gitmodules` now points `gemstack` at the correct upstream (`adamtasteslikegood/gemstack`) so CI can fetch the recorded SHA

### Removed

- 38MB of stray ImageMagick PostScript dumps committed to repo root with cryptic names (`base64`, `json`, `logging`, `markdown`, `os`, `requests`, `sys`)
- Broken `dependency-submission.yml` workflow — GitHub natively detects npm dependencies from `package-lock.json` ([TAS-2713](https://linear.app/tasteslikegood/issue/TAS-2713/snapshot-github-action-failing-still))
- Standalone pull-based Pub/Sub worker scripts (`Backend/workers/recipe_worker.py`, `image_worker.py`, `run_workers.py`) — replaced by HTTP push endpoints
- Duplicate `gemstack` entry in `.gitmodules`

### Infrastructure

- Cloud Run flask-backend env vars now include `GCP_PROJECT_ID` and `PUBSUB_INVOKER_SA` so the worker endpoints know which OIDC issuer to trust
- New GCP service account `pubsub-pusher@comdottasteslikegood.iam.gserviceaccount.com` with `roles/run.invoker` on flask-backend; flask service account gains `roles/pubsub.publisher`
- Push subscriptions configured with 600s ack-deadline (Imagen takes 30-90s), exponential retry backoff, and dead-letter routing to `generation-dlq` after 5 failed deliveries

### Internal

- Mark all `inject()` service references as `readonly` across Angular components and services ([TAS-2707](https://linear.app/tasteslikegood/issue/TAS-2707/find-a-small-improvement-copy))
- Use `Number.parseInt()` instead of global `parseInt()` in `server/valkey.ts` for consistency with the rest of the codebase
- Add descriptive context to bare `console.error()` in recipe import error handler

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
