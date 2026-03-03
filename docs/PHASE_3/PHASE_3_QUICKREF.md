# Phase 3 Quick Reference

One-page reference for Phase 3 database implementation.

---

## 🚀 Quick Start

```bash
# 1. Setup database
cd Backend
./init_database.sh

# 2. Migrate existing recipes (optional)
python scripts/migrate_recipes_to_db.py --dry-run
python scripts/migrate_recipes_to_db.py

# 3. Start backend
python app.py

# 4. Test API
curl http://localhost:5000/api/recipes
```

---

## 📁 Key Files

| File | Purpose |
|------|---------|
| `Backend/models/user.py` | User database model |
| `Backend/models/recipe.py` | Recipe database model |
| `Backend/repositories/db_recipe_repository.py` | Database CRUD operations |
| `Backend/blueprints/recipes_api_bp.py` | Recipe API endpoints |
| `Backend/blueprints/auth_api_bp.py` | User auth + persistence |
| `Backend/scripts/migrate_recipes_to_db.py` | File → DB migration |
| `Backend/init_database.sh` | One-command setup |

---

## 🔧 Commands

### Database Setup
```bash
cd Backend
export FLASK_APP=app.py

# Initialize migrations
flask db init

# Create migration
flask db migrate -m "Message"

# Apply migration
flask db upgrade

# Rollback
flask db downgrade
```

### Environment
```bash
# .env file
DATABASE_URL=sqlite:///tasteslikegood.db          # Development
DATABASE_URL=postgresql://user:pass@host:5432/db  # Production
```

---

## 🌐 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| **GET** | `/api/recipes` | List user's recipes |
| **POST** | `/api/recipes` | Create recipe |
| **GET** | `/api/recipes/:id` | Get recipe |
| **PUT** | `/api/recipes/:id` | Update recipe |
| **DELETE** | `/api/recipes/:id` | Delete recipe |
| **GET** | `/api/recipes/stats` | Recipe stats |
| **GET** | `/api/auth/check` | Auth status |
| **GET** | `/api/auth/me` | Current user |
| **POST** | `/api/auth/logout` | Logout |
| **GET** | `/api/status` | Health + DB status |

---

## 📊 Database Schema

```sql
-- Users
CREATE TABLE user (
    id INTEGER PRIMARY KEY,
    email VARCHAR(120) UNIQUE NOT NULL,
    name VARCHAR(100),
    google_id VARCHAR(100) UNIQUE,
    created_at TIMESTAMP
);

-- Recipes
CREATE TABLE recipe (
    id VARCHAR(36) PRIMARY KEY,
    user_id INTEGER REFERENCES user(id),  -- nullable
    name VARCHAR(200) NOT NULL,
    data JSON NOT NULL,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

---

## 🧪 Testing

### Test API
```bash
# List recipes
curl http://localhost:5000/api/recipes

# Create recipe
curl -X POST http://localhost:5000/api/recipes \
  -H "Content-Type: application/json" \
  -d '{"name": "Test", "ingredients": []}'

# Check status
curl http://localhost:5000/api/status
```

### Verify Database
```bash
# SQLite
sqlite3 Backend/tasteslikegood.db "SELECT * FROM user;"
sqlite3 Backend/tasteslikegood.db "SELECT id, name FROM recipe;"

# PostgreSQL
psql -d tasteslikegood -c "SELECT * FROM \"user\";"
```

---

## 🔥 Common Issues

| Problem | Solution |
|---------|----------|
| "flask: command not found" | `python -m flask db init` |
| "No such table" | Run `flask db upgrade` |
| "Can't locate revision" | Delete `migrations/` and re-init |
| DB connection refused | Check DATABASE_URL, start PostgreSQL |
| Permission denied | `chmod 664 tasteslikegood.db` |

---

## 📖 Documentation

- **Full Guide**: `docs/PHASE_3_DATABASE_IMPLEMENTATION.md`
- **Setup**: `Backend/DATABASE_SETUP.md`
- **API Docs**: `docs/RECIPE_API.md`
- **Progress**: `docs/PHASE_3_PROGRESS.md`
- **Summary**: `docs/PHASE_3_SUMMARY.md`

---

## ✅ Completion Checklist

### Backend
- [x] Models created (User, Recipe)
- [x] Repository with CRUD operations
- [x] API endpoints implemented
- [x] Auth persists users to DB
- [x] Migration script created
- [ ] Database initialized
- [ ] API endpoints tested
- [ ] Existing recipes migrated

### Frontend
- [ ] RecipeService created
- [ ] AppComponent updated
- [ ] Loading states added
- [ ] Error handling implemented
- [ ] Guest → login sync working

### Deployment
- [ ] PostgreSQL configured
- [ ] Migrations run on deploy
- [ ] Cloud Run tested

---

## 🎯 Next Steps

1. ✅ **Foundation Complete** - Models, repos, APIs created
2. ⏳ **Initialize Database** - Run `./init_database.sh`
3. ⏳ **Test Backend** - Verify all endpoints work
4. ⏳ **Frontend Integration** - Create RecipeService
5. ⏳ **End-to-End Testing** - Full flow works
6. ⏳ **Deploy** - Production with PostgreSQL

---

**Status**: 48% Complete (Backend foundation done)  
**Last Updated**: March 1, 2026
