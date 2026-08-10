#!/usr/bin/env bash
# check-valkey-health.sh — fail-fast deploy-time Valkey healthcheck (KAN-160)
#
# Verifies that the deployed Express frontend is using Valkey (not in-memory)
# for rate limiting. If Valkey is unreachable or unauthenticated, Express
# degrades silently to MemoryStore — per-instance rate limiting that does not
# share state across Cloud Run replicas. This script catches that degradation
# at deploy time, before the build reports success.
#
# Usage (Cloud Build):
#   scripts/gcloud/check-valkey-health.sh <express-service> <region>
#
# Usage (manual):
#   scripts/gcloud/check-valkey-health.sh express-frontend us-central1
#
# The script:
#   1. Gets the service URL via gcloud
#   2. Curls /api/health (unauthenticated — Express allows it)
#   3. Checks that rateLimitStore == "valkey"
#   4. Exits 0 on success, 1 on degradation
#
# Exit codes:
#   0 — Valkey is connected
#   1 — Valkey degraded to memory (build should fail)
#   2 — Could not reach the service or parse the response

set -euo pipefail

SERVICE="${1:-express-frontend}"
REGION="${2:-us-central1}"
MAX_RETRIES="${3:-5}"
RETRY_DELAY="${4:-10}"

# Get the service URL
SERVICE_URL="$(gcloud run services describe "$SERVICE" \
  --region="$REGION" \
  --format='value(status.url)' 2>/dev/null)" || {
  echo "ERROR: Could not get URL for Cloud Run service '$SERVICE' in '$REGION'" >&2
  exit 2
}

echo "Checking Valkey health at ${SERVICE_URL}/api/health ..."

# Retry loop — the new revision may take a few seconds to become ready
for attempt in $(seq 1 "$MAX_RETRIES"); do
  RESPONSE="$(curl -sf --max-time 10 "${SERVICE_URL}/api/health" 2>/dev/null)" && break
  if [ "$attempt" -eq "$MAX_RETRIES" ]; then
    echo "ERROR: /api/health unreachable after ${MAX_RETRIES} attempts" >&2
    exit 2
  fi
  echo "  Attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${RETRY_DELAY}s ..."
  sleep "$RETRY_DELAY"
done

# Parse the rateLimitStore field
STORE="$(echo "$RESPONSE" | grep -o '"rateLimitStore":"[^"]*"' | cut -d'"' -f4)"

if [ -z "$STORE" ]; then
  echo "ERROR: Could not parse rateLimitStore from response:" >&2
  echo "$RESPONSE" >&2
  exit 2
fi

if [ "$STORE" = "valkey" ]; then
  echo "OK: rateLimitStore = valkey (shared rate limiting active)"
  exit 0
else
  echo "FAIL: rateLimitStore = ${STORE} (expected 'valkey')" >&2
  echo "Valkey is unreachable or unauthenticated — rate limiting is per-instance only." >&2
  echo "Check VALKEY_HOST, VALKEY_AUTH_MODE, and VALKEY_CA_CERT on the service." >&2
  exit 1
fi
