# Copilot Instructions

## Project Overview

**Vegangenius Chef** is a vegan recipe generator and personal cookbook app. It is a single-page Angular 21 application backed by a Node.js/Express server. The AI layer uses Google Gemini (text generation via `gemini-2.5-flash` and image generation via `imagen-4.0-generate-001`).

Users can:
- Generate vegan recipes from a natural-language prompt
- Have AI-generated food photos created for each recipe
- Save recipes, organise them into named cookbooks, and scale ingredient portions
- Enter recipes manually and import/export recipes as JSON
- Sign in via Google OAuth (or use the app as a guest, with data stored in `localStorage`)

---

## Repository Layout

```
index.tsx                    # Angular app bootstrap (entry point; .tsx because tsconfig sets jsx:react-jsx, but this is an Angular file)
angular.json                 # Angular CLI / build configuration
tsconfig.json                # TypeScript config for the Angular app
tailwind.config.js           # Tailwind CSS configuration
postcss.config.js

src/
  app.component.ts           # Root component – all UI state and business logic
  app.component.html         # Root template
  styles.css                 # Global styles (Tailwind directives)
  recipe.types.ts            # Recipe, Ingredient, IngredientGroup interfaces
  auth.types.ts              # User, Cookbook, AuthProvider interfaces
  environments/
    environment.ts           # Dev config (flaskApiUrl = '' → relative/proxied)
    environment.prod.ts      # Prod config
  services/
    gemini.service.ts        # Calls /api/recipe and /api/image (Angular injectable)
    auth.service.ts          # Google OAuth + guest session management

server/
  index.ts                   # Express server entry point (API + static file serving)
  security.ts                # Rate-limiting, Helmet headers, request logger, error handler
  validation.ts              # express-validator rules for /api/recipe and /api/image
  types.ts                   # Server-side TypeScript types
  tsconfig.server.json       # TypeScript config for the server

proxy.conf.json              # Dev proxy: /api/auth/* → http://localhost:5000 (Flask)
Dockerfile                   # Production container (Cloud Run)
cloudbuild.yaml              # Google Cloud Build pipeline
docs/                        # Additional documentation
scripts/                     # Utility scripts
.env.example                 # Template for environment variables
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | Angular 21 (standalone components, signals API) |
| Styling | Tailwind CSS v3 |
| Frontend build | Angular CLI (`@angular/build`) backed by Vite |
| Backend | Node.js + Express |
| Backend language | TypeScript (compiled with `tsc`) |
| AI – text | Google Gemini `gemini-2.5-flash` via `@google/genai` |
| AI – images | Google Imagen `imagen-4.0-generate-001` via `@google/genai` |
| Auth | Google OAuth (Flask proxy in dev, backend sessions) + localStorage guests |
| Deployment | Google Cloud Run (Docker container) |

---

## Development Commands

```bash
# Install dependencies
npm install

# Start the Angular dev server (port 3000, hot-reload, API proxy to Flask on 5000)
npm run dev

# Build for production (Angular app → dist/, server TypeScript → server/dist/)
npm run build

# Start the production server (serves Angular SPA + /api/* endpoints on port 8080)
npm start
```

There is **no test suite** in this repository. There is no lint script beyond TypeScript compilation.

### Build troubleshooting

If the build fails after dependency changes:
```bash
rm -rf dist node_modules
npm install
npm run build
```

---

## Environment Variables

Copy `.env.example` to `.env.local` and populate it. The server reads these at runtime.

| Variable | Required | Description |
|---|---|---|
| `VITE_GEMINI_API_KEY` | ✅ Yes | Google Gemini API key (preferred) |
| `VITE_API_KEY` | Fallback | Alternative API key variable (deprecated) |
| `PORT` | No | Server port (default `8080`) |
| `NODE_ENV` | No | `development` or `production` |

**Rules:**
- The Gemini API key is **only ever read by the Express server** (`server/index.ts → getClient()`). The Angular client never accesses it directly — all AI calls go through `/api/recipe` and `/api/image`.
- The `VITE_` prefix in the variable names is a naming convention carried over from the project's origin; these variables are **not** exposed to the browser bundle.
- Never hardcode API keys in source files or commit them.
- If you add a new variable that genuinely needs to be read in the Angular client bundle, use the `VITE_` prefix — Vite will inline it at build time. Do not do this for secrets.

---

## Architecture Notes

### Frontend (Angular)
- The root component `src/app.component.ts` uses Angular **signals** (`signal()`, `computed()`) for all reactive state — no RxJS observables.
- Components are **standalone** (no NgModule). Imports are declared per-component.
- `GeminiService` communicates with the backend via `fetch()` to `/api/recipe` and `/api/image`.
- `AuthService` handles Google OAuth (redirects to `/api/auth/login`) and falls back to `localStorage` guest sessions. On startup it calls `/api/auth/check` to restore an existing Flask session.
- In development, `/api/auth/*` is proxied to a Flask backend on `localhost:5000` via `proxy.conf.json`. The Angular dev server itself runs on port 3000.

### Backend (Express)
- `server/index.ts` is the single Express entry point. It handles:
  - `POST /api/recipe` – generates a vegan recipe using Gemini (validated, rate-limited)
  - `POST /api/image` – generates a food photo using Imagen (validated, rate-limited)
  - `GET /api/health` – health check (skipped by rate limiter)
  - Static file serving of the Angular `dist/` output
  - Catch-all `GET *` returns `dist/index.html` (SPA routing)
- `server/security.ts` applies Helmet headers (CSP disabled — Angular uses inline styles), rate limiting (`100 req/15 min` general, `20 req/hr` for AI endpoints), request logging, and a generic error handler.
- `server/validation.ts` uses `express-validator` to validate `prompt` (string, 1–500 chars) and image request fields.
- The Gemini client is lazily instantiated (`getClient()`) — app startup does not fail if `VITE_GEMINI_API_KEY` is absent.

### Data Persistence
- Recipes and cookbooks are stored in **`localStorage`** (key: `vegan_genius_session`) under the `AuthService`. There is no database.
- Authenticated (Google) users merge their guest `localStorage` data into their account on first login.

---

## Key Conventions

- **Minimal changes**: prefer surgical edits; avoid large refactors.
- **Keep dev and prod aligned**: changes must work in both `npm run dev` and `npm start`.
- **No new server-side runtime dependencies** unless explicitly requested.
- **Documentation** goes in `docs/` (exception: top-level files like `README.md`).
- **Signals, not RxJS**: new reactive state in the Angular layer should use `signal()` / `computed()`.
- **Standalone components**: do not add NgModule patterns; declare imports in the component's `imports` array.
- **No hardcoded secrets**: use environment variables; `VITE_`-prefix only for variables that must be inlined into the client bundle at build time (not for secrets — API keys stay server-side).

---

## Common Errors & Workarounds

| Error | Cause | Fix |
|---|---|---|
| `Missing API key` on server start | `VITE_GEMINI_API_KEY` not set | Copy `.env.example` → `.env.local` and set the key |
| Angular build fails with type errors | Server TypeScript included in frontend compilation | The server has its own `server/tsconfig.server.json`; ensure files lists are correct |
| `dist/` not found on `npm start` | Server started before build | Run `npm run build` first |
| `/api/auth/*` 404 in dev | Flask backend not running | Start Flask on port 5000, or test without Google auth (guest mode works without it) |
| Build artefacts committed | `dist/` not in `.gitignore` | `dist/` is already in `.gitignore`; do not commit it |
