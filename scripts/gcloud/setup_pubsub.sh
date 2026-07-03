#!/usr/bin/env bash
# Idempotent setup for Pub/Sub topics, push subscriptions, IAM, and the
# pubsub-pusher service account that signs OIDC tokens for push delivery.
#
# Run BEFORE the first deploy of the push-based Pub/Sub workers (KAN-?).
# Safe to re-run; existing resources are left in place.
#
# Required env vars (with sensible defaults):
#   PROJECT_ID       — GCP project (default: comdottasteslikegood)
#   REGION           — Cloud Run region (default: us-central1)
#   FLASK_SERVICE    — Cloud Run service name (default: flask-backend)
#
# Usage:
#   ./scripts/gcloud/setup_pubsub.sh
#   PROJECT_ID=staging-tlg ./scripts/gcloud/setup_pubsub.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-comdottasteslikegood}"
REGION="${REGION:-us-central1}"
FLASK_SERVICE="${FLASK_SERVICE:-flask-backend}"

PUSH_SA_NAME="pubsub-pusher"
PUSH_SA="${PUSH_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Topic → subscription → push endpoint mapping.
# Format: topic:endpoint_path
PAIRS=(
  "recipe-generation:recipe"
  "image-generation:image"
)

DLQ_TOPIC="generation-dlq"
DLQ_SUB="generation-dlq-sub"

log() { printf '\033[36m[setup-pubsub]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[setup-pubsub] WARN:\033[0m %s\n' "$*" >&2; }

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 not found in PATH"; exit 1; }
}

require gcloud
gcloud config set project "$PROJECT_ID" >/dev/null

# ── 1. Push service account ─────────────────────────────────────────────────
log "Ensuring service account ${PUSH_SA}"
if ! gcloud iam service-accounts describe "$PUSH_SA" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$PUSH_SA_NAME" \
    --display-name="Pub/Sub push invoker" \
    --description="Identity Pub/Sub uses to OIDC-sign push requests to /api/worker/*"
else
  log "  already exists"
fi

# ── 2. Topics + DLQ ─────────────────────────────────────────────────────────
ALL_TOPICS=("$DLQ_TOPIC")
for pair in "${PAIRS[@]}"; do
  ALL_TOPICS+=("${pair%%:*}")
done

for topic in "${ALL_TOPICS[@]}"; do
  log "Ensuring topic ${topic}"
  if ! gcloud pubsub topics describe "$topic" >/dev/null 2>&1; then
    gcloud pubsub topics create "$topic"
  else
    log "  already exists"
  fi
done

# ── 3. Dead-letter subscription so DLQ is actually drainable ───────────────
log "Ensuring DLQ subscription ${DLQ_SUB}"
if ! gcloud pubsub subscriptions describe "$DLQ_SUB" >/dev/null 2>&1; then
  gcloud pubsub subscriptions create "$DLQ_SUB" \
    --topic="$DLQ_TOPIC" \
    --message-retention-duration=7d \
    --ack-deadline=60
else
  log "  already exists"
fi

# ── 4. Resolve Flask URL for push endpoints ────────────────────────────────
FLASK_URL="$(gcloud run services describe "$FLASK_SERVICE" \
  --region="$REGION" --format='value(status.url)' 2>/dev/null || true)"

if [[ -z "$FLASK_URL" ]]; then
  warn "Cloud Run service '${FLASK_SERVICE}' not found yet."
  warn "Push subscriptions will be CREATED with a placeholder URL and must be"
  warn "updated post-deploy via: ./scripts/gcloud/update_push_endpoints.sh"
  FLASK_URL="https://placeholder.invalid"
fi
log "Flask URL: ${FLASK_URL}"

# ── 5. Push subscriptions ──────────────────────────────────────────────────
for pair in "${PAIRS[@]}"; do
  TOPIC="${pair%%:*}"
  ENDPOINT_PATH="${pair##*:}"
  SUB="${TOPIC}-push-sub"
  PUSH_URL="${FLASK_URL}/api/worker/${ENDPOINT_PATH}"

  log "Ensuring push subscription ${SUB} → ${PUSH_URL}"
  if ! gcloud pubsub subscriptions describe "$SUB" >/dev/null 2>&1; then
    gcloud pubsub subscriptions create "$SUB" \
      --topic="$TOPIC" \
      --push-endpoint="$PUSH_URL" \
      --push-auth-service-account="$PUSH_SA" \
      --ack-deadline=600 \
      --message-retention-duration=7d \
      --min-retry-delay=10s \
      --max-retry-delay=600s \
      --dead-letter-topic="$DLQ_TOPIC" \
      --max-delivery-attempts=5
  else
    log "  already exists (run update_push_endpoints.sh if Flask URL changed)"
  fi
done

# ── 6. IAM ─────────────────────────────────────────────────────────────────
FLASK_SA="$(gcloud run services describe "$FLASK_SERVICE" \
  --region="$REGION" \
  --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null \
  || echo "")"
if [[ -z "$FLASK_SA" ]]; then
  PROJECT_NUM="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  FLASK_SA="${PROJECT_NUM}-compute@developer.gserviceaccount.com"
  warn "Falling back to default compute SA for publisher role: ${FLASK_SA}"
fi

log "Granting roles/pubsub.publisher to ${FLASK_SA}"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${FLASK_SA}" \
  --role="roles/pubsub.publisher" \
  --condition=None \
  --quiet >/dev/null

log "Granting roles/run.invoker on ${FLASK_SERVICE} to ${PUSH_SA}"
gcloud run services add-iam-policy-binding "$FLASK_SERVICE" \
  --region="$REGION" \
  --member="serviceAccount:${PUSH_SA}" \
  --role="roles/run.invoker" \
  --quiet >/dev/null

PROJECT_NUM="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
PUBSUB_AGENT="service-${PROJECT_NUM}@gcp-sa-pubsub.iam.gserviceaccount.com"
log "Granting Pub/Sub agent (${PUBSUB_AGENT}) tokenCreator on ${PUSH_SA}"
gcloud iam service-accounts add-iam-policy-binding "$PUSH_SA" \
  --member="serviceAccount:${PUBSUB_AGENT}" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --quiet >/dev/null

log "✅ Done."
log ""
log "Set on flask-backend Cloud Run env vars:"
log "  PUBSUB_INVOKER_SA=${PUSH_SA}"
log "  GCP_PROJECT_ID=${PROJECT_ID}"
log ""
log "Verify with:"
log "  gcloud pubsub subscriptions list --filter='name:push-sub'"
log "  gcloud pubsub topics list"
