#!/usr/bin/env bash
# PreCompact hook — the SAFETY NET for session logging.
#
# Fires before /compact and before auto-compact, i.e. exactly when context is
# about to be thrown away. It condenses the transcript, hands it to a cheap
# subagent (Haiku) to write a session summary, and publishes that summary to
# Confluence under the Agent Session Logs index.
#
# NOTE ON /clear: this hook does NOT fire on /clear. Claude Code gives no hook
# and no model turn on /clear — the context is simply dropped. If you want a
# guaranteed, verified log, run `/wrap` (or `/sync-and-clear`) BEFORE clearing.
# This hook only covers the compaction path.
#
# Design rules:
#   * NEVER block compaction. Every failure path exits 0. A broken log must not
#     wedge the user's session.
#   * Detach and run in the background. A blocking 60s summarize on every
#     auto-compact would be intolerable mid-task; the transcript file persists
#     after compaction, so the worker can finish on its own.
#   * Guard against recursion: the `claude -p` subagent inherits this repo's
#     settings and would otherwise be able to re-trigger this hook.
#
# Hook stdin (JSON): session_id, transcript_path, cwd, hook_event_name,
#                    trigger ("manual"|"auto"), custom_instructions

set -uo pipefail

# Always let compaction proceed, whatever happens below.
trap 'exit 0' ERR

# --- recursion guard -------------------------------------------------------
# The summarizer subagent runs `claude`, which loads this repo's hooks. Without
# this, a compaction inside the subagent would spawn another subagent.
if [ -n "${CLAUDE_PM_SESSION_LOG_ACTIVE:-}" ]; then
  exit 0
fi

INPUT=$(cat)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# This repo runs most sessions inside .claude/worktrees/*, where CLAUDE_PROJECT_DIR
# is the WORKTREE — which has no .env and no scripts/pm/.venv. Resolve the primary
# checkout and read tooling + credentials from there. `--git-common-dir` points at
# the shared .git of the main checkout from any linked worktree; in the main
# checkout it resolves to that same repo. Without this the hook would either skip
# silently in every worktree session, or bootstrap a throwaway venv mid-compaction.
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
TRIGGER=$(_field trigger)

{
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) PreCompact trigger=${TRIGGER:-?} session=${SESSION_ID:-?}"
} >>"$LOG" 2>&1

# --- preconditions (all fail-open) -----------------------------------------
if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  echo "  skip: no transcript at '${TRANSCRIPT:-<empty>}'" >>"$LOG"
  exit 0
fi

# No credentials => nothing to publish to. Don't spend a model call finding out.
if ! grep -qs '^ATLASSIAN_API_TOKEN=.' "$MAIN_REPO/.env"; then
  echo "  skip: ATLASSIAN_API_TOKEN not set in $MAIN_REPO/.env" >>"$LOG"
  exit 0
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "  skip: claude CLI not on PATH" >>"$LOG"
  exit 0
fi

# --- detach: do the slow work without stalling compaction -------------------
(
  export CLAUDE_PM_SESSION_LOG_ACTIVE=1
  WORK=$(mktemp -d -t session-log-XXXXXX)
  trap 'rm -rf "$WORK"' EXIT

  DIGEST="$WORK/digest.txt"
  SUMMARY="$WORK/summary.md"

  # transcript_digest.py is stdlib-only, so it can run from whichever checkout
  # the session is in — prefer that one, so a worktree editing the script tests
  # its own copy rather than a stale one from the main checkout. Anything that
  # needs the venv or .env (publish_session_log.py) still comes from MAIN_REPO.
  DIGEST_PY="$PROJECT_DIR/scripts/pm/transcript_digest.py"
  [ -f "$DIGEST_PY" ] || DIGEST_PY="$MAIN_REPO/scripts/pm/transcript_digest.py"

  if ! python3 "$DIGEST_PY" \
      --transcript "$TRANSCRIPT" --max-chars 40000 >"$DIGEST" 2>>"$LOG"; then
    echo "  FAIL: transcript_digest.py ($DIGEST_PY)" >>"$LOG"
    exit 0
  fi

  BRANCH=$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || echo unknown)
  STAMP=$(date -u +%Y%m%d-%H%M%S)

  # Haiku is deliberate here: this is compression, not reasoning. Cheap + fast.
  # --allowedTools '' keeps it from touching the repo; it only reads the digest
  # we hand it on stdin and emits markdown.
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

  if ! timeout 240 claude -p "$PROMPT" \
        --model claude-haiku-4-5-20251001 \
        --allowedTools '' >"$SUMMARY" 2>>"$LOG"; then
    echo "  FAIL: claude -p summarizer (timeout or error)" >>"$LOG"
    exit 0
  fi

  if [ ! -s "$SUMMARY" ]; then
    echo "  FAIL: summarizer produced empty output" >>"$LOG"
    exit 0
  fi

  # Header carries the provenance the model can't know reliably.
  TITLED="$WORK/titled.md"
  {
    echo "# Session Log — $BRANCH — $STAMP"
    echo
    echo "> Auto-captured by the PreCompact hook (trigger: ${TRIGGER:-auto}). Summarized by Haiku from the session transcript."
    echo "> Session ID: \`${SESSION_ID:-unknown}\`"
    echo
    cat "$SUMMARY"
  } >"$TITLED"

  if bash "$MAIN_REPO/scripts/pm/run_pm_script.sh" publish_session_log.py \
      --file "$TITLED" \
      --title "Session Log: auto-compact — $BRANCH — $STAMP" >>"$LOG" 2>&1; then
    echo "  OK: published session log for $BRANCH" >>"$LOG"
  else
    echo "  FAIL: publish_session_log.py (summary preserved below)" >>"$LOG"
    cat "$TITLED" >>"$LOG"
  fi
) >/dev/null 2>&1 &

disown 2>/dev/null || true
exit 0
