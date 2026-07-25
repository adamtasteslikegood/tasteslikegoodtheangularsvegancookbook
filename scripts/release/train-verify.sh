#!/usr/bin/env bash
# Release-train verify stations (KAN-138).
#
# Read-only. Answers one question: is the two-repo release train in a state
# where the next release would be correct? Every station here exists because it
# caught real drift on a manual run — see the pilot log on KAN-138.
#
# Exit codes (the contract callers depend on; do NOT make this always-exit-0):
#   0  clean — no blocking drift
#   1  blocking drift — something must be fixed before the next release
#   2  usage or environment error (could not determine the answer)
#
# The distinction matters: exit 1 means "I checked and it's wrong", exit 2 means
# "I could not check". A caller that conflates them ships on a broken check.

set -euo pipefail

BACKEND_REPO="adamtasteslikegood/tasteslikegood.com"
COOKBOOK_REPO="adamtasteslikegood/tasteslikegoodtheangularsvegancookbook"

FORMAT="text"
FOR_RELEASE=0
DO_FETCH=1

usage() {
  cat <<'EOF'
Usage: scripts/release/train-verify.sh [--json] [--for-release] [--no-fetch]

  --json          machine-readable output (one JSON object on stdout)
  --for-release   stricter. Also requires: something to ship; the submodule
                  pointer pinned to Backend main's own SHA; the CHANGELOG
                  section naming that SHA; and this version not already tagged.
                  Queries origin for the tag even under --no-fetch (one ref
                  lookup) — guessing there would mean greenlighting a release
                  that silently never deploys.
  --no-fetch      skip network fetches; compare whatever refs are already local
                  (faster, but a stale origin/* gives a stale answer)

Exit: 0 clean, 1 blocking drift, 2 could not determine.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --json) FORMAT="json" ;;
    --for-release) FOR_RELEASE=1 ;;
    --no-fetch) DO_FETCH=0 ;;
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
  echo "train-verify: $*" >&2
  exit 2
}

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
cd "$ROOT"

# The Backend submodule is the half of the product that is easiest to get wrong,
# and an uninitialized checkout is the classic way these checks silently report
# the PARENT repo's branches under a Backend heading. Refuse rather than guess.
[ -f Backend/.git ] || [ -d Backend/.git ] ||
  die "Backend/ submodule is not initialized — run: git submodule update --init Backend"

if [ "$DO_FETCH" = "1" ]; then
  git fetch origin --prune --quiet || die "git fetch failed in the parent repo"
  git -C Backend fetch origin --prune --quiet || die "git fetch failed in Backend/"
fi

# rev-list over two refs; dies rather than returning a plausible-looking 0 when
# a ref is missing, because "0 commits of drift" is exactly the answer a caller
# would act on.
count_ahead() {
  local repo_dir="$1" base="$2" head="$3"
  git -C "$repo_dir" rev-parse --verify --quiet "$base" >/dev/null ||
    die "$repo_dir: ref not found: $base"
  git -C "$repo_dir" rev-parse --verify --quiet "$head" >/dev/null ||
    die "$repo_dir: ref not found: $head"
  git -C "$repo_dir" rev-list --count "$base..$head"
}

# ── Stations ────────────────────────────────────────────────────────────────

# 1. Back-sync debt. After a dev→main promotion, main carries a merge commit
#    that dev does not. Historically this step got skipped, and because the
#    debt is ancestry-only (identical trees) nothing visibly breaks — it just
#    means the drift count never reads 0 again, so the next person stops
#    trusting the check.
cookbook_backsync=$(count_ahead . origin/dev origin/main)
backend_backsync=$(count_ahead Backend origin/dev origin/main)

# 2. Promotion debt: what is on dev that main has not taken yet.
cookbook_pending=$(count_ahead . origin/main origin/dev)
backend_pending=$(count_ahead Backend origin/main origin/dev)

# 3. Submodule pointer. Production deploys whatever SHA the cookbook pins at
#    tag time, so the pointer is the actual release payload for the Backend.
pointer=$(git rev-parse origin/dev:Backend)
backend_dev_tip=$(git -C Backend rev-parse origin/dev)
backend_main_tip=$(git -C Backend rev-parse origin/main)

# The pointer targets Backend **main**, not dev. main is the promoted tip and
# the branch that is meant to equal the deployed codebase, so pinning main's own
# SHA is what makes "which Backend commit is in production?" answerable by
# looking at one ref. Pinning a dev-side SHA that merely has main's content —
# which is what shipped in v0.3.9 and what the pointer does right now — leaves
# the deployed SHA and Backend main permanently disagreeing.
pointer_state="matches-backend-main"
[ "$pointer" = "$backend_main_tip" ] || pointer_state="differs-from-backend-main"

# Diagnostic only, but it changes what the fix is: identical trees mean the
# pointer is merely aimed at the wrong SHA (bump it), while differing trees mean
# Backend dev→main has not been promoted yet (promote first, then bump).
pointer_vs_dev="matches-backend-dev"
[ "$pointer" = "$backend_dev_tip" ] || pointer_vs_dev="differs-from-backend-dev"

# Trees, not commits: a promotion merge makes main's SHA differ from dev's while
# the content is identical, and pinning either one deploys the same code.
#
# An unresolvable pinned SHA is "could not check", not "differs" — reporting it
# as a content mismatch would be the same sin as a false green, just inverted:
# a confident answer where there is none. Same treatment as count_ahead().
pointer_tree=$(git -C Backend rev-parse "$pointer^{tree}" 2>/dev/null) ||
  die "pinned Backend SHA $pointer is not in the local object database — run: git -C Backend fetch origin"
backend_main_tree=$(git -C Backend rev-parse "origin/main^{tree}")
pointer_content_state="matches-backend-main-content"
[ "$pointer_tree" = "$backend_main_tree" ] || pointer_content_state="differs-from-backend-main-content"

# 4. Alembic heads. Two heads means `flask db upgrade` refuses to run, which
#    fails the migrate Job and aborts the deploy mid-release.
#    Shared with pr-gate.yml's required "Backend — single Alembic head" job so
#    the release train and the merge gate can never disagree about the answer.
heads=$("$(dirname "${BASH_SOURCE[0]}")/alembic-heads.sh" 2>/dev/null || echo "error")

# 5. Version / CHANGELOG coherence. pr-gate enforces this on the release PR;
#    checking it here means a bad bump is caught before the PR exists.
version=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
changelog_state="missing"
if [ "$version" != "unknown" ] && grep -qE "^## \[?${version//./\\.}\]?" CHANGELOG.md 2>/dev/null; then
  changelog_state="present"
fi

# 5b. The release notes must name the Backend SHA they ship. Production deploys
#     whatever the pointer pins at tag time, so without this the CHANGELOG
#     describes the frontend half of a release and stays silent about the other
#     half. The convention already exists informally (v0.3.7, v0.3.9, v0.4.0);
#     this makes it checkable. Any abbreviation of the pinned SHA counts, since
#     that is how the existing entries are written.
changelog_pointer_state="absent"
if [ "$changelog_state" = "present" ]; then
  changelog_pointer_state=$(
    python3 - "$version" "$pointer" <<'PY' 2>/dev/null || echo "error"
import pathlib, re, sys

version, pointer = sys.argv[1], sys.argv[2]
text = pathlib.Path("CHANGELOG.md").read_text(encoding="utf-8", errors="replace")

# This version's section only: heading through the next h2 (or EOF). Scanning
# the whole file would happily match the PREVIOUS release's pointer line and
# call it present.
match = re.search(
    r"^##\s+\[?" + re.escape(version) + r"\]?.*?$(.*?)(?=^##\s|\Z)",
    text,
    re.M | re.S,
)
if not match:
    print("missing-section")
    raise SystemExit

for token in re.findall(r"\b[0-9a-f]{7,40}\b", match.group(1)):
    if pointer.startswith(token):
        print("present")
        raise SystemExit
print("absent")
PY
  )
fi

# 6. Is this version already shipped? Once vX.Y.Z is cut the version is spent:
#    release.yml checks `git ls-remote --tags` first and skips tag creation,
#    the GitHub Release, and therefore the Cloud Build trigger. Re-merging a
#    release PR on a spent version is the quietest failure in the whole train —
#    green PR, green workflow, no tag, no deploy, no error. The rule Adam
#    stated for the freeze window is the fix: once a tag is cut, the next thing
#    to land needs a patch bump.
#
#    Under --for-release this asks origin (same query release.yml makes, so the
#    answers cannot disagree) and refuses to guess if the network fails. In the
#    default mode it is informational and reads local tags, which is honest
#    about being only as fresh as the last fetch.
if [ "$FOR_RELEASE" = "1" ]; then
  # --exit-code distinguishes the two "no tag" answers: 2 means the query
  # succeeded and matched nothing, anything else means the query itself failed.
  # Collapsing them would turn an offline run into a confident "safe to ship".
  ls_remote_rc=0
  git ls-remote --exit-code --tags origin "refs/tags/v$version" >/dev/null 2>&1 || ls_remote_rc=$?
  case "$ls_remote_rc" in
    0) tag_state="already-tagged" ;;
    2) tag_state="not-tagged" ;;
    *) die "could not query origin for tag v$version (git ls-remote exit $ls_remote_rc) — cannot tell whether this version is already shipped" ;;
  esac
else
  if git rev-parse --verify --quiet "refs/tags/v$version" >/dev/null; then
    tag_state="already-tagged (local)"
  else
    tag_state="not-tagged (local)"
  fi
fi

# ── Verdict ─────────────────────────────────────────────────────────────────

blocking=()
warnings=()

[ "$cookbook_backsync" = "0" ] ||
  blocking+=("cookbook main→dev back-sync owed: $cookbook_backsync commit(s) on main are missing from dev")
[ "$backend_backsync" = "0" ] ||
  blocking+=("Backend main→dev back-sync owed: $backend_backsync commit(s) on main are missing from dev")

case "$heads" in
  1) ;;
  error) blocking+=("alembic heads could not be determined (is python3 available and Backend/migrations present?)") ;;
  *) blocking+=("alembic has $heads heads — 'flask db upgrade' will refuse to run; unify with 'flask db merge'") ;;
esac

if [ "$FOR_RELEASE" = "1" ]; then
  [ "$cookbook_pending" != "0" ] ||
    blocking+=("nothing to release: dev is not ahead of main")
  if [ "$pointer_state" != "matches-backend-main" ]; then
    if [ "$pointer_content_state" = "matches-backend-main-content" ]; then
      blocking+=("submodule pointer pins ${pointer:0:12}, Backend main is ${backend_main_tip:0:12} (identical tree) — bump the pointer to main's own SHA: git -C Backend checkout ${backend_main_tip:0:12} && git add Backend")
    else
      blocking+=("submodule pointer content differs from Backend main — promote Backend dev→main first, then pin main's SHA")
    fi
  fi
  case "$changelog_pointer_state" in
    present) ;;
    error) blocking+=("could not read the CHANGELOG section for $version to check the pinned Backend SHA") ;;
    *) blocking+=("CHANGELOG section for $version does not name the pinned Backend SHA (${pointer:0:12}) — the release notes would describe only the frontend half of what deploys") ;;
  esac
  [ "$changelog_state" = "present" ] ||
    blocking+=("CHANGELOG.md has no '## [$version]' section — pr-gate will fail the release PR")
  [ "$tag_state" != "already-tagged" ] ||
    blocking+=("v$version is already tagged — release.yml would skip the tag, the Release, and the Cloud Build trigger and report success. Bump package.json (patch, at minimum) before cutting.")
else
  [ "$backend_pending" = "0" ] ||
    warnings+=("Backend dev is $backend_pending commit(s) ahead of main — promotion needed before the next release")
  [ "$pointer_state" = "matches-backend-main" ] ||
    warnings+=("submodule pointer pins ${pointer:0:12}, Backend main is ${backend_main_tip:0:12}")
  [ "$changelog_state" = "present" ] ||
    warnings+=("CHANGELOG.md has no '## [$version]' section yet")
  [ "$changelog_state" != "present" ] || [ "$changelog_pointer_state" = "present" ] ||
    warnings+=("CHANGELOG section for $version does not name the pinned Backend SHA yet")
fi

status="clean"
[ ${#blocking[@]} -eq 0 ] || status="blocked"

if [ "$FORMAT" = "json" ]; then
  json_array() {
    local first=1 item
    printf '['
    for item in "$@"; do
      [ $first -eq 1 ] || printf ','
      first=0
      printf '%s' "$(printf '%s' "$item" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
    done
    printf ']'
  }
  printf '{'
  printf '"status":"%s",' "$status"
  printf '"version":"%s",' "$version"
  printf '"cookbook":{"backsync_owed":%s,"pending_release":%s},' "$cookbook_backsync" "$cookbook_pending"
  printf '"backend":{"backsync_owed":%s,"pending_promotion":%s},' "$backend_backsync" "$backend_pending"
  printf '"pointer":{"sha":"%s","state":"%s","content":"%s","vs_backend_dev":"%s","backend_main":"%s"},' "$pointer" "$pointer_state" "$pointer_content_state" "$pointer_vs_dev" "$backend_main_tip"
  printf '"alembic_heads":"%s",' "$heads"
  printf '"changelog":"%s",' "$changelog_state"
  printf '"changelog_pointer":"%s",' "$changelog_pointer_state"
  printf '"tag":"%s",' "$tag_state"
  printf '"blocking":%s,' "$(json_array ${blocking[@]+"${blocking[@]}"})"
  printf '"warnings":%s' "$(json_array ${warnings[@]+"${warnings[@]}"})"
  printf '}\n'
else
  echo "Release train — verify stations"
  echo "  repos            $COOKBOOK_REPO + $BACKEND_REPO"
  echo "  version          $version (CHANGELOG section: $changelog_state, tag v$version: $tag_state)"
  echo
  printf '  %-34s %s\n' "cookbook main->dev back-sync owed" "$cookbook_backsync"
  printf '  %-34s %s\n' "cookbook dev->main pending" "$cookbook_pending"
  printf '  %-34s %s\n' "Backend  main->dev back-sync owed" "$backend_backsync"
  printf '  %-34s %s\n' "Backend  dev->main pending" "$backend_pending"
  printf '  %-34s %s (%s)\n' "submodule pointer" "${pointer:0:12}" "$pointer_state"
  printf '  %-34s %s\n' "Backend  main tip" "${backend_main_tip:0:12}"
  printf '  %-34s %s\n' "pointer content vs Backend main" "$pointer_content_state"
  printf '  %-34s %s\n' "CHANGELOG names pinned SHA" "$changelog_pointer_state"
  printf '  %-34s %s\n' "alembic heads" "$heads"
  echo

  for item in ${warnings[@]+"${warnings[@]}"}; do echo "  WARN  $item"; done
  for item in ${blocking[@]+"${blocking[@]}"}; do echo "  BLOCK $item"; done

  if [ "$status" = "clean" ]; then
    echo "  OK — no blocking drift."
  fi
fi

[ "$status" = "clean" ] || exit 1
exit 0
