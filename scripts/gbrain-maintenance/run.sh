#!/usr/bin/env bash
# Entry point for the gbrain maintenance cron service.
#
# Primary path (KAN-413): wake the hermes sprite through the Sprites exec API
# and run ~/.hermes/scripts/gbrain-remote-run.sh there, waiting for it to
# finish so the output lands in this service's logs. The sprite holds its own
# Backend clone, so that run also syncs gstack-code-backend, then extracts,
# embeds and runs one hermes scheduler tick (the Monday agent check). A sprite
# sleeps between requests and hermes cron does not wake it; this request does.
#
# Fallback: if the sprite cannot be reached or its run fails, extract stale
# links and embed stale chunks from here, then exit non-zero so the miss shows.
#
# It deliberately does NOT run `gbrain dream`: the cycle's propose_takes phase
# called a chat model for 20-50 minutes a night with nothing consuming the
# output (KAN-357). The Railway OPENAI_API_KEY is scoped to embeddings only.
set -euo pipefail

: "${SPRITES_TOKEN:?SPRITES_TOKEN is required (Railway service variable)}"
SPRITE_NAME="${SPRITE_NAME:-spawn-sprite-hermes222}"
SPRITE_SCRIPT="${SPRITE_SCRIPT:-/home/sprite/.hermes/scripts/gbrain-remote-run.sh}"
EMBED_MAX_USD="${EMBED_MAX_USD:-1}"

log() { echo "[gbrain-maintenance] $(date -u +%FT%TZ) $*"; }

run_on_sprite() {
  local out
  out=$(mktemp)
  log "waking ${SPRITE_NAME} and running ${SPRITE_SCRIPT}"
  # The response body is the command's output. Its last line is EXIT=<n>,
  # which is how this script learns the sprite-side result.
  if ! curl -sS --no-buffer --fail-with-body --retry 2 --retry-delay 15 --max-time 7200 \
    -X POST -H "Authorization: Bearer ${SPRITES_TOKEN}" \
    "https://api.sprites.dev/v1/sprites/${SPRITE_NAME}/exec?cmd=bash&cmd=-l&cmd=${SPRITE_SCRIPT}" \
    | tee "$out"; then
    log "ERROR: Sprites exec request failed"
    return 1
  fi
  local rc
  rc=$(grep -aoE 'EXIT=[0-9]+' "$out" | tail -1 | cut -d= -f2)
  if [ -z "$rc" ]; then
    log "ERROR: sprite output had no EXIT= line (run cut short?)"
    return 1
  fi
  log "sprite run exit ${rc}"
  [ "$rc" = 0 ]
}

run_local() {
  : "${GBRAIN_DATABASE_URL:?GBRAIN_DATABASE_URL is required for the fallback (Railway service variable)}"
  : "${OPENAI_API_KEY:?OPENAI_API_KEY is required for the fallback (Railway service variable)}"

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

  log "fallback: local maintenance, version $(gbrain --version)"

  # Extract stale links.
  log "extract --stale"
  gbrain extract --stale || log "WARN: extract --stale failed"

  # Embed any stale chunks. Without a terminal, embed exits 3 unless a spend
  # cap is given; EMBED_MAX_USD is that cap per run.
  log "embed --stale --catch-up --max-usd ${EMBED_MAX_USD}"
  gbrain embed --stale --catch-up --max-usd "${EMBED_MAX_USD}" || log "WARN: embed --stale failed"

  # Doctor check (fast mode, informational only).
  local doctor score
  doctor=$(gbrain doctor --fast --json 2>&1) || true
  score=$(echo "$doctor" | grep -oP '"health_score":\s*\K[0-9]+' 2>/dev/null || echo "?")
  log "health score: ${score}/100"
  echo "$doctor" | grep -i '"status":"fail"' 2>/dev/null || log "no FAILs"

  gbrain sources status || true
}

if run_on_sprite; then
  log "done (sprite)"
  exit 0
fi

log "sprite path failed; running the fallback here"
run_local
log "done (fallback); exiting 1 so the missed sprite run is visible"
exit 1
