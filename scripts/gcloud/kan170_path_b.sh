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

# The ingress target is a DELIBERATE choice, not a default to inherit.
#
# flask-backend was created with ingress=internal and was opened to `all` on
# 2026-03-09T10:20:31Z. `internal` is therefore both the least-privilege setting
# and the actual restoration — it admits VPC traffic only, which is exactly the
# path Express uses once it is on all-traffic egress.
#
# `internal-and-cloud-load-balancing` additionally admits traffic from Google
# Cloud load balancers. Choose it ONLY if Flask is intentionally attached to an
# external HTTP(S) load balancer. It is not today: Express is the single entry
# point and reaches Flask over the VPC. Widening to it "just in case" re-opens a
# slice of the surface this whole exercise exists to close.
FLASK_INGRESS="${FLASK_INGRESS:-internal}"
case "$FLASK_INGRESS" in
  internal|internal-and-cloud-load-balancing) ;;
  *)
    echo "ERROR: FLASK_INGRESS must be 'internal' or 'internal-and-cloud-load-balancing', got '$FLASK_INGRESS'." >&2
    exit 1
    ;;
esac

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
#
# MUST probe a PROXIED path. GET / is served by Express from disk (the SPA
# shell) and never touches Flask, so it returns 200 even when every
# Flask-backed route is 403 or 404 — which is exactly the failure this function
# exists to catch, and it would have returned 0 and skipped the rollback branch.
# /api/health is Express-local too and equally blind. /sitemap.xml is proxied
# (server/index.ts), so it actually exercises Express→Flask.
check_site() {
  [[ "$APPLY" == "1" ]] || { log "DRY RUN: would probe $PUBLIC_URL/sitemap.xml"; return 0; }
  log "Waiting 15s for the new revision to take traffic..."
  sleep 15
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "${PUBLIC_URL}/sitemap.xml" || echo 000)"
  if [[ "$code" == "200" ]]; then
    log "GET $PUBLIC_URL/sitemap.xml → 200 (Express→Flask healthy)"
  else
    warn "GET $PUBLIC_URL/sitemap.xml → $code — EXPRESS→FLASK IS BROKEN. Roll back this step now."
    warn "404 here means the request reached Cloud Run as EXTERNAL; 403 means auth."
    return 1
  fi
}

# check_site proves Express→Flask. That hop is Google-internal and NEVER
# traverses the NAT gateway, so a green /sitemap.xml says nothing about whether
# non-Google egress survived the cutover — the exact traffic the NAT exists for.
# Prove it separately, from the gateway's own counters.
read_nat_sent_bytes() {
  local token start end response
  token="$(gcloud auth print-access-token 2>/dev/null)" || return 1
  read -r start end < <(python3 -c '
import datetime
end = datetime.datetime.now(datetime.timezone.utc)
start = end - datetime.timedelta(minutes=10)
fmt = "%Y-%m-%dT%H:%M:%SZ"
print(start.strftime(fmt), end.strftime(fmt))
')
  response="$(curl -fsS --get \
    -H "Authorization: Bearer $token" \
    --data-urlencode 'filter=metric.type="router.googleapis.com/nat/sent_bytes_count" AND metric.labels.nat_gateway_name="'"$NAT_NAME"'"' \
    --data-urlencode "interval.startTime=$start" \
    --data-urlencode "interval.endTime=$end" \
    --data-urlencode "view=FULL" \
    --data-urlencode "pageSize=1000" \
    "https://monitoring.googleapis.com/v3/projects/$PROJECT_ID/timeSeries")" || return 1
  printf '%s' "$response" | python3 -c '
import json, sys
data = json.load(sys.stdin)
print(sum(int(point["value"].get("int64Value", 0))
          for series in data.get("timeSeries", [])
          for point in series.get("points", [])))
'
}

check_nat_egress() {
  local attempt total
  # Cloud NAT metrics are sampled every 60 seconds and can take up to 180
  # seconds to become visible. Poll for five minutes instead of declaring a
  # healthy, newly-created gateway broken on the first empty read.
  for attempt in 1 2 3 4 5; do
    if ! total="$(read_nat_sent_bytes)"; then
      warn "NAT egress UNPROVEN — could not query router.googleapis.com/nat/sent_bytes_count."
      warn "This is NOT a pass. Confirm the Monitoring API is enabled and the active"
      warn "identity has monitoring.timeSeries.list, or use fresh Datadog telemetry"
      warn "from the NEW $EXPRESS_SERVICE revision as the direct non-Google probe."
      return 1
    fi
    if [[ "$total" -gt 0 ]]; then
      log "NAT '$NAT_NAME' has translated $total bytes — non-Google egress confirmed live."
      return 0
    fi
    if [[ "$attempt" -lt 5 ]]; then
      warn "NAT metrics are still empty (attempt $attempt/5); waiting for ingestion..."
      sleep 60
    fi
  done

  warn "NAT '$NAT_NAME' has translated 0 bytes after five minutes. Non-Google egress is UNPROVEN."
  warn "Check fresh Datadog telemetry from the new revision or roll back egress."
  return 1
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
    # The guard must prove the NAT GATEWAY is usable, not merely that a Router
    # object exists. A Router with no NAT — or a NAT covering only some subnet
    # ranges — satisfies `routers describe` while still leaving Express with no
    # path to any public destination the moment egress flips to all-traffic.
    # That is the whole failure this step is ordered to avoid, so check it.
    if ! gcloud compute routers describe "$ROUTER_NAME" --project="$PROJECT_ID" --region="$REGION" >/dev/null 2>&1; then
      echo "ERROR: no Cloud Router '$ROUTER_NAME'. Run '$0 nat --apply' first, or Express loses all public egress." >&2
      exit 1
    fi
    NAT_JSON="$(gcloud compute routers nats describe "$NAT_NAME" --project="$PROJECT_ID" \
      --router="$ROUTER_NAME" --router-region="$REGION" --format=json 2>/dev/null || true)"
    if [[ -z "$NAT_JSON" ]]; then
      echo "ERROR: Cloud Router '$ROUTER_NAME' exists but has no NAT gateway '$NAT_NAME'." >&2
      echo "       A Router alone performs no translation. Run '$0 nat --apply' first." >&2
      exit 1
    fi
    NAT_SCOPE="$(printf '%s' "$NAT_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("sourceSubnetworkIpRangesToNat",""))')"
    if [[ "$NAT_SCOPE" != "ALL_SUBNETWORKS_ALL_IP_RANGES" ]]; then
      echo "ERROR: NAT '$NAT_NAME' covers '$NAT_SCOPE', not ALL_SUBNETWORKS_ALL_IP_RANGES." >&2
      echo "       The connector's subnet may be uncovered, which severs Express's public egress." >&2
      echo "       Recreate with --nat-all-subnet-ip-ranges, or widen the existing gateway." >&2
      exit 1
    fi
    NAT_IPS="$(printf '%s' "$NAT_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("natIps") or []), d.get("natIpAllocateOption",""))')"
    read -r NAT_IP_COUNT NAT_IP_MODE <<<"$NAT_IPS"
    if [[ "$NAT_IP_MODE" != "AUTO_ONLY" && "$NAT_IP_COUNT" -eq 0 ]]; then
      echo "ERROR: NAT '$NAT_NAME' is MANUAL_ONLY with no external address assigned." >&2
      echo "       It would translate nothing. Assign an address or switch to --auto-allocate-nat-external-ips." >&2
      exit 1
    fi
    log "NAT '$NAT_NAME' verified: scope=$NAT_SCOPE, ip_mode=$NAT_IP_MODE, assigned=$NAT_IP_COUNT"
    run gcloud run services update "$EXPRESS_SERVICE" \
      --project="$PROJECT_ID" --region="$REGION" \
      --vpc-egress=all-traffic --quiet
    check_site || { warn "Roll back with: $0 rollback-egress --apply"; exit 1; }
    # Both must hold. check_site proves the Google-internal hop; check_nat_egress
    # proves the hop that actually depends on the gateway. Passing only the first
    # is how you discover at 3am that every outbound integration is dark.
    check_nat_egress || {
      warn "Express→Flask is healthy but NAT-dependent egress is unproven."
      warn "Do NOT proceed to '$0 ingress' until it is. Roll back with: $0 rollback-egress --apply"
      exit 1
    }
    ;;

  ingress)
    # Restoration, not a new design: this service was created with
    # ingress=internal and was opened to `all` on 2026-03-09T10:20:31Z, which is
    # the exact moment the exposure began.
    # `|| true`: under `set -e`, VAR=$(cmd) takes the substitution's exit status,
    # so a failing gcloud would kill the script silently (stderr is suppressed)
    # instead of reaching the guard below. Failing open here would be the worst
    # outcome of the three — the guard is what stops an ordering mistake from
    # taking the site down.
    EXPRESS_EGRESS="$(gcloud run services describe "$EXPRESS_SERVICE" --project="$PROJECT_ID" \
      --region="$REGION" --format='value(spec.template.metadata.annotations["run.googleapis.com/vpc-access-egress"])' 2>/dev/null || true)"
    if [[ "$EXPRESS_EGRESS" != "all-traffic" ]]; then
      echo "ERROR: $EXPRESS_SERVICE egress is '$EXPRESS_EGRESS', not 'all-traffic'." >&2
      echo "       Closing Flask's ingress now would refuse Express's calls as EXTERNAL and take the site down." >&2
      exit 1
    fi
    log "Closing $FLASK_SERVICE ingress to '$FLASK_INGRESS' (override with FLASK_INGRESS=...)."
    run gcloud run services update "$FLASK_SERVICE" \
      --project="$PROJECT_ID" --region="$REGION" \
      --ingress="$FLASK_INGRESS" --quiet
    check_site || { warn "Roll back with: $0 rollback-ingress --apply"; exit 1; }
    log "Run ./scripts/gcloud/kan170_verify.sh — anonymous GET / on Flask should now fail."
    log ""
    log "STEP 6 — make this the DECLARED steady state, and only now:"
    log "  cloudbuild.yaml does not currently reassert Express's all-traffic egress or"
    log "  Flask's restricted ingress, so both are console state that the next deploy can"
    log "  silently revert. Add them to the deploy steps AFTER this cutover is verified."
    log "  Adding them BEFORE the NAT exists is actively dangerous: the next deploy would"
    log "  move Express to all-traffic with nothing to translate its egress."
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
