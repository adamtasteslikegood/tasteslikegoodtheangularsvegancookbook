#!/usr/bin/env bash
# check-valkey-health.sh — fail-fast deploy-time Valkey healthcheck (KAN-160)
#
# Verifies that the deployed Express frontend is using Valkey (not in-memory)
# for rate limiting. If Valkey is unreachable or unauthenticated, Express
# degrades silently to MemoryStore — per-instance rate limiting that does not
# share state across Cloud Run replicas. This script catches that degradation
# at deploy time, before the build reports success.
#
# The probe targets the CANONICAL HOST (https://www.tasteslikegood.org), not
# the Cloud Run status.url: express-frontend runs with
# ingress=internal-and-cloud-load-balancing, so the *.run.app URL 404s from
# outside the VPC — including Cloud Build's default pool — and probing it
# would red every release build regardless of Valkey state (decision D2,
# 2026-08-11). The canonical host reaches the service through the load
# balancer, the same path real traffic takes. Note the LB may briefly still
# serve the previous revision; this check verifies the live production
# surface, not a specific revision.
#
# Usage (Cloud Build — probes the canonical host):
#   scripts/gcloud/check-valkey-health.sh
#
# Usage (staging / other environments):
#   HEALTHCHECK_BASE_URL=https://staging.example.com \
#     scripts/gcloud/check-valkey-health.sh [max_retries] [retry_delay_seconds]
#
# The script:
#   1. Curls ${HEALTHCHECK_BASE_URL}/api/health (unauthenticated — Express allows it)
#   2. Parses rateLimitStore from the JSON with python3 (ships in the
#      cloud-sdk builder image)
#   3. Exits 0 if rateLimitStore == "valkey", nonzero otherwise
#
# Exit codes:
#   0 — Valkey is connected
#   1 — Valkey degraded to memory (build should fail)
#   2 — Could not reach the endpoint or parse the response

set -euo pipefail

BASE_URL="${HEALTHCHECK_BASE_URL:-https://www.tasteslikegood.org}"
MAX_RETRIES="${1:-5}"
RETRY_DELAY="${2:-10}"

echo "Checking Valkey health at ${BASE_URL}/api/health ..."

# Retry loop — the load balancer may take a few seconds to route to the
# newly deployed revision
for attempt in $(seq 1 "$MAX_RETRIES"); do
  RESPONSE="$(curl -sf --max-time 10 "${BASE_URL}/api/health" 2>/dev/null)" && break
  if [ "$attempt" -eq "$MAX_RETRIES" ]; then
    echo "ERROR: ${BASE_URL}/api/health unreachable after ${MAX_RETRIES} attempts" >&2
    exit 2
  fi
  echo "  Attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${RETRY_DELAY}s ..."
  sleep "$RETRY_DELAY"
done

# Parse the rateLimitStore field. `|| true` is load-bearing: under
# `set -euo pipefail` a parse failure would otherwise kill the script with a
# bare exit 1 (the "degraded" code) before the exit-2 diagnostics below run.
STORE="$(printf '%s' "$RESPONSE" | python3 -c '
import json, sys

try:
    print(json.load(sys.stdin).get("rateLimitStore", ""))
except (ValueError, AttributeError):
    pass
' || true)"

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
