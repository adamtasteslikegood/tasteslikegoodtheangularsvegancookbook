#!/usr/bin/env bash
# KAN-170 — read-only posture check for the public-egress remediation.
#
# Prints the live configuration that decides whether flask-backend is
# anonymously invokable from the internet, and probes the two endpoints that
# actually matter. Mutates nothing; safe to run at any point before, during, or
# after either remediation path.
#
# The exposure it verifies: flask-backend ran with ingress=all AND the
# annotation run.googleapis.com/invoker-iam-disabled=true, which switches the
# invoker IAM check off wholesale. cloudbuild.yaml's --no-allow-unauthenticated
# could never clear it — that flag edits the IAM policy, and the annotation
# bypasses IAM entirely. So neither the build config nor the IAM policy reveals
# the problem; only the annotation does, which is why this script exists.
#
# The service hostname is resolved at runtime and never hardcoded: both repos
# are PUBLIC and the project-number URL form is already derivable from
# cloudbuild.yaml (see KAN-170 landmine L6 and KAN-171).
#
# Required env vars (with sensible defaults):
#   PROJECT_ID       — GCP project (default: comdottasteslikegood)
#   REGION           — Cloud Run region (default: us-central1)
#   FLASK_SERVICE    — Flask service name (default: flask-backend)
#   EXPRESS_SERVICE  — Express service name (default: express-frontend)
#   PUBLIC_URL       — customer-facing origin (default: https://www.tasteslikegood.org)
#
# Usage:
#   ./scripts/gcloud/kan170_verify.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-comdottasteslikegood}"
REGION="${REGION:-us-central1}"
FLASK_SERVICE="${FLASK_SERVICE:-flask-backend}"
EXPRESS_SERVICE="${EXPRESS_SERVICE:-express-frontend}"
PUBLIC_URL="${PUBLIC_URL:-https://www.tasteslikegood.org}"

log() { printf '\033[36m[kan170-verify]\033[0m %s\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 not found in PATH"; exit 1; }
}
require gcloud
require curl

# --project is passed per command: mutating the user's global gcloud config
# from a check script is a rude side effect.
describe() {
  gcloud run services describe "$1" --project="$PROJECT_ID" --region="$REGION" --format="$2" 2>/dev/null
}

# ── 1. Service configuration ────────────────────────────────────────────────
log "Cloud Run configuration"

FLASK_INGRESS="$(describe "$FLASK_SERVICE" 'value(metadata.annotations["run.googleapis.com/ingress"])')"
FLASK_IAM_OFF="$(describe "$FLASK_SERVICE" 'value(metadata.annotations["run.googleapis.com/invoker-iam-disabled"])')"
FLASK_EGRESS="$(describe "$FLASK_SERVICE" 'value(spec.template.metadata.annotations["run.googleapis.com/vpc-access-egress"])')"
FLASK_URL="$(describe "$FLASK_SERVICE" 'value(status.url)')"
EXPRESS_INGRESS="$(describe "$EXPRESS_SERVICE" 'value(metadata.annotations["run.googleapis.com/ingress"])')"
EXPRESS_EGRESS="$(describe "$EXPRESS_SERVICE" 'value(spec.template.metadata.annotations["run.googleapis.com/vpc-access-egress"])')"

if [[ -z "$FLASK_URL" ]]; then
  echo "ERROR: could not resolve $FLASK_SERVICE in $PROJECT_ID/$REGION" >&2
  exit 1
fi

info "$FLASK_SERVICE   ingress=${FLASK_INGRESS:-<unset>} invoker-iam-disabled=${FLASK_IAM_OFF:-<absent>} egress=${FLASK_EGRESS:-<unset>}"
info "$EXPRESS_SERVICE ingress=${EXPRESS_INGRESS:-<unset>} egress=${EXPRESS_EGRESS:-<unset>}"

# The annotation is the landmine: absent means the invoker IAM check is ON.
if [[ "$FLASK_IAM_OFF" == "true" || "$FLASK_IAM_OFF" == "True" ]]; then
  bad "invoker IAM check is DISABLED on $FLASK_SERVICE (the KAN-170 landmine)"
else
  ok "invoker IAM check is ENFORCED on $FLASK_SERVICE"
fi

if [[ "$FLASK_INGRESS" == "all" ]]; then
  bad "ingress=all — $FLASK_SERVICE is reachable directly from the internet"
else
  ok "ingress=${FLASK_INGRESS} — direct internet access is refused"
fi

# ── 2. IAM + audiences ──────────────────────────────────────────────────────
log "IAM invoker bindings on $FLASK_SERVICE"
gcloud run services get-iam-policy "$FLASK_SERVICE" \
  --project="$PROJECT_ID" --region="$REGION" \
  --format='value(bindings.role,bindings.members)' 2>/dev/null | sed 's/^/    /' \
  || info "(none)"

CUSTOM_AUD="$(describe "$FLASK_SERVICE" 'value(spec.template.metadata.annotations["run.googleapis.com/custom-audiences"])')"
info "custom audiences: ${CUSTOM_AUD:-<none>}"

# ── 3. Pub/Sub push subscriptions ───────────────────────────────────────────
# These push DIRECTLY to Flask, bypassing Express. Their OIDC audience defaults
# to the full push endpoint URL *including the path*, so they are the inbound
# caller most at risk from the cutover.
log "Pub/Sub push subscriptions targeting $FLASK_SERVICE"
gcloud pubsub subscriptions list --project="$PROJECT_ID" \
  --format='value(name,pushConfig.pushEndpoint,pushConfig.oidcToken.serviceAccountEmail,pushConfig.oidcToken.audience)' \
  2>/dev/null | grep -F "$(echo "$FLASK_URL" | sed 's|https://||')" | sed 's/^/    /' \
  || info "(none found)"

# ── 4. Cloud Router / NAT (Path B prerequisites) ────────────────────────────
log "Cloud Router / NAT"
ROUTERS="$(gcloud compute routers list --project="$PROJECT_ID" --format='value(name,region)' 2>/dev/null)"
if [[ -z "$ROUTERS" ]]; then
  info "none — express-frontend would lose ALL public egress under --vpc-egress=all-traffic"
else
  echo "$ROUTERS" | sed 's/^/    /'
fi

# ── 5. Live probes ──────────────────────────────────────────────────────────
# GET only. Never POST to /api/generate* from a check script: those endpoints
# complete and bill Gemini/Imagen even for an unauthenticated caller.
log "Live probes"

probe() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1" 2>/dev/null || echo "000"; }

FLASK_ANON="$(probe "${FLASK_URL}/")"
SITE="$(probe "${PUBLIC_URL}/")"

if [[ "$FLASK_ANON" == "403" || "$FLASK_ANON" == "404" ]]; then
  ok "anonymous GET / on $FLASK_SERVICE → $FLASK_ANON (closed)"
else
  bad "anonymous GET / on $FLASK_SERVICE → $FLASK_ANON (EXPOSED — expected 403/404)"
fi

if [[ "$SITE" == "200" ]]; then
  ok "GET $PUBLIC_URL/ → 200 (site healthy)"
else
  bad "GET $PUBLIC_URL/ → $SITE (SITE IS DOWN — expected 200)"
fi

echo
log "Interpreting a failed cutover:"
info "403 = token was valid but the caller lacks roles/run.invoker"
info "401 = token missing, malformed, or minted for the wrong audience"
info "404 = request reached Cloud Run as EXTERNAL and was refused by internal ingress"
echo
log "Done."
