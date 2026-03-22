# Phase 3: Database Implementation

## Current Status: PARTIALLY IMPLEMENTED ⚠️

Phase 3 adds persistent database storage to replace the file-based recipe system. The foundation has been laid, but integration is incomplete.

---

## ✅ What's Been Completed

### 1. Database Models Created
- **Location**: `Backend/models/`
- **Files**:
  - `user.py` - User model with Google OAuth fields
  - `recipe.py` - Recipe model with JSON storage
  - `__init__.py` - Model exports

### 2. Database Configuration
- **SQLAlchemy** and **Flask-Migrate** installed (`requirements.txt`)
- **Database URI** configured in `config.py`:
  - Falls back to SQLite: `sqlite:///tasteslikegood.db`
  - Supports PostgreSQL via `DATABASE_URL` environment variable
  - Automatic Heroku/GCP URL format conversion (`postgres://` → `postgresql://`)

### 3. Extensions Setup
- **File**: `Backend/extensions.py`
- SQLAlchemy (`db`) and Flask-Migrate (`migrate`) initialized
- Imported and configured in `app.py`

### 4. Dependencies Installed
```txt
flask-sqlalchemy==3.1.1
psycopg2-binary==2.9.9
flask-migrate==4.0.5
```

---

## ❌ What's Still Missing

### 1. Database Migrations Not Initialized
**Problem**: No `migrations/` directory exists. Flask-Migrate is configured but migrations haven't been created.

**What's needed**:
```bash
cd Backend
flask db init
flask db migrate -m "Initial migration: User and Recipe models"
flask db upgrade
```

### 2. No Database CRUD Operations
**Problem**: Models exist, but no code uses them. All recipe operations still use file-based storage (`repositories/recipe_repository.py`).

**What's needed**:
- Create database repository methods (`repositories/db_recipe_repository.py`)
- Update blueprints to use database instead of files
- Add user creation/lookup in authentication flow

### 3. Authentication Doesn't Create Users
**Problem**: OAuth flow stores user info in session but doesn't persist to database.

**What's needed** in `blueprints/auth_api_bp.py`:
```python
# After getting user_info from Google
from models import User
from extensions import db

user = User.query.filter_by(email=user_info['email']).first()
if not user:
    user = User(
        email=user_info['email'],
        name=user_info.get('name'),
        google_id=user_info['id']
    )
    db.session.add(user)
    db.session.commit()

session['user_id'] = user.id  # Store database ID
```

### 4. Recipe Endpoints Still Use Files
**Problem**: All recipe operations in blueprints use `recipe_repository.py` (file-based).

**What's needed**:
- `/api/recipes` (GET) - List user's recipes from database
- `/api/recipes` (POST) - Save new recipe to database
- `/api/recipes/:id` (GET) - Get recipe from database
- `/api/recipes/:id` (PUT) - Update recipe in database
- `/api/recipes/:id` (DELETE) - Delete recipe from database

### 5. No Migration Strategy for Existing Data
**Problem**: Recipes stored as JSON files in `recipes/` directory need migration path.

**What's needed**:
- Script to import existing recipes into database
- Associate anonymous recipes with special "guest" user or null user_id
- Keep file-based storage as backup during transition

### 6. Frontend Doesn't Know About Database
**Problem**: Angular app (`src/`) stores recipes in localStorage, doesn't call backend recipe APIs.

**What's needed**:
- Create Angular service: `RecipeService` to call `/api/recipes` endpoints
- Update `app.component.ts` to persist recipes server-side
- Sync localStorage recipes on first login (merge guest data)

---

## 📋 Implementation Checklist

### Phase 3A: Initialize Database (Backend Only)

- [ ] **Step 1**: Add `DATABASE_URL` to `.env`
  ```bash
  # Backend/.env
  DATABASE_URL=postgresql://user:password@localhost:5432/tasteslikegood
  # OR for SQLite (local development):
  DATABASE_URL=sqlite:///tasteslikegood.db
  ```

- [ ] **Step 2**: Initialize Flask-Migrate
  ```bash
  cd Backend
  export FLASK_APP=app.py
  flask db init
  flask db migrate -m "Add User and Recipe models"
  flask db upgrade
  ```

- [ ] **Step 3**: Verify database created
  - **SQLite**: Check for `Backend/tasteslikegood.db` file
  - **PostgreSQL**: Connect and verify `user` and `recipe` tables exist

- [ ] **Step 4**: Add database health check
  ```python
  # Backend/blueprints/api_bp.py
  @api_bp.route('/health', methods=['GET'])
  def health_check():
      try:
          db.session.execute('SELECT 1')
          return jsonify({'status': 'healthy', 'database': 'connected'})
      except Exception as e:
          return jsonify({'status': 'unhealthy', 'database': str(e)}), 500
  ```

### Phase 3B: User Persistence

- [ ] **Step 5**: Update OAuth callback to create/update users
  - File: `Backend/blueprints/auth_api_bp.py`
  - Method: `api_callback()`
  - Add user lookup/creation after Google authentication
  - Store database `user.id` in session

- [ ] **Step 6**: Add user info endpoint
  ```python
  # Backend/blueprints/auth_api_bp.py
  @auth_api_bp.route('/me', methods=['GET'])
  def get_current_user():
      user_id = session.get('user_id')
      if not user_id:
          return jsonify({'authenticated': False}), 401
      
      user = User.query.get(user_id)
      return jsonify({
          'authenticated': True,
          'user': user.to_dict() if user else None
      })
  ```

### Phase 3C: Recipe Database Operations

- [ ] **Step 7**: Create database recipe repository
  - File: `Backend/repositories/db_recipe_repository.py`
  - Functions:
    - `get_user_recipes(user_id)` → List[Recipe]
    - `get_recipe_by_id(recipe_id, user_id)` → Recipe
    - `create_recipe(user_id, recipe_data)` → Recipe
    - `update_recipe(recipe_id, user_id, recipe_data)` → Recipe
    - `delete_recipe(recipe_id, user_id)` → bool

- [ ] **Step 8**: Add recipe API endpoints
  - File: `Backend/blueprints/recipes_api_bp.py` (new file)
  - Register blueprint in `app.py`
  - Implement RESTful recipe CRUD

- [ ] **Step 9**: Update recipe generation to save to database
  - File: `Backend/blueprints/generation_bp.py`
  - After generating recipe with Gemini, save to database if user authenticated
  - Keep file backup for anonymous users

### Phase 3D: Data Migration

- [ ] **Step 10**: Create migration script
  - File: `Backend/scripts/migrate_recipes_to_db.py`
  - Read all JSON files from `recipes/`
  - Import into database with `user_id = NULL` (anonymous)
  - Log migration results

- [ ] **Step 11**: Run migration
  ```bash
  cd Backend
  python scripts/migrate_recipes_to_db.py
  ```

### Phase 3E: Frontend Integration

- [ ] **Step 12**: Create Angular RecipeService
  - File: `src/services/recipe.service.ts`
  - Methods to call all recipe API endpoints
  - Handle authentication state

- [ ] **Step 13**: Update AppComponent to use RecipeService
  - File: `src/app.component.ts`
  - Replace localStorage recipe storage
  - Keep localStorage as fallback for anonymous users
  - Sync on login (merge localStorage → server)

- [ ] **Step 14**: Add loading states and error handling
  - Show spinners during API calls
  - Handle network errors gracefully
  - Offline fallback to localStorage

### Phase 3F: Testing & Cleanup

- [ ] **Step 15**: Test complete flow
  - [ ] Generate recipe as guest → saved to localStorage
  - [ ] Log in → guest recipes synced to database
  - [ ] Generate new recipe → saved to database immediately
  - [ ] Edit/delete recipes → persisted
  - [ ] Log out and back in → recipes restored from database

- [ ] **Step 16**: Update documentation
  - [ ] Add database setup to README
  - [ ] Document environment variables
  - [ ] Update API.md with new endpoints

- [ ] **Step 17**: Optional: Keep file-based system as backup
  - Add config flag: `USE_DATABASE=true/false`
  - Allow gradual migration or rollback if needed

---

## 🗄️ Database Schema

### User Table
```sql
CREATE TABLE user (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- or SERIAL in PostgreSQL
    email VARCHAR(120) UNIQUE NOT NULL,
    name VARCHAR(100),
    google_id VARCHAR(100) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Recipe Table
```sql
CREATE TABLE recipe (
    id VARCHAR(36) PRIMARY KEY,           -- UUID
    user_id INTEGER REFERENCES user(id),  -- NULL for anonymous recipes
    name VARCHAR(200) NOT NULL,
    data JSON NOT NULL,                   -- Full recipe JSON
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🔗 API Endpoints to Implement

### Authentication (Already Exists)
```
GET  /api/auth/login     → Initiate OAuth
GET  /api/auth/callback  → OAuth callback
GET  /api/auth/me        → Get current user (needs database lookup)
POST /api/auth/logout    → Clear session
```

### Recipes (NEW - Phase 3C)
```
GET    /api/recipes              → List user's recipes
POST   /api/recipes              → Create new recipe
GET    /api/recipes/:id          → Get specific recipe
PUT    /api/recipes/:id          → Update recipe
DELETE /api/recipes/:id          → Delete recipe
POST   /api/recipes/:id/favorite → Toggle favorite (Phase 4)
```

---

## 🚀 Quick Start (Resume Implementation)

```bash
# 1. Set up database
cd Backend
cp .env.example .env
# Edit .env and add DATABASE_URL

# 2. Install dependencies (already done, but verify)
pip install -r requirements.txt

# 3. Initialize database
export FLASK_APP=app.py
flask db init
flask db migrate -m "Initial schema"
flask db upgrade

# 4. Start backend
python app.py

# 5. Test database connection
curl http://localhost:5000/api/health

# 6. Implement remaining steps from checklist above
```

---

## 📚 Files to Create/Modify

### Files to CREATE:
- `Backend/migrations/` (directory - via `flask db init`)
- `Backend/repositories/db_recipe_repository.py`
- `Backend/blueprints/recipes_api_bp.py`
- `Backend/scripts/migrate_recipes_to_db.py`
- `src/services/recipe.service.ts`
- `docs/PHASE_3/` (directory for completion docs)

### Files to MODIFY:
- `Backend/blueprints/auth_api_bp.py` (add user persistence)
- `Backend/blueprints/api_bp.py` (add health check)
- `Backend/blueprints/generation_bp.py` (save to database)
- `Backend/app.py` (register new blueprints)
- `src/app.component.ts` (use RecipeService)
- `Backend/.env.example` (document DATABASE_URL)
- `README.md` (add database setup instructions)

---

## 🎯 Success Criteria

Phase 3 is complete when:
1. ✅ Database migrations run successfully
2. ✅ Users are created/retrieved during OAuth
3. ✅ Recipes can be saved to and retrieved from database
4. ✅ Angular frontend persists recipes server-side for authenticated users
5. ✅ Guest users continue to work with localStorage
6. ✅ Login syncs guest recipes to user account
7. ✅ Old file-based recipes are migrated to database

---

## 🔧 Troubleshooting

### "No module named 'flask_sqlalchemy'"
```bash
cd Backend
pip install flask-sqlalchemy flask-migrate psycopg2-binary
```

### "flask: command not found"
```bash
export FLASK_APP=app.py
# OR
python -m flask db init
```

### "Can't locate revision identified by 'xxxxx'"
```bash
# Reset migrations
rm -rf migrations/
flask db init
flask db migrate -m "Initial schema"
flask db upgrade
```

### Database connection errors
- **SQLite**: Make sure `Backend/` is writable
- **PostgreSQL**: Verify connection string and database exists
- Check `DATABASE_URL` format matches SQLAlchemy requirements

---

## 📖 Related Documentation

- [ARCHITECTURE_RECOMMENDATION.md](ARCHITECTURE_RECOMMENDATION.md) - Original Phase 3 plan
- [PHASE_2/PHASE_2_COMPLETE.md](PHASE_2/PHASE_2_COMPLETE.md) - What came before
- [Backend/API.md](../Backend/API.md) - API documentation (needs updating)
- [Flask-SQLAlchemy Docs](https://flask-sqlalchemy.palletsprojects.com/)
- [Flask-Migrate Docs](https://flask-migrate.readthedocs.io/)

---

## 👤 Author Notes

**Last Updated**: March 1, 2026  
**Status**: Foundation laid, integration needed  
**Next Steps**: Follow checklist starting with Step 1 (Initialize Database)

---
