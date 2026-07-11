#!/usr/bin/env bash
# Entry point for the gbrain maintenance cron service.
# Writes gbrain config from env vars, runs dream + extract --stale, exits.
set -euo pipefail

: "${GBRAIN_DATABASE_URL:?GBRAIN_DATABASE_URL is required (Railway service variable)}"
: "${OPENAI_API_KEY:?OPENAI_API_KEY is required (Railway service variable)}"

# The code source to run the dream cycle against. Matches the owner's
# worktree-scoped source pin (.gbrain-source on the dev machine).
GBRAIN_DREAM_SOURCE="${GBRAIN_DREAM_SOURCE:-gstack-code-575c47df-9dc431}"

umask 077
mkdir -p ~/.gbrain
cat > ~/.gbrain/config.json <<EOF
{
  "engine": "postgres",
  "database_url": "${GBRAIN_DATABASE_URL}",
  "embedding_model": "openai:text-embedding-3-large",
  "embedding_dimensions": 1536,
  "expansion_model": "openai:gpt-5.2",
  "chat_model": "openai:gpt-5.2",
  "schema_pack": "gbrain-base-v2",
  "mcp": {"publish_skills": false},
  "self_upgrade": {"mode": "notify", "mode_prompted": true}
}
EOF

gbrain() { (cd /opt/gbrain && bun src/cli.ts "$@"); }

echo "[gbrain-maintenance] $(date -u +%FT%TZ) version: $(gbrain --version)"

echo "[gbrain-maintenance] dream --source ${GBRAIN_DREAM_SOURCE}"
gbrain dream --source "${GBRAIN_DREAM_SOURCE}"

echo "[gbrain-maintenance] extract --stale"
gbrain extract --stale

echo "[gbrain-maintenance] status snapshot"
gbrain status || true

echo "[gbrain-maintenance] $(date -u +%FT%TZ) done"
