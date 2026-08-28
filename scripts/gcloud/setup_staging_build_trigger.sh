#!/usr/bin/env bash
# setup_staging_build_trigger.sh — the repo record for the staging Cloud Build
# trigger (KAN-250).
#
# WHY THIS FILE EXISTS
#
# The production deploy fires from a Cloud Build trigger that was configured in
# the GCP console and exists nowhere in this repository. Sprint 9's R2 names the
# failure that creates: "the GCP trigger is config with no repo record, so it
# passes vacuously". A reviewer cannot read a console. A checklist item that says
# "trigger exists" is unfalsifiable from a checkout, so it gets ticked and the
# claim rots.
#
# This script is the record AND the mechanism: the desired trigger is the
# constants below, `--verify` reads the live trigger and diffs it against them,
# and the default mode reconciles the live trigger to them. Drift is therefore
# detectable by running one command, not by remembering to look.
#
# TARGET TOPOLOGY (symmetric with production)
#
#   git tag staging-v0.5.0 && git push  ->  trigger ^staging-v.*                -> cloudbuild.staging.yaml
#   git tag v0.5.0         && git push  ->  trigger ^v[0-9]+\.[0-9]+\.[0-9]+$   -> cloudbuild.yaml
#
# The two patterns cannot collide: production's is anchored and digits-only, so
# it can never match a `staging-`-prefixed tag.
#
# USAGE
#
#   ./scripts/gcloud/setup_staging_build_trigger.sh --verify    # read-only, exit 1 on drift
#   ./scripts/gcloud/setup_staging_build_trigger.sh --dry-run   # print the gcloud command
#   ./scripts/gcloud/setup_staging_build_trigger.sh             # create or update (idempotent)
#   ./scripts/gcloud/setup_staging_build_trigger.sh --preflight # check prerequisites only
#
# Overridable via env: PROJECT_ID, REGION, TRIGGER_NAME, TAG_PATTERN,
# BUILD_CONFIG, REPO_OWNER, REPO_NAME, TRIGGER_SERVICE_ACCOUNT,
# REPO_RESOURCE (2nd-gen Cloud Build repositories resource path).

set -uo pipefail

# ── Desired trigger configuration — THIS IS THE RECORD ──────────────────────
PROJECT_ID="${PROJECT_ID:-gen-lang-client-0491022701}"
REGION="${REGION:-us-central1}"
TRIGGER_NAME="${TRIGGER_NAME:-staging-tag-deploy}"
TAG_PATTERN="${TAG_PATTERN:-^staging-v.*}"
BUILD_CONFIG="${BUILD_CONFIG:-cloudbuild.staging.yaml}"
REPO_OWNER="${REPO_OWNER:-adamtasteslikegood}"
REPO_NAME="${REPO_NAME:-tasteslikegoodtheangularsvegancookbook}"
DESCRIPTION="Staging deploy on staging-v* tag (KAN-249/KAN-250)"

# Optional 2nd-gen repository resource, e.g.
#   projects/P/locations/us-central1/connections/C/repositories/R
# When set, the trigger is created against the 2nd-gen connection instead of the
# 1st-gen GitHub App (--repo-owner/--repo-name).
REPO_RESOURCE="${REPO_RESOURCE:-}"

# Build identity. Empty = Cloud Build's legacy default compute service account.
#
# Prefer a dedicated, narrowly-scoped SA. See docs/deployment/
# STAGING_CLOUD_BUILD_TRIGGER.md § "Build identity" — the default compute SA is
# shared by all three staging workloads, so widening it to deploy also widens
# what a compromised build can impersonate. A user-managed build SA REQUIRES
# `options.logging: CLOUD_LOGGING_ONLY`, which cloudbuild.staging.yaml already
# sets; without it the build fails at submit with a logging-bucket error.
TRIGGER_SERVICE_ACCOUNT="${TRIGGER_SERVICE_ACCOUNT:-}"

MODE="apply"
case "${1:-}" in
  --verify) MODE="verify" ;;
  --dry-run) MODE="dry-run" ;;
  --preflight) MODE="preflight" ;;
  --help | -h)
    sed -n '2,40p' "$0"
    exit 0
    ;;
  "") ;;
  *)
    echo "ERROR: unknown argument '$1' (expected --verify, --dry-run, --preflight)" >&2
    exit 2
    ;;
esac

log() { printf '\033[36m[staging-trigger]\033[0m %s\n' "$*"; }
ok() { printf '\033[32m[staging-trigger] OK:\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[staging-trigger] WARN:\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[31m[staging-trigger] FAIL:\033[0m %s\n' "$*" >&2; }

# --dry-run is deliberately credential-free: reading the exact command this
# script would run is the cheapest way to review the trigger config, and it must
# work in CI, in a review, and on a laptop with no gcloud login.
if [[ "$MODE" != "dry-run" ]]; then
  command -v gcloud >/dev/null 2>&1 || {
    fail "gcloud not found in PATH."
    exit 1
  }

  # Auth is checked with a real token fetch, not `gcloud auth list`: a listed
  # account whose refresh token has expired still prints as ACTIVE and then
  # fails on the first API call with a reauth prompt that cannot be answered
  # from a non-interactive session.
  if ! gcloud auth print-access-token >/dev/null 2>&1; then
    fail "gcloud has no usable credentials (a listed account can still need reauth)."
    echo "      Run: gcloud auth login" >&2
    echo "      (--dry-run works without credentials.)" >&2
    exit 1
  fi
fi

# ── Preflight ───────────────────────────────────────────────────────────────
# Each check fails with a named cause. A trigger that cannot fetch source, or
# cannot push to the registry, fails deep inside a build with an opaque error;
# naming the missing prerequisite here is the whole point.

preflight() {
  local problems=0

  log "Project: ${PROJECT_ID}   Region: ${REGION}"

  # 1. Cloud Build API enabled.
  if gcloud services list --enabled --project="$PROJECT_ID" \
    --filter='config.name:cloudbuild.googleapis.com' --format='value(config.name)' \
    2>/dev/null | grep -q cloudbuild; then
    ok "cloudbuild.googleapis.com is enabled"
  else
    fail "cloudbuild.googleapis.com is NOT enabled in ${PROJECT_ID}."
    echo "      gcloud services enable cloudbuild.googleapis.com --project=${PROJECT_ID}" >&2
    problems=$((problems + 1))
  fi

  # 2. A GitHub connection must exist IN THE STAGING PROJECT. Production's
  #    connection lives in comdottasteslikegood and does not carry over —
  #    connections are per-project. Cloud Build has never run in the staging
  #    project, so assume this is missing until the check says otherwise.
  if [[ -n "$REPO_RESOURCE" ]]; then
    if gcloud builds repositories describe "${REPO_RESOURCE##*/}" \
      --connection="$(printf '%s' "$REPO_RESOURCE" | sed -E 's|.*/connections/([^/]+)/repositories/.*|\1|')" \
      --region="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
      ok "2nd-gen repository resource reachable: ${REPO_RESOURCE}"
    else
      fail "REPO_RESOURCE is set but not readable: ${REPO_RESOURCE}"
      problems=$((problems + 1))
    fi
  else
    local conns
    conns="$(gcloud builds connections list --region="$REGION" --project="$PROJECT_ID" \
      --format='value(name)' 2>/dev/null || true)"
    if [[ -n "$conns" ]]; then
      ok "Cloud Build host connection(s) present: $(tr '\n' ' ' <<<"$conns")"
      log "  (1st-gen GitHub App triggers do not use these; see below)"
    else
      warn "No 2nd-gen Cloud Build connections in ${PROJECT_ID}/${REGION}."
      warn "This is only a problem if the GitHub App (1st-gen) is also not installed"
      warn "for ${REPO_OWNER}/${REPO_NAME} on this project. There is no read-only API"
      warn "that proves the 1st-gen install; the create call below is the test."
      warn "If create fails with a repository-not-found or permission error, install the"
      warn "Cloud Build GitHub App on ${PROJECT_ID} via the console, or connect a 2nd-gen"
      warn "host connection and re-run with REPO_RESOURCE set."
    fi
  fi

  # 3. Artifact Registry repo the build pushes to.
  if gcloud artifacts repositories describe vegangenius \
    --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
    ok "Artifact Registry repo 'vegangenius' exists"
  else
    fail "Artifact Registry repo 'vegangenius' missing in ${PROJECT_ID}/${REGION}."
    echo "      The build's push steps will fail. Create it, or point _IMAGE_REGISTRY elsewhere." >&2
    problems=$((problems + 1))
  fi

  # 4. Cloud SQL instance the migrate Job and Flask service attach to.
  if gcloud sql instances describe vegangenius-staging-db --project="$PROJECT_ID" \
    >/dev/null 2>&1; then
    ok "Cloud SQL instance 'vegangenius-staging-db' exists"
  else
    warn "Cloud SQL instance 'vegangenius-staging-db' not readable (missing, or you lack sqladmin.viewer)."
  fi

  # 5. The staging secrets the build mounts. A missing secret surfaces as a
  #    Cloud Run deploy failure several minutes in, which reads like a code
  #    problem; name it here instead.
  local secret missing_secrets=0
  for secret in GOOGLE_API_KEY_STAGING FLASK_SECRET_KEY_STAGING \
    GOOGLE_CLIENT_ID_STAGING GOOGLE_CLIENT_SECRET_STAGING DATABASE_URL_STAGING; do
    if ! gcloud secrets describe "$secret" --project="$PROJECT_ID" >/dev/null 2>&1; then
      fail "Secret '${secret}' not found in ${PROJECT_ID}."
      missing_secrets=$((missing_secrets + 1))
    fi
  done
  if [[ "$missing_secrets" -eq 0 ]]; then
    ok "All five *_STAGING secrets present"
  else
    problems=$((problems + missing_secrets))
  fi

  # 6. Build identity IAM. Roles are reported, never granted: project-level IAM
  #    in the staging project is Adam's call, and a script that silently widens
  #    a service account is exactly the kind of change nobody reviews.
  local sa
  if [[ -n "$TRIGGER_SERVICE_ACCOUNT" ]]; then
    sa="${TRIGGER_SERVICE_ACCOUNT##*/}"
  else
    local pnum
    pnum="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)' 2>/dev/null || true)"
    sa="${pnum:-UNKNOWN}-compute@developer.gserviceaccount.com"
  fi
  log "Build identity: ${sa}"
  local held
  held="$(gcloud projects get-iam-policy "$PROJECT_ID" --flatten='bindings[].members' \
    --filter="bindings.members:serviceAccount:${sa}" --format='value(bindings.role)' \
    2>/dev/null | sort -u | tr '\n' ' ' || true)"
  if [[ -n "$held" ]]; then
    log "  project-level roles: ${held}"
  else
    warn "  could not read the IAM policy (needs resourcemanager.projects.getIamPolicy)."
  fi
  log "  Required for this build: see docs/deployment/STAGING_CLOUD_BUILD_TRIGGER.md"
  log "  § 'Build identity'. This script never grants roles."

  return "$problems"
}

# ── Read the live trigger ───────────────────────────────────────────────────

read_live() {
  gcloud builds triggers describe "$TRIGGER_NAME" \
    --region="$REGION" --project="$PROJECT_ID" --format=json 2>/dev/null
}

verify() {
  command -v jq >/dev/null 2>&1 || {
    fail "jq not found in PATH; --verify parses the trigger JSON with it."
    return 1
  }
  local live
  live="$(read_live)"
  if [[ -z "$live" ]]; then
    fail "Trigger '${TRIGGER_NAME}' does not exist in ${PROJECT_ID}/${REGION}."
    echo "      Run this script with no arguments to create it." >&2
    return 1
  fi

  local drift=0
  local live_pattern live_config live_disabled live_sa
  live_pattern="$(jq -r '.github.push.tag // .sourceToBuild.ref // "MISSING"' <<<"$live")"
  live_config="$(jq -r '.filename // "MISSING"' <<<"$live")"
  live_disabled="$(jq -r '.disabled // false' <<<"$live")"
  live_sa="$(jq -r '.serviceAccount // ""' <<<"$live")"

  echo "=== Live trigger: ${TRIGGER_NAME} (${PROJECT_ID}/${REGION}) ==="
  printf '  tag pattern : %s\n' "$live_pattern"
  printf '  build config: %s\n' "$live_config"
  printf '  disabled    : %s\n' "$live_disabled"
  printf '  service acct: %s\n' "${live_sa:-<default compute SA>}"
  echo ""

  [[ "$live_pattern" == "$TAG_PATTERN" ]] ||
    { fail "tag pattern drift: live='${live_pattern}' expected='${TAG_PATTERN}'"; drift=1; }
  [[ "$live_config" == "$BUILD_CONFIG" ]] ||
    { fail "build config drift: live='${live_config}' expected='${BUILD_CONFIG}'"; drift=1; }
  [[ "$live_disabled" == "false" ]] ||
    { fail "trigger is DISABLED — a staging-v* tag will silently deploy nothing"; drift=1; }

  if [[ "$drift" -eq 0 ]]; then
    ok "Live trigger matches the record in this file."
  fi
  return "$drift"
}

# ── Build the create/update command ─────────────────────────────────────────

build_args() {
  local -n out="$1"
  out=(builds triggers "$2" github)
  # `create` takes --name; `update` takes the trigger as a POSITIONAL and
  # rejects --name. Verified against `gcloud builds triggers {create,update}
  # github --help` (gcloud 2026.08). Getting this wrong fails at argument
  # parsing, which is cheap — but only if someone runs it, so it is encoded
  # here rather than left to the caller.
  if [[ "$2" == "update" ]]; then
    out+=("$TRIGGER_NAME")
  else
    out+=("--name=${TRIGGER_NAME}")
  fi
  out+=(
    "--region=${REGION}"
    "--project=${PROJECT_ID}"
    "--tag-pattern=${TAG_PATTERN}"
    "--build-config=${BUILD_CONFIG}"
    "--description=${DESCRIPTION}"
  )
  if [[ -n "$REPO_RESOURCE" ]]; then
    out+=("--repository=${REPO_RESOURCE}")
  else
    out+=("--repo-owner=${REPO_OWNER}" "--repo-name=${REPO_NAME}")
  fi
  if [[ -n "$TRIGGER_SERVICE_ACCOUNT" ]]; then
    out+=("--service-account=${TRIGGER_SERVICE_ACCOUNT}")
  fi
}

print_command() {
  local verb="$1" args
  build_args args "$verb"
  printf 'gcloud'
  printf ' %q' "${args[@]}"
  printf '\n'
}

case "$MODE" in
  preflight)
    preflight
    exit $?
    ;;
  verify)
    verify
    exit $?
    ;;
  dry-run)
    echo "# create (trigger absent):"
    print_command create
    echo ""
    echo "# update (trigger present):"
    print_command update
    exit 0
    ;;
esac

# ── Apply ───────────────────────────────────────────────────────────────────

preflight || warn "Preflight reported $? problem(s); continuing so the create call names the real failure."

if read_live >/dev/null 2>&1 && [[ -n "$(read_live)" ]]; then
  log "Trigger '${TRIGGER_NAME}' exists — updating to match this file."
  verb=update
else
  log "Trigger '${TRIGGER_NAME}' absent — creating."
  verb=create
fi

build_args APPLY_ARGS "$verb"
log "Running: $(print_command "$verb")"
if ! gcloud "${APPLY_ARGS[@]}"; then
  fail "gcloud builds triggers ${verb} failed."
  echo "      A 'repository not found' or permission error here usually means the" >&2
  echo "      Cloud Build GitHub connection does not exist in ${PROJECT_ID}." >&2
  echo "      See docs/deployment/STAGING_CLOUD_BUILD_TRIGGER.md § 'Repo connection'." >&2
  exit 1
fi

echo ""
verify
