#!/usr/bin/env bash
# local-generation.sh — run the full recipe-generation pipeline locally
# against the Pub/Sub emulator, with the dedicated staging Gemini key.
#
# Why: deployed staging has no Pub/Sub (GCP_PROJECT_ID is empty, so
# /api/generate fails at publish by design — KAN-225 tracks stubs vs a
# budget-capped key). The publish path honors PUBSUB_EMULATOR_HOST
# (Backend/services/pubsub_service.py), so the entire async pipeline —
# POST /api/generate → publish → push subscription → /api/worker/recipe →
# Gemini — runs on this machine with zero cloud infrastructure changes and
# nothing public. The only real external call is Gemini itself.
#
# The emulator runs in Docker (the gcloud pubsub-emulator component needs a
# JVM; the official emulators image avoids that). It publishes its port the
# normal way (-p) and reaches Flask back through host.docker.internal
# (mapped to the bridge gateway via --add-host=...:host-gateway) — NOT
# --network=host, which some environments block; Flask's dev server binds
# 0.0.0.0 (Backend/app.py), so the bridge gateway reaches it.
#
# Usage:
#   ./scripts/staging/local-generation.sh                  # sqlite (Backend default)
#   ./scripts/staging/local-generation.sh --staging-db     # CloudSQL staging Postgres (needs Auth Proxy — see below)
#
# Then in another terminal: npm run dev  (SPA on :3000, proxies /api → :5000)
# or curl:  curl -X POST http://localhost:5000/api/generate \
#             -H 'Content-Type: application/json' \
#             -d '{"prompt": "a cozy vegan mushroom stew for winter"}'
#
# API key resolution (first match wins):
#   1. GOOGLE_API_KEY in the environment (use GOOGLE_API_KEY=dummy to test
#      the pipeline plumbing without a real key — the worker will receive
#      the push and fail only at the Gemini call)
#   2. Secret GOOGLE_API_KEY_STAGING in the staging project
#
# Database resolution:
#   --staging-db      → Secret DATABASE_URL_STAGING (writes rows to the
#                       CloudSQL staging DB — that's the point, but know it).
#                       The secret's value is a Cloud SQL Auth Proxy Unix-socket
#                       URL (host=/cloudsql/PROJECT:REGION:INSTANCE). That
#                       socket only exists on the dev machine if you are running
#                       `cloud-sql-proxy` locally AND the socket lives at that
#                       exact path (needs sudo, or a symlink from a writable
#                       dir). Without it, Flask fails at connect. See the
#                       preflight check below.
#   DATABASE_URL env  → used as-is (override the secret's socket URL by
#                       exporting a `localhost:5432` form if you run the
#                       proxy on a TCP port instead of a socket).
#   neither           → Backend default (local sqlite)
#
# Image generation note: the image worker additionally needs GCS
# (GCS_BUCKET_NAME + storage credentials). Without it, image jobs fail and
# are recorded on the recipe; recipe generation itself completes normally.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-gen-lang-client-0491022701}"
EMULATOR_PORT="${EMULATOR_PORT:-8085}"
EMULATOR_CONTAINER="pubsub-emulator-staging"
EMULATOR_IMAGE="gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators"
FLASK_PORT=5000

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/../../Backend" && pwd)"

USE_STAGING_DB=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --staging-db) USE_STAGING_DB=true; shift ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

command -v docker >/dev/null || { echo "ERROR: docker is required (the emulator runs in a container)" >&2; exit 1; }
command -v uv >/dev/null || { echo "ERROR: uv is required to run the Flask backend" >&2; exit 1; }

# ── Resolve the Gemini key ────────────────────────────────────────────
if [[ -z "${GOOGLE_API_KEY:-}" ]]; then
  echo "GOOGLE_API_KEY not set; trying secret GOOGLE_API_KEY_STAGING in ${PROJECT_ID}..."
  if ! GOOGLE_API_KEY="$(gcloud secrets versions access latest \
      --secret=GOOGLE_API_KEY_STAGING --project="${PROJECT_ID}" 2>/dev/null)"; then
    cat >&2 <<EOF
ERROR: no Gemini API key. Either export GOOGLE_API_KEY, or store the
dedicated staging key once and this script will pick it up from then on:

  printf '%s' "<the-key>" | gcloud secrets create GOOGLE_API_KEY_STAGING \\
    --data-file=- --project=${PROJECT_ID}

(To test only the pipeline plumbing, run with GOOGLE_API_KEY=dummy.)
EOF
    exit 1
  fi
  echo "Using key from Secret Manager."
fi

# ── Resolve the database ──────────────────────────────────────────────
if $USE_STAGING_DB; then
  DATABASE_URL="$(gcloud secrets versions access latest \
    --secret=DATABASE_URL_STAGING --project="${PROJECT_ID}")"
  echo "Database: CloudSQL staging Postgres (from DATABASE_URL_STAGING)"
  # KAN-248: the secret now holds a Cloud SQL Auth Proxy socket URL
  # (host=/cloudsql/PROJECT:REGION:INSTANCE). That directory is created by
  # Cloud Run's sidecar in production but does NOT exist on a dev machine.
  # Fail early so Flask's cryptic SQLAlchemy connect error isn't the first
  # signal something's wrong. --staging-db is an explicit request for the
  # staging DB, so an unreachable instance is an error, not a warning.
  if [[ "$DATABASE_URL" == *"host=/cloudsql/"* ]]; then
    SOCKET_DIR="$(printf '%s\n' "$DATABASE_URL" | sed -n 's/.*host=\([^&]*\).*/\1/p')"
    INSTANCE_NAME="${SOCKET_DIR##*/}"
    if [[ ! -S "${SOCKET_DIR}/.s.PGSQL.5432" ]]; then
      cat >&2 <<EOF
ERROR: DATABASE_URL_STAGING points at ${SOCKET_DIR}, but no Postgres
socket exists there.

That socket is created by Cloud Run's Auth Proxy sidecar. Reproducing it
locally needs more than starting the proxy: ${INSTANCE_NAME}
has a private IP and no public IP, and the Cloud SQL Auth Proxy
authenticates and encrypts a connection — it does NOT create a network
route. From a machine with no route into the VPC (VPN, Interconnect, or a
bastion), there is no proxy invocation that reaches this instance.

If this machine IS on the VPC, start the proxy with --private-ip (it
targets the public IP by default, and this instance has none):

  sudo mkdir -p ${SOCKET_DIR%/*}
  sudo chown \$USER ${SOCKET_DIR%/*}
  cloud-sql-proxy --private-ip --unix-socket ${SOCKET_DIR%/*} \\
    ${INSTANCE_NAME}

Otherwise, drop --staging-db and run against local sqlite — the Pub/Sub
pipeline this script exercises does not depend on the staging database.
To inspect or edit staging data without a VPC route, use Cloud SQL Studio
in the console. See scripts/staging/README.md "Where seeding can run from".
EOF
      exit 1
    fi
  fi
elif [[ -n "${DATABASE_URL:-}" ]]; then
  echo "Database: DATABASE_URL from environment"
else
  echo "Database: Backend default (local sqlite)"
fi

# ── Start the Pub/Sub emulator ────────────────────────────────────────
docker rm -f "${EMULATOR_CONTAINER}" >/dev/null 2>&1 || true
docker run -d --rm --name "${EMULATOR_CONTAINER}" \
  -p "${EMULATOR_PORT}:8085" \
  --add-host=host.docker.internal:host-gateway \
  "${EMULATOR_IMAGE}" \
  gcloud beta emulators pubsub start --project="${PROJECT_ID}" \
  --host-port="0.0.0.0:8085" >/dev/null

cleanup() { docker rm -f "${EMULATOR_CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# The emulator is a JVM app — first boot takes ~15-30s.
echo -n "Waiting for emulator on :${EMULATOR_PORT} "
for _ in $(seq 1 60); do
  if curl -s "http://localhost:${EMULATOR_PORT}" >/dev/null 2>&1; then break; fi
  echo -n "."
  sleep 1
done
curl -s "http://localhost:${EMULATOR_PORT}" >/dev/null || {
  echo " emulator never came up; container logs:" >&2
  docker logs "${EMULATOR_CONTAINER}" >&2 || true
  exit 1
}
echo " up."

# ── Topics + push subscriptions (mirrors the prod wiring) ─────────────
# Push endpoints point at the local Flask worker blueprint; the OIDC check
# is bypassed with PUBSUB_AUTH_OPTIONAL=1 (the emulator cannot mint
# Google-signed tokens).
BASE="http://localhost:${EMULATOR_PORT}/v1/projects/${PROJECT_ID}"
for topic in recipe-generation image-generation; do
  curl -s -X PUT "${BASE}/topics/${topic}" >/dev/null
done
# Push endpoints use host.docker.internal: the emulator delivers from
# inside the container, and Flask listens on the host.
PUSH_HOST="host.docker.internal"
curl -s -X PUT "${BASE}/subscriptions/recipe-generation-local" \
  -H 'Content-Type: application/json' \
  -d "{\"topic\":\"projects/${PROJECT_ID}/topics/recipe-generation\",\"pushConfig\":{\"pushEndpoint\":\"http://${PUSH_HOST}:${FLASK_PORT}/api/worker/recipe\"},\"ackDeadlineSeconds\":600}" >/dev/null
curl -s -X PUT "${BASE}/subscriptions/image-generation-local" \
  -H 'Content-Type: application/json' \
  -d "{\"topic\":\"projects/${PROJECT_ID}/topics/image-generation\",\"pushConfig\":{\"pushEndpoint\":\"http://${PUSH_HOST}:${FLASK_PORT}/api/worker/image\"},\"ackDeadlineSeconds\":600}" >/dev/null
echo "Topics recipe-generation + image-generation wired to /api/worker/* on :${FLASK_PORT}."

# ── Run Flask with the generation stack enabled ───────────────────────
echo ""
echo "Starting Flask on :${FLASK_PORT} (Ctrl-C stops Flask and the emulator)."
echo ""
cd "${BACKEND_DIR}"
# PORT is pinned: app.py honors an ambient PORT (Cloud Run convention),
# which would silently move Flask off the port the push subscriptions target.
env \
  PUBSUB_EMULATOR_HOST="localhost:${EMULATOR_PORT}" \
  GCP_PROJECT_ID="${PROJECT_ID}" \
  PUBSUB_AUTH_OPTIONAL=1 \
  GOOGLE_API_KEY="${GOOGLE_API_KEY}" \
  PORT="${FLASK_PORT}" \
  ${DATABASE_URL:+DATABASE_URL="${DATABASE_URL}"} \
  uv run python app.py
