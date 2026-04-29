#!/usr/bin/env bash
# Repoint existing Pub/Sub push subscriptions at the current Flask Cloud Run URL.
# Run after any deploy that changes the flask-backend service URL (region change,
# rename, etc.). Normal redeploys keep the same URL so this is rarely needed,
# but the first deploy after setup_pubsub.sh ran without a live service does
# require it.
#
# Usage:
#   ./scripts/gcloud/update_push_endpoints.sh
#   PROJECT_ID=staging-tlg ./scripts/gcloud/update_push_endpoints.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-comdottasteslikegood}"
REGION="${REGION:-us-central1}"
FLASK_SERVICE="${FLASK_SERVICE:-flask-backend}"

PAIRS=(
  "recipe-generation:recipe"
  "image-generation:image"
)

log() { printf '\033[36m[update-push]\033[0m %s\n' "$*"; }

gcloud config set project "$PROJECT_ID" >/dev/null

FLASK_URL="$(gcloud run services describe "$FLASK_SERVICE" \
  --region="$REGION" --format='value(status.url)')"

if [[ -z "$FLASK_URL" ]]; then
  echo "ERROR: Cloud Run service '${FLASK_SERVICE}' not found in ${REGION}" >&2
  exit 1
fi

log "Flask URL: ${FLASK_URL}"

for pair in "${PAIRS[@]}"; do
  TOPIC="${pair%%:*}"
  ENDPOINT_PATH="${pair##*:}"
  SUB="${TOPIC}-push-sub"
  PUSH_URL="${FLASK_URL}/api/worker/${ENDPOINT_PATH}"

  log "Updating ${SUB} → ${PUSH_URL}"
  gcloud pubsub subscriptions update "$SUB" \
    --push-endpoint="$PUSH_URL" \
    --quiet
done

log "✅ Done."
