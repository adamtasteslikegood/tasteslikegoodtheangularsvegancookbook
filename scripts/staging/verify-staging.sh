#!/usr/bin/env bash
# verify-staging.sh — machine-checkable S3 acceptance for the staging pair.
#
# Runs every check and reports PASS/FAIL per line; exits 0 only if all pass.
# This is the gate KAN-182 closes on: it must pass against the *deployed*
# environment, not a local server.
#
# Usage:
#   ./scripts/staging/verify-staging.sh [EXPRESS_URL] [FLASK_URL]
#
# With no args, URLs are resolved via gcloud from the staging project
# (requires gcloud auth; pass the URLs explicitly to run without it).
#
# Environment overrides: PROJECT_ID, REGION (same defaults as deploy-staging.sh)

set -uo pipefail

PROJECT_ID="${PROJECT_ID:-gen-lang-client-0491022701}"
REGION="${REGION:-us-central1}"

EXPRESS_URL="${1:-}"
FLASK_URL="${2:-}"

if [[ -z "$EXPRESS_URL" ]]; then
  EXPRESS_URL="$(gcloud run services describe express-frontend-staging \
    --region="${REGION}" --project="${PROJECT_ID}" --format='value(status.url)')"
fi
if [[ -z "$FLASK_URL" ]]; then
  FLASK_URL="$(gcloud run services describe flask-backend-staging \
    --region="${REGION}" --project="${PROJECT_ID}" --format='value(status.url)')"
fi

echo "=== Staging verification ==="
echo "Express: ${EXPRESS_URL}"
echo "Flask:   ${FLASK_URL}"
echo ""

PASS=0
FAIL=0

check() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS: ${name}"
    PASS=$((PASS + 1))
  else
    echo "FAIL: ${name}"
    FAIL=$((FAIL + 1))
  fi
}

# 1. Every response carries the noindex header.
noindex_header() {
  curl -sfI "${EXPRESS_URL}/" | grep -qi '^x-robots-tag:.*noindex'
}
check "X-Robots-Tag noindex on /" noindex_header

# 2. robots.txt denies all crawlers.
robots_deny() {
  curl -sf "${EXPRESS_URL}/robots.txt" | grep -q '^Disallow: /$'
}
check "robots.txt Disallow: /" robots_deny

# 3. Health endpoint reports the staging environment.
health_env() {
  curl -sf "${EXPRESS_URL}/api/health" | grep -q '"environment":[[:space:]]*"staging"'
}
check "/api/health environment=staging" health_env

# 4. Flask is NOT directly reachable (Cloud Run edge returns 403).
flask_private() {
  [[ "$(curl -s -o /dev/null -w '%{http_code}' "${FLASK_URL}/api/health")" == "403" ]]
}
check "Flask direct access returns 403" flask_private

# 5. DB-backed page: /browse renders and links at least one public recipe.
BROWSE_HTML="$(curl -sf "${EXPRESS_URL}/browse" || true)"
browse_nonempty() {
  grep -q 'href="/r/' <<<"${BROWSE_HTML}"
}
check "/browse lists at least one recipe" browse_nonempty

# 6. DB-backed API: the first browse slug resolves to non-empty recipe JSON.
api_nonempty() {
  local slug
  slug="$(grep -o 'href="/r/[^"]*"' <<<"${BROWSE_HTML}" | head -1 | sed 's|href="/r/||; s|"||')"
  [[ -n "$slug" ]] && curl -sf "${EXPRESS_URL}/api/recipes/public/${slug}" | grep -q '"name"'
}
check "/api/recipes/public/<slug> returns recipe JSON" api_nonempty

# 7. Static assets are served with a real content type, not the SPA fallback.
static_content_type() {
  curl -sfI "${EXPRESS_URL}/static/css/tokens.css" | grep -qi '^content-type:.*text/css'
}
check "/static/css/tokens.css served as text/css" static_content_type

echo ""
echo "=== ${PASS} passed, ${FAIL} failed ==="
[[ "$FAIL" -eq 0 ]]
