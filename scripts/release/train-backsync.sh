#!/usr/bin/env bash
# Release-train back-sync (KAN-138) — step 8/9 of the train.
#
# After a dev→main promotion, main carries a merge commit that dev does not.
# Skipping the back-sync is the single most repeated miss in this project's
# release history (Backend #227/#236 before v0.4.3, Backend #245 after v0.4.4).
# The debt is ancestry-only — identical trees — so nothing breaks visibly; it
# just means every later drift check reads non-zero and stops being trusted.
#
# Opens (and optionally merges) the main→dev PRs. Runs LOCALLY, not in CI:
#   - the Backend repo is a different repository, and Actions' GITHUB_TOKEN is
#     scoped to this one;
#   - `dev` carries `required_linear_history` in both repos, so a merge-commit
#     merge into dev only lands for an actor with ruleset bypass (repo admin).
#     Squashing instead would defeat the whole point: it rewrites the commits,
#     ancestry never converges, and the drift count never reaches zero.
#
# Default is a dry run. Pass --apply to actually open PRs.

set -euo pipefail

COOKBOOK_REPO="adamtasteslikegood/tasteslikegoodtheangularsvegancookbook"
BACKEND_REPO="adamtasteslikegood/tasteslikegood.com"

APPLY=0
MERGE=0
ONLY=""

usage() {
  cat <<'EOF'
Usage: scripts/release/train-backsync.sh [--apply] [--merge] [--only cookbook|backend]

  (default)   dry run — report what would be opened, change nothing
  --apply     open the main→dev back-sync PR(s)
  --merge     also merge them, with a MERGE COMMIT (never squash)
  --only X    restrict to one repo

Exit: 0 nothing owed / work done, 1 action needed but not applied, 2 error.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --merge) MERGE=1 ;;
    --only)
      shift
      ONLY="${1:-}"
      case "$ONLY" in
        cookbook | backend) ;;
        *)
          echo "--only takes 'cookbook' or 'backend'" >&2
          exit 2
          ;;
      esac
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

die() {
  echo "train-backsync: $*" >&2
  exit 2
}

command -v gh >/dev/null 2>&1 || die "gh CLI is required"

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
cd "$ROOT"
[ -f Backend/.git ] || [ -d Backend/.git ] ||
  die "Backend/ submodule is not initialized — run: git submodule update --init Backend"

owed_anywhere=0

backsync_one() {
  local label="$1" repo_dir="$2" gh_repo="$3"

  git -C "$repo_dir" fetch origin --prune --quiet || die "$label: fetch failed"
  local owed
  owed=$(git -C "$repo_dir" rev-list --count origin/dev..origin/main)

  if [ "$owed" = "0" ]; then
    echo "  $label: in sync (0 commits owed)"
    return 0
  fi

  owed_anywhere=1
  echo "  $label: $owed commit(s) on main are missing from dev"
  git -C "$repo_dir" log --oneline origin/dev..origin/main | sed 's/^/      /'

  if [ "$APPLY" != "1" ]; then
    echo "      (dry run — re-run with --apply to open the PR)"
    return 0
  fi

  # An existing open back-sync PR means a previous run got this far; don't
  # stack a second one on top of it.
  local existing
  existing=$(gh pr list -R "$gh_repo" --state open --base dev --head main \
    --json number --jq '.[0].number // empty' 2>/dev/null || true)

  if [ -n "$existing" ]; then
    echo "      PR #$existing already open"
  else
    gh pr create -R "$gh_repo" --base dev --head main \
      --title "chore(sync): back-sync main → dev after release promotion [KAN-138]" \
      --body "$(
        cat <<EOF
Step 8/9 of the release train — main → dev back-sync.

\`main\` carries $owed commit(s) that \`dev\` does not (the promotion merge from
the last release). The trees are typically identical, so this ships no code
change; it converges ancestry so the train's drift stations can read zero again.

Opened by \`scripts/release/train-backsync.sh\`.

**Merge with a merge commit, never squash** — squashing rewrites the commits and
ancestry never converges, which is what left this debt outstanding in the first
place.

_Opened by Claude on Adam's behalf_
EOF
      )" >/dev/null || die "$label: gh pr create failed"

    existing=$(gh pr list -R "$gh_repo" --state open --base dev --head main \
      --json number --jq '.[0].number // empty')
    echo "      opened PR #$existing"
  fi

  if [ "$MERGE" = "1" ] && [ -n "$existing" ]; then
    # --merge, explicitly: `dev` allows squash by ruleset, so the wrong choice
    # is reachable here and would silently undo the purpose of this PR.
    gh pr merge "$existing" -R "$gh_repo" --merge ||
      die "$label: merge of #$existing failed (ruleset bypass requires admin)"
    echo "      merged #$existing with a merge commit"
  fi
}

echo "Release train — back-sync (main → dev)"
[ "$APPLY" = "1" ] || echo "  mode: DRY RUN"

if [ "$ONLY" != "backend" ]; then
  backsync_one "cookbook" "." "$COOKBOOK_REPO"
fi
if [ "$ONLY" != "cookbook" ]; then
  backsync_one "Backend " "Backend" "$BACKEND_REPO"
fi

if [ "$owed_anywhere" = "1" ] && [ "$APPLY" != "1" ]; then
  exit 1
fi
exit 0
