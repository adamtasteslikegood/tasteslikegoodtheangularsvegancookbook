# Phase 3 Architecture Diagram

Visual representation of the Phase 3 database-backed architecture.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Angular 21)                        │
│                      http://localhost:3000 (dev)                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────────┐    │
│  │ AppComponent │───▶│ AuthService  │    │  GeminiService    │    │
│  │   (signals)  │    │  (OAuth)     │    │ (AI generation)   │    │
│  └──────────────┘    └──────────────┘    └───────────────────┘    │
│         │                    │                      │               │
│         │                    │                      │               │
│         ▼                    ▼                      ▼               │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │           RecipeService (⏳ Phase 3 - TODO)              │     │
│  │  - API calls to /api/recipes                             │     │
│  │  - localStorage fallback for guests                      │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                       │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ HTTP Requests
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    EXPRESS SERVER (Node.js)                          │
│                      http://localhost:8080                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌────────────────────┐        ┌────────────────────┐              │
│  │  POST /api/recipe  │        │  POST /api/image   │              │
│  │ (Generate Recipe)  │        │ (Generate Image)   │              │
│  └────────────────────┘        └────────────────────┘              │
│             │                              │                         │
│             └──────────────┬───────────────┘                         │
│                            ▼                                         │
│                 ┌─────────────────────┐                             │
│                 │   Google Gemini     │                             │
│                 │  - gemini-2.5-flash │                             │
│                 │  - imagen-4.0       │                             │
│                 └─────────────────────┘                             │
│                                                                       │
│  ┌────────────────────────────────────────────────────────┐        │
│  │           Static File Serving                           │        │
│  │  GET /* → serves Angular dist/                          │        │
│  └────────────────────────────────────────────────────────┘        │
│                                                                       │
│  ┌────────────────────────────────────────────────────────┐        │
│  │           Proxy to Flask (dev only)                     │        │
│  │  /api/auth/* → http://localhost:5000                    │        │
│  └────────────────────────────────────────────────────────┘        │
│                                                                       │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ Proxy
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      FLASK BACKEND (Python)                          │
│                      http://localhost:5000                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                   Authentication                              │  │
│  │  GET  /api/auth/login     → Initiate OAuth                   │  │
│  │  GET  /api/auth/callback  → OAuth callback                   │  │
│  │  GET  /api/auth/me        → Current user info                │  │
│  │  GET  /api/auth/check     → Auth status                      │  │
│  │  POST /api/auth/logout    → Clear session                    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                            │                                         │
│                            ▼                                         │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │               User Persistence (Phase 3)                      │  │
│  │  - Create/update User in database                            │  │
│  │  - Store user_id in session                                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              Recipe API (Phase 3 - NEW!)                      │  │
│  │  GET    /api/recipes       → List user's recipes             │  │
│  │  POST   /api/recipes       → Create recipe                   │  │
│  │  GET    /api/recipes/:id   → Get recipe                      │  │
│  │  PUT    /api/recipes/:id   → Update recipe                   │  │
│  │  DELETE /api/recipes/:id   → Delete recipe                   │  │
│  │  GET    /api/recipes/stats → Recipe statistics               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                            │                                         │
│                            ▼                                         │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │            Database Repository Layer                          │  │
│  │  - db_recipe_repository.py                                   │  │
│  │  - CRUD operations with SQLAlchemy                           │  │
│  │  - User ownership enforcement                                │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                            │                                         │
│                            ▼                                         │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                 SQLAlchemy ORM                                │  │
│  │  - models/user.py                                            │  │
│  │  - models/recipe.py                                          │  │
│  │  - Flask-Migrate for migrations                              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                            │                                         │
└────────────────────────────┼─────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          DATABASE                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Development: SQLite (tasteslikegood.db)                     │  │
│  │  Production:  PostgreSQL (Cloud SQL / Railway / Heroku)      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌─────────────────────────┐   ┌────────────────────────────────┐  │
│  │     Table: user         │   │      Table: recipe             │  │
│  ├─────────────────────────┤   ├────────────────────────────────┤  │
│  │ id (PK)                 │   │ id (PK, UUID)                  │  │
│  │ email (UNIQUE)          │   │ user_id (FK → user.id)         │  │
│  │ name                    │   │ name                           │  │
│  │ google_id (UNIQUE)      │   │ data (JSON)                    │  │
│  │ created_at              │   │ created_at                     │  │
│  └─────────────────────────┘   │ updated_at                     │  │
│                                 └────────────────────────────────┘  │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Recipe Creation

### Authenticated User Flow

```
1. User clicks "Generate Recipe" in Angular
                │
                ▼
2. Angular → Express POST /api/recipe
   - Includes session cookie
                │
                ▼
3. Express → Gemini API (generate recipe JSON)
                │
                ▼
4. Express returns recipe to Angular
                │
                ▼
5. Angular → Flask POST /api/recipes
   - Session identifies user
                │
                ▼
6. Flask extracts user_id from session
                │
                ▼
7. db_recipe_repository.create_recipe(data, user_id)
                │
                ▼
8. SQLAlchemy inserts into database
                │
                ▼
9. Recipe saved with user ownership
                │
                ▼
10. Angular displays success message
```

### Guest User Flow (Phase 3)

```
1. User clicks "Generate Recipe" in Angular
                │
                ▼
2. Angular → Express POST /api/recipe
   - No session cookie
                │
                ▼
3. Express → Gemini API (generate recipe JSON)
                │
                ▼
4. Express returns recipe to Angular
                │
                ▼
5. Angular saves to localStorage
   - No database call (user not authenticated)
                │
                ▼
6. Recipe available in current session only
```

### Guest → Authenticated Migration Flow

```
1. Guest user has recipes in localStorage
                │
                ▼
2. User logs in via Google OAuth
                │
                ▼
3. Flask creates/updates User in database
                │
                ▼
4. Angular detects authentication success
                │
                ▼
5. Angular reads recipes from localStorage
                │
                ▼
6. For each recipe:
   Angular → Flask POST /api/recipes
                │
                ▼
7. Recipes saved to database with user_id
                │
                ▼
8. localStorage cleared (optional)
                │
                ▼
9. User now has persistent recipes
```

---

## Phase 3 File Organization

```
Backend/
├── app.py                           # Flask app factory
├── config.py                        # Database URI config
├── extensions.py                    # SQLAlchemy, Flask-Migrate
│
├── models/
│   ├── __init__.py                  # Model exports
│   ├── user.py                      # User model
│   └── recipe.py                    # Recipe model
│
├── repositories/
│   ├── db_recipe_repository.py      # ✨ NEW: Database operations
│   └── recipe_repository.py         # Legacy: File operations
│
├── blueprints/
│   ├── recipes_api_bp.py            # ✨ NEW: Recipe CRUD API
│   ├── auth_api_bp.py               # ✨ UPDATED: User persistence
│   ├── api_bp.py                    # ✨ UPDATED: Health check
│   ├── generation_bp.py             # TODO: Save to database
│   └── recipes_bp.py                # Legacy: File-based routes
│
├── scripts/
│   └── migrate_recipes_to_db.py     # ✨ NEW: File → DB migration
│
├── migrations/                      # Created by flask db init
│   ├── versions/
│   └── alembic.ini
│
├── tasteslikegood.db                # SQLite database (gitignored)
├── DATABASE_SETUP.md                # ✨ NEW: Setup guide
└── init_database.sh                 # ✨ NEW: Setup script

src/ (Angular)
├── app.component.ts                 # TODO: Use RecipeService
├── services/
│   ├── auth.service.ts              # Existing
│   ├── gemini.service.ts            # Existing
│   └── recipe.service.ts            # TODO: Create for API calls
└── ...

docs/
├── PHASE_3_INDEX.md                 # ✨ NEW: This file
├── PHASE_3_DATABASE_IMPLEMENTATION.md  # ✨ NEW: Main guide
├── PHASE_3_SUMMARY.md               # ✨ NEW: Implementation summary
├── PHASE_3_PROGRESS.md              # ✨ NEW: Task tracking
├── PHASE_3_QUICKREF.md              # ✨ NEW: Quick reference
└── RECIPE_API.md                    # ✨ NEW: API documentation
```

---

## Technology Stack (Phase 3)

```
┌─────────────────────────────────────────────────────────┐
│                  Frontend (Angular 21)                   │
│  - Signals API                                          │
│  - Standalone components                                │
│  - HttpClient for API calls                             │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│             Backend 1: Express (Node.js)                 │
│  - TypeScript                                           │
│  - AI generation endpoints                              │
│  - Static file serving                                  │
│  - Security middleware                                  │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│              Backend 2: Flask (Python)                   │
│  - Google OAuth 2.0                                     │
│  - SQLAlchemy ORM                                       │
│  - Flask-Migrate (Alembic)                              │
│  - RESTful API (Phase 3)                                │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                      Database                            │
│  - SQLite (dev): tasteslikegood.db                      │
│  - PostgreSQL (prod): Cloud SQL / Railway / Heroku      │
└─────────────────────────────────────────────────────────┘
```

---

## Authentication Flow (Phase 3)

```
┌─────────────┐
│   Browser   │
└──────┬──────┘
       │
       │ 1. Click "Sign in with Google"
       ▼
┌─────────────────┐
│   Angular App   │
└──────┬──────────┘
       │
       │ 2. Redirect to /api/auth/login
       ▼
┌─────────────────┐
│  Flask Backend  │
└──────┬──────────┘
       │
       │ 3. Redirect to Google OAuth
       ▼
┌─────────────────┐
│  Google OAuth   │
└──────┬──────────┘
       │
       │ 4. User authorizes
       ▼
┌─────────────────┐
│  Flask Backend  │ 5. /api/auth/callback
│                 │    - Exchange code for token
│                 │    - Get user info from Google
│                 │    ┌─────────────────────────┐
│                 │───▶│ Create/Update User in DB │
│                 │    └─────────────────────────┘
│                 │    - Store user_id in session
│                 │    - Set session cookie
└──────┬──────────┘
       │
       │ 6. Redirect to Angular with cookie
       ▼
┌─────────────────┐
│   Angular App   │ 7. Call /api/auth/check
└──────┬──────────┘    - Confirm authentication
       │               - Get user info
       ▼
┌─────────────────┐
│  Authenticated  │ 8. All API calls include session cookie
│      State      │    - /api/recipes uses user_id from session
└─────────────────┘
```

---

## Migration Strategy

### Phase 2 → Phase 3 (Current)

```
Before (Phase 2):
  Recipes → JSON files in recipes/
  Users → Session data only (not persisted)

After (Phase 3):
  Recipes → Database (user ownership)
  Users → Database (persistent)
  
Transition:
  ✅ Both systems coexist
  ✅ Migration script: files → database
  ✅ No data loss
  ⏳ Frontend still uses localStorage (pending)
```

---

## Deployment Architecture

### Development
```
localhost:3000 ← Angular dev server (ng serve)
localhost:8080 ← Express server (npm run dev)
localhost:5000 ← Flask backend (python app.py)
File: tasteslikegood.db (SQLite)
```

### Production (Cloud Run)
```
your-app.run.app (HTTPS)
├─ Express container (serves Angular + AI endpoints)
└─ Flask container (auth + recipes API)
    └─ Cloud SQL (PostgreSQL)
```

---

## Success Metrics

| Metric | Target | Status |
|--------|--------|--------|
| Backend models created | ✅ Yes | Complete |
| Database repository working | ✅ Yes | Complete |
| API endpoints functional | ✅ Yes | Complete |
| User persistence working | ✅ Yes | Complete |
| Frontend integration | ⏳ No | Pending |
| Production deployment | ⏳ No | Pending |
| Data migration tested | ⏳ No | Pending |

---

**Last Updated**: March 1, 2026  
**Status**: Backend architecture complete, frontend integration pending
