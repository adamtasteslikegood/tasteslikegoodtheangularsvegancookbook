# Phase IV — Next Steps & Cloud Run Deployment Checklist

**Date:** 2026-03-03  
**Status:** Phase IV code complete locally. Cloud deployment pending.

---

## Immediate Next Steps (Before Deploying)

### Step 1 — Run the Database Migration

The `cookbook` table does not exist in Cloud SQL yet. This **must** be run before deploying
the new Flask container, or the app will crash on any collections request.

```bash
# Option A: Run locally against Cloud SQL (via Cloud SQL Auth Proxy)
cd Backend
./cloud-sql-proxy --instances=comdottasteslikegood:us-west2:vegangenius-chef-db=tcp:5432 &
FLASK_APP=app.py .venv/bin/flask db upgrade

# Option B: Run as a Cloud Run Job (recommended for production CI/CD)
# Add a step to cloudbuild.yaml before the Cloud Run deploy step:
# - name: 'gcr.io/comdottasteslikegood/flask-backend-image'
#   args: ['flask', 'db', 'upgrade']
#   env:
#     - 'FLASK_APP=app.py'
#     - 'DATABASE_URL=$$DATABASE_URL'
#   secretEnv: ['DATABASE_URL']
```

**Migration file:** `Backend/migrations/versions/d4f8c2e19a73_add_cookbook_model.py`  
**Creates:** `cookbook` table with columns: `id`, `user_id`, `name`, `description`, `cover_image`, `recipe_ids` (JSON), `created_at`, `updated_at`

---

### Step 2 — Update Terraform env var name

The Terraform template currently injects the Flask URL as `flask_backend_SERVICE_ENDPOINT`.
Express reads `FLASK_BACKEND_URL`. Align them:

```hcl
# Google Cloud App Designs/app-template-5-main.tf
# In the express-frontend containers block, change:
"flask_backend_SERVICE_ENDPOINT" = module.flask-backend.service_uri
# TO:
"FLASK_BACKEND_URL" = module.flask-backend.service_uri
```

This is the env var `server/index.ts` and `server/proxy.ts` read:
```typescript
const FLASK_BACKEND_URL = process.env.FLASK_BACKEND_URL || "http://localhost:5000";
```

---

### Step 3 — Build and push Docker images

```bash
# Express frontend image
docker build -t gcr.io/comdottasteslikegood/express-frontend-image .
docker push gcr.io/comdottasteslikegood/express-frontend-image

# Flask backend image
docker build -t gcr.io/comdottasteslikegood/flask-backend-image ./Backend
docker push gcr.io/comdottasteslikegood/flask-backend-image
```

Or trigger via Cloud Build:
```bash
gcloud builds submit --config cloudbuild.yaml
```

---

### Step 4 — Deploy Cloud Run services

```bash
# Deploy flask-backend first (migration must have run)
gcloud run deploy flask-backend \
  --image gcr.io/comdottasteslikegood/flask-backend-image \
  --region us-west2 \
  --project comdottasteslikegood

# Then deploy express-frontend
gcloud run deploy express-frontend \
  --image gcr.io/comdottasteslikegood/express-frontend-image \
  --region us-west2 \
  --project comdottasteslikegood \
  --set-env-vars FLASK_BACKEND_URL=<flask-backend-service-url>
```

---

### Step 5 — Update Angular component calls (optional, progressive)

Currently, `app.component.ts` still calls `AuthService.saveRecipe()`, `AuthService.createCookbook()`,
etc. directly. These will continue to work (localStorage only). To get full persistence for
logged-in users, update the component to inject and call `PersistenceService` instead:

```typescript
// app.component.ts — add to constructor
constructor(
  public authService: AuthService,
  public persistenceService: PersistenceService,  // add this
) {}

// Change calls from:
this.authService.saveRecipe(recipe);
// To:
await this.persistenceService.saveRecipe(recipe);
```

This is a progressive enhancement — do it per feature when convenient.

---

## Deployment Checklist

### Pre-Deploy
- [ ] Cloud SQL Auth Proxy downloaded and configured locally
- [ ] `flask db upgrade` run successfully against Cloud SQL instance `vegangenius-chef-db`
- [ ] `cookbook` table visible in Cloud SQL console
- [ ] Terraform `app-template-5-main.tf` updated: `flask_backend_SERVICE_ENDPOINT` → `FLASK_BACKEND_URL`
- [ ] `terraform plan` reviewed — no destructive changes
- [ ] `terraform apply` run successfully
- [ ] Docker images built and pushed for both services

### Deploy
- [ ] `flask-backend` Cloud Run service updated with new image
- [ ] `express-frontend` Cloud Run service updated with new image and correct `FLASK_BACKEND_URL`
- [ ] Both services show `READY` status in Cloud Run console

### Post-Deploy Smoke Tests
- [ ] `GET https://<express-url>/api/health` → `200 OK`
- [ ] `GET https://<express-url>/api/auth/check` → `{"authenticated": false}` (unauthenticated)
- [ ] Sign in with Google → `{"authenticated": true}` on callback
- [ ] `GET https://<express-url>/api/recipes` → `{"recipes": [], "count": 0}` (fresh user)
- [ ] `GET https://<express-url>/api/collections` → `{"collections": []}`
- [ ] Save a recipe via the Angular UI → appears in `GET /api/recipes`
- [ ] Refresh the browser → recipe is still there (loaded from Cloud SQL, not localStorage)
- [ ] Create a cookbook → appears in `GET /api/collections`
- [ ] Log out, log back in → recipes and cookbooks still present

### Guest User Regression Tests
- [ ] Load app without signing in → guest session created
- [ ] Save a recipe as guest → appears in UI, stored in `localStorage`
- [ ] No network calls to `/api/recipes` or `/api/collections` for guest user
- [ ] Sign in as Google user → guest recipes merged into authenticated session

---

## Questions to Resolve Before Production

1. **Migration strategy in CI/CD:** Should `flask db upgrade` be a Cloud Build step, a Cloud Run Job, or run manually? (Recommended: Cloud Run Job with `--wait` flag so deploy fails fast if migration fails)

2. **Flask session secret key:** Is `SECRET_KEY` in Secret Manager? Flask sessions are insecure without a stable, secret key. Check `Backend/config.py`.

3. **FRONTEND_URL env var in Flask:** The OAuth callback redirects to `os.environ.get("FRONTEND_URL", "http://localhost:3000")`. In production this needs to be the `express-frontend` Cloud Run URL. Confirm it's set.

4. **Cloud Run minimum instances:** Both services are set to `min_instance_count = 0` (scale to zero). This causes cold-start latency on first request. Consider setting to `1` for the Flask backend since OAuth session state is involved.

5. **Session cookie domain:** Flask session cookies use `SameSite=Lax` which works for same-origin (through Express proxy). Confirm Flask's `SESSION_COOKIE_SAMESITE` is set to `'Lax'` in `Backend/config.py`.

6. **Guest recipe upload:** Currently, localStorage-only guest recipes are merged client-side on login but not uploaded to the Flask API. Should the `PersistenceService` upload them in batch after `loadFromApi()` completes?

7. **Cookbook cover image:** The `cover_image` column exists in the DB model but the Angular `Cookbook` interface uses `coverImage?`. The `PersistenceService` currently only sets cover images when creating a cookbook. Should updates to `coverImage` (e.g., when first recipe with image is added) also sync to the API?
