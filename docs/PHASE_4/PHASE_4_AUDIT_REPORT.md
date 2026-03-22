# Phase IV — Pre-Implementation Audit Report

**Date:** 2026-03-03  
**Auditor:** GitHub Copilot  
**Scope:** What existed in the codebase before Phase IV changes, what was missing, and what each gap required.

---

## Audit Methodology

Files read before writing any code:

1. `Backend/blueprints/recipes_api_bp.py` — Flask recipe CRUD routes
2. `Backend/blueprints/` directory listing — blueprint inventory
3. `Backend/models/` directory — SQLAlchemy model inventory
4. `Backend/repositories/db_recipe_repository.py` — database layer
5. `Backend/migrations/versions/` — migration history and pattern
6. `Backend/requirements.txt` — available Python packages
7. `Backend/extensions.py` — Flask extensions (SQLAlchemy, Migrate)
8. `Backend/app.py` — blueprint registration
9. `server/proxy.ts` — Express proxy implementation
10. `server/index.ts` — Express route mounting
11. `src/services/auth.service.ts` — Angular auth + persistence (localStorage)
12. `src/auth.types.ts` — `User`, `Cookbook` interfaces
13. `src/recipe.types.ts` — `Recipe` interface
14. `docs/ADR-001-auth-and-persistence-routing.md` — architecture decision

---

## Audit Results

### ✅ What Existed and Was Ready

| Component | Status | Notes |
|-----------|--------|-------|
| Flask `/api/recipes` blueprint | ✅ Complete | All 5 CRUD routes + `/stats`. `url_prefix="/api/recipes"` set correctly. |
| Flask `/api/auth/*` blueprint | ✅ Complete | `login`, `callback`, `me`, `logout`, `check` all implemented. |
| `db_recipe_repository.py` | ✅ Complete | Full CRUD + migration helper functions. Handles NULL user_id for guests. |
| `User` SQLAlchemy model | ✅ Complete | `id`, `email`, `name`, `google_id`, `created_at`. |
| `Recipe` SQLAlchemy model | ✅ Complete | `id`, `user_id`, `name`, `data` (JSON), timestamps. `to_dict()` implemented. |
| Alembic migration infrastructure | ✅ Complete | Flask-Migrate configured in `extensions.py`. One migration exists: `b8896f552679`. |
| `flask-sqlalchemy`, `flask-migrate`, `psycopg2-binary` | ✅ In `requirements.txt` | No new pip packages needed. |
| Express proxy (`server/proxy.ts`) | ✅ Working | `createAuthProxy()` implemented with raw Node.js `http`/`https`. No npm deps needed. |
| Angular `AuthService` | ✅ Working | localStorage CRUD for recipes and cookbooks. Google OAuth flow via Flask. Signal-based state. |
| Angular `environment.ts` / `environment.prod.ts` | ✅ Correct | `flaskApiUrl: ''` — relative URLs. No change needed. |

---

### ❌ What Was Missing (Gaps That Blocked Phase IV)

#### Gap 1 — No `/api/collections` Flask blueprint

**Impact:** Angular had no API endpoint for cookbook persistence.  
**What was needed:** A full CRUD blueprint with 6 routes.  
**Fix:** Created `Backend/blueprints/collections_api_bp.py`.

---

#### Gap 2 — No `Cookbook` SQLAlchemy model

**Impact:** No database table to store cookbooks.  
**What was needed:** A model matching Angular's `Cookbook` interface (`id`, `name`, `description`, `recipeIds`, `coverImage`).  
**Decision:** Store `recipe_ids` as a JSON array (not a join table). Rationale:
  - Angular already uses `recipeIds: string[]` — no ORM join needed on the Python side.
  - Avoids a many-to-many association table and the cascade complexity that comes with it.
  - Queries are simple: filter by `user_id`, return the array.
  - PostgreSQL's JSON support handles this efficiently.  
**Fix:** Created `Backend/models/cookbook.py` and `Backend/migrations/versions/d4f8c2e19a73_add_cookbook_model.py`.

---

#### Gap 3 — Express proxy only covered `/api/auth/*`

**Impact:** Angular calls to `/api/recipes` and `/api/collections` would be handled by Express (which has no such routes) and return 404.  
**What was needed:** The proxy pattern extended to new route prefixes.  
**Fix:** Refactored `createAuthProxy()` into a generic `createFlaskProxy(label)` in `server/proxy.ts`. Added two new mounts in `server/index.ts`.

---

#### Gap 4 — `GET /api/recipes` list response omitted recipe `data`

**Impact:** Angular's `loadFromApi()` in `PersistenceService` would receive recipe stubs (id + name only) and could not reconstruct full `Recipe` objects.  
**What was needed:** The full `recipe.data` JSON blob in the list response.  
**Fix:** Added `"data": recipe.data` to the list comprehension in `list_recipes()`. Additive, backward-compatible change.

---

#### Gap 5 — No `PersistenceService` in Angular

**Impact:** `AuthService` only persisted to `localStorage`. A logged-in user's saved recipes were lost on browser refresh.  
**What was needed:** A service that (a) calls Flask API for authenticated users, (b) falls back to localStorage for guests, (c) auto-hydrates on login.  
**Fix:** Created `src/services/persistence.service.ts`.

---

#### Gap 6 — `AuthService` lacked `hydrate()` and `deleteRecipe()` methods

**Impact:** `PersistenceService` had no way to push API-loaded data back into the Angular user signal, and no way to remove a single recipe from localStorage.  
**Fix:** Added both methods to `src/services/auth.service.ts` (16 lines total).

---

## Package/Dependency Assessment

### Python (Backend)
| Package | Needed For | Status |
|---------|-----------|--------|
| `flask-sqlalchemy` | Cookbook model | ✅ Already in requirements.txt |
| `flask-migrate` | Alembic migrations | ✅ Already in requirements.txt |
| `psycopg2-binary` | PostgreSQL driver | ✅ Already in requirements.txt |
| `flask-cors` | CORS headers | ✅ Already installed (not needed for proxy pattern) |

**No new pip packages were added.**

### Node.js (Express)
| Package | Needed For | Status |
|---------|-----------|--------|
| `http` / `https` | Proxy transport | ✅ Node.js built-in |

**No new npm packages were added.**

### Angular
| Package | Needed For | Status |
|---------|-----------|--------|
| `@angular/core` signals, `effect`, `untracked` | PersistenceService reactive auto-sync | ✅ Already in Angular 21 |

**No new npm packages were added.**

---

## What Was NOT Changed (Intentionally Preserved)

| Component | Reason Preserved |
|-----------|-----------------|
| `server/index.ts` AI endpoints (`/api/recipe`, `/api/image`) | Working — not related to persistence |
| `server/security.ts` rate limiting, Helmet | Working — applies to all routes |
| `Backend/blueprints/auth_api_bp.py` | Working — full OAuth flow in place |
| `Backend/auth.py` (Flask template-based auth) | Legacy — kept for backward compat |
| `AuthService` localStorage methods | Guests and local cache still use them |
| `src/environments/environment.ts` | `flaskApiUrl: ''` is correct by design |
| Angular component (`app.component.ts`) | Out of scope — components call `PersistenceService` when they're ready |
