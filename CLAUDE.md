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

## Non-obvious patterns

- **Rate limiter** uses Valkey for distributed state across Express replicas; `server/valkey.ts` has open GH issues (#163, #162) for edge cases under broken connections — see KAN-16, KAN-17
- **AI model names** include `models/` prefix (e.g., `models/gemini-3.1-pro-preview`); filter by `generateContent` in `supported_generation_methods`
- **Backend submodule** — `Backend/` is a git submodule; always `git pull` inside it separately or use `git submodule update --remote`
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
