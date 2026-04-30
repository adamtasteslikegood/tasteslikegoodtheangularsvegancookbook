# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Vegangenius Chef** — vegan recipe generator and personal cookbook app. Users generate recipes via Google Gemini, get AI food photos via Imagen, and manage cookbooks. Auth via Google OAuth or guest (localStorage).

## Commands

### Frontend + Express proxy (root)

```bash
npm install
npm run dev          # Angular dev server on :3000, proxies /api → Flask :5000
npm run build        # ng build + compile server/tsconfig.server.json → server/dist/
npm start            # node server/dist/index.js (production, port 8080)
npm run lint         # ESLint (src/ + server/)
npm run lint:fix     # ESLint auto-fix
npm run format       # Prettier write
npm run format:check # Prettier check (CI)
npm run type-check   # tsc --noEmit (both tsconfigs)
npm test             # Vitest (server tests)
npm run test:ci      # Vitest with coverage
```

### Backend (Python/Flask)

```bash
cd Backend
uv sync              # Install deps via uv (preferred over pip)
cp .env.example .env
./init_database.sh   # Initialize DB + run migrations
python app.py        # Flask dev server on :5000
pytest               # Run all tests
pytest tests/test_normalization.py::TestNormalization::test_normalize_unit  # Single test
```

### Cloud deployment

```bash
gcloud builds submit --config=cloudbuild.yaml  # Build + deploy both services to Cloud Run
```

## Architecture

### Three-tier request flow

```
Browser → Express :8080 → Flask :5000 → Cloud SQL (PostgreSQL)
```

**All browser traffic routes through Express** (single origin, no CORS). Express proxies `/api/*` to Flask as a raw HTTP stream — mounted **before** `express.json()` so Flask handles body parsing itself. Flask's `url_for(_external=True)` resolves correctly via `X-Forwarded-*` headers set by Express. Angular only ever uses relative URLs (`/api/...`).

### Layer 1 — Angular 21 SPA (`src/`)

- Standalone components with **Signals API** (`signal()`, `computed()`, `effect()`) — no RxJS
- Three services: `GeminiService` (recipe + image generation), `AuthService` (OAuth + guest), `PersistenceService` (localStorage-first, background sync to Flask)
- Type definitions: `recipe.types.ts`, `auth.types.ts`
- Dev server port 3000; `proxy.conf.json` maps `/api` → Flask :5000
- Entry: `index.tsx` (tsconfig uses `jsx: react-jsx`, hence `.tsx`)

### Layer 2 — Express reverse proxy (`server/`)

- `server/index.ts` — startup, graceful shutdown (drains HTTP, closes Valkey)
- `server/proxy.ts` — `createFlaskProxy()`, raw streaming to Flask
- `server/security.ts` — Helmet, rate limiting (300 req/15 min general, 20 req/hr AI), request logger
- `server/valkey.ts` — Valkey (Redis alternative) client for distributed rate limiting; falls back to in-memory
- `server/validation.ts` — express-validator rules for AI endpoints
- No AI logic lives here; it's purely proxy + static hosting

### Layer 3 — Flask API (`Backend/`)

Modular blueprint architecture (the `Backend/CLAUDE.md` is **outdated** — ignore its monolithic description):

- `auth.py` + `blueprints/auth_api_bp.py` — Google OAuth 2.0 flow, sessions
- `blueprints/generation_bp.py` — `/api/generate` (Gemini text), `/api/generate_image` (Imagen)
- `blueprints/recipes_api_bp.py` — CRUD for recipes
- `blueprints/collections_api_bp.py` — CRUD for cookbooks
- `services/` — business logic (Gemini, Imagen, stock images)
- `repositories/` — data access with file locking
- `validators/` — JSON Schema Draft 7 validation
- `models/` — SQLAlchemy: User, Recipe, Collection
- `migrations/` — Alembic via Flask-Migrate

### Persistence strategy

- `PersistenceService` writes localStorage first (instant UI), then syncs to Flask
- On OAuth login, guest localStorage data merges into the authenticated session
- Cloud SQL (PostgreSQL) is authoritative; SQLite used for local dev

### Authentication

- Dual-auth: Flask tries user OAuth credentials first, falls back to server `GOOGLE_API_KEY`
- `ProxyFix` middleware in Flask trusts `X-Forwarded-*` from Express for external URL generation

## Key environment variables

**Root (`.env.local`):**

- `GEMINI_API_KEY` — required
- `FLASK_BACKEND_URL` — default `http://localhost:5000`

**Backend (`.env`):**

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — OAuth
- `GOOGLE_API_KEY` — Gemini fallback key
- `FLASK_SECRET_KEY` — session signing
- `DATABASE_URL` — PostgreSQL (prod) / SQLite (local)

In production all secrets come from Google Secret Manager, injected at Cloud Run runtime.

## Deployment

Two Cloud Run services in `us-central1`:

- `express-frontend` — Node.js, port 8080, public
- `flask-backend` — Python (gunicorn), port 5000, no public auth

`cloudbuild.yaml` builds both Docker images and deploys them in sequence. Express Dockerfile is at root; Flask Dockerfile is at `Backend/Dockerfile`.

### Release flow

1. PR merges to `main` (only path that ships).
2. `.github/workflows/release.yml` extracts `version` from `package.json`, creates the git tag `vX.Y.Z`, pushes the tag, and publishes a GitHub Release with the matching CHANGELOG section. Idempotent — re-running on an existing tag is a no-op.
3. The tag push hits a **Cloud Build trigger configured on the GCP side** (not in this repo). The trigger watches for tag pushes matching the regex below and runs `cloudbuild.yaml` with `_VERSION=vX.Y.Z`.

### Cloud Build tag-push trigger (production deploy)

The tag-push trigger lives in Cloud Build — **GCP Console → Cloud Build → Triggers** (or `gcloud builds triggers list`). Its tag pattern MUST be:

```
^v[0-9]+\.[0-9]+\.[0-9]+$
```

Anchored, digits-only, leading `v`, no trailing pre-release or metadata. This is a deliberate gate so:

- `v0.2.0`, `v1.0.0`, `v2.13.7` — match → production deploy fires
- `v0.2.0-rc.1`, `v0.2.0-beta` — pre-release tags → **do not match**, no production deploy
- `v0.2.0+build.123`, `v0.2.0+sha.abc` — metadata tags → **do not match**, no production deploy
- `latest`, `dev`, `0.2.0` (missing leading `v`) — **do not match**

If you ever need to ship a release candidate without triggering production, push a tag like `v0.3.0-rc.1` and it'll create a GitHub Release without a Cloud Run deploy. To verify the trigger is configured correctly:

```bash
gcloud builds triggers list --filter='name~deploy OR name~release' \
  --format='value(name, github.push.tag, filename)'
```

The `github.push.tag` field on the matching trigger should print `^v[0-9]+\.[0-9]+\.[0-9]+$`.

## Startup (agent sessions)

Project MCP servers are declared in `.mcp.json` at the repo root. When Claude Code (or any compatible agent) starts a session in this directory, it auto-spawns the servers listed there as stdio child processes. Currently registered:

- `pm-daemon` — runs `scripts/pm/run_pm_daemon.sh`, which creates the venv on first run if missing, then launches `alirez-claude-skills/pm-daemon/pm_daemon.py`. The daemon does two things in one process: serves the FastMCP tools (`sync_pm_documents`, `get_project_status`) over stdio for the agent, and runs a `watchdog` Observer in the background that syncs `plan.md`, `roadmap.md`, `planning_notes.md`, `design-plan.md`, `SCRUM_BOOTSTRAP_AND_BOARD_PLAN.md`, `SPRINT_0_PLAN.md`, and `ATLASSIAN_PM_LINK.md` to Confluence on save.

Requirements for `pm-daemon` to actually sync:

- `.env` (project root) must contain `ATLASSIAN_EMAIL` and `ATLASSIAN_API_TOKEN`. Without them the MCP tools register but Confluence sync logs `WARNING: Atlassian credentials missing` and no-ops.
- `python3 -m venv` must work (Debian/Ubuntu: `sudo apt install python3.12-venv`).

To verify the daemon is running during a session: `ps -ef | grep pm_daemon | grep -v grep`. If you don't see it, your agent isn't reading `.mcp.json` — check the agent's MCP loader logs.

## Non-obvious patterns

- **Rate limiter** uses Valkey for distributed state across Express replicas; `server/valkey.ts` has open GH issues (#163, #162) for edge cases under broken connections — see KAN-16, KAN-17
- **AI model names** include `models/` prefix (e.g., `models/gemini-3.1-pro-preview`); filter by `generateContent` in `supported_generation_methods`
- **Backend submodule** — `Backend/` is a git submodule (remote: `adamtasteslikegood/tasteslikegood.com`, branch `dev/backend_sub222`) and accounts for roughly half of the project. Before starting any backend work or shipping a release, ALWAYS check the Backend repo for open PRs and recent commits that may not yet be reflected in the parent's submodule pointer. Quick checks:
  - `gh pr list -R adamtasteslikegood/tasteslikegood.com --state open` — open Backend PRs
  - `git -C Backend fetch && git -C Backend log --oneline HEAD..origin/dev/backend_sub222` — commits on the tracked branch the pointer hasn't picked up yet
  - `git submodule update --remote Backend` — fast-forward the pointer to the latest tracked branch tip when ready
- **Branching** — ALWAYS create a new branch off `dev` before making any changes. Do not commit directly to `dev` or `main`.
- **CI auto-formats** — Prettier runs as a CI job and commits fixes on push; don't be alarmed by bot commits
- **TypeScript 6.x is blocked** — `package.json` pins `typescript >= 5.9 < 7`; Dependabot is configured to skip TS major bumps

## Further reading

- `Backend/API.md` — Flask API endpoint reference
- `Backend/DATABASE_SETUP.md` — migration steps
- `docs/PHASE_3/` — database architecture and data models
- `docs/DEPLOYMENT_CHECKLIST.md` — pre-production checklist
- `docs/rate_limit.md` — rate limiting details

## gstack

Use the `/browse` skill from gstack for **all web browsing**. Never use `mcp__claude-in-chrome__*` tools directly.

Available gstack skills:

| Skill                  | Skill                    | Skill              | Skill                 |
| ---------------------- | ------------------------ | ------------------ | --------------------- |
| `/office-hours`        | `/plan-ceo-review`       | `/plan-eng-review` | `/plan-design-review` |
| `/design-consultation` | `/design-shotgun`        | `/design-html`     | `/review`             |
| `/ship`                | `/land-and-deploy`       | `/canary`          | `/benchmark`          |
| `/browse`              | `/connect-chrome`        | `/qa`              | `/qa-only`            |
| `/design-review`       | `/setup-browser-cookies` | `/setup-deploy`    | `/retro`              |
| `/investigate`         | `/document-release`      | `/codex`           | `/cso`                |
| `/autoplan`            | `/plan-devex-review`     | `/devex-review`    | `/careful`            |
| `/freeze`              | `/guard`                 | `/unfreeze`        | `/gstack-upgrade`     |
| `/learn`               |                          |                    |                       |

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:

- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health

## GBrain Configuration (configured by /setup-gbrain)
- Engine: postgres
- Config file: ~/.gbrain/config.json (mode 0600)
- Setup date: 2026-04-30
- MCP registered: no (OpenCode — register `gbrain serve` manually in MCP config if desired)
- Memory sync: off
- Current repo policy: read-write
- Database: Railway Postgres (shared with Hermes agent)
- Pages: ~249 imported from this repo
- Background job: gbrain embed --stale (PID 78503)
