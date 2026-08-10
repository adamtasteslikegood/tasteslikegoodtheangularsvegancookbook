#!/usr/bin/env bash
# deploy-staging.sh — Deploy staging Cloud Run services for express-frontend
# and flask-backend. Reuses the production container images (no rebuild).
#
# Staging services:
#   express-frontend-staging  (public, serves SPA + proxies to flask-backend-staging)
#   flask-backend-staging     (private, SQLite, no Gemini/Imagen, no Valkey)
#
# Dry run is the DEFAULT. Nothing mutates without --apply.
#
# Usage:
#   ./scripts/staging/deploy-staging.sh [--apply] [--version v0.4.10]
#
# Environment overrides:
#   PROJECT_ID    — GCP project (default: comdottasteslikegood)
#   REGION        — Cloud Run region (default: us-central1)
#   IMAGE_TAG     — Image tag to deploy (default: latest release tag)

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-comdottasteslikegood}"
REGION="${REGION:-us-central1}"
IMAGE_REGISTRY="${IMAGE_REGISTRY:-${REGION}-docker.pkg.dev/${PROJECT_ID}/vegangenius}"

FLASK_SERVICE="flask-backend-staging"
EXPRESS_SERVICE="express-frontend-staging"

DRY_RUN=true
IMAGE_TAG=""

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

# ── Step 1: Deploy Flask backend (staging) ────────────────────────────
# Staging Flask uses SQLite (embedded, no Cloud SQL needed), no Gemini/Imagen
# keys, no Valkey, no Pub/Sub, no Datadog. FLASK_ENV=staging activates
# staging-specific behaviour (robots.txt deny-all).
#
# FLASK_SECRET_KEY is still needed for session signing — staging uses a
# dedicated secret. If the secret doesn't exist yet, create it first:
#   echo -n "$(openssl rand -base64 32)" | \
#     gcloud secrets create FLASK_SECRET_KEY_STAGING --data-file=- --project=$PROJECT_ID

echo "--- Step 1: Deploy ${FLASK_SERVICE} ---"
run_cmd gcloud run deploy "${FLASK_SERVICE}" \
  --image="${FLASK_IMAGE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --port=8080 \
  --memory=512Mi \
  --min-instances=0 \
  --max-instances=2 \
  --set-env-vars="FLASK_ENV=staging,FLASK_APP=app.py,DATABASE_URL=sqlite:///staging.db,FRONTEND_URL=,GCS_BUCKET_NAME=,GCP_PROJECT_ID=,PUBSUB_INVOKER_SA=,PUBSUB_AUTH_OPTIONAL=1" \
  --set-secrets="FLASK_SECRET_KEY=FLASK_SECRET_KEY_STAGING:latest" \
  --allow-unauthenticated \
  --quiet

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
# NODE_ENV=staging activates:
#   - noindex meta tag injection on all HTML pages
#   - /robots.txt deny-all
#   - No Gemini API key (generation endpoints disabled)
#   - No Valkey (rate limiting falls back to in-memory)
#   - No Datadog

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
  --allow-unauthenticated \
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
  echo "Flask (backend):  ${FLASK_STAGING_URL}"
  echo ""
  echo "Verify:"
  echo "  curl -s ${EXPRESS_STAGING_URL}/ | grep -c 'noindex'"
  echo "  curl -s ${EXPRESS_STAGING_URL}/robots.txt"
  echo "  curl -s ${EXPRESS_STAGING_URL}/api/health"
else
  echo "=== Dry run complete ==="
  echo "Re-run with --apply to deploy."
fi
