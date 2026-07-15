#!/usr/bin/env bash
# SessionEnd hook — the session-log SAFETY NET for the paths PreCompact misses.
#
# precompact-session-log.sh only fires on /compact and auto-compact. It does NOT
# fire on /clear or on a normal session exit — those drop context with no model
# turn. This hook closes that gap: on SessionEnd it condenses the transcript,
# hands it to Haiku for a summary, and publishes to Confluence under the Agent
# Session Logs index — the same flow as the PreCompact hook.
#
# To avoid spamming Confluence with trivial exits, it applies a SUBSTANCE GATE:
# sessions whose condensed digest is too small to be worth a page are skipped.
#
# Design rules (identical spirit to precompact-session-log.sh):
#   * NEVER block session teardown. Every failure path exits 0.
#   * Detach the slow work to the background; the transcript persists on disk, so
#     the worker finishes after the parent process exits.
#   * Recursion guard: the summarizer runs `claude -p`, which would re-enter this
#     and the SessionStart hooks. The CLAUDE_PM_SESSION_LOG_ACTIVE flag stops it.
#
# SessionEnd stdin (JSON): session_id, transcript_path, cwd, hook_event_name,
#                          reason ("clear"|"logout"|"prompt_input_exit"|"other").

set -uo pipefail
trap 'exit 0' ERR

# --- recursion guard -------------------------------------------------------
if [ -n "${CLAUDE_PM_SESSION_LOG_ACTIVE:-}" ]; then
  exit 0
fi

INPUT=$(cat 2>/dev/null || true)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Resolve the primary checkout (venv + .env + scripts live there, not in worktrees).
COMMON_GIT=$(git -C "$PROJECT_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")
if [ -n "$COMMON_GIT" ] && [ -d "$COMMON_GIT" ]; then
  MAIN_REPO=$(dirname "$COMMON_GIT")
else
  MAIN_REPO="$PROJECT_DIR"
fi

LOG="$MAIN_REPO/.claude/session-log-hook.log"
mkdir -p "$(dirname "$LOG")"

_field() {
  printf '%s' "$INPUT" | python3 -c "
import json,sys
try: print((json.load(sys.stdin) or {}).get('$1','') or '')
except Exception: print('')
" 2>/dev/null
}

TRANSCRIPT=$(_field transcript_path)
SESSION_ID=$(_field session_id)
REASON=$(_field reason)

{
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) SessionEnd reason=${REASON:-?} session=${SESSION_ID:-?}"
} >>"$LOG" 2>&1

# --- preconditions (all fail-open) -----------------------------------------
if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  echo "  skip: no transcript at '${TRANSCRIPT:-<empty>}'" >>"$LOG"
  exit 0
fi

# Mirror atlassian_pm_link.load_config(): env var wins over .env, all three of
# URL/EMAIL/TOKEN required. Bail BEFORE spending a Haiku call if none configured.
_has_cred() {
  [ -n "$(printenv "$1" 2>/dev/null)" ] && return 0
  grep -qs "^[[:space:]]*$1=[^[:space:]]" "$MAIN_REPO/.env"
}

MISSING=""
for key in ATLASSIAN_URL ATLASSIAN_EMAIL ATLASSIAN_API_TOKEN; do
  _has_cred "$key" || MISSING="$MISSING $key"
done
if [ -n "$MISSING" ]; then
  echo "  skip: missing Atlassian credentials (env or $MAIN_REPO/.env):$MISSING" >>"$LOG"
  exit 0
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "  skip: claude CLI not on PATH" >>"$LOG"
  exit 0
fi

# --- detach: do the slow work without stalling teardown ---------------------
(
  export CLAUDE_PM_SESSION_LOG_ACTIVE=1
  WORK=$(mktemp -d -t session-log-end-XXXXXX)
  trap 'rm -rf "$WORK"' EXIT

  DIGEST="$WORK/digest.txt"
  SUMMARY="$WORK/summary.md"

  DIGEST_PY="$PROJECT_DIR/scripts/pm/transcript_digest.py"
  [ -f "$DIGEST_PY" ] || DIGEST_PY="$MAIN_REPO/scripts/pm/transcript_digest.py"

  if ! python3 "$DIGEST_PY" \
      --transcript "$TRANSCRIPT" --max-chars 40000 >"$DIGEST" 2>>"$LOG"; then
    echo "  FAIL: transcript_digest.py ($DIGEST_PY)" >>"$LOG"
    exit 0
  fi

  # SUBSTANCE GATE: SessionEnd fires on every exit, including greetings and
  # aborted sessions. If the condensed digest is tiny, there is nothing worth a
  # Confluence page — skip before spending a model call. PreCompact has no such
  # gate because a session that filled its context is substantive by definition.
  DIGEST_CHARS=$(wc -m <"$DIGEST" 2>/dev/null | tr -d ' ')
  DIGEST_CHARS=${DIGEST_CHARS:-0}
  if [ "$DIGEST_CHARS" -lt 800 ]; then
    echo "  skip: digest too small ($DIGEST_CHARS chars < 800) — trivial session" >>"$LOG"
    exit 0
  fi

  BRANCH=$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || echo unknown)
  STAMP=$(date -u +%Y%m%d-%H%M%S)

  PROMPT="You are writing a session log for an engineering team's Confluence.

Below is a condensed transcript of a Claude Code session on branch \`$BRANCH\`.
Write a session log in GitHub-flavored markdown with EXACTLY these sections:

## Summary
2-4 sentences. What was this session actually about, and what changed? Lead with
the outcome, not the process.

## Key decisions
Bullets. Each is a decision made and WHY. If a decision reversed an earlier one,
say so. If none were made, write 'None.'

## Files changed
Bullets of file paths. If none, write 'None.'

## Follow-ups
Bullets of work explicitly left undone, deferred, or flagged. If none, 'None.'

## Gotchas
Bullets of anything surprising, non-obvious, or that cost time — the things a
future session would want to know. If none, 'None.'

Rules: be concrete, name files and identifiers, no filler, no preamble. Do not
invent anything not present in the transcript. Output ONLY the markdown.

--- TRANSCRIPT DIGEST ---
$(cat "$DIGEST")"

  if command -v timeout >/dev/null 2>&1; then
    RUNNER=(timeout 240)
  elif command -v gtimeout >/dev/null 2>&1; then
    RUNNER=(gtimeout 240)
  else
    RUNNER=()
    echo "  note: no timeout(1) available; running summarizer unbounded (detached)" >>"$LOG"
  fi

  if ! "${RUNNER[@]}" claude -p "$PROMPT" \
        --model claude-haiku-4-5-20251001 \
        --allowedTools '' >"$SUMMARY" 2>>"$LOG"; then
    echo "  FAIL: claude -p summarizer (timeout or error)" >>"$LOG"
    exit 0
  fi

  if [ ! -s "$SUMMARY" ]; then
    echo "  FAIL: summarizer produced empty output" >>"$LOG"
    exit 0
  fi

  TITLED="$WORK/titled.md"
  {
    echo "# Session Log — $BRANCH — $STAMP"
    echo
    echo "> Auto-captured by the SessionEnd hook (reason: ${REASON:-unknown}). Summarized by Haiku from the session transcript."
    echo "> Session ID: \`${SESSION_ID:-unknown}\`"
    echo
    cat "$SUMMARY"
  } >"$TITLED"

  if bash "$MAIN_REPO/scripts/pm/run_pm_script.sh" publish_session_log.py \
      --file "$TITLED" \
      --title "Session Log: session-end (${REASON:-exit}) — $BRANCH — $STAMP" >>"$LOG" 2>&1; then
    echo "  OK: published session log for $BRANCH" >>"$LOG"
  else
    echo "  FAIL: publish_session_log.py (summary preserved below)" >>"$LOG"
    cat "$TITLED" >>"$LOG"
  fi
) >/dev/null 2>&1 &

disown 2>/dev/null || true
exit 0
