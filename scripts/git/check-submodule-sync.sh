#!/usr/bin/env bash
#
# check-submodule-sync.sh
#
# Guards against the "detached gitlink" failure mode: backend submodule's
# main/dev diverge, or the parent repo's dev branch points at a submodule
# SHA that isn't reachable from a clean line off submodule main.
#
# Two modes, chosen by $1:
#
#   divergence   Run INSIDE the backend submodule repo.
#                Fails if main and dev have diverged (i.e. main has commits
#                not reachable from dev). dev being ahead of main is fine.
#
#   gitlink      Run INSIDE the parent repo (with submodule checked out).
#                Fails if the parent's gitlink SHA for the submodule is not
#                reachable from the submodule's dev branch tip.
#
# Usage:
#   ./check-submodule-sync.sh divergence
#   ./check-submodule-sync.sh gitlink <submodule_path> [dev_branch] [main_branch]
#
# Exits non-zero + prints a reason on failure. Safe to wire directly into
# a GH Action step.

set -euo pipefail

MODE="${1:-}"
MAIN_BRANCH_DEFAULT="main"
DEV_BRANCH_DEFAULT="dev"

fail() {
  echo "::error::$1"
  exit 1
}

case "$MODE" in
  divergence)
    MAIN_BRANCH="${2:-$MAIN_BRANCH_DEFAULT}"
    DEV_BRANCH="${3:-$DEV_BRANCH_DEFAULT}"

    git fetch origin "$MAIN_BRANCH" "$DEV_BRANCH" --quiet

    MAIN_SHA="$(git rev-parse "origin/$MAIN_BRANCH")"
    DEV_SHA="$(git rev-parse "origin/$DEV_BRANCH")"

    echo "backend $MAIN_BRANCH: $MAIN_SHA"
    echo "backend $DEV_BRANCH:  $DEV_SHA"

    if [ "$MAIN_SHA" = "$DEV_SHA" ]; then
      echo "in sync (identical commit)"
      exit 0
    fi

    if git merge-base --is-ancestor "$MAIN_SHA" "$DEV_SHA"; then
      echo "ok: $MAIN_BRANCH is an ancestor of $DEV_BRANCH ($DEV_BRANCH is ahead, no divergence)"
      exit 0
    fi

    # main has commits dev doesn't have -> true divergence
    ONLY_ON_MAIN="$(git rev-list --count "$DEV_SHA..$MAIN_SHA")"
    fail "backend $MAIN_BRANCH and $DEV_BRANCH have diverged: $ONLY_ON_MAIN commit(s) on $MAIN_BRANCH not reachable from $DEV_BRANCH. Merge/rebase $MAIN_BRANCH into $DEV_BRANCH before this PR can be trusted."
    ;;

  gitlink)
    SUBMODULE_PATH="${2:?submodule path required, e.g. backend}"
    DEV_BRANCH="${3:-$DEV_BRANCH_DEFAULT}"
    MAIN_BRANCH="${4:-$MAIN_BRANCH_DEFAULT}"

    [ -d "$SUBMODULE_PATH" ] || fail "submodule path '$SUBMODULE_PATH' not found"

    GITLINK_SHA="$(git ls-tree HEAD "$SUBMODULE_PATH" | awk '{print $3}')"
    [ -n "$GITLINK_SHA" ] || fail "could not resolve gitlink SHA for '$SUBMODULE_PATH'"

    pushd "$SUBMODULE_PATH" > /dev/null
    git fetch origin "$DEV_BRANCH" "$MAIN_BRANCH" --quiet
    DEV_TIP="$(git rev-parse "origin/$DEV_BRANCH")"

    echo "parent gitlink -> $GITLINK_SHA"
    echo "submodule $DEV_BRANCH tip -> $DEV_TIP"

    if [ "$GITLINK_SHA" = "$DEV_TIP" ]; then
      echo "ok: gitlink points exactly at submodule $DEV_BRANCH tip"
      popd > /dev/null
      exit 0
    fi

    if git cat-file -e "$GITLINK_SHA^{commit}" 2>/dev/null \
       && git merge-base --is-ancestor "$GITLINK_SHA" "$DEV_TIP"; then
      echo "ok: gitlink SHA is an ancestor of submodule $DEV_BRANCH (stale but reachable, non-blocking)"
      popd > /dev/null
      exit 0
    fi

    popd > /dev/null
    fail "parent gitlink SHA ($GITLINK_SHA) for '$SUBMODULE_PATH' is not reachable from submodule $DEV_BRANCH tip ($DEV_TIP). The pointer is orphaned or points to a commit off a diverged branch. Re-run the sync step to select a valid commit and re-commit the gitlink."
    ;;

  *)
    echo "usage: $0 divergence [main_branch] [dev_branch]"
    echo "       $0 gitlink <submodule_path> [dev_branch] [main_branch]"
    exit 2
    ;;
esac
