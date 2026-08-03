#!/usr/bin/env bash
# PM snapshot builder — shared by precompact-session-log.sh and
# sessionend-session-log.sh.
#
# WHY THIS EXISTS
# The auto-log summarizer runs `claude -p ... --allowedTools ''`. It can read
# NOTHING but the prompt it is handed. So a transcript-only log can never cite
# the PR the session opened, the daemon state, or how far the branch is ahead
# of dev — unless those facts happened to be typed into the conversation.
# This script gathers them from the machine and prints a markdown block that the
# hooks paste into the prompt, so the model reports facts instead of guessing.
#
# Ported from the `buildPmSnapshot` function in the pi extension at
# .pi/extensions/atlassian-aota/index.js, which had the same problem and solved
# it the same way. The pi original is left in place and unchanged.
#
# Usage:  pm-snapshot.sh <project_dir> <main_repo> <branch>
# Output: a markdown block on stdout. Always exits 0 — callers append `|| true`
#         and treat empty output as "no snapshot", never as an error. Nothing in
#         here may block a session teardown or a compaction.

set -uo pipefail

PROJECT_DIR="${1:-$(pwd)}"
MAIN_REPO="${2:-$PROJECT_DIR}"
BRANCH="${3:-unknown}"

BACKEND_REPO="adamtasteslikegood/tasteslikegood.com"

# `timeout` is GNU coreutils and is absent by default on macOS. Same fallback
# ladder the hooks use for the summarizer. Every command below is wrapped:
# these are network calls, and a hung `gh` must not strand the worker.
if command -v timeout >/dev/null 2>&1; then
  _t() { timeout "$@"; }
elif command -v gtimeout >/dev/null 2>&1; then
  _t() { gtimeout "$@"; }
else
  _t() { shift; "$@"; }  # drop the duration, run unbounded (worker is detached)
fi

echo "## PM snapshot (gathered from the machine, not the transcript)"
echo
echo "- Branch: \`$BRANCH\`"

# --- git position ----------------------------------------------------------
# "Ahead of dev" is the single most useful number for a reader deciding whether
# the session's work actually landed anywhere.
AHEAD=$(_t 10 git -C "$PROJECT_DIR" rev-list --count origin/dev..HEAD 2>/dev/null || echo "")
[ -n "$AHEAD" ] && echo "- Commits ahead of \`origin/dev\`: $AHEAD"

if DIRTY_OUT=$(_t 10 git -C "$PROJECT_DIR" status --porcelain 2>/dev/null); then
  if [ -n "$DIRTY_OUT" ]; then
    DIRTY=$(echo "$DIRTY_OUT" | wc -l | tr -d ' ')
  else
    DIRTY=0
  fi
  echo "- Uncommitted files in working tree: $DIRTY"
fi

# Cap the file list: a big refactor would otherwise crowd out the transcript.
CHANGED=$(_t 10 git -C "$PROJECT_DIR" diff --name-only origin/dev...HEAD 2>/dev/null | head -25)
if [ -n "$CHANGED" ]; then
  echo "- Files changed vs \`origin/dev\` (first 25):"
  printf '%s\n' "$CHANGED" | sed 's/^/  - /'
fi

# --- open PRs for this branch ----------------------------------------------
# Both repos: a session that touched Backend/ has a PR in each. Without this the
# log says "opened a PR" with no number.
if command -v gh >/dev/null 2>&1 && [ "$BRANCH" != "unknown" ]; then
  for spec in "cookbook|" "Backend|-R $BACKEND_REPO"; do
    label="${spec%%|*}"
    repo_args="${spec#*|}"
    # shellcheck disable=SC2086 -- repo_args is an intentional argument split
    prs=$(_t 25 gh pr list $repo_args --head "$BRANCH" --state open \
            --json number,title,url \
            --jq '.[] | "  - #\(.number) \(.title) — \(.url)"' 2>/dev/null || echo "")
    if [ -n "$prs" ]; then
      echo "- Open $label PRs for this branch:"
      printf '%s\n' "$prs"
    else
      echo "- Open $label PRs for this branch: none found"
    fi
  done
else
  echo "- Open PRs: not checked (gh unavailable or branch unknown)"
fi

# --- PM daemon + briefing freshness ----------------------------------------
# Only `npm run pm:daemon` writes this pidfile; the per-session MCP daemons do
# not. So "not running" is the common, harmless case — it means nobody started
# a background daemon on this machine, NOT that PM tooling is broken. Worth
# recording either way, because a stale briefing explains a stale session log.
PID_FILE="$MAIN_REPO/.agent-work/pm/pm-daemon.pid"
if [ -f "$PID_FILE" ]; then
  PID=$(tr -d '[:space:]' <"$PID_FILE" 2>/dev/null || echo "")
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "- PM daemon (pm:daemon): running, pid $PID"
  else
    echo "- PM daemon (pm:daemon): pidfile present but process $PID is gone (stale)"
  fi
else
  echo "- PM daemon (pm:daemon): not running (normal — MCP-spawned daemons write no pidfile)"
fi

BRIEFING="$MAIN_REPO/.agent-work/pm/PROJECT_PM_BRIEFING.md"
if [ -f "$BRIEFING" ]; then
  # `date -r` is BSD; GNU needs -r too but with a different meaning for other
  # flags, so use stat where available and fall back quietly.
  MTIME=$(date -u -r "$BRIEFING" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
          || stat -c %y "$BRIEFING" 2>/dev/null \
          || stat -f '%Sm' -t '%Y-%m-%dT%H:%M:%SZ' "$BRIEFING" 2>/dev/null \
          || echo "unknown")
  echo "- PM briefing last refreshed: $MTIME"
else
  echo "- PM briefing: absent (run \`npm run pm:brief\`)"
fi

# --- Atlassian link check ---------------------------------------------------
# Bounded hard: run_pm_script.sh bootstraps a venv on first run, and this is a
# network call. 25s then give up — an unreachable Jira must not cost the log.
if [ -f "$MAIN_REPO/scripts/pm/run_pm_script.sh" ]; then
  CHECK=$(_t 25 bash "$MAIN_REPO/scripts/pm/run_pm_script.sh" \
            atlassian_pm_link.py check 2>/dev/null | tail -12 || echo "")
  if [ -n "$CHECK" ]; then
    echo "- Atlassian link check:"
    printf '%s\n' "$CHECK" | sed 's/^/  /'
  else
    echo "- Atlassian link check: unavailable (timed out or errored)"
  fi
fi

exit 0
