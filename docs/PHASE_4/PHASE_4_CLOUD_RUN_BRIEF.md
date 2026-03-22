# Cloud Run App Design Center — Phase IV Integration Brief

**Project:** VeganGenius Chef (`comdottasteslikegood`)  
**Date:** 2026-03-03  
**Phase:** IV complete — Frontend ↔ Backend persistence wiring  
**Forward to:** Google Cloud App Design Center for production configuration review

---

## Current Infrastructure State (Post-Phase IV)

### Cloud Run Services

| Service | Image | Purpose | Status |
|---------|-------|---------|--------|
| `express-frontend` | `gcr.io/comdottasteslikegood/express-frontend-image` | Angular SPA + Express API gateway + Flask proxy | Updated in Phase IV |
| `flask-backend` | `gcr.io/comdottasteslikegood/flask-backend-image` | Auth (Google OAuth), Recipe CRUD, Cookbook CRUD | Updated in Phase IV |

### Cloud SQL

| Resource | Value |
|----------|-------|
| Instance name | `vegangenius-chef-db` |
| Engine | PostgreSQL 15 |
| Region | `us-west2` |
| Tier | `db-perf-optimized-N-8` (ENTERPRISE_PLUS) |
| Tables | `user`, `recipe`, `cookbook` (new in Phase IV) |
| IAM auth | Enabled (`cloudsql.iam_authentication = on`) |

### Secret Manager

| Secret | Purpose |
|--------|---------|
| `vite-gemini-api-key` | Gemini API key (Express service) |
| `vegangenius-chef-db-credentials` | PostgreSQL connection credentials (Flask service) |

---

## What Changed in Phase IV

### New API Routes (Flask, proxied through Express)

The Express service now proxies three route groups to Flask:

```
/api/auth/*         → Flask (was already proxied)
/api/recipes/*      → Flask (NEW in Phase IV)
/api/collections/*  → Flask (NEW in Phase IV)
```

Full endpoint list:

```
GET    /api/collections
POST   /api/collections
GET    /api/collections/:id
DELETE /api/collections/:id
POST   /api/collections/:id/recipes
DELETE /api/collections/:id/recipes/:recipe_id
```

### New Database Table

```sql
CREATE TABLE cookbook (
    id          VARCHAR(36)  PRIMARY KEY,
    user_id     INTEGER      REFERENCES "user"(id),
    name        VARCHAR(200) NOT NULL,
    description VARCHAR(500),
    cover_image VARCHAR(500),
    recipe_ids  JSON         NOT NULL DEFAULT '[]',
    created_at  TIMESTAMP    NOT NULL,
    updated_at  TIMESTAMP    NOT NULL
);
```

**Action required:** Run Alembic migration `d4f8c2e19a73` before deploying updated Flask image.

### New Angular Service

`PersistenceService` (providedIn: 'root') auto-loads user data from Flask on Google OAuth login
and routes all save/delete operations to both the API and localStorage.

---

## Configuration Changes Required in App Design Center

### 1. Environment Variable Rename (Critical)

The Terraform template currently injects the Flask service URL as:
```
flask_backend_SERVICE_ENDPOINT
```

The Express server reads:
```
FLASK_BACKEND_URL
```

**Update needed in `app-template-5-main.tf`** (express-frontend `env_vars` block):
```hcl
# Change:
"flask_backend_SERVICE_ENDPOINT" = module.flask-backend.service_uri

# To:
"FLASK_BACKEND_URL" = module.flask-backend.service_uri
```

### 2. Flask `FRONTEND_URL` Variable (Required for OAuth)

Flask's OAuth callback redirects to `FRONTEND_URL` after authentication. This must be set to
the `express-frontend` Cloud Run service URL (the URL users see in their browser).

**Add to flask-backend `env_vars`:**
```hcl
"FRONTEND_URL" = module.express-frontend.service_uri
```

### 3. Flask `SECRET_KEY` (Security Critical)

Flask server-side sessions require a stable `SECRET_KEY`. Without it, all sessions are
invalidated on every container restart (Cloud Run scales to zero frequently).

**Add to Secret Manager and reference in flask-backend:**
```hcl
# New secret:
module "flask-secret-key" {
  source      = "github.com/GoogleCloudPlatform/terraform-google-secret-manager//modules/simple-secret?ref=v0.9.0"
  project_id  = "comdottasteslikegood"
  name        = "flask-secret-key"
  secret_data = "<generate a 64-char random hex string>"
}

# In flask-backend containers env_secret_vars:
"FLASK_SECRET_KEY" = { "secret" = "flask-secret-key", "version" = "latest" }
```

### 4. Flask `SESSION_COOKIE_SECURE` (HTTPS Production Setting)

Cloud Run serves HTTPS by default. Flask must be configured for secure cookies:

```python
# Backend/config.py — production settings:
SESSION_COOKIE_SECURE = True      # HTTPS only
SESSION_COOKIE_HTTPONLY = True    # No JS access
SESSION_COOKIE_SAMESITE = 'Lax'  # Same-origin proxy pattern works with Lax
```

### 5. Cloud Run Minimum Instances

Current Terraform sets `min_instance_count = 0` for both services (scale to zero).

**Recommendation for flask-backend:**
```hcl
service_scaling = {
  min_instance_count = 1  # Avoid cold-start during OAuth callback
}
template_scaling = {
  min_instance_count = 1
}
```

Cold starts on the Flask service during OAuth callbacks cause the state token to mismatch
because the OAuth flow requires session continuity between `/api/auth/login` and `/api/auth/callback`.

---

## Service-to-Service Communication Pattern

```
Browser → express-frontend Cloud Run (HTTPS, public)
              │
              │  Internal VPC (private, no internet)
              ▼
         flask-backend Cloud Run
              │
              │  Cloud SQL Auth Proxy (Unix socket /cloudsql)
              ▼
         Cloud SQL PostgreSQL (vegangenius-chef-db)
```

The Terraform already configures:
- VPC egress `ALL_TRAFFIC` on both services
- `roles/cloudsql.client` IAM role on flask-backend service account
- Cloud SQL volume mount at `/cloudsql` in flask-backend container

---

## Questions for App Design Center

1. **Migration Job:** Can the App Design Center configure a Cloud Build step or Cloud Run Job
   that runs `flask db upgrade` automatically before each Flask deployment? The migration file
   is at `Backend/migrations/versions/d4f8c2e19a73_add_cookbook_model.py`.

2. **Service Account Roles:** The `express-frontend` service account currently has
   `roles/run.invoker`. Does it need additional permissions to make authenticated
   service-to-service calls to `flask-backend`? (Currently the proxy passes browser cookies
   through — it doesn't use Google IAM auth between services.)

3. **Load Balancer:** The Terraform diagram shows Cloud Load Balancing (`LB`) in front of
   `express-frontend`. Is this configured via the `ingress = "INGRESS_TRAFFIC_ALL"` setting,
   or is a separate Cloud Load Balancing resource needed? The current template removed the
   explicit LB components.

4. **Custom Domain:** Should `express-frontend` be mapped to a custom domain
   (e.g., `tasteslikegood.com`)? The OAuth `redirect_uri` must match this domain exactly.
   Flask's `url_for("auth_api.api_callback", _external=True)` will use the `Host` header
   forwarded by Express — confirm this resolves to the right URL in production.

5. **Pub/Sub:** The architecture diagram includes Cloud Pub/Sub. Is this intended for a
   future feature (e.g., async image generation, recipe sharing notifications)? It is not
   currently used by either service.

6. **Database Tier:** `db-perf-optimized-N-8` is provisioned for this application. For a
   personal cookbook app, `db-f1-micro` or `db-g1-small` may be more cost-appropriate.
   Is the current tier intentional, or should it be scaled down?

---

## Terraform Diff Summary (changes to apply)

```hcl
# 1. express-frontend env_vars
- "flask_backend_SERVICE_ENDPOINT" = module.flask-backend.service_uri
+ "FLASK_BACKEND_URL"               = module.flask-backend.service_uri

# 2. flask-backend env_vars (add)
+ "FRONTEND_URL" = module.express-frontend.service_uri

# 3. New secret for Flask session key
+ module "flask-secret-key" { ... }

# 4. flask-backend env_secret_vars (add)
+ "FLASK_SECRET_KEY" = { "secret" = "flask-secret-key", "version" = "latest" }

# 5. flask-backend scaling (change)
- min_instance_count = 0
+ min_instance_count = 1
```

---

## Files Reference

| Doc | Location |
|-----|----------|
| Architecture Decision Record (proxy vs CORS) | `docs/ADR-001-auth-and-persistence-routing.md` |
| Three-tier architecture recommendation | `docs/ARCHITECTURE_RECOMMENDATION.md` |
| Phase IV implementation summary | `docs/PHASE_4/PHASE_4_IMPLEMENTATION_SUMMARY.md` |
| Phase IV audit report | `docs/PHASE_4/PHASE_4_AUDIT_REPORT.md` |
| Cloud Run + Terraform diagram | `Google Cloud App Designs/cloud_run_flask_plus_express.md` |
| Terraform template | `Google Cloud App Designs/app-template-5-main.tf` |
| Google's guidance (Gemini response) | `Google Cloud App Designs/gemini_ref_aewser.md` |
