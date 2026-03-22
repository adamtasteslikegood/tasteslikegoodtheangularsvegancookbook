# Phase IV — Implementation Summary

**Date:** 2026-03-03  
**Status:** ✅ Complete — build passing, Flask importable  
**Phase:** IV — Frontend ↔ Backend Persistence Wiring  

---

## What Was Done

Phase IV connected the Angular frontend services to the Flask backend so that recipes and
cookbooks persist to Cloud SQL PostgreSQL for logged-in users, while guest users continue
to work entirely in `localStorage` (zero behavior change for guests).

---

## Files Changed / Created (10 total)

### Express Layer

| File | Type | Change |
|------|------|--------|
| `server/proxy.ts` | Modified | Added generic `createFlaskProxy(label)` export. `createAuthProxy` now delegates to it. The proxy pattern is now reusable for any Flask route group. |
| `server/index.ts` | Modified | Imported `createFlaskProxy`; mounted `/api/recipes` and `/api/collections` proxy routes (before `express.json()` so request bodies stream through intact). |

### Flask Layer

| File | Type | Change |
|------|------|--------|
| `Backend/blueprints/recipes_api_bp.py` | Modified | Added `"data": recipe.data` to the `GET /api/recipes` list response. Required so Angular can reconstruct full `Recipe` objects from the API on login. |
| `Backend/models/cookbook.py` | **New** | SQLAlchemy `Cookbook` model. Stores `recipe_ids` as a PostgreSQL JSON array, matching Angular's `Cookbook` interface (`recipeIds: string[]`). |
| `Backend/models/__init__.py` | Modified | Added `Cookbook` to the `__all__` export so Alembic and blueprints can import it. |
| `Backend/migrations/versions/d4f8c2e19a73_add_cookbook_model.py` | **New** | Alembic migration that creates the `cookbook` table. Chained after the existing `b8896f552679` User/Recipe migration. |
| `Backend/blueprints/collections_api_bp.py` | **New** | Full CRUD blueprint for cookbooks: 6 routes (list, create, get, delete, add-recipe, remove-recipe). Modelled on `recipes_api_bp.py`. |
| `Backend/app.py` | Modified | Imported and registered `collections_api_bp` (`url_prefix="/api/collections"`). |

### Angular Layer

| File | Type | Change |
|------|------|--------|
| `src/services/auth.service.ts` | Modified | Added two new public methods: `hydrate(recipes, cookbooks)` — merges API-loaded data into the signal + localStorage cache; `deleteRecipe(id)` — removes a recipe from savedRecipes and all cookbook recipeIds. |
| `src/services/persistence.service.ts` | **New** | Hybrid persistence service. Routes API calls for authenticated users, delegates to `AuthService` localStorage methods for guests. Auto-syncs from Flask on login via Angular `effect()`. |

---

## Architecture Pattern

```
Browser (Angular)
    │
    │  All calls are relative URLs — no CORS needed
    │
    ▼
Express Server (express-frontend Cloud Run)
    ├── /api/recipe, /api/image     → handled locally (Gemini/Imagen)
    ├── /api/auth/*                 → proxied to Flask (auth session)
    ├── /api/recipes/*              → proxied to Flask (recipe CRUD)
    └── /api/collections/*          → proxied to Flask (cookbook CRUD)
                                           │
                                           ▼
                                    Flask (flask-backend Cloud Run)
                                           │
                                           ▼
                                    Cloud SQL (PostgreSQL)
                                    ├── user table
                                    ├── recipe table
                                    └── cookbook table  ← new
```

Full ADR (Architecture Decision Record) for why Express proxy was chosen over direct CORS:
→ `docs/ADR-001-auth-and-persistence-routing.md`

---

## API Surface After Phase IV

### Express-native (unchanged)
```
GET  /api/health
POST /api/recipe     → Gemini 2.5 Flash
POST /api/image      → Imagen 4.0
```

### Flask (proxied through Express)
```
# Auth
GET  /api/auth/check
GET  /api/auth/login
GET  /api/auth/callback
GET  /api/auth/me
POST /api/auth/logout

# Recipes
GET    /api/recipes
POST   /api/recipes
GET    /api/recipes/:id
PUT    /api/recipes/:id
DELETE /api/recipes/:id
GET    /api/recipes/stats

# Collections (Cookbooks)  ← new in Phase IV
GET    /api/collections
POST   /api/collections
GET    /api/collections/:id
DELETE /api/collections/:id
POST   /api/collections/:id/recipes
DELETE /api/collections/:id/recipes/:recipe_id
```

---

## Persistence Behaviour

| User Type | Save Recipe | Save Cookbook | On Page Refresh |
|-----------|-------------|---------------|-----------------|
| Guest | `localStorage` only | `localStorage` only | Data survives until browser clear |
| Google OAuth | `localStorage` (instant) + Flask API (async) | Flask API | Data loaded from Cloud SQL ✅ |

The `PersistenceService` effect fires once per login session — it calls `GET /api/recipes`
and `GET /api/collections`, then merges the results into Angular's user signal via
`AuthService.hydrate()`. Any localStorage-only recipes (created before login) are preserved
and can be uploaded to the API via `saveRecipe()`.

---

## Verification

```bash
# Build check
npm run build
# → Application bundle generation complete ✅

# Flask import check
cd Backend && .venv/bin/python -c "from app import create_app; print('OK')"
# → OK ✅

# Routes registered
.venv/bin/python -c "
from app import create_app
app = create_app()
with app.app_context():
    for r in sorted(app.url_map.iter_rules(), key=str):
        if 'collection' in str(r) or 'recipe' in str(r):
            print(r)
"
# → /api/collections (x2), /api/collections/<id> (x2),
#   /api/collections/<id>/recipes (x1), /api/collections/<id>/recipes/<rid> (x1)
#   /api/recipes (x2), /api/recipes/<id> (x3), /api/recipes/stats (x1) ✅
```
