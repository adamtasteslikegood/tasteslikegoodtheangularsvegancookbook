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

# ── 2. Secret path token ─────────────────────────────────────────────────────
# The token becomes a URL path segment (the endpoint is /<token>/mcp), so it must
# be URL-path-safe. New tokens are base64url with the '=' padding stripped for a
# clean URL; the server also accepts '=' (a path sub-delim) so legacy padded
# tokens keep working, but rejects anything else (space, /, ?, #, %, …).
if ! gcloud secrets describe "$SECRET_NAME" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Creating secret $SECRET_NAME with a freshly generated token"
  gcloud secrets create "$SECRET_NAME" \
    --project "$PROJECT_ID" \
    --replication-policy automatic
  # 32 random bytes, base64url, no '=' padding — URL-path-safe.
  openssl rand -base64 32 | tr -d '\n' | tr '+/' '-_' | tr -d '=' \
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
# --allow-unauthenticated is REQUIRED: Claude's servers are not GCP principals,
# so IAM-gated ingress rejects them at Google's front door (its own sign-in) long
# before this app runs. The secret URL path is the actual access control. If an
# org policy (constraints/iam.allowedPolicyMemberDomains — Domain Restricted
# Sharing) blocks binding allUsers, this flag fails and the service stays private;
# that org policy must be exempted for the connector to be reachable.
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

# Verify ingress is actually public (the --allow-unauthenticated bind can be
# silently refused by an org policy). allUsers with run.invoker == reachable.
# Check specifically for allUsers bound to roles/run.invoker (what actually makes
# the service reachable) — flatten members, keep only the run.invoker binding,
# and match allUsers exactly, so allUsers under some other role can't read as
# "public".
if gcloud run services get-iam-policy "$SERVICE" --project "$PROJECT_ID" --region "$REGION" \
     --flatten='bindings[].members' \
     --filter='bindings.role=roles/run.invoker' \
     --format='value(bindings.members)' 2>/dev/null | grep -qx 'allUsers'; then
  PUBLIC="yes"
else
  PUBLIC="NO"
fi

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)')"
echo
if [[ "$PUBLIC" != "yes" ]]; then
  echo "!! WARNING: this service does NOT allow unauthenticated access (allUsers"
  echo "   is not bound to roles/run.invoker). Claude cannot reach it and the"
  echo "   connector will fail with a Google sign-in error. Likely an org policy"
  echo "   (Domain Restricted Sharing) blocking allUsers — get it exempted, then"
  echo "   re-run, or: gcloud run services add-iam-policy-binding $SERVICE \\"
  echo "     --region=$REGION --member=allUsers --role=roles/run.invoker"
  echo
fi
echo "Deployed. Register as a Claude custom connector (Settings -> Connectors ->"
echo "Add custom connector). Paste this as the URL and leave the OAuth Client ID /"
echo "Secret fields BLANK — the server is authless and the secret IS the path:"
if [[ "${PRINT_TOKEN:-0}" == "1" ]]; then
  # Opt-in only: the whole URL is the secret, so it's withheld from output by
  # default (terminal scrollback / CI logs / shared transcripts). tr strips any
  # trailing newline/CR a manually-added secret version may carry.
  TOKEN="$(gcloud secrets versions access latest --secret="$SECRET_NAME" --project="$PROJECT_ID" 2>/dev/null | tr -d '\r\n' || true)"
  echo "    ${URL}/${TOKEN:-<token>}/mcp"
else
  echo "    ${URL}/<token>/mcp"
  echo "  (token withheld by default; re-run with PRINT_TOKEN=1 to inline it, or"
  echo "   fetch it with the command below)"
fi
echo
echo "The same URL works from Claude Code CLI / Desktop / the API connector too."
echo
echo "Fetch the token:"
echo "  gcloud secrets versions access latest --secret=$SECRET_NAME --project=$PROJECT_ID"
