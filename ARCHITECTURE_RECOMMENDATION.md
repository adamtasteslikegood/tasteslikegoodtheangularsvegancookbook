# Architecture Recommendation: Three-Tier Application Design

**Date:** February 25, 2026  
**Status:** Recommendation / Planning

## Current State Analysis

### Your Current Architecture

You currently have **two parallel backends**:

1. **Express/TypeScript Backend** (`/server/`)
   - Serves Angular frontend as static files
   - `/api/recipe` - Recipe generation via Gemini 2.5 Flash
   - `/api/image` - Image generation via Imagen 4.0
   - Security middleware (Helmet, rate limiting, validation)
   - **Status:** Working well, you don't want to change it ✅

2. **Flask/Python Backend** (`/Backend/`)
   - Full-featured app with templates (HTML rendering)
   - Google OAuth authentication
   - Recipe generation with multiple Gemini models
   - Stock image integration (Unsplash)
   - AI image generation (Imagen 3)
   - Recipe file persistence (JSON files)
   - Session management
   - Modular architecture (blueprints, services, repositories)
   - **Status:** Mature, well-architected, but standalone

3. **Angular Frontend**
   - Graphically appealing UI
   - Recipe import/export functionality
   - Currently served by Express server
   - Compatible JSON format with Flask backend

## Recommendation: **USE THE FLASK BACKEND FOR NON-GENERATIVE FEATURES**

### Why This Makes Sense

#### ✅ Advantages of Using Flask Backend:

1. **Already Has Authentication Infrastructure**
   - Google OAuth 2.0 fully implemented
   - Session management in place
   - `login_required` decorator ready to use
   - User info tracking

2. **Already Has Database Patterns**
   - Repository pattern implemented (`recipe_repository.py`)
   - File locking for concurrent access
   - Easy to swap JSON files for real database (PostgreSQL, MongoDB)
   - Migration scripts already exist

3. **Modular Architecture Ready for Growth**
   - Clean separation: blueprints → services → repositories
   - Easy to add new features without touching Express
   - Already has error handling, logging, validation

4. **Complementary Technology Stacks**
   - **Express/TypeScript:** Fast, lightweight, great for AI generation
   - **Flask/Python:** Rich ecosystem for auth, databases, business logic
   - Python excels at data processing, ORM (SQLAlchemy), admin tasks

5. **Zero Interference with Working Code**
   - Express server continues serving frontend + AI endpoints
   - Flask handles authentication, user data, recipe persistence
   - They communicate via the Angular frontend as orchestrator

#### ⚠️ Why NOT to Build from Scratch:

- You'd be recreating OAuth flow (40+ lines already written)
- You'd be recreating session management
- You'd be recreating the repository pattern
- Wastes 2-3 days of development time

#### ⚠️ Why NOT to Add to Express Server:

- TypeScript auth libraries are more complex than Python's
- Database ORMs in Node.js (TypeORM, Prisma) add significant complexity
- Mixing concerns violates your own "don't change working code" rule
- Python has better tooling for data validation (Pydantic) and migrations

## Proposed Three-Tier Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   PRESENTATION TIER                      │
│                                                          │
│              Angular Frontend (Port 4200)                │
│         Served as static files by Express (8080)         │
│                                                          │
│  • Recipe browsing/creation UI                          │
│  • User profile display                                 │
│  • Import/Export features                               │
└─────────────────────────────────────────────────────────┘
                           │
          ┌────────────────┴────────────────┐
          │                                 │
          ▼                                 ▼
┌──────────────────────┐        ┌──────────────────────┐
│   APPLICATION TIER   │        │   APPLICATION TIER   │
│                      │        │                      │
│  Express Server      │        │  Flask Server        │
│  (Port 8080)         │        │  (Port 5000)         │
│                      │        │                      │
│  • /api/recipe       │        │  • /auth/*           │
│  • /api/image        │        │  • /api/users/*      │
│  • Rate limiting     │        │  • /api/favorites/*  │
│  • Gemini calls      │        │  • /api/collections/*│
│  • Static serving    │        │  • Session mgmt      │
│                      │        │  • OAuth flow        │
└──────────────────────┘        └──────────────────────┘
                                           │
                                           ▼
                              ┌──────────────────────┐
                              │     DATA TIER        │
                              │                      │
                              │  PostgreSQL/MongoDB  │
                              │  (Port 5432/27017)   │
                              │                      │
                              │  • Users             │
                              │  • Recipes (persist) │
                              │  • Collections       │
                              │  • Favorites         │
                              │  • User settings     │
                              └──────────────────────┘
```

## Implementation Plan

### Phase 1: Keep Both Backends Running

**No changes to Express server** - it continues to work exactly as is.

1. **Add CORS to Flask** (allow Angular to call it)
   ```python
   from flask_cors import CORS
   CORS(app, origins=["http://localhost:4200", "http://localhost:8080"])
   ```

2. **Update Flask blueprints for API-only responses**
   - Add `/api/auth/login` that returns JWT or session cookie
   - Add `/api/auth/me` to get current user
   - Add `/api/auth/logout`

3. **Keep JSON file storage initially**
   - No database needed immediately
   - Use existing `recipe_repository.py`

### Phase 2: Angular Frontend Orchestrates Both Backends

4. **Update Angular services**
   ```typescript
   // src/services/auth.service.ts (NEW)
   const FLASK_API = 'http://localhost:5000';
   
   // src/services/recipe.service.ts (EXISTING)
   const EXPRESS_API = 'http://localhost:8080';
   ```

5. **Angular calls appropriate backend:**
   - Express: `/api/recipe`, `/api/image` (AI generation)
   - Flask: `/auth/login`, `/api/users`, `/api/favorites`

### Phase 3: Add Database to Flask

6. **Add SQLAlchemy or MongoDB**
   ```python
   # Backend/models/user.py
   class User(db.Model):
       id = db.Column(db.Integer, primary_key=True)
       email = db.Column(db.String(120), unique=True)
       name = db.Column(db.String(100))
       google_id = db.Column(db.String(100))
   
   # Backend/models/recipe.py
   class Recipe(db.Model):
       id = db.Column(db.String(36), primary_key=True)
       user_id = db.Column(db.Integer, ForeignKey('user.id'))
       name = db.Column(db.String(200))
       data = db.Column(JSON)  # Store full recipe JSON
   ```

7. **Update repositories to use database**
   ```python
   # Backend/repositories/recipe_repository.py
   # Add database methods alongside file methods
   # Keep backward compatibility
   ```

### Phase 4: Add User Features

8. **User-specific features in Flask:**
   - Save recipes to user account
   - Recipe collections/folders
   - Favorite recipes
   - Share recipes with others
   - User settings/preferences

9. **Public vs. Private recipes**
   - Anonymous users (current behavior)
   - Logged-in users (persistent storage)

## API Design Example

### Flask API Endpoints (NEW)

```python
# Authentication
POST   /api/auth/login          # Initiates OAuth, returns redirect
GET    /api/auth/callback       # OAuth callback, sets session cookie
GET    /api/auth/me             # Get current user info
POST   /api/auth/logout         # Clear session

# User Recipes
GET    /api/recipes             # List user's saved recipes
POST   /api/recipes             # Save new recipe (from Express generation)
GET    /api/recipes/:id         # Get specific recipe
PUT    /api/recipes/:id         # Update recipe
DELETE /api/recipes/:id         # Delete recipe

# Collections
GET    /api/collections         # List user's collections
POST   /api/collections         # Create collection
POST   /api/collections/:id/recipes  # Add recipe to collection

# Favorites
POST   /api/favorites/:recipeId # Toggle favorite
GET    /api/favorites           # List favorites
```

### Express API Endpoints (UNCHANGED)

```typescript
// AI Generation (keep exactly as is)
GET    /api/health              # Health check
POST   /api/recipe              # Generate recipe (Gemini)
POST   /api/image               # Generate image (Imagen)
```

## Technology Additions Needed

### Flask Backend (`Backend/requirements.txt`)

```python
# Add these:
flask-cors==5.0.0           # CORS for Angular
flask-sqlalchemy==3.1.1     # Database ORM
psycopg2-binary==2.9.9      # PostgreSQL driver (or use pymongo)
flask-migrate==4.0.5        # Database migrations
pyjwt==2.8.0               # Optional: JWT tokens instead of sessions
```

### Angular Frontend (`package.json`)

```json
{
  "dependencies": {
    // Add these:
    "@angular/common/http": "^21.1.0"  // Likely already there
  }
}
```

## Deployment Architecture

### Development
- **Angular Dev Server:** `http://localhost:4200`
- **Express Server:** `http://localhost:8080`
- **Flask Server:** `http://localhost:5000`

### Production

Option A: **Separate Services (Recommended)**
```
Cloud Run Service 1: express-frontend (Angular + Express)
  - Serves static files
  - Handles /api/recipe, /api/image

Cloud Run Service 2: flask-backend
  - Handles /auth/*, /api/users/*, /api/recipes/*
  - Connected to Cloud SQL (PostgreSQL)

Cloud SQL: PostgreSQL instance
```

Option B: **Nginx Reverse Proxy**
```
Nginx (Port 80/443)
  ├─> /api/recipe, /api/image  → Express (8080)
  ├─> /auth/*, /api/*          → Flask (5000)
  └─> /*                       → Express static files
```

## Migration Path for Existing Flask Features

The Flask backend already has recipe generation. Here's how to handle it:

1. **Keep Flask recipe generation as backup/alternative**
   - Different models available (Gemini 2.0 Flash Exp vs Express's 2.5 Flash)
   - Can be exposed as `/api/recipe/flask` endpoint
   - Useful for testing model differences

2. **Use Flask's stock image feature**
   - Express doesn't have Unsplash integration
   - Add `/api/stock-images/:recipeName` endpoint
   - Angular can call this for additional images

3. **Use Flask's reporting feature**
   - Already has `/api/report_recipe` endpoint
   - Keeps user feedback in one place

## Timeline Estimate

- **Phase 1** (CORS + API endpoints): 2-4 hours
- **Phase 2** (Angular service updates): 4-6 hours  
- **Phase 3** (Database integration): 1-2 days
- **Phase 4** (User features): 3-5 days per feature

**Total:** ~2 weeks for full three-tier architecture with auth and database

## Security Considerations

1. **CORS**: Restrict origins to your domains
2. **CSRF**: Use Flask-WTF for form protection (or JWT tokens)
3. **Rate Limiting**: Add to Flask endpoints (like Express has)
4. **Session Cookies**: Use `secure=True, httponly=True, samesite='lax'`
5. **API Keys**: Keep Gemini keys in Express, don't expose via Flask

## Conclusion

**Recommendation: Use the Flask Backend for auth, database, and user management.**

This approach:
- ✅ Preserves your working Express AI generation code
- ✅ Leverages existing Flask auth and architecture
- ✅ Provides clean separation of concerns
- ✅ Allows independent scaling and deployment
- ✅ Uses each technology for its strengths
- ✅ Minimizes development time

The Flask backend is already **80% of the way there** for what you need. It would be inefficient to rebuild this in Express or start from scratch.

---

**Next Steps:**
1. Review this recommendation
2. I can implement Phase 1 (CORS + API endpoints) immediately
3. Then proceed to Phase 2 (Angular integration)
4. Database can come later once the architecture is proven

Would you like me to start implementing Phase 1?
