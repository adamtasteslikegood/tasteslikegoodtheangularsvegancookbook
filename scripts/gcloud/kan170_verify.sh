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

# How many flask-backend guards the DECLARED steady state requires. 1 until the
# KAN-176 Path B cutover lands; set to 2 as the cutover's final step to demand
# invoker IAM AND restricted ingress. See assert_posture() for why this is a
# declared value rather than a constant.
REQUIRED_FLASK_GUARDS="${REQUIRED_FLASK_GUARDS:-1}"
case "$REQUIRED_FLASK_GUARDS" in
  1|2) ;;
  *) echo "ERROR: REQUIRED_FLASK_GUARDS must be 1 or 2, got '$REQUIRED_FLASK_GUARDS'." >&2; exit 1 ;;
esac
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

  # flask-backend has two possible guards — invoker IAM enforcement (Path A,
  # shipped v0.4.7) and closed ingress (Path B; KAN-176). How many are REQUIRED
  # is a declared value, not a constant, because the right answer changes at the
  # cutover:
  #
  #   REQUIRED_FLASK_GUARDS=1  — before Path B. Both-guards would fail every run
  #                              against the posture actually in production. A
  #                              permanently-red check is not a stricter check;
  #                              it is an ignored one, and the drift it exists to
  #                              catch then hides in its own noise.
  #   REQUIRED_FLASK_GUARDS=2  — after Path B lands. This is the tightened
  #                              steady-state assertion: IAM *and* restricted
  #                              ingress, both required.
  #
  # Flipping it is the LAST step of the cutover, once the ingress restriction is
  # verified — see kan170_path_b.sh. Set it in the workflow so the tightening is
  # a one-line reviewable change rather than a code edit under time pressure.
  #
  # Both guards gone simultaneously IS the KAN-170 exposure, reproduced exactly:
  # that fails here at either setting, within 24h of the flip.
  local flask_guards=0

  # The annotation is the landmine: absent means the invoker IAM check is ON.
  if [[ "$iam_off" == "true" || "$iam_off" == "True" ]]; then
    info "invoker IAM check is DISABLED on $FLASK_SERVICE (the KAN-170 landmine annotation)"
  else
    ok "invoker IAM check is ENFORCED on $FLASK_SERVICE"
    flask_guards=$((flask_guards + 1))
  fi

  # An UNSET ingress annotation is never counted as a guard. Absence here is an
  # unknown, and a posture check that reads unknown as safe is the exact defect
  # KAN-173 exists to remove — so unknown ingress cannot rescue a disabled IAM
  # check. Only an explicitly non-`all` value counts as closed.
  if [[ -z "$ingress" ]]; then
    info "ingress is UNSET on $FLASK_SERVICE — unknown, NOT counted as a guard"
  elif [[ "$ingress" == "all" ]]; then
    info "ingress=all on $FLASK_SERVICE — no network guard (Path B not executed; KAN-176)"
  else
    ok "ingress=$ingress on $FLASK_SERVICE — direct internet access is refused"
    flask_guards=$((flask_guards + 1))
  fi

  if [[ "$flask_guards" -eq 0 ]]; then
    bad "$FLASK_SERVICE has NO guard left — invoker IAM disabled AND ingress open/unknown. This is KAN-170."
  elif [[ "$flask_guards" -lt "$REQUIRED_FLASK_GUARDS" ]]; then
    bad "$FLASK_SERVICE has $flask_guards guard(s); the declared steady state requires $REQUIRED_FLASK_GUARDS (IAM AND restricted ingress)."
  fi

  # express-frontend carries the SAME invoker-iam-disabled=true annotation and
  # is held shut by ingress alone — see docs/security/SECURITY_DECISIONS.md.
  # Widening its ingress therefore reproduces KAN-170 on the other service, with
  # no IAM change to make it visible.
  if [[ -z "$express_ingress" ]]; then
    bad "ingress is UNSET on $EXPRESS_SERVICE — unknown state, not a pass (KAN-172)"
  elif [[ "$express_ingress" == "all" ]]; then
    bad "ingress=all on $EXPRESS_SERVICE — its only guard has been removed (KAN-172)"
  else
    ok "ingress=$express_ingress on $EXPRESS_SERVICE — load-balancer path only"
  fi
}

# Runs before `require gcloud` on purpose: the self-test needs no credentials
# and no network, so CI can prove the gate is live on every PR.
if [[ "${1:-}" == "--self-test" ]]; then
  log "Self-test — driving the posture assertions with known-bad values"
  info "No gcloud, no network. Proves this check can FAIL (KAN-173)."

  info "scenario 1 — the exact KAN-170 exposure: both guards gone, on both services"
  assert_posture "true" "all" "all"
  EXPOSED_FAILURES="$FAILURES"

  # Scenario 2 exists because scenario 1 alone cannot catch the regression that
  # matters most: annotations that read back empty. Reported as a pass, that is
  # a green run over an unknown production state.
  #
  # Absence means something DIFFERENT for each annotation. An absent
  # `invoker-iam-disabled` genuinely means the invoker check is enforced — the
  # safe state, correctly a pass, and on its own a sufficient guard. An absent
  # `ingress` carries no such guarantee and is never counted as a guard. The
  # single failure here is express-frontend, which has no second guard to fall
  # back on. This asymmetry is deliberate.
  FAILURES=0
  info "scenario 2 — annotations unreadable; unknown ingress must not count as a guard"
  assert_posture "" "" ""
  UNKNOWN_FAILURES="$FAILURES"

  # Scenarios 3 and 4 pin the single-guard rule from both sides. Without them a
  # future edit could silently collapse it back to "any disabled IAM fails"
  # (permanently red against the agreed posture) or "disabled IAM always passes"
  # (blind to the landmine) and the self-test would not notice either.
  FAILURES=0
  info "scenario 3 — IAM disabled but ingress CLOSED: one guard holds, must NOT fail"
  assert_posture "true" "internal" "internal-and-cloud-load-balancing"
  ONE_GUARD_FAILURES="$FAILURES"

  FAILURES=0
  info "scenario 4 — IAM disabled and ingress UNKNOWN: unknown cannot rescue it"
  assert_posture "true" "" "internal-and-cloud-load-balancing"
  UNKNOWN_RESCUE_FAILURES="$FAILURES"

  if [[ "$EXPOSED_FAILURES" -eq 2 && "$UNKNOWN_FAILURES" -eq 1 &&
    "$ONE_GUARD_FAILURES" -eq 0 && "$UNKNOWN_RESCUE_FAILURES" -eq 1 ]]; then
    printf '\n\033[32mSELF-TEST PASS\033[0m — exposure %d, unknown %d, one-guard %d, unknown-rescue %d; a scheduled run would exit 1.\n' \
      "$EXPOSED_FAILURES" "$UNKNOWN_FAILURES" "$ONE_GUARD_FAILURES" "$UNKNOWN_RESCUE_FAILURES"
    exit 0
  fi
  printf '\n\033[31mSELF-TEST FAIL\033[0m — expected 2/1/0/1, got %d/%d/%d/%d.\n' \
    "$EXPOSED_FAILURES" "$UNKNOWN_FAILURES" "$ONE_GUARD_FAILURES" "$UNKNOWN_RESCUE_FAILURES"
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
EXPRESS_URL="$(describe "$EXPRESS_SERVICE" 'value(status.url)')"
EXPRESS_INGRESS="$(describe "$EXPRESS_SERVICE" 'value(metadata.annotations["run.googleapis.com/ingress"])')"
EXPRESS_EGRESS="$(describe "$EXPRESS_SERVICE" 'value(spec.template.metadata.annotations["run.googleapis.com/vpc-access-egress"])')"

# Unresolvable services must abort, never pass. A scheduled check whose target
# has been renamed or moved would otherwise read every annotation as empty and
# report the posture as correct — green because it looked at nothing.
if [[ -z "$FLASK_URL" ]]; then
  echo "ERROR: could not resolve $FLASK_SERVICE in $PROJECT_ID/$REGION" >&2
  exit 1
fi
# Gate on status.url, mirroring the Flask check exactly. Gating on the ingress
# annotation instead conflated two different failures: a service that does not
# resolve, and a service that resolves with no ingress annotation. The second is
# a real posture question and now belongs to assert_posture, which fails it.
if [[ -z "$EXPRESS_URL" ]]; then
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
  # A Router performs no translation by itself. Listing Routers and stopping
  # there reports "prerequisite present" for a Router that has no NAT gateway,
  # no assigned address, or a gateway covering the wrong subnet ranges — any of
  # which severs Express's public egress the moment it moves to all-traffic.
  # Inspect the gateway itself.
  while read -r _rname _rregion; do
    [[ -z "$_rname" ]] && continue
    NATS="$(gcloud compute routers nats list --project="$PROJECT_ID" \
      --router="$_rname" --router-region="$_rregion" \
      --format='value(name)' 2>/dev/null)"
    if [[ -z "$NATS" ]]; then
      info "  router $_rname has NO NAT gateway — it translates nothing"
      continue
    fi
    while read -r _nat; do
      [[ -z "$_nat" ]] && continue
      gcloud compute routers nats describe "$_nat" --project="$PROJECT_ID" \
        --router="$_rname" --router-region="$_rregion" --format=json 2>/dev/null \
        | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print("    NAT (unreadable)"); raise SystemExit
scope = d.get("sourceSubnetworkIpRangesToNat", "?")
mode = d.get("natIpAllocateOption", "?")
ips = d.get("natIps") or []
ok = "ok" if scope == "ALL_SUBNETWORKS_ALL_IP_RANGES" else "PARTIAL COVERAGE"
print("    NAT %s: scope=%s [%s] ip_mode=%s assigned=%d"
      % (d.get("name", "?"), scope, ok, mode, len(ips)))
if mode != "AUTO_ONLY" and not ips:
    print("      WARNING: MANUAL_ONLY with no address assigned — translates nothing")
'
    done <<<"$NATS"
  done <<<"$ROUTERS"
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

# One retry on a transport failure. curl returning 000 is indistinguishable from
# "exposed" or "site down" to the assertions below, so without this a single
# dropped packet on the daily run raises a security-labelled alert for what was
# a network blip. A genuine outage still fails — it just has to fail twice.
probe() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1" 2>/dev/null || echo "000")"
  if [[ "$code" == "000" ]]; then
    sleep 2
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1" 2>/dev/null || echo "000")"
  fi
  printf '%s' "$code"
}

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
