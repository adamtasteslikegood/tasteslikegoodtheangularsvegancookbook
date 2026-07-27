#!/usr/bin/env bash
# KAN-170 Path A — authenticate Express→Flask with a Google-signed ID token,
# then re-enable Cloud Run's invoker IAM check on flask-backend.
#
# Path A is the actual authentication fix: it removes the
# run.googleapis.com/invoker-iam-disabled=true annotation, which is what made
# cloudbuild.yaml's --no-allow-unauthenticated inert for ~4.6 months. Path B
# (network isolation) closes reachability but leaves that annotation in place,
# so it cannot substitute for this.
#
# ORDER IS THE ENTIRE SAFETY MARGIN. `prepare` is additive and changes no
# traffic behaviour; the Express image carrying the token must be deployed AND
# serving before `cutover` runs. Flipping the check first returns 403 to Express
# and takes down every proxied route — /api/*, /r/*, /browse, /sitemap.xml and
# /static/* — which is the whole public site, not just the API.
#
#   1. ./scripts/gcloud/kan170_path_a.sh prepare --apply
#   2. deploy Express with the server/flask-auth.ts token path
#   3. ./scripts/gcloud/kan170_verify.sh          (site healthy, token arriving)
#   4. ./scripts/gcloud/kan170_path_a.sh cutover --apply
#   5. ./scripts/gcloud/kan170_verify.sh          (anon 403, site 200)
#      rollback in seconds:  ./scripts/gcloud/kan170_path_a.sh rollback --apply
#
# Dry run is the DEFAULT. Nothing mutates without --apply.
#
# Required env vars (with sensible defaults):
#   PROJECT_ID       — GCP project (default: comdottasteslikegood)
#   REGION           — Cloud Run region (default: us-central1)
#   FLASK_SERVICE    — Flask service name (default: flask-backend)
#   EXPRESS_SERVICE  — Express service name (default: express-frontend)
#
# Usage:
#   ./scripts/gcloud/kan170_path_a.sh prepare [--apply]
#   ./scripts/gcloud/kan170_path_a.sh cutover [--apply]
#   ./scripts/gcloud/kan170_path_a.sh rollback [--apply]

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-comdottasteslikegood}"
REGION="${REGION:-us-central1}"
FLASK_SERVICE="${FLASK_SERVICE:-flask-backend}"
EXPRESS_SERVICE="${EXPRESS_SERVICE:-express-frontend}"

APPLY=0
COMMAND="${1:-}"
shift || true
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    *) echo "ERROR: unknown argument '$arg'" >&2; exit 1 ;;
  esac
done

log() { printf '\033[36m[kan170-path-a]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[kan170-path-a] WARN:\033[0m %s\n' "$*" >&2; }

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 not found in PATH"; exit 1; }
}
require gcloud

# Run a mutating gcloud command, or print it in dry-run mode.
run() {
  if [[ "$APPLY" == "1" ]]; then
    log "RUN: $*"
    "$@"
  else
    log "DRY RUN: $*"
  fi
}

describe() {
  gcloud run services describe "$1" --project="$PROJECT_ID" --region="$REGION" --format="$2" 2>/dev/null
}

# gcloud exposes the annotation as --[no-]invoker-iam-check. Older gcloud
# releases lack it entirely, and silently doing nothing here would look like a
# successful cutover while the service stayed wide open.
assert_invoker_flag() {
  if ! gcloud run services update --help 2>/dev/null | grep -q -- '--invoker-iam-check'; then
    echo "ERROR: this gcloud lacks --invoker-iam-check. Run 'gcloud components update'." >&2
    exit 1
  fi
}

case "$COMMAND" in
  prepare)
    # ── A. Grant the Express runtime SA permission to invoke Flask ──────────
    # Resolved rather than hardcoded. NOTE: both services currently run as the
    # SAME default compute SA, so this grant is coarser than its name suggests
    # — it also lets flask-backend invoke itself and confers the capability on
    # anything else running as that SA. Splitting the identities is tracked
    # separately; it is deliberately NOT bundled into a security cutover.
    SA="$(describe "$EXPRESS_SERVICE" 'value(spec.template.spec.serviceAccountName)')"
    if [[ -z "$SA" ]]; then
      echo "ERROR: could not resolve the runtime SA for $EXPRESS_SERVICE" >&2
      exit 1
    fi
    FLASK_SA="$(describe "$FLASK_SERVICE" 'value(spec.template.spec.serviceAccountName)')"
    log "Express runtime SA: $SA"
    [[ "$SA" == "$FLASK_SA" ]] && warn "$FLASK_SERVICE runs as the SAME SA — the grant is project-wide in effect"

    # Additive and DRS-legal: a same-customer service account, not allUsers.
    # (Domain Restricted Sharing makes allUsers unaddable in this project, which
    # is exactly why the invoker-iam-disabled annotation was used instead.)
    run gcloud run services add-iam-policy-binding "$FLASK_SERVICE" \
      --project="$PROJECT_ID" --region="$REGION" \
      --member="serviceAccount:${SA}" --role="roles/run.invoker" --quiet

    # ── B. Make the Pub/Sub push audiences explicitly valid ────────────────
    # Both push subscriptions set no explicit audience, so Pub/Sub signs
    # aud = the full push endpoint URL *including* the path
    # (…/api/worker/recipe). Cloud Run's docs say the audience is the service
    # URL and do not confirm a path-bearing aud is accepted — and the check has
    # never run here, because it is disabled. If Cloud Run rejects it, every
    # push 403s, retries 5x, and async recipe/image generation drains into the
    # DLQ: a silent, user-visible outage with recipes stuck "generating".
    #
    # Registering those URLs as custom audiences removes the question entirely.
    # It is purely additive — "The default Google-generated URL always remains
    # as an accepted audience value" — so Express's root-origin token keeps
    # working unchanged.
    #
    # Do NOT instead repoint Pub/Sub at the bare service URL: Flask verifies
    # audience=request.base_url (Backend/blueprints/worker_api_bp.py), which is
    # the path-bearing form, so that "fix" breaks the app-side check instead.
    AUDIENCES="$(gcloud pubsub subscriptions list --project="$PROJECT_ID" \
      --format='value(pushConfig.pushEndpoint)' 2>/dev/null \
      | grep -F "$(describe "$FLASK_SERVICE" 'value(status.url)' | sed 's|https://||')" || true)"

    if [[ -z "$AUDIENCES" ]]; then
      warn "no Pub/Sub push subscriptions found targeting $FLASK_SERVICE — skipping custom audiences"
    else
      JOINED="$(echo "$AUDIENCES" | paste -sd, -)"
      log "Registering push endpoints as custom audiences: $JOINED"
      run gcloud run services update "$FLASK_SERVICE" \
        --project="$PROJECT_ID" --region="$REGION" \
        --add-custom-audiences="$JOINED" --quiet
    fi

    log "prepare complete — both changes are additive and change no traffic behaviour."
    log "Next: deploy Express with the token path, verify, THEN run 'cutover'."
    ;;

  cutover)
    assert_invoker_flag
    # The one irreversible-feeling moment. By now the token path must be live
    # and proven, because until this runs Flask accepts anonymous calls and a
    # broken token path is invisible — a green site proves nothing about it.
    warn "This closes the hole. If Express is not already sending a valid ID token, the site goes down."
    warn "Rollback is one command: $0 rollback --apply"
    run gcloud run services update "$FLASK_SERVICE" \
      --project="$PROJECT_ID" --region="$REGION" \
      --invoker-iam-check --quiet
    log "cutover issued — now run ./scripts/gcloud/kan170_verify.sh (expect anon 403, site 200)."
    ;;

  rollback)
    assert_invoker_flag
    run gcloud run services update "$FLASK_SERVICE" \
      --project="$PROJECT_ID" --region="$REGION" \
      --no-invoker-iam-check --quiet
    warn "Rolled back: $FLASK_SERVICE is anonymously invokable again (KAN-170 exposure reopened)."
    ;;

  *)
    echo "Usage: $0 {prepare|cutover|rollback} [--apply]" >&2
    exit 1
    ;;
esac

if [[ "$APPLY" != "1" ]]; then
  echo
  log "mode: DRY RUN — nothing was changed. Re-run with --apply to execute."
fi
