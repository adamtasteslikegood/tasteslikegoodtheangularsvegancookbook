#!/usr/bin/env bash
# Entry point for the gbrain maintenance cron service.
# Writes gbrain config from env vars, extracts stale links, embeds stale
# chunks, runs doctor, exits.
#
# It deliberately does NOT run `gbrain dream`: the cycle's propose_takes phase
# called a chat model for 20-50 minutes a night with nothing consuming the
# output (KAN-357). The Railway OPENAI_API_KEY is scoped to embeddings only.
set -euo pipefail

: "${GBRAIN_DATABASE_URL:?GBRAIN_DATABASE_URL is required (Railway service variable)}"
: "${OPENAI_API_KEY:?OPENAI_API_KEY is required (Railway service variable)}"
EMBED_MAX_USD="${EMBED_MAX_USD:-1}"

umask 077
mkdir -p ~/.gbrain
cat > ~/.gbrain/config.json <<EOF
{
  "engine": "postgres",
  "database_url": "${GBRAIN_DATABASE_URL}",
  "embedding_model": "openai:text-embedding-3-large",
  "embedding_dimensions": 1536,
  "expansion_model": "openai:gpt-6-luna",
  "chat_model": "openai:gpt-6-luna",
  "schema_pack": "gbrain-base-v2",
  "mcp": {"publish_skills": false},
  "self_upgrade": {"mode": "notify", "mode_prompted": true}
}
EOF

gbrain() { (cd /opt/gbrain && bun src/cli.ts "$@"); }

echo "[gbrain-maintenance] $(date -u +%FT%TZ) version: $(gbrain --version)"

FAILED=0

# Phase 1: Extract stale links
echo "[gbrain-maintenance] extract --stale"
gbrain extract --stale || { echo "[gbrain-maintenance] WARN: extract --stale failed"; FAILED=$((FAILED + 1)); }

# Phase 2: Embed any stale chunks. Without a terminal, embed exits 3 unless a
# spend cap is given; EMBED_MAX_USD is that cap per run.
echo "[gbrain-maintenance] embed --stale --catch-up --max-usd ${EMBED_MAX_USD}"
gbrain embed --stale --catch-up --max-usd "${EMBED_MAX_USD}" || { echo "[gbrain-maintenance] WARN: embed --stale failed"; FAILED=$((FAILED + 1)); }

# Phase 3: Doctor check (fast mode, best-effort — informational only)
echo "[gbrain-maintenance] doctor --fast --json"
DOCTOR_OUTPUT=$(gbrain doctor --fast --json 2>&1) || true
SCORE=$(echo "$DOCTOR_OUTPUT" | grep -oP '"health_score":\s*\K[0-9]+' 2>/dev/null || echo "?")
echo "[gbrain-maintenance] health score: ${SCORE}/100"

# Log failed checks for visibility
echo "$DOCTOR_OUTPUT" | grep -i '"status":"fail"' 2>/dev/null || echo "[gbrain-maintenance] no FAILs"

# Phase 4: Sources status snapshot (best-effort)
echo "[gbrain-maintenance] sources status"
gbrain sources status || true

echo "[gbrain-maintenance] $(date -u +%FT%TZ) done (score: ${SCORE}/100, failures: ${FAILED})"
exit "$FAILED"
