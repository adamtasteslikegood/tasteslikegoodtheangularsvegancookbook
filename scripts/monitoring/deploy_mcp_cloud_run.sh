#!/usr/bin/env bash
#
# Deploy the GCP monitoring MCP server to Cloud Run as an authenticated remote
# connector. Idempotent — safe to re-run to roll out a new revision.
#
# What it provisions (only what's missing):
#   1. A dedicated service account with roles/monitoring.viewer. The Cloud Run
#      service runs AS this SA, so the Monitoring client authenticates via ADC.
#      No key file, no GOOGLE_APPLICATION_CREDENTIALS_B64 anywhere.
#   2. A Secret Manager secret (MCP_AUTH_TOKEN) holding the shared bearer token
#      Claude presents on every request. Generated on first run if absent.
#   3. The Cloud Run service itself, built from scripts/monitoring/Dockerfile.
#
# Ingress is public (Claude's servers must reach it and cannot do GCP IAM), so
# the bearer token IS the access control. Rotate it by adding a new secret
# version and redeploying.
#
# Usage:
#   scripts/monitoring/deploy_mcp_cloud_run.sh
#   PROJECT_ID=comdottasteslikegood REGION=us-central1 \
#     scripts/monitoring/deploy_mcp_cloud_run.sh
#
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-${GCP_PROJECT_ID:-comdottasteslikegood}}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-gcp-monitor-mcp}"
SA_NAME="${SA_NAME:-gcp-monitor-mcp}"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
SECRET_NAME="${SECRET_NAME:-MCP_AUTH_TOKEN}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Project:  $PROJECT_ID"
echo "Region:   $REGION"
echo "Service:  $SERVICE"
echo "SA:       $SA_EMAIL"
echo

# ── 1. Service account + roles/monitoring.viewer ────────────────────────────
if ! gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Creating service account $SA_EMAIL"
  gcloud iam service-accounts create "$SA_NAME" \
    --project "$PROJECT_ID" \
    --display-name "GCP monitoring MCP connector (read-only)"
else
  echo "Service account $SA_EMAIL already exists"
fi

echo "Ensuring roles/monitoring.viewer on $SA_EMAIL"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:$SA_EMAIL" \
  --role roles/monitoring.viewer \
  --condition None >/dev/null

# ── 2. Bearer token secret ──────────────────────────────────────────────────
if ! gcloud secrets describe "$SECRET_NAME" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Creating secret $SECRET_NAME with a freshly generated token"
  gcloud secrets create "$SECRET_NAME" \
    --project "$PROJECT_ID" \
    --replication-policy automatic
  # 32 random bytes, URL-safe — plenty for a bearer secret.
  openssl rand -base64 32 | tr -d '\n' | tr '+/' '-_' \
    | gcloud secrets versions add "$SECRET_NAME" --project "$PROJECT_ID" --data-file=-
  echo "Generated a new token — retrieve it for the connector config with:"
  echo "  gcloud secrets versions access latest --secret=$SECRET_NAME --project=$PROJECT_ID"
else
  echo "Secret $SECRET_NAME already exists (reusing current token)"
fi

# Let the runtime SA read the token at container start.
gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
  --project "$PROJECT_ID" \
  --member "serviceAccount:$SA_EMAIL" \
  --role roles/secretmanager.secretAccessor \
  --condition None >/dev/null

# ── 3. Deploy the Cloud Run service ─────────────────────────────────────────
echo "Deploying $SERVICE from $SOURCE_DIR"
gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --source "$SOURCE_DIR" \
  --service-account "$SA_EMAIL" \
  --set-env-vars "MCP_TRANSPORT=http,GCP_PROJECT_ID=$PROJECT_ID" \
  --set-secrets "MCP_AUTH_TOKEN=${SECRET_NAME}:latest" \
  --allow-unauthenticated \
  --min-instances 0 \
  --cpu 1 \
  --memory 512Mi \
  --port 8080 \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)')"
echo
echo "Deployed. Register as a Claude custom connector."
echo
echo "claude.ai / Claude Code web (Settings -> Connectors -> Add custom connector):"
echo "  Its UI has no header field, so the token rides in the URL. Use this as the"
echo "  URL and leave the OAuth Client ID / Secret fields BLANK:"
if [[ "${PRINT_TOKEN:-0}" == "1" ]]; then
  # Opt-in only: the full token lands in terminal scrollback / CI logs / shared
  # transcripts, so it's not printed by default. `tr -d '\r\n'` strips any
  # trailing newline a manually-added secret version may carry, so the pasted
  # URL matches what the server expects.
  TOKEN="$(gcloud secrets versions access latest --secret="$SECRET_NAME" --project="$PROJECT_ID" 2>/dev/null | tr -d '\r\n' || true)"
  echo "    ${URL}/mcp?key=${TOKEN:-<token>}"
else
  echo "    ${URL}/mcp?key=<token>"
  echo "  (token withheld from output by default; re-run with PRINT_TOKEN=1 to"
  echo "   inline it, or fetch it with the command below)"
fi
echo
echo "Claude Code CLI / Desktop / API (header auth — keeps the token out of URLs & logs):"
echo "  URL:    ${URL}/mcp"
echo "  Header: Authorization: Bearer <token>"
echo
echo "Fetch the token:"
echo "  gcloud secrets versions access latest --secret=$SECRET_NAME --project=$PROJECT_ID"
