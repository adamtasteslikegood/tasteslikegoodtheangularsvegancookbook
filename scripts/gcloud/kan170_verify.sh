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
#   ./scripts/gcloud/kan170_verify.sh --self-test   # no gcloud, no network
#
# Exit status (KAN-173): 0 when every check passes, 1 when any fails. Before
# 2026-07-28 this script only printed and always exited 0, so scheduling it
# would have produced a green run forever — the same shape as the Alembic head
# check that sat unused in scripts/ until it was wired into pr-gate.yml AND
# gate.needs (KAN-138). A check that cannot fail is documentation, not a gate.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-comdottasteslikegood}"
REGION="${REGION:-us-central1}"
FLASK_SERVICE="${FLASK_SERVICE:-flask-backend}"
EXPRESS_SERVICE="${EXPRESS_SERVICE:-express-frontend}"
PUBLIC_URL="${PUBLIC_URL:-https://www.tasteslikegood.org}"

FAILURES=0

log() { printf '\033[36m[kan170-verify]\033[0m %s\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() {
  printf '  \033[31m✗\033[0m %s\n' "$*"
  FAILURES=$((FAILURES + 1))
}
info() { printf '    %s\n' "$*"; }

# The two annotations that define the KAN-170 exposure. Extracted from the main
# flow purely so --self-test can drive them with drifted values: the risk with a
# scheduled posture check is that it silently passes while pointed at the wrong
# thing, and the only way to trust a green run is to have seen a red one.
assert_posture() {
  local iam_off="$1" ingress="$2" express_ingress="$3"

  # The annotation is the landmine: absent means the invoker IAM check is ON.
  if [[ "$iam_off" == "true" || "$iam_off" == "True" ]]; then
    bad "invoker IAM check is DISABLED on $FLASK_SERVICE (the KAN-170 landmine)"
  else
    ok "invoker IAM check is ENFORCED on $FLASK_SERVICE"
  fi

  if [[ "$ingress" == "all" ]]; then
    bad "ingress=all — $FLASK_SERVICE is reachable directly from the internet"
  else
    ok "ingress=${ingress:-<unset>} — direct internet access is refused"
  fi

  # express-frontend carries the SAME invoker-iam-disabled=true annotation and
  # is held shut by ingress alone — see docs/security/SECURITY_DECISIONS.md.
  # Widening its ingress therefore reproduces KAN-170 on the other service, with
  # no IAM change to make it visible.
  if [[ "$express_ingress" == "all" ]]; then
    bad "ingress=all on $EXPRESS_SERVICE — its only guard has been removed (KAN-172)"
  else
    ok "ingress=${express_ingress:-<unset>} on $EXPRESS_SERVICE — load-balancer path only"
  fi
}

# Runs before `require gcloud` on purpose: the self-test needs no credentials
# and no network, so CI can prove the gate is live on every PR.
if [[ "${1:-}" == "--self-test" ]]; then
  log "Self-test — driving the posture assertions with drifted values"
  info "No gcloud, no network. Proves this check can FAIL (KAN-173)."
  assert_posture "true" "all" "all" # the exact KAN-170 exposure, on both services
  if [[ "$FAILURES" -eq 3 ]]; then
    printf '\n\033[32mSELF-TEST PASS\033[0m — drift raised %d failures; a scheduled run would exit 1.\n' "$FAILURES"
    exit 0
  fi
  printf '\n\033[31mSELF-TEST FAIL\033[0m — drift raised %d failures, expected 3.\n' "$FAILURES"
  printf 'The posture check can no longer detect the exposure it exists for. Fix before trusting a green run.\n'
  exit 1
fi

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 not found in PATH"; exit 1; }
}
require gcloud
require curl

# --project is passed per command: mutating the user's global gcloud config
# from a check script is a rude side effect.
# `|| true` is load-bearing: under `set -e`, VAR=$(cmd) takes the substitution's
# exit status, so a failing gcloud would kill this script silently (stderr is
# suppressed) and make the "could not resolve" guard below unreachable.
describe() {
  gcloud run services describe "$1" --project="$PROJECT_ID" --region="$REGION" --format="$2" 2>/dev/null || true
}

# ── 1. Service configuration ────────────────────────────────────────────────
log "Cloud Run configuration"

FLASK_INGRESS="$(describe "$FLASK_SERVICE" 'value(metadata.annotations["run.googleapis.com/ingress"])')"
FLASK_IAM_OFF="$(describe "$FLASK_SERVICE" 'value(metadata.annotations["run.googleapis.com/invoker-iam-disabled"])')"
FLASK_EGRESS="$(describe "$FLASK_SERVICE" 'value(spec.template.metadata.annotations["run.googleapis.com/vpc-access-egress"])')"
FLASK_URL="$(describe "$FLASK_SERVICE" 'value(status.url)')"
EXPRESS_INGRESS="$(describe "$EXPRESS_SERVICE" 'value(metadata.annotations["run.googleapis.com/ingress"])')"
EXPRESS_EGRESS="$(describe "$EXPRESS_SERVICE" 'value(spec.template.metadata.annotations["run.googleapis.com/vpc-access-egress"])')"

# Unresolvable services must abort, never pass. A scheduled check whose target
# has been renamed or moved would otherwise read every annotation as empty and
# report the posture as correct — green because it looked at nothing.
if [[ -z "$FLASK_URL" ]]; then
  echo "ERROR: could not resolve $FLASK_SERVICE in $PROJECT_ID/$REGION" >&2
  exit 1
fi
if [[ -z "$EXPRESS_INGRESS" ]]; then
  echo "ERROR: could not resolve $EXPRESS_SERVICE in $PROJECT_ID/$REGION" >&2
  exit 1
fi

info "$FLASK_SERVICE   ingress=${FLASK_INGRESS:-<unset>} invoker-iam-disabled=${FLASK_IAM_OFF:-<absent>} egress=${FLASK_EGRESS:-<unset>}"
info "$EXPRESS_SERVICE ingress=${EXPRESS_INGRESS:-<unset>} egress=${EXPRESS_EGRESS:-<unset>}"

assert_posture "$FLASK_IAM_OFF" "$FLASK_INGRESS" "$EXPRESS_INGRESS"

# ── 2. IAM + audiences ──────────────────────────────────────────────────────
log "IAM invoker bindings on $FLASK_SERVICE"
gcloud run services get-iam-policy "$FLASK_SERVICE" \
  --project="$PROJECT_ID" --region="$REGION" \
  --format='value(bindings.role,bindings.members)' 2>/dev/null | sed 's/^/    /' \
  || info "(none)"

# Custom audiences live on the SERVICE-level metadata annotations, not the
# revision template. The template path read here before 2026-07-27 is never
# populated by `gcloud run services update --add-custom-audiences`, so this
# line reported "<none>" during the KAN-170 cutover while the live service
# annotation provably listed both worker endpoints.
CUSTOM_AUD="$(describe "$FLASK_SERVICE" 'value(metadata.annotations["run.googleapis.com/custom-audiences"])')"
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

# ── 5. Token preconditions ──────────────────────────────────────────────────
# Neither of these proves a token is being sent — that is only observable after
# the cutover, when a proxied route either works or 403s. But both are NECESSARY,
# and each fails silently on its own, so checking them turns two invisible
# misconfigurations into visible ones before the irreversible-feeling step.
log "Token preconditions (necessary, not sufficient)"

# server/flask-auth.ts mints a token only when FLASK_BACKEND_URL is https and
# *.run.app — a custom domain is not a valid Cloud Run audience. This value is
# service config, not set in cloudbuild.yaml, so nothing else validates it.
EXPRESS_FLASK_URL="$(describe "$EXPRESS_SERVICE" \
  'value(spec.template.spec.containers[0].env.filter("name:FLASK_BACKEND_URL").extract("value").flatten())')"
if [[ "$EXPRESS_FLASK_URL" =~ ^https://[^/]*\.run\.app$ ]]; then
  ok "FLASK_BACKEND_URL is an https run.app origin — a token will be minted"
elif [[ -z "$EXPRESS_FLASK_URL" ]]; then
  bad "FLASK_BACKEND_URL is unset on $EXPRESS_SERVICE — NO token will be minted"
else
  bad "FLASK_BACKEND_URL is not a bare https run.app origin — NO token will be minted"
  info "a trailing slash, a path, or a custom domain all silently disable auth"
fi

EXPRESS_SA="$(describe "$EXPRESS_SERVICE" 'value(spec.template.spec.serviceAccountName)')"
if gcloud run services get-iam-policy "$FLASK_SERVICE" --project="$PROJECT_ID" --region="$REGION" \
    --format='value(bindings.members)' 2>/dev/null | grep -qF "$EXPRESS_SA"; then
  ok "$EXPRESS_SERVICE's runtime SA holds an invoker binding on $FLASK_SERVICE"
else
  bad "$EXPRESS_SERVICE's runtime SA has NO invoker binding — cutover would 403 everything"
  info "run: ./scripts/gcloud/kan170_path_a.sh prepare --apply"
fi

# ── 6. Live probes ──────────────────────────────────────────────────────────
# GET only. Never POST to /api/generate* from a check script: those endpoints
# complete and bill Gemini/Imagen even for an unauthenticated caller.
log "Live probes"

probe() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1" 2>/dev/null || echo "000"; }

FLASK_ANON="$(probe "${FLASK_URL}/")"
SITE_ROOT="$(probe "${PUBLIC_URL}/")"
# THE load-bearing probe. GET / is served by Express from disk (the SPA shell)
# and NEVER touches Flask, so it returns 200 even when every Flask-backed route
# is 403 — verified empirically. /api/health is Express-local too and equally
# blind. /sitemap.xml is proxied (server/index.ts app.get('/sitemap.xml',
# ssrProxy)), so it is the cheapest GET that actually exercises Express→Flask.
SITE_PROXIED="$(probe "${PUBLIC_URL}/sitemap.xml")"

if [[ "$FLASK_ANON" == "403" || "$FLASK_ANON" == "404" ]]; then
  ok "anonymous GET / on $FLASK_SERVICE → $FLASK_ANON (closed)"
else
  bad "anonymous GET / on $FLASK_SERVICE → $FLASK_ANON (EXPOSED — expected 403/404)"
fi

if [[ "$SITE_ROOT" == "200" ]]; then
  ok "GET $PUBLIC_URL/ → 200 (Express shell up — proves nothing about Flask)"
else
  bad "GET $PUBLIC_URL/ → $SITE_ROOT (Express itself is down — expected 200)"
fi

if [[ "$SITE_PROXIED" == "200" ]]; then
  ok "GET $PUBLIC_URL/sitemap.xml → 200 (Express→Flask path WORKING)"
else
  bad "GET $PUBLIC_URL/sitemap.xml → $SITE_PROXIED (Express→Flask path BROKEN — expected 200)"
  info "this is the probe that matters; 403 here means the token is missing or unauthorised"
fi

echo
log "Interpreting a failed cutover:"
info "403 = token was valid but the caller lacks roles/run.invoker"
info "401 = token missing, malformed, or minted for the wrong audience"
info "404 = request reached Cloud Run as EXTERNAL and was refused by internal ingress"
echo

if [[ "$FAILURES" -gt 0 ]]; then
  log "FAILED — $FAILURES check(s) did not pass."
  exit 1
fi
log "Done — all checks passed."
