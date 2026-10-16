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
# links and embed stale chunks from here, then exit non-zero so the miss shows:
# 1 when the fallback ran cleanly, 2 when one of its phases failed too.
#
# It deliberately does NOT run `gbrain dream`: the cycle's propose_takes phase
# called a chat model for 20-50 minutes a night with nothing consuming the
# output (KAN-357). The Railway OPENAI_API_KEY is scoped to embeddings only.
set -euo pipefail

SPRITE_NAME="${SPRITE_NAME:-spawn-sprite-hermes222}"
# The sprite runs as user `sprite` (HOME=/home/sprite). Its /home/allisone holds
# only the Backend clone, at the path the shared DB records for that source.
SPRITE_SCRIPT="${SPRITE_SCRIPT:-/home/sprite/.hermes/scripts/gbrain-remote-run.sh}"
EMBED_MAX_USD="${EMBED_MAX_USD:-1}"

log() { echo "[gbrain-maintenance] $(date -u +%FT%TZ) $*"; }

# Returns 0 when the sprite run succeeded, 1 when it never started or finished
# with a failure (the fallback is safe), and 2 when it started but its outcome
# is unknown: the sprite may still be running, so a fallback would overlap it.
run_on_sprite() {
  # A missing token is a failed sprite run, so it still reaches the fallback.
  if [ -z "${SPRITES_TOKEN:-}" ]; then
    log "ERROR: SPRITES_TOKEN is not set (Railway service variable)"
    return 1
  fi
  local out rc="" curl_rc=0
  out=$(mktemp)
  log "waking ${SPRITE_NAME} and running ${SPRITE_SCRIPT}"
  # The response body is the command's framed output and exit code (decoded
  # below); the wrapper's last output line is EXIT=<n> as a second check.
  # No --retry: the POST starts a run, so a retry after a dropped connection
  # would start a second one.
  # -G puts the url-encoded cmd args in the query string; -X POST keeps the method.
  curl -sS --fail-with-body --max-time 7200 -o "$out" \
    -G -X POST -H "Authorization: Bearer ${SPRITES_TOKEN}" \
    --data-urlencode "cmd=bash" --data-urlencode "cmd=-l" --data-urlencode "cmd=${SPRITE_SCRIPT}" \
    "https://api.sprites.dev/v1/sprites/${SPRITE_NAME}/exec" || curl_rc=$?
  # Framing bytes are dropped for the log only.
  tr -d '\000\001\002\003' <"$out"
  if [ "$curl_rc" -ne 0 ]; then
    rm -f "$out"
    case "$curl_rc" in
      # DNS, connect, TLS, or an HTTP error status (22, sent before any output):
      # the run never started.
      6 | 7 | 22 | 35 | 60)
        log "ERROR: Sprites exec request failed before the run started (curl exit ${curl_rc})"
        return 1
        ;;
      # Anything else (28 timeout, 18/52/56 dropped mid-stream) happened after
      # the run may have started.
      *)
        log "ERROR: Sprites exec request broke off mid-run (curl exit ${curl_rc}); the sprite may still be running"
        return 2
        ;;
    esac
  fi
  # The HTTP exec body is framed: a type byte before each output chunk (1
  # stdout, 2 stderr), then an exit frame, byte 3 followed by the process exit
  # code. Frames carry no lengths, but the exit frame is always last, so it is
  # read as the final two bytes. No exit frame means the run was cut short.
  local ftype="" fcode=""
  read -r ftype fcode < <(tail -c 2 "$out" | od -An -tu1)
  if [ "$ftype" != 3 ] || [ -z "$fcode" ]; then
    log "ERROR: response has no exit frame; the sprite may still be running"
    rm -f "$out"
    return 2
  fi
  # The output must also carry the wrapper's EXIT=<n> line. The last one
  # counts; it need not be the final line, since stderr frames can follow it.
  rc=$(head -c -2 "$out" | tr -cd '[:print:]\n' | sed -nE 's/^EXIT=([0-9]+)$/\1/p' | tail -1)
  rm -f "$out"
  log "sprite process exit ${fcode}, marker EXIT=${rc:-missing}"
  if [ "$fcode" != 0 ] || [ -z "$rc" ]; then
    return 1
  fi
  # 75: a sprite run already holds its lock (the wrapper prints 75 and exits
  # 0); running the fallback too would overlap it, so count this as done. The
  # flock is released when its holder dies, so only a live (possibly hung) run
  # holds it; warn so a run stuck for days shows up in the logs.
  if [ "$rc" = 75 ]; then
    log "WARN: another sprite run holds the lock; nothing done. If this repeats, check for a hung run on the sprite"
    return 0
  fi
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
  gbrain extract --stale || { log "WARN: extract --stale failed"; FALLBACK_FAILED=$((FALLBACK_FAILED + 1)); }

  # Embed any stale chunks. Without a terminal, embed exits 3 unless a spend
  # cap is given; EMBED_MAX_USD is that cap per run.
  log "embed --stale --catch-up --max-usd ${EMBED_MAX_USD}"
  gbrain embed --stale --catch-up --max-usd "${EMBED_MAX_USD}" || { log "WARN: embed --stale failed"; FALLBACK_FAILED=$((FALLBACK_FAILED + 1)); }

  # Doctor check (fast mode, informational only).
  # Only stdout is parsed, so an error message cannot pass for a score;
  # stderr still reaches the log.
  local doctor score
  doctor=$(gbrain doctor --fast --json) || true
  score=$(echo "$doctor" | grep -oP '"health_score":\s*\K[0-9]+' 2>/dev/null || echo "?")
  log "health score: ${score}/100"
  echo "$doctor" | grep -i '"status":"fail"' 2>/dev/null || log "no FAILs"

  gbrain sources status || true
}

sprite_rc=0
run_on_sprite || sprite_rc=$?
if [ "$sprite_rc" = 0 ]; then
  log "done (sprite)"
  exit 0
fi
if [ "$sprite_rc" = 2 ]; then
  log "skipping the fallback so it cannot overlap a sprite run; exiting 3"
  exit 3
fi

log "sprite path failed; running the fallback here"
FALLBACK_FAILED=0
run_local
if [ "$FALLBACK_FAILED" -gt 0 ]; then
  log "done (fallback, ${FALLBACK_FAILED} phase(s) failed); exiting 2"
  exit 2
fi
log "done (fallback); exiting 1 so the missed sprite run is visible"
exit 1
