#!/usr/bin/env bash
# deploy-staging.sh — Deploy staging Cloud Run services for express-frontend
# and flask-backend into the dedicated staging project.
#
# Staging lives in its own GCP project (comdottasteslikegood-staging, in the
# org's Staging folder) — not in the prod project. Images are NOT rebuilt:
# staging reuses the production images from the prod project's Artifact
# Registry, which needs a one-time cross-project read grant (step 0 handles
# it, idempotently).
#
# Staging services:
#   express-frontend-staging  (public, serves SPA + proxies to flask-backend-staging)
#   flask-backend-staging     (private: invoker IAM check ON, same posture as
#                              prod flask-backend — Express authenticates with
#                              a Google-signed ID token, see server/flask-auth.ts)
#
# Storage: CloudSQL Postgres (db-f1-micro in the staging project), reached
# via Cloud SQL Auth Proxy (--set-cloudsql-instances). The connection string
# lives in Secret Manager as DATABASE_URL_STAGING in the staging project —
# never in this script or the repo. Seed it with scripts/staging/seed-data.py
# --from-json (see scripts/staging/README.md). Decision recorded in KAN-248
# (2026-08-24, supersedes Railway decision from KAN-182 / discussion #3394).
#
# Dry run is the DEFAULT. Nothing mutates without --apply.
#
# Usage:
#   ./scripts/staging/deploy-staging.sh [--apply] [--version v0.4.10]
#
# Environment overrides:
#   PROJECT_ID    — staging GCP project (default: gen-lang-client-0491022701,
#                   display name "comdottasteslikegood-staging")
#   IMAGE_PROJECT — project whose Artifact Registry holds the images
#                   (default: comdottasteslikegood — the prod registry)
#   REGION        — Cloud Run region (default: us-central1)
#   IMAGE_TAG     — Image tag to deploy (default: latest release tag)

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-gen-lang-client-0491022701}"
IMAGE_PROJECT="${IMAGE_PROJECT:-comdottasteslikegood}"
REGION="${REGION:-us-central1}"
IMAGE_REGISTRY="${IMAGE_REGISTRY:-${REGION}-docker.pkg.dev/${IMAGE_PROJECT}/vegangenius}"

FLASK_SERVICE="flask-backend-staging"
EXPRESS_SERVICE="express-frontend-staging"

DRY_RUN=true
IMAGE_TAG="${IMAGE_TAG:-}"

# ── Parse args ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)   DRY_RUN=false; shift ;;
    --version) IMAGE_TAG="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--apply] [--version vX.Y.Z]"
      echo ""
      echo "Deploy staging Cloud Run services reusing production images."
      echo "Dry run by default; pass --apply to mutate."
      exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# ── Resolve image tag ─────────────────────────────────────────────────
if [[ -z "$IMAGE_TAG" ]]; then
  # Read version from package.json (the source of truth for the latest release)
  REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  IMAGE_TAG="v$(node -p "require('${REPO_ROOT}/package.json').version")"
fi

FLASK_IMAGE="${IMAGE_REGISTRY}/flask-backend:${IMAGE_TAG}"
EXPRESS_IMAGE="${IMAGE_REGISTRY}/express-frontend:${IMAGE_TAG}"

echo "=== Staging Deployment ==="
echo "Project:        ${PROJECT_ID}"
echo "Image project:  ${IMAGE_PROJECT}"
echo "Region:         ${REGION}"
echo "Image tag:      ${IMAGE_TAG}"
echo "Flask image:    ${FLASK_IMAGE}"
echo "Express image:  ${EXPRESS_IMAGE}"
echo "Dry run:        ${DRY_RUN}"
echo ""

run_cmd() {
  if $DRY_RUN; then
    echo "[DRY RUN] $*"
  else
    echo "[RUNNING] $*"
    "$@"
  fi
}

# ── Step 0: Preflight (staging-project wiring, all idempotent) ────────
echo "--- Step 0: Preflight ---"

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
# The Cloud Run service agent pulls images; the default compute SA runs the
# services (reads secrets, invokes Flask).
RUN_SERVICE_AGENT="service-${PROJECT_NUMBER}@serverless-robot-prod.iam.gserviceaccount.com"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Secret Manager API must be enabled in the staging project — Cloud Run
# resolves --set-secrets against its own project.
if ! gcloud services list --project="${PROJECT_ID}" --enabled \
    --filter="config.name=secretmanager.googleapis.com" \
    --format="value(config.name)" 2>/dev/null | grep -q .; then
  run_cmd gcloud services enable secretmanager.googleapis.com --project="${PROJECT_ID}"
fi

# The staging session-signing secret must exist in the staging project.
if ! gcloud secrets describe FLASK_SECRET_KEY_STAGING --project="${PROJECT_ID}" >/dev/null 2>&1; then
  CREATE_SECRET_CMD="echo -n \"\$(openssl rand -base64 32)\" | gcloud secrets create FLASK_SECRET_KEY_STAGING --data-file=- --project=${PROJECT_ID}"
  if $DRY_RUN; then
    echo "[DRY RUN] Secret FLASK_SECRET_KEY_STAGING missing in ${PROJECT_ID}; create it first:"
    echo "          ${CREATE_SECRET_CMD}"
  else
    echo "ERROR: secret FLASK_SECRET_KEY_STAGING does not exist in ${PROJECT_ID}." >&2
    echo "Create it, then re-run:" >&2
    echo "  ${CREATE_SECRET_CMD}" >&2
    exit 1
  fi
fi

# Let the services' runtime SA read the secret.
run_cmd gcloud secrets add-iam-policy-binding FLASK_SECRET_KEY_STAGING \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role=roles/secretmanager.secretAccessor

# The staging database URL (CloudSQL Postgres) must exist in the staging
# project. Unlike FLASK_SECRET_KEY_STAGING it cannot be generated here —
# the value is a Unix-socket connection string for the Cloud SQL Auth Proxy:
#   postgresql://USER:PASS@/vegangenius?host=/cloudsql/PROJECT:REGION:INSTANCE
if ! gcloud secrets describe DATABASE_URL_STAGING --project="${PROJECT_ID}" >/dev/null 2>&1; then
  CREATE_DB_SECRET_CMD="printf '%s' 'postgresql://USER:PASS@/vegangenius?host=/cloudsql/${PROJECT_ID}:${REGION}:vegangenius-staging-db' | gcloud secrets create DATABASE_URL_STAGING --data-file=- --project=${PROJECT_ID}"
  if $DRY_RUN; then
    echo "[DRY RUN] Secret DATABASE_URL_STAGING missing in ${PROJECT_ID}; create it first:"
    echo "          ${CREATE_DB_SECRET_CMD}"
  else
    echo "ERROR: secret DATABASE_URL_STAGING does not exist in ${PROJECT_ID}." >&2
    echo "Create it with the CloudSQL connection string, then re-run:" >&2
    echo "  ${CREATE_DB_SECRET_CMD}" >&2
    exit 1
  fi
fi

run_cmd gcloud secrets add-iam-policy-binding DATABASE_URL_STAGING \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role=roles/secretmanager.secretAccessor

# Google OAuth login on staging is OPTIONAL and keys off secret presence:
# when both staging OAuth secrets exist they are wired into Flask and the
# Sign In button works; when absent, staging deploys without them and
# /api/auth/login returns 500 "OAuth credentials not configured" (the SPA
# stays guest-only). To enable, create an OAuth 2.0 Client ID (type: Web
# application) in the staging project's console with redirect URI
#   https://<express-staging-url>/api/auth/callback
# (consent screen: External + Testing, with the logging-in Google accounts
# added as test users is enough), then store both halves:
#   printf '%s' "<client-id>" | gcloud secrets create GOOGLE_CLIENT_ID_STAGING --data-file=- --project=<staging-project>
#   printf '%s' "<client-secret>" | gcloud secrets create GOOGLE_CLIENT_SECRET_STAGING --data-file=- --project=<staging-project>
OAUTH_SECRETS=""
if gcloud secrets describe GOOGLE_CLIENT_ID_STAGING --project="${PROJECT_ID}" >/dev/null 2>&1 \
    && gcloud secrets describe GOOGLE_CLIENT_SECRET_STAGING --project="${PROJECT_ID}" >/dev/null 2>&1; then
  OAUTH_SECRETS=",GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID_STAGING:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET_STAGING:latest"
  run_cmd gcloud secrets add-iam-policy-binding GOOGLE_CLIENT_ID_STAGING \
    --project="${PROJECT_ID}" \
    --member="serviceAccount:${COMPUTE_SA}" \
    --role=roles/secretmanager.secretAccessor
  run_cmd gcloud secrets add-iam-policy-binding GOOGLE_CLIENT_SECRET_STAGING \
    --project="${PROJECT_ID}" \
    --member="serviceAccount:${COMPUTE_SA}" \
    --role=roles/secretmanager.secretAccessor
  echo "OAuth login: enabled (staging OAuth secrets found)"
else
  echo "OAuth login: disabled (GOOGLE_CLIENT_ID_STAGING / GOOGLE_CLIENT_SECRET_STAGING not in ${PROJECT_ID})"
fi

# Gemini/Imagen API key is OPTIONAL — without it, recipe and image
# generation endpoints return errors (no AI costs incurred). With it,
# staging mirrors the full prod generation pipeline end-to-end.
GEMINI_SECRET=""
if gcloud secrets describe GOOGLE_API_KEY_STAGING --project="${PROJECT_ID}" >/dev/null 2>&1; then
  GEMINI_SECRET=",GOOGLE_API_KEY=GOOGLE_API_KEY_STAGING:latest"
  run_cmd gcloud secrets add-iam-policy-binding GOOGLE_API_KEY_STAGING \
    --project="${PROJECT_ID}" \
    --member="serviceAccount:${COMPUTE_SA}" \
    --role=roles/secretmanager.secretAccessor
  echo "Gemini/Imagen: enabled (GOOGLE_API_KEY_STAGING found)"
else
  echo "Gemini/Imagen: disabled (GOOGLE_API_KEY_STAGING not in ${PROJECT_ID})"
  echo "  To enable: printf '%s' '<key>' | gcloud secrets create GOOGLE_API_KEY_STAGING --data-file=- --project=${PROJECT_ID}"
fi

# Cross-project image pull: the staging project's Cloud Run service agent
# needs read access to the prod Artifact Registry repo.
run_cmd gcloud artifacts repositories add-iam-policy-binding vegangenius \
  --project="${IMAGE_PROJECT}" --location="${REGION}" \
  --member="serviceAccount:${RUN_SERVICE_AGENT}" \
  --role=roles/artifactregistry.reader

echo ""

# ── Step 1: Deploy Flask backend (staging) ────────────────────────────
# Staging Flask mirrors prod architecture: CloudSQL (Auth Proxy), Pub/Sub
# (push subscriptions with OIDC), GCS (recipe images), and optionally
# Gemini/Imagen (GOOGLE_API_KEY_STAGING) and Google OAuth. No Valkey
# (rate limiting falls back to in-memory SimpleCache), no Datadog.
#
# Posture mirrors prod flask-backend (KAN-170): the invoker IAM check stays
# ON (--no-allow-unauthenticated), and Express authenticates with a
# Google-signed ID token (server/flask-auth.ts).
#
# max-instances=1: kept as a cost ceiling — staging never needs more than
# one instance.

echo "--- Step 1: Deploy ${FLASK_SERVICE} ---"

# FRONTEND_URL is where the OAuth callback 302s the browser after login.
# The Express staging URL is stable across revisions, so resolve it from the
# existing service. On the very first deploy it doesn't exist yet — deploy
# once, then re-run this script (idempotent) to wire it in.
# SESSION_COOKIE_DOMAIN stays unset on purpose: run.app is on the Public
# Suffix List, so host-only session cookies are the only shape that works.
EXPRESS_EXISTING_URL="$(gcloud run services describe "${EXPRESS_SERVICE}" \
  --region="${REGION}" --project="${PROJECT_ID}" \
  --format='value(status.url)' 2>/dev/null || true)"
if [[ -n "$OAUTH_SECRETS" && -z "$EXPRESS_EXISTING_URL" ]]; then
  echo "NOTE: OAuth secrets exist but ${EXPRESS_SERVICE} has no URL yet;"
  echo "      re-run after this deploy so FRONTEND_URL gets wired in."
fi

run_cmd gcloud run deploy "${FLASK_SERVICE}" \
  --image="${FLASK_IMAGE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --port=8080 \
  --memory=512Mi \
  --min-instances=0 \
  --max-instances=1 \
  --set-env-vars="FLASK_ENV=staging,FLASK_APP=app.py,FRONTEND_URL=${EXPRESS_EXISTING_URL},GCS_BUCKET_NAME=tasteslikegood-recipe-images-staging,GCP_PROJECT_ID=${PROJECT_ID},PUBSUB_INVOKER_SA=pubsub-pusher@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-secrets="FLASK_SECRET_KEY=FLASK_SECRET_KEY_STAGING:latest,DATABASE_URL=DATABASE_URL_STAGING:latest${GEMINI_SECRET}${OAUTH_SECRETS}" \
  --set-cloudsql-instances="${PROJECT_ID}:${REGION}:vegangenius-staging-db" \
  --network=default \
  --subnet=default \
  --vpc-egress=private-ranges-only \
  --no-allow-unauthenticated \
  --quiet

# Express (running as the compute SA) must be allowed to invoke Flask.
run_cmd gcloud run services add-iam-policy-binding "${FLASK_SERVICE}" \
  --region="${REGION}" --project="${PROJECT_ID}" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role=roles/run.invoker

echo ""

# ── Step 2: Get Flask staging URL ─────────────────────────────────────
if ! $DRY_RUN; then
  FLASK_STAGING_URL="$(gcloud run services describe "${FLASK_SERVICE}" \
    --region="${REGION}" --project="${PROJECT_ID}" \
    --format='value(status.url)')"
  echo "Flask staging URL: ${FLASK_STAGING_URL}"
else
  FLASK_STAGING_URL="https://${FLASK_SERVICE}-HASH-uc.a.run.app"
  echo "[DRY RUN] Flask staging URL: ${FLASK_STAGING_URL} (placeholder)"
fi

echo ""

# ── Step 3: Deploy Express frontend (staging) ─────────────────────────
# Public access uses --no-invoker-iam-check rather than
# --allow-unauthenticated: the org's Domain Restricted Sharing policy
# (iam.allowedPolicyMemberDomains) forbids binding allUsers, so the
# allUsers invoker grant always fails here. Disabling the invoker IAM
# check makes the service public without any IAM member.
#
# NODE_ENV=staging activates:
#   - X-Robots-Tag: noindex, nofollow header on every response
#   - /robots.txt deny-all
#   - No Valkey (rate limiting falls back to in-memory)
#   - No Datadog
# Express is purely a proxy — Gemini, Pub/Sub, GCS are all Flask-side.

echo "--- Step 3: Deploy ${EXPRESS_SERVICE} ---"
run_cmd gcloud run deploy "${EXPRESS_SERVICE}" \
  --image="${EXPRESS_IMAGE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --port=8080 \
  --memory=512Mi \
  --min-instances=0 \
  --max-instances=2 \
  --set-env-vars="NODE_ENV=staging,FLASK_BACKEND_URL=${FLASK_STAGING_URL}" \
  --clear-secrets \
  --no-invoker-iam-check \
  --quiet

echo ""

# ── Step 4: Get Express staging URL ───────────────────────────────────
if ! $DRY_RUN; then
  EXPRESS_STAGING_URL="$(gcloud run services describe "${EXPRESS_SERVICE}" \
    --region="${REGION}" --project="${PROJECT_ID}" \
    --format='value(status.url)')"
  echo ""
  echo "=== Staging deployed ==="
  echo "Express (public): ${EXPRESS_STAGING_URL}"
  echo "Flask (private):  ${FLASK_STAGING_URL}"
  echo ""
  echo "Verify (machine-checkable S3 acceptance, exits 0/1):"
  echo "  ./scripts/staging/verify-staging.sh ${EXPRESS_STAGING_URL} ${FLASK_STAGING_URL}"
else
  echo "=== Dry run complete ==="
  echo "Re-run with --apply to deploy."
fi
