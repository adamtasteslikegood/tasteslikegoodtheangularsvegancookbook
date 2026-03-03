# Phase IV — Local Development Checklist (SQLite)

> **Goal:** Verify all Phase IV persistence changes work end-to-end in the local dev environment before deploying to Cloud Run. The local Flask server uses SQLite (stored in `Backend/instance/`). No Google Cloud services are required for these steps.
>
> **Code-review findings incorporated** — four bugs were identified during review; fixes are listed inline where they affect the test.

---

## 0. Prerequisites

- [ ] Node.js ≥ 20, Python ≥ 3.11, and [`uv`](https://docs.astral.sh/uv/) installed
- [ ] `npm install` completed at repo root
- [ ] Backend dependencies installed via `uv`:
  ```bash
  cd Backend
  uv sync
  ```
- [ ] `.env.local` exists at repo root with `VITE_GEMINI_API_KEY` set
- [ ] `Backend/.env` exists with at minimum:
  ```
  FLASK_SECRET_KEY=dev-secret-change-in-prod
  DATABASE_URL=sqlite:///instance/dev.db
  FRONTEND_URL=http://localhost:8080
  ```

---

## 1. Database Setup (SQLite)

- [ ] **Run migrations** — creates `recipe`, `cookbook`, and other tables:
  ```bash
  cd Backend
  uv run flask db upgrade
  ```
- [ ] **Verify tables exist:**
  ```bash
  sqlite3 instance/dev.db ".tables"
  # Expected output includes: recipe  cookbook  alembic_version
  ```
- [ ] **Verify cookbook schema:**
  ```bash
  sqlite3 instance/dev.db "PRAGMA table_info(cookbook);"
  # Expected columns: id, user_id, name, description, recipe_ids, cover_image_url, created_at, updated_at
  ```
- [ ] **Seed a test user** (if Google OAuth not configured locally):
  ```bash
  sqlite3 instance/dev.db "INSERT INTO user (id, email, name) VALUES ('test-user-1', 'dev@test.com', 'Dev User');" 2>/dev/null || echo "No user table or already exists — check your User model"
  ```
  > ℹ️ Guest mode (localStorage only) does not require a DB user — skip this if testing guest flow only.

---

## 2. Start Dev Servers

Open **three terminals** simultaneously:

**Terminal A — Flask backend (port 5000):**
```bash
cd Backend
export $(grep -v '^#' .env | xargs)
uv run flask run --port 5000 --debug
```
Expected: `Running on http://127.0.0.1:5000`

**Terminal B — Express + Angular (port 8080):**
```bash
export $(grep -v '^#' .env.local | xargs)
npm run build && npm start
```
Expected: `Listening on port 8080`

> ℹ️ The Express server on port 8080 serves the Angular SPA and proxies `/api/auth/*`, `/api/recipes`, and `/api/collections` to Flask. Use **http://localhost:8080** for all browser testing.

> ⚠️ For faster frontend iteration (hot-reload), run `npx ng serve --port 8080 --proxy-config proxy.conf.json` instead of `npm run build && npm start`. This requires Angular CLI installed (`npm i -g @angular/cli`).

---

## 3. Flask API Smoke Tests (Direct, no Angular)

Use `curl` to verify Flask endpoints before testing through the full stack.

### 3a. Health
- [ ] `curl http://localhost:5000/api/health` → `{"status": "ok"}`

### 3b. Recipes — list (unauthenticated should return 401)
- [ ] `curl http://localhost:5000/api/recipes` → `{"error": "Unauthorized"}` or `401`

### 3c. Recipes — create (using session cookie from login)
> If OAuth is not configured locally, skip to Section 4 (Guest Mode tests).
- [ ] Log in via `http://localhost:8080/api/auth/login` in a browser
- [ ] Copy session cookie, then:
  ```bash
  curl -X POST http://localhost:5000/api/recipes \
    -H "Content-Type: application/json" \
    -b "session=<your-cookie>" \
    -d '{"id":"test-r-001","title":"Test Soup","ingredients":[],"instructions":[]}'
  ```
  → `{"id": "test-r-001", ...}` with **same ID returned** (not a new UUID)

  > 🐛 **Bug check:** If the returned `id` differs from `"test-r-001"`, the recipe repository is ignoring the provided ID. This causes frontend/backend ID mismatch. Fix in `Backend/repositories/db_recipe_repository.py` — use `recipe_data.get('id') or str(uuid.uuid4())`.

### 3d. Recipes — list (authenticated)
- [ ] `curl http://localhost:5000/api/recipes -b "session=<cookie>"` → array containing the recipe created above

### 3e. Collections — create
- [ ] ```bash
  curl -X POST http://localhost:5000/api/collections \
    -H "Content-Type: application/json" \
    -b "session=<cookie>" \
    -d '{"name":"My First Cookbook","description":"Test cookbook"}'
  ```
  → `{"id": "...", "name": "My First Cookbook", ...}`

### 3f. Collections — add recipe
- [ ] ```bash
  curl -X POST http://localhost:5000/api/collections/<cookbook-id>/recipes \
    -H "Content-Type: application/json" \
    -b "session=<cookie>" \
    -d '{"recipe_id":"test-r-001"}'
  ```
  → `200 OK`

### 3g. Collections — list
- [ ] `curl http://localhost:5000/api/collections -b "session=<cookie>"` → array with your cookbook, `recipe_ids` contains `"test-r-001"`

### 3h. Collections — delete recipe from cookbook
- [ ] ```bash
  curl -X DELETE http://localhost:5000/api/collections/<cookbook-id>/recipes/test-r-001 \
    -b "session=<cookie>"
  ```
  → `200 OK`; subsequent GET shows `recipe_ids` is empty

### 3i. Collections — delete cookbook
- [ ] `curl -X DELETE http://localhost:5000/api/collections/<cookbook-id> -b "session=<cookie>"`
  → `204 No Content`

---

## 4. Guest Mode Tests (localStorage, no auth)

Open `http://localhost:8080` **without logging in.**

- [ ] Generate a recipe via the UI — verify it appears in the recipe list
- [ ] Open DevTools → Application → Local Storage → `vegan_genius_session` — confirm recipe is stored
- [ ] Create a cookbook — confirm it appears in the UI and in localStorage
- [ ] Add the recipe to the cookbook — confirm `recipeIds` array is updated in localStorage
- [ ] Refresh the page — confirm all data persists (reload from localStorage)
- [ ] Delete a recipe — confirm it disappears from UI and localStorage

  > 🐛 **Bug check:** Currently `deleteRecipe()` in `persistence.service.ts` deletes from localStorage before checking if the API call succeeded. In guest mode this is harmless (no API call). In logged-in mode, if the API fails, the item will reappear on next login. Note for future fix.

---

## 5. PersistenceService — Logged-In Flow

Log in via Google OAuth (requires `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `Backend/.env`).

- [ ] **Login triggers hydration:** After login, open DevTools → Network — verify `GET /api/recipes` and `GET /api/collections` requests fire automatically
- [ ] **Guest data merge:** Before logging in, create 1-2 guest recipes. After login, verify those recipes appear in the logged-in recipe list and in the DB:
  ```bash
  sqlite3 Backend/instance/dev.db "SELECT id, title FROM recipe;"
  ```
- [ ] **New recipe saves to DB:** Generate a new recipe while logged in → check DB:
  ```bash
  sqlite3 Backend/instance/dev.db "SELECT id, title FROM recipe ORDER BY created_at DESC LIMIT 1;"
  ```
- [ ] **Cookbook creates in DB:** Create a cookbook while logged in → check DB:
  ```bash
  sqlite3 Backend/instance/dev.db "SELECT id, name, recipe_ids FROM cookbook;"
  ```
- [ ] **Session persists on refresh:** Refresh the page — verify recipes and cookbooks still show (served from DB, not just localStorage)
- [ ] **Logout clears local state:** Log out → confirm UI shows empty state, localStorage is cleared

---

## 6. Express Proxy Tests

Verify Express forwards `/api/recipes` and `/api/collections` to Flask correctly.

- [ ] With both servers running, call via Express (port 8080):
  ```bash
  curl http://localhost:8080/api/recipes -b "session=<cookie>"
  ```
  → Same response as hitting Flask directly on 5000

- [ ] Verify proxy error handling: stop Flask, then:
  ```bash
  curl http://localhost:8080/api/recipes
  ```
  → Should return `502 Bad Gateway` or similar, not crash Express

  > 🐛 **Bug check:** If Express crashes or hangs instead of returning 502, add error handling in `server/proxy.ts`.

---

## 7. Known Bugs to Fix Before Production

The code review identified four bugs. Track them here:

| # | File | Severity | Issue | Status |
|---|------|----------|-------|--------|
| 1 | `Backend/repositories/db_recipe_repository.py:74` | 🔴 High | Recipe ID ignored on create — always generates new UUID, breaks idempotency; fix: `recipe_id = recipe_data.get('id') or str(uuid.uuid4())` | ☐ |
| 2 | `src/services/persistence.service.ts:62,104,133` | 🟡 Medium | Delete from localStorage before checking API success — deleted items reappear on next login if API fails | ☐ |
| 3 | `src/services/persistence.service.ts:70-92` | 🟡 Medium | Race condition in `createCookbook()` — user reference not re-validated after async API call | ☐ |
| 4 | `src/services/persistence.service.ts:115-122` | 🟡 Medium | `addRecipeToCookbook()` — no error check on `_apiSaveRecipe()` before adding to collection; localStorage and DB can diverge | ☐ |

---

## 8. Gemini Enterprise Review — Action Items for Dev

From `Google Cloud App Designs/Phase4_GeminiEnterprise_ReviewRecomendations.md`:

| Priority | Item | Dev Action |
|----------|------|------------|
| 🔴 Critical | `FLASK_SECRET_KEY` must be consistent (not random) | Set a fixed dev key in `Backend/.env`; never use default |
| 🔴 Critical | `FRONTEND_URL` must be set in Flask env | Add `FRONTEND_URL=http://localhost:8080` to `Backend/.env` |
| 🟡 High | Terraform var name mismatch (`flask_backend_SERVICE_ENDPOINT` vs `FLASK_BACKEND_URL`) | Fix in `Google Cloud App Designs/app-template-5-main.tf` before next deploy |
| 🟡 High | Guest recipe merge UX — prompt user instead of auto-upload | Design the UX; implement after core persistence is stable |
| 🟢 Medium | `updateCookbook()` method missing from `PersistenceService` | Add `PUT /api/collections/:id` support when cover image feature is built |
| 🟢 Medium | Proxy wildcard consolidation — single `/api/*` catch-all vs per-path mounts | Refactor `server/index.ts` after all API paths are known |

---

## 9. Ready for Cloud Run?

Before moving to production, all of the following must be true:

- [ ] All Section 3 curl tests pass against SQLite
- [ ] All 4 bugs in Section 7 are fixed
- [ ] `uv run flask db upgrade` tested against a PostgreSQL instance (can use Cloud SQL Proxy locally)
- [ ] `FLASK_SECRET_KEY` stored in Secret Manager (not hardcoded)
- [ ] `FRONTEND_URL` added to flask-backend Cloud Run env vars
- [ ] Terraform `flask_backend_SERVICE_ENDPOINT` renamed to `FLASK_BACKEND_URL`
- [ ] `min_instance_count = 1` set on flask-backend service
- [ ] End-to-end OAuth test on staging URL (not localhost)

---

*Last updated: Phase IV implementation — see `PHASE_4_IMPLEMENTATION_SUMMARY.md` for full context.*
