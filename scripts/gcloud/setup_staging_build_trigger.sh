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
#
# REQUIREMENTS
#
#   bash >= 4.3  — build_args() uses a nameref (`local -n`), added in 4.3.
#                  macOS ships bash 3.2 as /bin/bash and will stay there for
#                  licensing reasons, so `/bin/bash setup_staging_build_trigger.sh`
#                  on a Mac fails with `local: -n: invalid option` on the first
#                  build_args call — which both --dry-run and the default apply
#                  mode reach. Run it under Homebrew bash (`brew install bash`,
#                  then /opt/homebrew/bin/bash) or from Linux/Cloud Shell.
#                  --verify and --preflight do not call build_args and work
#                  under 3.2.
#   gcloud       — all modes.
#   jq           — --verify and apply (apply calls verify at the end). Not
#                  needed for --dry-run or --preflight.

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
    # Print the header block: every line from 2 up to the first line that is
    # not a comment. Derived rather than a hardcoded range — the previous
    # `sed -n '2,36p'` had to be corrected once when the header grew, and then
    # silently truncated the REQUIREMENTS block the next time it grew again.
    # A range that must be re-tuned whenever the file above it changes is a
    # latent bug, not a constant.
    awk 'NR == 1 { next } /^#/ { print; next } { exit }' "$0"
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

# Tempfile tracker cleaned up on every exit path, including an interrupt
# between mktemp and read_live()'s normal rm -f branches. Signal handlers must
# also terminate: a cleanup-only INT/TERM trap overrides Bash's default action
# and would let an interrupted apply resume after gcloud returns.
_STAGING_TRIGGER_TMPFILE=""
cleanup_staging_trigger_tmpfile() {
  [[ -n "$_STAGING_TRIGGER_TMPFILE" ]] && rm -f -- "$_STAGING_TRIGGER_TMPFILE"
  _STAGING_TRIGGER_TMPFILE=""
}
trap cleanup_staging_trigger_tmpfile EXIT
trap 'cleanup_staging_trigger_tmpfile; exit 130' INT
trap 'cleanup_staging_trigger_tmpfile; exit 143' TERM

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

  # jq is used by verify (and apply, which calls verify at the end). Fail early
  # here rather than after a successful create — a green create followed by a
  # jq-missing verify would exit 1 and read as a failed run.
  if [[ "$MODE" == "verify" || "$MODE" == "apply" ]]; then
    command -v jq >/dev/null 2>&1 || {
      fail "jq not found in PATH (required to parse the trigger JSON)."
      exit 1
    }
  fi
fi

# ── Preflight ───────────────────────────────────────────────────────────────
# Each check fails with a named cause. A trigger that cannot fetch source, or
# cannot push to the registry, fails deep inside a build with an opaque error;
# naming the missing prerequisite here is the whole point.

preflight() {
  local problems=0

  log "Project: ${PROJECT_ID}   Region: ${REGION}"

  # 0. BUILD_CONFIG must exist somewhere the tag build will find it. gcloud
  #    accepts any string here; the file's existence is checked at build time by
  #    Cloud Build, which reports "config file not found" from deep inside a
  #    build log. Catch the obvious form (BUILD_CONFIG missing from the current
  #    tree) here — this is not authoritative (the build reads the TAG, not
  #    HEAD), but a BUILD_CONFIG that has never been committed to any branch is
  #    almost certainly a rename typo or a merge-order mistake (KAN-249 landing
  #    after this PR), and both fail the same way.
  local repo_root config_path
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -n "$repo_root" ]]; then
    config_path="${repo_root}/${BUILD_CONFIG}"
    if [[ -f "$config_path" ]]; then
      ok "BUILD_CONFIG '${BUILD_CONFIG}' present in the current tree"
    elif git -C "$repo_root" cat-file -e "HEAD:${BUILD_CONFIG}" 2>/dev/null; then
      ok "BUILD_CONFIG '${BUILD_CONFIG}' present in HEAD (not working tree)"
    else
      fail "BUILD_CONFIG '${BUILD_CONFIG}' not found in ${repo_root} or HEAD."
      echo "      The trigger will be created, but the first staging-v* tag push" >&2
      echo "      will fail with 'config file not found' in the Cloud Build log." >&2
      echo "      If this depends on KAN-249 landing first, merge that PR before" >&2
      echo "      pushing an acceptance tag." >&2
      problems=$((problems + 1))
    fi
  else
    warn "not a git checkout; skipped BUILD_CONFIG existence check."
  fi

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
  local sa=""
  if [[ -n "$TRIGGER_SERVICE_ACCOUNT" ]]; then
    sa="${TRIGGER_SERVICE_ACCOUNT##*/}"
  else
    local pnum
    pnum="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)' 2>/dev/null || true)"
    if [[ -n "$pnum" ]]; then
      sa="${pnum}-compute@developer.gserviceaccount.com"
    fi
  fi
  if [[ -n "$sa" ]]; then
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
  else
    warn "Build identity: could not resolve (projects describe failed — needs resourcemanager.projects.get)."
  fi
  log "  Required for this build: see docs/deployment/STAGING_CLOUD_BUILD_TRIGGER.md"
  log "  § 'Build identity'. This script never grants roles."

  return "$problems"
}

# ── Read the live trigger ───────────────────────────────────────────────────

read_live() {
  # Capture stdout and stderr separately so we can tell "trigger absent"
  # (gcloud NOT_FOUND, expected on first apply) apart from every other failure
  # mode (expired token between the auth check and now, region typo, quota,
  # transient network error). Swallowing stderr wholesale would let the caller
  # conclude "create it" and then get a misleading ALREADY_EXISTS or auth error.
  # Anchor the match on gcloud's structured `ERROR: ... NOT_FOUND` code so
  # compound messages like "Project X was not found or the user lacks permission"
  # (wrong PROJECT_ID or API disabled) don't collapse into "trigger absent" and
  # trip the create path under a misleading "creating..." log line.
  local err_file out rc
  err_file="$(mktemp)"
  _STAGING_TRIGGER_TMPFILE="$err_file"
  out="$(gcloud builds triggers describe "$TRIGGER_NAME" \
    --region="$REGION" --project="$PROJECT_ID" --format=json 2>"$err_file")"
  rc=$?
  if [[ $rc -eq 0 ]]; then
    rm -f "$err_file"
    _STAGING_TRIGGER_TMPFILE=""
    printf '%s' "$out"
    return 0
  fi
  # Match the trigger-specific `NOT_FOUND: Requested entity was not found`
  # phrasing, not just any `^ERROR:.*NOT_FOUND` — a bad PROJECT_ID surfaces as
  # `NOT_FOUND: Resource 'projects/...' was not found`, which we want to
  # propagate as a real failure rather than misclassify as "trigger absent".
  if grep -qE '^ERROR:.*NOT_FOUND: Requested entity' "$err_file"; then
    rm -f "$err_file"
    _STAGING_TRIGGER_TMPFILE=""
    return 0
  fi
  cat "$err_file" >&2
  rm -f "$err_file"
  _STAGING_TRIGGER_TMPFILE=""
  return "$rc"
}

verify() {
  command -v jq >/dev/null 2>&1 || {
    fail "jq not found in PATH; --verify parses the trigger JSON with it."
    return 1
  }
  local live
  if ! live="$(read_live)"; then
    fail "Could not read trigger '${TRIGGER_NAME}' — see gcloud error above."
    return 1
  fi
  if [[ -z "$live" ]]; then
    fail "Trigger '${TRIGGER_NAME}' does not exist in ${PROJECT_ID}/${REGION}."
    echo "      Run this script with no arguments to create it." >&2
    return 1
  fi

  local drift=0
  local live_pattern live_config live_disabled live_sa
  # 1st-gen GitHub App triggers store the pattern under .github.push.tag; 2nd-gen
  # Cloud Build repository triggers store it under .repositoryEventConfig.push.tag.
  # `.sourceToBuild.ref` is for MANUAL triggers, not tag pushes — the fallback
  # emits the live trigger's top-level keys so an unrecognised shape names the
  # actual event config (e.g. `github.pullRequest`, `pubsubConfig`, `webhookConfig`)
  # instead of the opaque literal "MISSING", pointing the operator at which jq
  # path to add or which trigger-shape mistake to undo.
  live_pattern="$(jq -r '.github.push.tag // .repositoryEventConfig.push.tag // .sourceToBuild.ref // ("MISSING (unrecognised event shape; top-level keys: " + ([keys[] | select(. != "createTime" and . != "id" and . != "name" and . != "resourceName" and . != "description" and . != "filename" and . != "disabled" and . != "serviceAccount" and . != "tags" and . != "substitutions")] | join(",")) + ")")' <<<"$live")"
  live_config="$(jq -r '.filename // "MISSING"' <<<"$live")"
  live_disabled="$(jq -r '.disabled // false' <<<"$live")"
  live_sa="$(jq -r '.serviceAccount // ""' <<<"$live")"

  # Compare on the bare email — gcloud's API returns the full resource path
  # (`projects/*/serviceAccounts/<email>`) even when the operator set the env
  # var to a bare email (gcloud's usual convention). Both forms are legal input
  # to `--service-account=`; normalising both sides here keeps the drift check
  # from tripping on a purely cosmetic shape difference.
  #
  # Additionally: an empty TRIGGER_SERVICE_ACCOUNT and an empty live
  # `.serviceAccount` both mean "Cloud Build's legacy default compute SA"; a
  # console-created trigger that explicitly picked that SA stores its email,
  # while a CLI create that omits `--service-account` leaves the field unset.
  # Both are the same identity, so resolve the compute SA email once and
  # substitute it on either side that is empty — otherwise verify() would
  # false-positive drift against a semantically identical trigger. Mirror
  # the preflight resolution above.
  local expected_sa live_sa_email default_sa=""
  if [[ -z "$TRIGGER_SERVICE_ACCOUNT" || -z "$live_sa" ]]; then
    local pnum
    pnum="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)' 2>/dev/null || true)"
    [[ -n "$pnum" ]] && default_sa="${pnum}-compute@developer.gserviceaccount.com"
  fi
  expected_sa="${TRIGGER_SERVICE_ACCOUNT##*/}"
  [[ -z "$expected_sa" ]] && expected_sa="$default_sa"
  live_sa_email="${live_sa##*/}"
  [[ -z "$live_sa_email" ]] && live_sa_email="$default_sa"

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
  # SA drift check. Silently accepting a widened build identity would defeat the
  # whole security posture the docs argue for — the whole point of § "Build
  # identity" is that this SA is narrower than the default compute SA, so an
  # unnoticed reversion is exactly what --verify must catch.
  [[ "$live_sa_email" == "$expected_sa" ]] ||
    { fail "service account drift: live='${live_sa:-<default compute SA>}' expected='${TRIGGER_SERVICE_ACCOUNT:-<default compute SA>}' (set TRIGGER_SERVICE_ACCOUNT to match, or update the live trigger)"; drift=1; }

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

# One read_live call, not two — a describe against a missing trigger is cheap
# but not free (a round trip and an error log), and calling twice risks the two
# reads seeing different states. Distinguish "trigger absent" (empty stdout,
# exit 0) from any other gcloud failure so we don't misdiagnose an auth or
# region error as "create it".
if ! LIVE_JSON="$(read_live)"; then
  fail "Could not query trigger '${TRIGGER_NAME}' — see gcloud error above."
  exit 1
fi
if [[ -n "$LIVE_JSON" ]]; then
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
