#!/bin/bash
# branch-preflight - Refuse to start work on a stale branch or a rolled-back Backend pointer.
#
# Run from the cookbook repo root (or any worktree of it) before starting work
# on a branch, and again before opening a PR:
#
#   scripts/git/branch-preflight.sh                # current branch vs origin/dev
#   scripts/git/branch-preflight.sh --max-behind 5 # tolerate a few commits behind
#
# Two checks (KAN-303, Sprint 8 retro action 6):
#   1. Commits behind origin/<base>. A branch cut from a stale local dev cost four
#      sessions in Sprint 8; any commit behind fails unless --max-behind allows it.
#   2. Backend pointer ancestry. The branch's Backend gitlink must be origin/<base>'s
#      gitlink or a descendant of it. Anything else would roll the submodule back
#      when the branch merges (Sprint 8: 18 commits, no gate caught it). Checked for
#      the committed gitlink (HEAD) AND the staged one, because a staged re-pin
#      survives `git switch` and is absorbed by the next commit on any branch.
#
# Exit codes:
#   0  preflight passed
#   1  preflight failed (branch behind, or Backend pointer not a descendant)
#   2  could not inspect (not the cookbook root, fetch failed, Backend objects missing)
#      — never a pass

set -uo pipefail

BASE="dev"
MAX_BEHIND=0
FETCH=true

usage() {
  sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    --base)
      [[ $# -ge 2 ]] || { echo "Error: --base requires a branch name" >&2; exit 2; }
      BASE="$2"; shift 2 ;;
    --max-behind)
      [[ $# -ge 2 && "$2" =~ ^[0-9]+$ ]] || { echo "Error: --max-behind requires a non-negative integer" >&2; exit 2; }
      MAX_BEHIND="$2"; shift 2 ;;
    --no-fetch) FETCH=false; shift ;;
    *) echo "Error: unknown argument $1" >&2; exit 2 ;;
  esac
done

REMOTE_BASE="origin/$BASE"
failed=0

toplevel=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "❌ not inside a git repository" >&2; exit 2; }
cd "$toplevel" || exit 2
if [[ "$(git ls-files --stage -- Backend | awk '{print $1}')" != "160000" ]]; then
  echo "❌ $toplevel has no Backend gitlink; run this from the cookbook repo" >&2
  exit 2
fi

if [[ "$FETCH" == true ]]; then
  git fetch --quiet origin --prune || { echo "❌ git fetch origin failed; refs are stale, refusing to judge" >&2; exit 2; }
fi
git rev-parse --verify --quiet "$REMOTE_BASE^{commit}" >/dev/null || { echo "❌ $REMOTE_BASE does not resolve" >&2; exit 2; }

branch=$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD)
echo "🔍 Preflight: $branch vs $REMOTE_BASE"

# ── 1. Commits behind ─────────────────────────────────────────────
read -r ahead behind < <(git rev-list --left-right --count "HEAD...$REMOTE_BASE")
if (( behind > MAX_BEHIND )); then
  echo "❌ behind: $branch is $behind commit(s) behind $REMOTE_BASE (ahead $ahead; allowed $MAX_BEHIND)"
  echo "   fix: rebase or merge $REMOTE_BASE, or start fresh with: git switch -c <topic> $REMOTE_BASE"
  failed=1
else
  echo "✅ behind: $behind commit(s) behind $REMOTE_BASE (ahead $ahead; allowed $MAX_BEHIND)"
fi

# ── 2. Backend pointer ancestry ───────────────────────────────────
base_ptr=$(git rev-parse "$REMOTE_BASE:Backend" 2>/dev/null) || { echo "❌ cannot read Backend gitlink on $REMOTE_BASE" >&2; exit 2; }
head_ptr=$(git rev-parse "HEAD:Backend" 2>/dev/null) || { echo "❌ cannot read Backend gitlink on HEAD" >&2; exit 2; }
staged_ptr=$(git ls-files --stage -- Backend | awk '{print $2}')

if [[ ! -e Backend/.git ]]; then
  echo "❌ Backend submodule is not initialized; run: git submodule update --init Backend" >&2
  exit 2
fi
if [[ "$FETCH" == true ]]; then
  git -C Backend fetch --quiet origin --prune || { echo "❌ git -C Backend fetch failed" >&2; exit 2; }
fi

check_ptr() {
  local label="$1" ptr="$2"
  if [[ "$ptr" == "$base_ptr" ]]; then
    echo "✅ backend ($label): ${ptr:0:12} equals $REMOTE_BASE's pointer"
    return 0
  fi
  local obj
  for obj in "$ptr" "$base_ptr"; do
    if ! git -C Backend cat-file -e "$obj^{commit}" 2>/dev/null; then
      echo "❌ backend ($label): Backend commit ${obj:0:12} is not available locally; cannot judge ancestry" >&2
      exit 2
    fi
  done
  if git -C Backend merge-base --is-ancestor "$base_ptr" "$ptr"; then
    local n
    n=$(git -C Backend rev-list --count "$base_ptr..$ptr")
    echo "✅ backend ($label): ${ptr:0:12} is $n commit(s) ahead of $REMOTE_BASE's ${base_ptr:0:12}"
  else
    local lost
    lost=$(git -C Backend rev-list --count "$ptr..$base_ptr")
    echo "❌ backend ($label): ${ptr:0:12} is NOT a descendant of $REMOTE_BASE's ${base_ptr:0:12}; merging would roll Backend back ($lost commit(s) on $REMOTE_BASE's pointer are missing)"
    echo "   fix: git -C Backend checkout $base_ptr (or a descendant) && git add Backend"
    failed=1
  fi
}

check_ptr "HEAD" "$head_ptr"
if [[ "$staged_ptr" != "$head_ptr" ]]; then
  check_ptr "staged" "$staged_ptr"
fi

if (( failed )); then
  echo "❌ preflight FAILED"
  exit 1
fi
echo "✅ preflight passed"
exit 0
