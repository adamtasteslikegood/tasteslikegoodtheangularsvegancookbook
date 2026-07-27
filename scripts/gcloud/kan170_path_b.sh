#!/usr/bin/env bash
# KAN-170 Path B — network isolation: route Express's egress through the VPC and
# close flask-backend's ingress to the internet.
#
# Path B is DEFENCE IN DEPTH, not a substitute for Path A. It closes
# reachability for BOTH of flask-backend's run.app hostnames at once, but it
# leaves run.googleapis.com/invoker-iam-disabled=true in place — i.e. it
# preserves the exact silent-failure mode that caused KAN-170. Do Path A first.
#
# WHAT ACTUALLY MAKES THIS WORK (and what does not):
#   Cloud NAT is NOT what lets Express reach an internal-ingress Flask. A Public
#   NAT gateway never performs NAT for Google APIs and services — that traffic
#   goes via Private Google Access instead, and PGA is already enabled on the
#   `default` subnet in us-central1. Google's documented option #1 for
#   "Cloud Run → internal-ingress Cloud Run" is exactly: caller on
#   --vpc-egress=all-traffic + PGA on the subnet, still dialling the normal
#   public run.app URL. No hostname change, no PSC endpoint.
#
#   Cloud NAT is required for something else: express-frontend's NON-Google
#   egress. Under all-traffic, everything leaves via the VPC, so without a NAT
#   the container loses public internet access entirely — which breaks the
#   Datadog intake the image's serverless-init entrypoint ships to. That is why
#   the NAT step comes first even though the Flask hop does not need it.
#
#   Pub/Sub push is SAFE under internal ingress: Cloud Run counts Pub/Sub
#   subscriptions as internal traffic when they are in the same project and use
#   the default run.app URL. Both hold here. Do NOT "improve" the push endpoints
#   to point at the custom domain — a custom-domain push endpoint under internal
#   ingress fails 100% of deliveries.
#
# ORDER MATTERS: NAT → egress → verify → ingress. Setting Flask's ingress before
# Express is on all-traffic takes the site down, because Express's call would
# still arrive from the public internet and be refused as EXTERNAL.
#
# Diagnosing a failure here: a wrongly-classified request returns 404, NOT 403.
# A 404 from the site after the ingress step means the traffic is arriving
# external — roll back the ingress, not the egress.
#
# Dry run is the DEFAULT. Nothing mutates without --apply.
#
# Required env vars (with sensible defaults):
#   PROJECT_ID       — GCP project (default: comdottasteslikegood)
#   REGION           — region (default: us-central1)
#   NETWORK          — VPC network (default: default)
#   SUBNET           — subnet (default: default)
#   FLASK_SERVICE    — Flask service name (default: flask-backend)
#   EXPRESS_SERVICE  — Express service name (default: express-frontend)
#
# Usage:
#   ./scripts/gcloud/kan170_path_b.sh nat      [--apply]   # router + NAT
#   ./scripts/gcloud/kan170_path_b.sh egress   [--apply]   # Express → all-traffic
#   ./scripts/gcloud/kan170_path_b.sh ingress  [--apply]   # Flask → internal
#   ./scripts/gcloud/kan170_path_b.sh rollback-egress  [--apply]
#   ./scripts/gcloud/kan170_path_b.sh rollback-ingress [--apply]

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-comdottasteslikegood}"
REGION="${REGION:-us-central1}"
NETWORK="${NETWORK:-default}"
SUBNET="${SUBNET:-default}"
FLASK_SERVICE="${FLASK_SERVICE:-flask-backend}"
EXPRESS_SERVICE="${EXPRESS_SERVICE:-express-frontend}"
PUBLIC_URL="${PUBLIC_URL:-https://www.tasteslikegood.org}"

ROUTER_NAME="${ROUTER_NAME:-tlg-nat-router}"
NAT_NAME="${NAT_NAME:-tlg-nat}"

APPLY=0
COMMAND="${1:-}"
shift || true
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    *) echo "ERROR: unknown argument '$arg'" >&2; exit 1 ;;
  esac
done

log() { printf '\033[36m[kan170-path-b]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[kan170-path-b] WARN:\033[0m %s\n' "$*" >&2; }

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 not found in PATH"; exit 1; }
}
require gcloud
require curl

run() {
  if [[ "$APPLY" == "1" ]]; then
    log "RUN: $*"
    "$@"
  else
    log "DRY RUN: $*"
  fi
}

# Probe the customer-facing site. After egress/ingress changes this is the
# signal that matters — not whether the gcloud command returned 0.
check_site() {
  [[ "$APPLY" == "1" ]] || { log "DRY RUN: would probe $PUBLIC_URL/"; return 0; }
  log "Waiting 15s for the new revision to take traffic..."
  sleep 15
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "${PUBLIC_URL}/" || echo 000)"
  if [[ "$code" == "200" ]]; then
    log "GET $PUBLIC_URL/ → 200 (healthy)"
  else
    warn "GET $PUBLIC_URL/ → $code — SITE MAY BE DOWN. Roll back this step now."
    return 1
  fi
}

case "$COMMAND" in
  nat)
    # Idempotent: describe before create, matching the house convention.
    if gcloud compute routers describe "$ROUTER_NAME" --project="$PROJECT_ID" --region="$REGION" >/dev/null 2>&1; then
      log "router $ROUTER_NAME already exists — skipping"
    else
      run gcloud compute routers create "$ROUTER_NAME" \
        --project="$PROJECT_ID" --network="$NETWORK" --region="$REGION"
    fi

    if gcloud compute routers nats describe "$NAT_NAME" --project="$PROJECT_ID" \
        --router="$ROUTER_NAME" --router-region="$REGION" >/dev/null 2>&1; then
      log "NAT $NAT_NAME already exists — skipping"
    else
      run gcloud compute routers nats create "$NAT_NAME" \
        --project="$PROJECT_ID" --router="$ROUTER_NAME" --region="$REGION" \
        --auto-allocate-nat-external-ips --nat-all-subnet-ip-ranges
    fi
    log "NAT ready. This is billable and always-on (hourly + per-GB) — it is now owned infrastructure."
    log "No traffic behaviour has changed yet; Express is still on private-ranges-only."
    ;;

  egress)
    # THE risky step. Without a working NAT this severs every public
    # destination Express uses, and it is the step that must be verified
    # immediately rather than batched with the ingress change.
    if ! gcloud compute routers describe "$ROUTER_NAME" --project="$PROJECT_ID" --region="$REGION" >/dev/null 2>&1; then
      echo "ERROR: no Cloud Router '$ROUTER_NAME'. Run '$0 nat --apply' first, or Express loses all public egress." >&2
      exit 1
    fi
    run gcloud run services update "$EXPRESS_SERVICE" \
      --project="$PROJECT_ID" --region="$REGION" \
      --vpc-egress=all-traffic --quiet
    check_site || { warn "Roll back with: $0 rollback-egress --apply"; exit 1; }
    ;;

  ingress)
    # Restoration, not a new design: this service was created with
    # ingress=internal and was opened to `all` on 2026-03-09T10:20:31Z, which is
    # the exact moment the exposure began.
    EXPRESS_EGRESS="$(gcloud run services describe "$EXPRESS_SERVICE" --project="$PROJECT_ID" \
      --region="$REGION" --format='value(spec.template.metadata.annotations["run.googleapis.com/vpc-access-egress"])' 2>/dev/null)"
    if [[ "$EXPRESS_EGRESS" != "all-traffic" ]]; then
      echo "ERROR: $EXPRESS_SERVICE egress is '$EXPRESS_EGRESS', not 'all-traffic'." >&2
      echo "       Closing Flask's ingress now would refuse Express's calls as EXTERNAL and take the site down." >&2
      exit 1
    fi
    run gcloud run services update "$FLASK_SERVICE" \
      --project="$PROJECT_ID" --region="$REGION" \
      --ingress=internal-and-cloud-load-balancing --quiet
    check_site || { warn "Roll back with: $0 rollback-ingress --apply"; exit 1; }
    log "Run ./scripts/gcloud/kan170_verify.sh — anonymous GET / on Flask should now fail."
    ;;

  rollback-egress)
    run gcloud run services update "$EXPRESS_SERVICE" \
      --project="$PROJECT_ID" --region="$REGION" \
      --vpc-egress=private-ranges-only --quiet
    ;;

  rollback-ingress)
    run gcloud run services update "$FLASK_SERVICE" \
      --project="$PROJECT_ID" --region="$REGION" \
      --ingress=all --quiet
    warn "Rolled back: $FLASK_SERVICE is internet-reachable again."
    ;;

  *)
    echo "Usage: $0 {nat|egress|ingress|rollback-egress|rollback-ingress} [--apply]" >&2
    exit 1
    ;;
esac

if [[ "$APPLY" != "1" ]]; then
  echo
  log "mode: DRY RUN — nothing was changed. Re-run with --apply to execute."
fi
