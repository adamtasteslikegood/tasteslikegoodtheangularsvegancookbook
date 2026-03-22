# Phase IV Documentation Index

**Phase:** IV — Frontend ↔ Backend Persistence Wiring  
**Status:** ✅ Code complete | 🔄 Cloud deployment pending  

---

## Documents

| Doc | Purpose | Audience |
|-----|---------|----------|
| [PHASE_4_AUDIT_REPORT.md](./PHASE_4_AUDIT_REPORT.md) | What existed before Phase IV, what each gap required, package/dependency audit | Developers |
| [PHASE_4_IMPLEMENTATION_SUMMARY.md](./PHASE_4_IMPLEMENTATION_SUMMARY.md) | All 10 files changed/created, architecture diagram, API surface, verification commands | Developers |
| [PHASE_4_DEV_CHECKLIST_SQLITE.md](./PHASE_4_DEV_CHECKLIST_SQLITE.md) | Step-by-step local dev verification with SQLite — includes code-review bug list, Gemini recommendations | Developer (local) |
| [PHASE_4_DEPLOYMENT_CHECKLIST.md](./PHASE_4_DEPLOYMENT_CHECKLIST.md) | Step-by-step deployment guide, smoke tests, open questions | DevOps / Developer deploying to Cloud Run |
| [PHASE_4_CLOUD_RUN_BRIEF.md](./PHASE_4_CLOUD_RUN_BRIEF.md) | Infrastructure state, Terraform diffs, configuration questions — forward to Cloud Run App Design Center | Cloud architect / App Design Center |

---

## Quick Reference

### What Phase IV added
- `GET/POST/DELETE /api/collections/*` — cookbook CRUD (Flask → Cloud SQL)
- `PersistenceService` — Angular hybrid persistence (API for logged-in users, localStorage for guests)
- Express proxy extended to cover `/api/recipes` and `/api/collections`
- `cookbook` database table (requires `flask db upgrade` before deploying)

### One-line deploy sequence
```bash
flask db upgrade          # 1. apply cookbook table migration
docker build + push       # 2. rebuild both images
terraform apply           # 3. apply Terraform config changes (env var rename + FRONTEND_URL)
gcloud run deploy         # 4. update Cloud Run services
```

### Critical config changes still needed
1. Rename `flask_backend_SERVICE_ENDPOINT` → `FLASK_BACKEND_URL` in Terraform
2. Add `FRONTEND_URL = express-frontend URL` to flask-backend env vars
3. Add `FLASK_SECRET_KEY` secret to Secret Manager
4. Set `min_instance_count = 1` on flask-backend (prevents OAuth cold-start failures)

See [PHASE_4_CLOUD_RUN_BRIEF.md](./PHASE_4_CLOUD_RUN_BRIEF.md) for full Terraform diff.
