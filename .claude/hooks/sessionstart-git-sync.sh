#!/usr/bin/env bash
# SessionStart hook — automate CLAUDE.md "sync before you act" steps 1-2.
#
# Local checkouts on this machine routinely lag origin, and parallel agent
# sessions may already be working the same area. This hook runs the READ-ONLY
# half of the ritual on every session start — fetch origin for the parent repo
# and the Backend submodule, then report ahead/behind for `dev` — and injects
# the divergence summary into the session context so the agent starts informed.
#
# Deliberately NON-MUTATING: it never runs `submodule update`, `pull`, or checks
# out anything. Moving the working tree or submodule pointer silently on every
# session start would clobber in-progress work. When `dev` is behind, the
# injected context tells the agent the exact `--ff-only` command to run.
#
# Design rules (mirrors precompact-session-log.sh):
#   * Fail-open: never wedge session start. Every path exits 0.
#   * Bounded: hook-level timeout in settings.json caps the network fetch.
#   * Recursion guard: the PreCompact/SessionEnd summarizer spawns `claude -p`,
#     which fires SessionStart again. Skip when that flag is set.
#
# SessionStart stdin (JSON): session_id, transcript_path, cwd, hook_event_name,
#                            source ("startup"|"resume"|"clear"|"compact").

set -uo pipefail
trap 'exit 0' ERR

# The session-log summarizer runs `claude -p`, which re-enters this hook. Bail.
if [ -n "${CLAUDE_PM_SESSION_LOG_ACTIVE:-}" ]; then
  exit 0
fi

INPUT=$(cat 2>/dev/null || true)

_field() {
  printf '%s' "$INPUT" | python3 -c "
import json,sys
try: print((json.load(sys.stdin) or {}).get('$1','') or '')
except Exception: print('')
" 2>/dev/null
}

SOURCE=$(_field source)
CWD=$(_field cwd)
[ -n "$CWD" ] || CWD="$(pwd)"

# Skip the mid-lifecycle re-entries: a compaction is not a fresh session, and a
# fetch summary injected there is noise. Run on startup / resume / clear.
if [ "$SOURCE" = "compact" ]; then
  exit 0
fi

# Resolve the MAIN checkout. Worktree sessions live in .claude/worktrees/* where
# the Backend submodule may be uninitialized; the shared .git of the main
# checkout always has Backend and the right `dev` refs. --git-common-dir points
# there from any linked worktree, and to the repo itself from the main checkout.
COMMON_GIT=$(git -C "$CWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")
if [ -n "$COMMON_GIT" ] && [ -d "$COMMON_GIT" ]; then
  MAIN_REPO=$(dirname "$COMMON_GIT")
else
  MAIN_REPO="$CWD"
fi

# Not a git repo? Nothing to sync.
git -C "$MAIN_REPO" rev-parse --git-dir >/dev/null 2>&1 || exit 0

# --- ahead/behind for one repo against origin/<base>, fetch first -----------
# Prints one summary line to stdout. Never fails the caller.
_repo_divergence() {
  local dir="$1" label="$2" base="${3:-dev}"
  git -C "$dir" rev-parse --git-dir >/dev/null 2>&1 || return 0

  # Fetch is best-effort; a network hiccup must not block the session. The
  # hook-level timeout in settings.json bounds the total.
  git -C "$dir" fetch origin --prune --quiet 2>/dev/null || true

  # Need both local base and origin/base to compare.
  git -C "$dir" rev-parse --verify --quiet "refs/heads/$base" >/dev/null 2>&1 || {
    printf '%s: no local `%s` branch (skipped)\n' "$label" "$base"; return 0; }
  git -C "$dir" rev-parse --verify --quiet "refs/remotes/origin/$base" >/dev/null 2>&1 || {
    printf '%s: no origin/%s (skipped)\n' "$label" "$base"; return 0; }

  local behind ahead
  behind=$(git -C "$dir" rev-list --count "${base}..origin/${base}" 2>/dev/null || echo 0)
  ahead=$(git -C "$dir" rev-list --count "origin/${base}..${base}" 2>/dev/null || echo 0)

  if [ "$behind" -eq 0 ] && [ "$ahead" -eq 0 ]; then
    printf '%s: `%s` up to date with origin/%s\n' "$label" "$base" "$base"
  else
    printf '%s: `%s` is %s behind / %s ahead of origin/%s\n' \
      "$label" "$base" "$behind" "$ahead" "$base"
  fi
}

CUR_BRANCH=$(git -C "$CWD" branch --show-current 2>/dev/null || echo "?")

SUMMARY=$(
  echo "Automated git sync (read-only fetch) at session start:"
  _repo_divergence "$MAIN_REPO" "cookbook"
  if [ -d "$MAIN_REPO/Backend/.git" ] || [ -f "$MAIN_REPO/Backend/.git" ]; then
    _repo_divergence "$MAIN_REPO/Backend" "Backend"
  else
    echo "Backend: submodule not initialized in main checkout (skipped)"
  fi
  echo "This session's branch: \`$CUR_BRANCH\`."
  echo "If \`dev\` is behind: \`git switch dev && git pull --ff-only\` (in the main checkout), then branch new work off \`origin/dev\`. This hook does NOT pull or update submodules for you."
)

# Emit as SessionStart additionalContext (JSON-encoded safely via python3).
python3 -c "
import json,sys
ctx = sys.stdin.read()
print(json.dumps({'hookSpecificOutput': {'hookEventName': 'SessionStart', 'additionalContext': ctx}}))
" <<<"$SUMMARY" 2>/dev/null || true

exit 0
