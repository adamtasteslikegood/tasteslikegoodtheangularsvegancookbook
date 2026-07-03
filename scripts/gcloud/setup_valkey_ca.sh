#!/usr/bin/env bash
# Idempotent setup for the VALKEY_CA_CERT secret: fetches the Google-managed
# CA certificate of the Memorystore (Valkey) instance and stores it in Secret
# Manager so the Express service can verify the instance's TLS cert.
#
# Without this secret, Node.js rejects the Memorystore server cert
# ("self-signed certificate in certificate chain") and the rate limiter
# silently falls back to in-memory state (GH #163 / #162, KAN-16 / KAN-17).
#
# Run BEFORE the first deploy that includes VALKEY_CA_CERT in cloudbuild.yaml.
# Safe to re-run; a new secret version is only added when the CA changed.
#
# Required env vars (with sensible defaults):
#   PROJECT_ID       — GCP project (default: comdottasteslikegood)
#   REGION           — Memorystore location (default: us-central1)
#   VALKEY_INSTANCE  — Memorystore instance id (default: veganchef-valkeymem)
#   EXPRESS_SERVICE  — Cloud Run service name (default: express-frontend)
#
# Usage:
#   ./scripts/gcloud/setup_valkey_ca.sh
#   PROJECT_ID=staging-tlg ./scripts/gcloud/setup_valkey_ca.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-comdottasteslikegood}"
REGION="${REGION:-us-central1}"
VALKEY_INSTANCE="${VALKEY_INSTANCE:-veganchef-valkeymem}"
EXPRESS_SERVICE="${EXPRESS_SERVICE:-express-frontend}"

SECRET_NAME="VALKEY_CA_CERT"

log() { printf '\033[36m[setup-valkey-ca]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[setup-valkey-ca] WARN:\033[0m %s\n' "$*" >&2; }

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 not found in PATH"; exit 1; }
}

require gcloud
gcloud config set project "$PROJECT_ID" >/dev/null

# ── 1. Fetch the instance CA certificate ────────────────────────────────────
log "Fetching CA cert for Memorystore instance ${VALKEY_INSTANCE} (${REGION})"
CA_PEM="$(gcloud memorystore instances get-certificate-authority "$VALKEY_INSTANCE" \
  --location="$REGION" \
  --format='value(managedServerCa.caCerts[0].certificates[0])')"

if [[ "$CA_PEM" != *"BEGIN CERTIFICATE"* ]]; then
  echo "ERROR: response does not look like a PEM certificate:"
  echo "$CA_PEM" | head -3
  exit 1
fi

# ── 2. Create the secret / add a version only when the CA changed ──────────
if ! gcloud secrets describe "$SECRET_NAME" >/dev/null 2>&1; then
  log "Creating secret ${SECRET_NAME}"
  printf '%s\n' "$CA_PEM" | gcloud secrets create "$SECRET_NAME" \
    --replication-policy=automatic \
    --data-file=-
else
  CURRENT="$(gcloud secrets versions access latest --secret="$SECRET_NAME" 2>/dev/null || true)"
  if [[ "$CURRENT" == "$CA_PEM" ]]; then
    log "Secret ${SECRET_NAME} already holds the current CA — nothing to do"
  else
    log "CA changed — adding new version to ${SECRET_NAME}"
    printf '%s\n' "$CA_PEM" | gcloud secrets versions add "$SECRET_NAME" --data-file=-
  fi
fi

# ── 3. Grant the Express runtime SA access to the secret ───────────────────
RUNTIME_SA="$(gcloud run services describe "$EXPRESS_SERVICE" --region="$REGION" \
  --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null || true)"
if [[ -z "$RUNTIME_SA" ]]; then
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
  warn "Service ${EXPRESS_SERVICE} has no explicit SA — using default compute SA"
fi

log "Granting roles/secretmanager.secretAccessor on ${SECRET_NAME} to ${RUNTIME_SA}"
gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/secretmanager.secretAccessor" >/dev/null

log "Done. Next deploy (cloudbuild.yaml) injects ${SECRET_NAME} into ${EXPRESS_SERVICE}."
