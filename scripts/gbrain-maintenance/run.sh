#!/usr/bin/env bash
# Entry point for the gbrain maintenance cron service.
# Writes gbrain config from env vars, runs dream on all active sources,
# extracts stale links, embeds stale chunks, runs doctor, exits.
set -euo pipefail

: "${GBRAIN_DATABASE_URL:?GBRAIN_DATABASE_URL is required (Railway service variable)}"
: "${OPENAI_API_KEY:?OPENAI_API_KEY is required (Railway service variable)}"

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

FAILED=0

# Phase 1: Dream cycle on all active federated sources
echo "[gbrain-maintenance] discovering active sources..."
SOURCES=$(gbrain sources list \
  | grep -E '^\s+(gstack-|default)' \
  | awk '{print $1}' \
  | grep -v '^$' || true)

if [ -z "$SOURCES" ]; then
  echo "[gbrain-maintenance] WARN: no sources found, running dream without --source"
  gbrain dream || { echo "[gbrain-maintenance] WARN: dream (no source) failed"; FAILED=1; }
else
  for src in $SOURCES; do
    echo "[gbrain-maintenance] dream --source ${src}"
    gbrain dream --source "${src}" || { echo "[gbrain-maintenance] WARN: dream failed for ${src}"; FAILED=1; }
  done
fi

# Phase 2: Extract stale links
echo "[gbrain-maintenance] extract --stale"
gbrain extract --stale || { echo "[gbrain-maintenance] WARN: extract --stale failed"; FAILED=1; }

# Phase 3: Embed any stale chunks
echo "[gbrain-maintenance] embed --stale"
gbrain embed --stale || { echo "[gbrain-maintenance] WARN: embed --stale failed"; FAILED=1; }

# Phase 4: Doctor check (fast mode, best-effort — informational only)
echo "[gbrain-maintenance] doctor --fast --json"
DOCTOR_OUTPUT=$(gbrain doctor --fast --json 2>&1) || true
SCORE=$(echo "$DOCTOR_OUTPUT" | grep -oP '"overall_score":\s*\K[0-9]+' 2>/dev/null || echo "?")
echo "[gbrain-maintenance] health score: ${SCORE}/100"

# Log failed checks for visibility
echo "$DOCTOR_OUTPUT" | grep -i '"status":"fail"' 2>/dev/null || echo "[gbrain-maintenance] no FAILs"

# Phase 5: Sources status snapshot (best-effort)
echo "[gbrain-maintenance] sources status"
gbrain sources status || true

echo "[gbrain-maintenance] $(date -u +%FT%TZ) done (score: ${SCORE}/100, failures: ${FAILED})"
exit $FAILED
