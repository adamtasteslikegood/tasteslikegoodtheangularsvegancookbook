# AGENTS.md

This file provides guidance to OpenCode and other coding agents working in this repository.
For Claude Code sessions, see `CLAUDE.md` (both files are kept in sync for the core sections).

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

## Three submodules — always keep in sync

This repo has three git submodules. On every fresh checkout or after pulling:

```bash
git submodule update --init --recursive  # first checkout
git pull --recurse-submodules            # daily pull
git submodule foreach "git switch dev && git pull"  # align all to dev tip
```

### `Backend/` submodule — CRITICAL

**This is the source for the `flask-backend` Cloud Run service.** The main repo pins which SHA of `adamtasteslikegood/tasteslikegood.com` (tracked branch `dev`) gets deployed to production alongside the frontend. Any drift between the pointer and real Backend state = production risk.

**On every session start or before any merge/release:**

```bash
# Open PRs in the Backend repo (any unlanded work?)
gh pr list -R adamtasteslikegood/tasteslikegood.com --state open

# Commits on Backend dev not yet reflected in our pinned pointer
git -C Backend fetch && git -C Backend log --oneline HEAD..origin/dev

# Commits on Backend dev not yet promoted to Backend main
git -C Backend log --oneline origin/main..origin/dev

# Migration heads — MUST be exactly one line with (head)
cd Backend && uv run flask db heads
```

- Two migration heads = unmerged branch: use `flask db merge` to unify before deploying
- To fast-forward the pinned pointer: `git submodule update --remote Backend`
- Production deploys whatever SHA the submodule pins when the release tag fires — check the pointer before every release merge

### `alirez-claude-skills/` submodule

Houses the `pm-daemon/` MCP server. The daemon auto-syncs PM planning files to Confluence (see "PM Daemon" section below).

### `gemstack/` submodule

GStack browser tooling. Used by `/browse` skill in Claude Code sessions.

## PM Daemon (`.mcp.json`)

The `pm-daemon` MCP server runs `scripts/pm/run_pm_daemon.sh`, which sets up a venv and launches `alirez-claude-skills/pm-daemon/pm_daemon.py`. It:

1. Serves FastMCP tools (`sync_pm_documents`, `get_project_status`) over stdio
2. Runs a `watchdog` Observer that auto-syncs these files to Confluence on save:
   - `specs/plan.md`
   - `specs/roadmap.md`
   - `specs/planning_notes.md`
   - `specs/design-plan.md`
   - `specs/SCRUM_BOOTSTRAP_AND_BOARD_PLAN.md`
   - `specs/SPRINT_0_PLAN.md`
   - `specs/ATLASSIAN_PM_LINK.md`

Requirements:

- `.env` must contain `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`, and `ATLASSIAN_URL`
- `python3 -m venv` must work

Verify: `ps -ef | grep pm_daemon | grep -v grep`

## PM status script

`scripts/pm/sync_jira_confluence_status.py` — fetches live project status:

- Jira issues from KAN project
- Open GitHub PRs
- Confluence page info
- Production site health check

Install deps: `pip install -r scripts/pm/requirements.txt`
Env vars needed: `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`, `ATLASSIAN_URL`, `GITHUB_TOKEN`

## Branching strategy

Both this repo and the `Backend/` submodule follow the same model:

- **`main`** — release branch. Stable. Only the bot's release commit and merges from `dev` land here. Tags fire from `main`. `main` always matches the latest production tag.
- **`dev`** — integration branch. All feature work merges here first.
- **`feat/*`, `fix/*`, `chore/*`** — short-lived branches off `dev`. PR back into `dev`.

Never commit directly to `main` or `dev`. Always branch off `dev`.

To ship a Backend change:

1. PR into Backend `dev` (in `Backend/` submodule)
2. After it lands: `git submodule update --remote Backend`, commit the new pointer in a cookbook PR off `dev`, merge to `main`, release

## Database migrations

Backend migrations live in `Backend/migrations/versions/` (Alembic via Flask-Migrate). Applied in production by Cloud Run Job `flask-backend-migrate`.

When two PRs both add migrations off the same parent, detect branched heads:

```bash
cd Backend && uv run flask db heads  # must print exactly one line with (head)
```

To unify branched heads:

```bash
cd Backend && uv run flask db merge -m "merge <topic-a> and <topic-b> heads" <revA> <revB>
```

## Deployment

Two Cloud Run services + one Cloud Run Job in `us-central1`:

- `express-frontend` — Node.js, port 8080, public
- `flask-backend` — Python (gunicorn), port 5000, no public auth
- `flask-backend-migrate` — Cloud Run **Job** runs `flask db upgrade` before each Flask deploy

### Release flow

1. Feature work on `feat/*` / `fix/*` / `chore/*` off `dev`. PR into `dev`
2. When ready to ship: PR `dev` → `main`, bump `package.json` version + CHANGELOG. Merge.
3. `.github/workflows/release.yml` creates git tag `vX.Y.Z` and GitHub Release
4. Tag push `^v[0-9]+\.[0-9]+\.[0-9]+$` triggers Cloud Build → `cloudbuild.yaml`
5. `cloudbuild.yaml` builds images, runs migrate Job, deploys Flask then Express

Pre-release tags like `v0.3.0-rc.1` create a GitHub Release without triggering production deploy.

## Non-obvious patterns

- **Rate limiter** uses Valkey for distributed state; `server/valkey.ts` has open GH issues (#163, #162) for edge cases
- **AI model names** include `models/` prefix (e.g., `models/gemini-3.1-pro-preview`); filter by `generateContent` in `supported_generation_methods`
- **CI auto-formats** — Prettier runs as a CI job and commits fixes on push; don't be alarmed by bot commits
- **TypeScript 6.x is blocked** — `package.json` pins `typescript >= 5.9 < 7`
- **PM planning docs** live in `specs/` directory (except AGENTS.md at repo root)

## Further reading

- `Backend/API.md` — Flask API endpoint reference
- `Backend/DATABASE_SETUP.md` — migration steps
- `docs/PHASE_3/` — database architecture and data models
- `docs/DEPLOYMENT_CHECKLIST.md` — pre-production checklist
- `docs/rate_limit.md` — rate limiting details
- `specs/` — PM planning documents (plan, roadmap, design, etc.)
- `BRANCHING_STRATEGY.md` — detailed branching and release conventions
