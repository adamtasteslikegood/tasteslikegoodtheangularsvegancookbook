# Terraform Deployment Audit & Fixes

> Audit of the App Design Center Terraform export (`app-template-5_terraform_code_2026-03-04T21_09_21Z/`) against the actual application code, `cloudbuild.yaml`, and Phase IV implementation.

---

## Summary of All Changes

### Round 1 — Fill in Blanks (previous step)
| # | File | Change |
|---|------|--------|
| 1 | `main.tf` | `flask_backend_SERVICE_ENDPOINT` → `FLASK_BACKEND_URL` (matches `server/proxy.ts`) |
| 2 | `main.tf` | Flask secret name/value: `FLASK_SECRET_KEY_NAME` → `flask-secret-key` with real 64-char hex key |
| 3 | `main.tf` | SSL domain: `api.tasteslikegood.org` → `veganchef.tasteslikegood.org` |
| 4 | `main.tf` | VPC connector placeholder → `network_interfaces` (matches other services) |
| 5 | `input.tfvars` | Populated `apphub_project_id`, `apphub_location`, `apphub_application_id` |

### Round 2 — Fix Deployment Blockers (this step)
| # | File | Issue | Fix |
|---|------|-------|-----|
| 6 | `main.tf` | **Region mismatch** — Cloud Run was `us-west2`, DB is `us-central1`, cloudbuild is `us-central1` | All 3 Cloud Run services → `us-central1` |
| 7 | `main.tf` | **Container image paths** — Terraform used `express-frontend-image` / `flask-backend-image`, cloudbuild uses `vegangenius/express-frontend:$SHA` | Aligned to `gcr.io/comdottasteslikegood/vegangenius/{service}:latest` |
| 8 | `Backend/app.py` | **Flask port hardcoded to 5000** — Cloud Run sets `PORT=8080` | Changed to `int(os.environ.get("PORT", 5000))` |
| 9 | `main.tf` | **Missing Cloud SQL volumes** — containers had `volume_mounts` but no `volumes` definition | Added `volumes` block to both `flask-backend` and `db-migration-job` |
| 10 | `main.tf` | **Flask backend publicly accessible** — no ingress restriction | Added `ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"` |
| 11 | `main.tf` | **Duplicate IAM role** — `roles/secretmanager.secretAccessor` listed twice on flask-backend | Removed duplicate |
| 12 | `.gitignore` | **Terraform files not ignored** — state, tfvars, .terraform/ could be committed | Added terraform-specific gitignore entries |

---

## Architecture Diagram (After Fixes)

```
                    ┌─────────────────────────────────────┐
                    │   veganchef.tasteslikegood.org       │
                    │   (Google-managed SSL certificate)   │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │   Cloud Load Balancer               │
                    │   + CDN (CACHE_ALL_STATIC)          │
                    │   express-frontend-lb               │
                    └──────────────┬──────────────────────┘
                                   │ (internal LB ingress)
                    ┌──────────────▼──────────────────────┐
                    │   Cloud Run: express-frontend       │
                    │   Region: us-central1               │
                    │   Port: 8080                        │
                    │   Image: vegangenius/express-frontend│
                    │                                     │
                    │   Env: FLASK_BACKEND_URL             │
                    │   Secret: VITE_GEMINI_API_KEY        │
                    │   Ingress: INTERNAL_LOAD_BALANCER    │
                    └──────┬───────────────┬──────────────┘
                           │               │
              /api/recipe  │    /api/auth   │  /api/recipes
              /api/image   │    /api/collections
              (Gemini AI)  │               │
                           │  ┌────────────▼──────────────┐
                           │  │  Cloud Run: flask-backend  │
                           │  │  Region: us-central1       │
                           │  │  Port: 8080 (reads PORT)   │
                           │  │  min_instances: 1          │
                           │  │  Ingress: INTERNAL_ONLY    │
                           │  │                            │
                           │  │  Secrets: DATABASE_URL,    │
                           │  │    FLASK_SECRET_KEY        │
                           │  │  Env: FRONTEND_URL,        │
                           │  │    Cloud SQL connection     │
                           │  └────────────┬───────────────┘
                           │               │ (Cloud SQL proxy socket)
                           │  ┌────────────▼───────────────┐
                           │  │  Cloud SQL: PostgreSQL 15   │
                           │  │  Region: us-central1        │
                           │  │  Tier: db-c4a-highmem-2     │
                           │  │  IAM auth enabled           │
                           │  └────────────────────────────┘
                           │
                    ┌──────▼──────────────────────────────┐
                    │  Secret Manager                      │
                    │  - vite-gemini-api-key               │
                    │  - flask-secret-key                  │
                    │  - vegangenius-chef-db-credentials   │
                    │  - db-migration-secret               │
                    └─────────────────────────────────────┘
```

---

## What You Need to Do Before `terraform apply`

### Step 1: Build and push initial container images
Terraform needs images to exist when creating Cloud Run services:
```bash
# From repo root
docker build -t gcr.io/comdottasteslikegood/vegangenius/express-frontend:latest .
docker build -t gcr.io/comdottasteslikegood/vegangenius/flask-backend:latest Backend/
docker build -t gcr.io/comdottasteslikegood/vegangenius/migration-task:latest -f Backend/Dockerfile.migrate Backend/

# Push (requires `gcloud auth configure-docker`)
docker push gcr.io/comdottasteslikegood/vegangenius/express-frontend:latest
docker push gcr.io/comdottasteslikegood/vegangenius/flask-backend:latest
docker push gcr.io/comdottasteslikegood/vegangenius/migration-task:latest
```

### Step 2: DNS setup
Point `veganchef.tasteslikegood.org` to the Load Balancer's external IP:
```bash
# After terraform apply, get the IP:
terraform output express-frontend-lb-frontend_external_ip
# Then create an A record in your DNS provider
```

### Step 3: Google OAuth redirect URI
Update your Google Cloud Console OAuth client to allow:
- `https://veganchef.tasteslikegood.org/api/auth/callback`

### Step 4: Run Terraform
```bash
cd "Google Cloud App Designs/app-template-5_terraform_code_2026-03-04T21_09_21Z"
terraform init
terraform plan -var-file=input.tfvars
terraform apply -var-file=input.tfvars
```

---

## Remaining Considerations (Non-Blocking)

| Item | Note |
|------|------|
| **DB tier cost** | `db-c4a-highmem-2` ENTERPRISE_PLUS is expensive (~$500+/mo). Consider `db-g1-small` for dev/staging. |
| **Gemini API key in plaintext** | Line 9 of `main.tf` has the key in cleartext. It goes into Secret Manager at apply time, but the `.tf` file itself contains it. The `.gitignore` now excludes `*.tfvars` but `main.tf` is still tracked. Consider moving it to a `.tfvars` file. |
| **Google OAuth credentials** | Not in Terraform yet — `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` need to be added as env vars or secrets on flask-backend. |
| **Gunicorn** | `Backend/Dockerfile` runs `python app.py` (Flask dev server). For production, add `gunicorn` to `requirements.txt` and use `CMD ["gunicorn", "-b", "0.0.0.0:8080", "app:app"]`. |
| **Cloud Run Jobs vs Services** | `db-migration-job` uses the Cloud Run *service* module (`v2`), but it's conceptually a job. Works for now (Cloud Build triggers it), but consider the `google_cloud_run_v2_job` resource for a cleaner model. |
