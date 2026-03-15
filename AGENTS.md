# AGENTS

> Last updated: 2026-03-14

**Vegangenius Chef** — AI-powered vegan recipe generator and personal cookbook app.
Angular 21 SPA → Express reverse-proxy → Flask API → Cloud SQL (PostgreSQL).

---

## Quick Orientation

```
Browser
  │  (all requests go to one origin)
  ▼
Express  (Cloud Run: express-frontend, port 8080)
  ├─ GET /*              → serves Angular SPA from dist/
  ├─ GET /api/health     → local health check
  └─ ALL /api/*          → reverse-proxied to Flask (server/proxy.ts)
                              │
Flask    (Cloud Run: flask-backend, port 5000)
  ├─ /api/auth/*         → Google OAuth login/logout/check
  ├─ /api/generate       → Gemini recipe generation
  ├─ /api/generate_image → Imagen food photo generation
  ├─ /api/recipes/*      → CRUD recipes (Cloud SQL)
  └─ /api/collections/*  → CRUD cookbooks/collections (Cloud SQL)
```

---

## Repository Layout

```
.                               # Project root
├── index.tsx                   # Angular bootstrap (entry point; .tsx per tsconfig jsx:react-jsx)
├── angular.json                # Angular CLI build config (builder: @angular/build:application)
├── tsconfig.json               # Frontend TypeScript config (target ES2022, jsx react-jsx)
├── tailwind.config.js          # Tailwind CSS v3
├── postcss.config.js           # PostCSS (Tailwind + autoprefixer)
├── eslint.config.js            # Flat ESLint config (TS + Angular + Prettier)
├── vitest.config.ts            # Vitest config (server tests only)
├── proxy.conf.json             # Dev proxy: /api → localhost:5000
├── Dockerfile                  # Multi-stage build (node:20-alpine)
├── cloudbuild.yaml             # GCB pipeline: build + push + deploy both services
├── package.json                # npm scripts, dependencies
├── .env.example                # Environment variable template
│
├── src/                        # ── Angular frontend ──────────────────
│   ├── app.component.ts        # Root component — ALL UI state + business logic (signals)
│   ├── app.component.html      # Root template (Tailwind-styled)
│   ├── styles.css              # Global styles (@tailwind directives)
│   ├── recipe.types.ts         # Recipe, Ingredient, IngredientGroup, InstructionStep
│   ├── auth.types.ts           # User, Cookbook, AuthProvider
│   ├── environments/
│   │   ├── environment.ts      # Dev  (flaskApiUrl: '' → proxied)
│   │   └── environment.prod.ts # Prod (flaskApiUrl: '' → proxied via Express)
│   └── services/
│       ├── gemini.service.ts   # Calls /api/generate, /api/generate_image (fetch)
│       ├── auth.service.ts     # Google OAuth + guest localStorage sessions
│       └── persistence.service.ts # Hybrid persistence: Flask API + localStorage cache
│
├── server/                     # ── Express backend (reverse proxy + SPA host) ──
│   ├── index.ts                # Entry point: health, proxy, static, SPA catch-all
│   ├── proxy.ts                # createFlaskProxy() — streams to FLASK_BACKEND_URL
│   ├── security.ts             # Helmet, rate limiters, request logger, error handler
│   ├── validation.ts           # express-validator rules (prompt, image fields)
│   ├── types.ts                # Server-side TS interfaces
│   ├── server.test.ts          # Vitest tests
│   └── tsconfig.server.json    # Separate TS config (target ES2022, outDir dist/)
│
├── Backend/                    # ── Flask backend (Python) ────────────
│   ├── app.py                  # Flask factory (create_app), CORS, session middleware
│   ├── auth.py                 # Google OAuth blueprint
│   ├── config.py               # DB URI, environment loading
│   ├── extensions.py           # SQLAlchemy db, Flask-Migrate
│   ├── blueprints/             # Route handlers (recipes, generation, collections, auth)
│   ├── models/                 # SQLAlchemy models
│   ├── repositories/           # Data access layer
│   ├── services/               # Business logic (Gemini, images, stock images)
│   ├── migrations/             # Alembic/Flask-Migrate schema migrations
│   ├── Dockerfile              # Flask production container
│   └── requirements.txt        # Python dependencies
│
├── docs/                       # Architecture decisions, guides, phase docs
│   ├── ADR-001-auth-and-persistence-routing.md  # Key: Express proxy decision
│   └── PHASE_{1..4}/          # Implementation phase records
│
└── scripts/                    # Utility scripts
    ├── list_revisions.sh       # List Cloud Run revisions (gcloud helper)
    └── commit-phase-1.sh       # Phase 1 commit script
```

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend framework | Angular (standalone components, signals API) | 21 |
| Styling | Tailwind CSS | 3 |
| Frontend build | Angular CLI (`@angular/build`) backed by Vite | 21 |
| Reverse proxy | Node.js + Express | 20 / 4.x |
| Backend API | Python + Flask | 3.x |
| Database | Cloud SQL (PostgreSQL) via SQLAlchemy + Flask-Migrate | — |
| AI — text | Google Gemini `gemini-2.5-flash` via `@google/genai` | — |
| AI — images | Google Imagen `imagen-4.0-generate-001` via `@google/genai` | — |
| Auth | Google OAuth (Flask sessions) + localStorage guests | — |
| Deployment | Google Cloud Run (2 services) + Cloud Build | — |
| Linting | ESLint (flat config) + Prettier | 9 / 3 |
| Testing | Vitest (server tests) | 4 |

---

## Development Commands

```bash
# Install
npm install

# Dev server (Angular on :3000, proxies /api → Flask on :5000)
npm run dev

# Build for production
npm run build          # Angular → dist/  +  server TS → server/dist/

# Start production server
export $(grep -v '^#' .env.local | xargs)
npm start              # node server/dist/index.js on :8080

# Lint & format
npm run lint           # ESLint (src + server)
npm run lint:fix       # Auto-fix
npm run format         # Prettier write
npm run format:check   # Prettier check

# Type check (both tsconfigs)
npm run type-check

# Tests
npm test               # Vitest (server tests)
npm run test:ci        # With coverage
```

---

## Environment Variables

Copy `.env.example` → `.env.local`. The Express server has **no dotenv loader** — export vars before `npm start`.

| Variable | Required | Used by | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | ✅ | Express (Secret Manager in prod) | Gemini API key |
| `FLASK_BACKEND_URL` | No | Express | Flask URL (default `http://localhost:5000`) |
| `PORT` | No | Express | Server port (default `8080`) |
| `NODE_ENV` | No | Express | `development` or `production` |
| `GOOGLE_API_KEY` | ✅ | Flask (Secret Manager in prod) | Gemini key for Flask |
| `FLASK_SECRET_KEY` | ✅ (prod) | Flask | Session signing key |
| `SQLALCHEMY_DATABASE_URI` | ✅ (prod) | Flask | PostgreSQL connection string |

**Rules:**
- API keys are **server-side only** — never exposed to the browser bundle.
- The `VITE_` prefix is a naming convention carried over from the project's origin — not used for secrets.
- Never hardcode secrets in source files or commit them.

---

## Architecture Notes

### Request Flow (ADR-001)

All browser requests go to Express. Express proxies every `/api/*` request to Flask via `server/proxy.ts` (raw HTTP stream, no body parsing). This means:
- **One origin** — no CORS issues, session cookies work automatically.
- Flask's `url_for(_external=True)` resolves correctly via `X-Forwarded-Host`.
- Angular uses only relative paths (`/api/...`) — no Flask URL in the bundle.

### Frontend (Angular 21)
- **Single standalone component** (`app.component.ts`) — all UI state + logic.
- **Signals API** (`signal()`, `computed()`) for all reactive state — no RxJS observables.
- **Three services:** `GeminiService` (AI calls), `AuthService` (OAuth + guest sessions), `PersistenceService` (hybrid API + localStorage).
- The dev server runs on **port 3000** and proxies `/api` to Flask on `:5000` via `proxy.conf.json`.

### Express Server (Reverse Proxy)
- Handles `/api/health` locally; everything else under `/api` is proxied to Flask.
- Serves the Angular `dist/` as static files with an SPA catch-all.
- Security: Helmet headers, rate limiting, request logging, error handler.
- **No AI logic** — the Express server is a pure reverse proxy + static host.

### Flask Backend (API + AI + Auth + DB)
- Google OAuth via Flask sessions (server-side, not JWT).
- Gemini recipe generation and Imagen image generation.
- CRUD for recipes and collections (cookbooks) in Cloud SQL.
- Modular: blueprints, repositories, services, models.

### Data Persistence
- **Cloud SQL (PostgreSQL)** — primary store for recipes, collections, user data.
- **localStorage** — client-side cache (`vegan_genius_session`) for offline/guest access.
- `PersistenceService` writes to localStorage first (instant UI), then syncs to Flask API.

### Deployment (Cloud Run)
- **Two Cloud Run services** in `us-central1`, project `comdottasteslikegood`:
  - `express-frontend` — serves SPA + proxies to Flask
  - `flask-backend` — API, AI, auth, database
- **Cloud Build** (`cloudbuild.yaml`) builds + pushes Docker images, deploys both services.
- Images stored in Artifact Registry: `us-central1-docker.pkg.dev/comdottasteslikegood/vegangenius/`
- Secrets injected via Secret Manager (`GEMINI_API_KEY`, `GOOGLE_API_KEY`, `FLASK_SECRET_KEY`).
- `flask-backend` has `roles/cloudsql.client` IAM for database access.

---

## Key Conventions

### Code Style
- **Signals, not RxJS** — new reactive state uses `signal()` / `computed()`.
- **Standalone components** — no NgModule; declare imports in the component's `imports` array.
- **Angular prefix** — components: `app-*` (kebab-case), directives: `app*` (camelCase).
- **Prettier + ESLint** — flat ESLint config with `eslint-config-prettier` last. Run `npm run format` before committing.
- **TypeScript strict** — server uses `strict: true`; frontend uses Angular defaults.

### Workflow
- **Minimal changes** — prefer surgical edits; avoid large refactors.
- **Keep dev and prod aligned** — changes must work in both `npm run dev` and `npm start`.
- **No new server-side runtime dependencies** unless explicitly requested.
- **Documentation** goes in `docs/` (exception: top-level files like `README.md`).
- **No hardcoded secrets** — use environment variables; API keys stay server-side.

### File Naming
- Angular: `*.component.ts`, `*.service.ts`, `*.types.ts`
- Server: `*.ts` (compiled to `server/dist/`)
- Flask: snake_case Python files, blueprint pattern
- Docs: UPPERCASE_SNAKE.md for guides, ADR-NNN-*.md for decisions

---

## Available Utility Scripts

| Script | Location | Description |
|---|---|---|
| `list_revisions.sh` | `scripts/` | List recent Cloud Run revisions. Flags: `-n` (count), `-s`/`-S` (services), `-p` (project), `-r` (region), `-h` (help). |

---

## Cloud Run Operations (Quick Reference)

```bash
# List recent revisions for both services
./scripts/list_revisions.sh

# List 5 revisions for a specific service
./scripts/list_revisions.sh -n 5 -s flask-backend

# Set min instances on a service
gcloud run services update flask-backend \
  --region=us-central1 \
  --project=comdottasteslikegood \
  --min-instances=1

# Deploy a new image manually
gcloud run deploy express-frontend \
  --image=us-central1-docker.pkg.dev/comdottasteslikegood/vegangenius/express-frontend:TAG \
  --region=us-central1 \
  --project=comdottasteslikegood
```

---

## Short-Term Goals & Direction

1. **Cold-start mitigation** — set `min-instances=1` on `flask-backend` to keep the database connection warm and reduce first-request latency.
2. **CI/CD hardening** — Cloud Build pipeline refinements, automated tests in pipeline.
3. **Frontend polish** — UI/UX improvements, accessibility, responsive design refinements.
4. **Test coverage** — expand Vitest server tests; consider adding Angular component tests.
5. **Observability** — structured logging, Cloud Logging queries, alerting.

---

## Common Errors & Workarounds

| Error | Cause | Fix |
|---|---|---|
| `Missing API key` on first AI request | `GEMINI_API_KEY` / `GOOGLE_API_KEY` not set | Export env vars: `export $(grep -v '^#' .env.local \| xargs)` |
| Angular build fails with type errors | Server TS included in frontend compilation | Server has own `server/tsconfig.server.json`; check `include` arrays |
| `dist/` not found on `npm start` | Server started before build | Run `npm run build` first |
| `/api/*` 502 in dev | Flask backend not running | Start Flask on `:5000` (`cd Backend && python app.py`) |
| `Backend service unavailable` in prod | Express can't reach Flask Cloud Run | Check `FLASK_BACKEND_URL` env var on `express-frontend` service |
| Build artefacts committed | `dist/` not in `.gitignore` | Already gitignored — do not commit `dist/` |
