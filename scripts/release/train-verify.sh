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
  --for-release   stricter: also require that there is something to ship and
                  that the submodule pointer matches the Backend tip
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

pointer_state="matches-backend-dev"
[ "$pointer" = "$backend_dev_tip" ] || pointer_state="behind-backend-dev"

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
heads=$(
  python3 - <<'PY' 2>/dev/null || echo "error"
import pathlib, re

# Heads = revisions nobody names as a parent, which is how alembic computes
# them. Parsed rather than shelled out to `flask db heads` so this station
# needs no Backend virtualenv. The down_revision pattern deliberately allows a
# tuple to span lines: a merge migration's `down_revision = ('a', 'b')` is one
# line as alembic writes it, but a formatter will wrap a long one, and missing
# those parents would over-count heads and block a release that is fine.
versions = pathlib.Path("Backend/migrations/versions")
revisions, parents = set(), set()
for path in versions.glob("*.py"):
    text = path.read_text(encoding="utf-8", errors="replace")
    match = re.search(r"^revision(?::\s*str)?\s*=\s*['\"]([^'\"]+)['\"]", text, re.M)
    if match:
        revisions.add(match.group(1))
    for down in re.findall(
        r"down_revision(?:\s*:[^=]*)?\s*=\s*(\([^)]*\)|\[[^\]]*\]|['\"][^'\"]*['\"])",
        text,
        re.S,
    ):
        parents.update(re.findall(r"['\"]([^'\"]+)['\"]", down))
print(len(revisions - parents) if revisions else "error")
PY
)

# 5. Version / CHANGELOG coherence. pr-gate enforces this on the release PR;
#    checking it here means a bad bump is caught before the PR exists.
version=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
changelog_state="missing"
if [ "$version" != "unknown" ] && grep -qE "^## \[?${version//./\\.}\]?" CHANGELOG.md 2>/dev/null; then
  changelog_state="present"
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
  [ "$pointer_state" = "matches-backend-dev" ] ||
    blocking+=("submodule pointer is behind Backend dev — bump it before cutting the release")
  [ "$pointer_content_state" = "matches-backend-main-content" ] ||
    blocking+=("submodule pointer content differs from Backend main — promote Backend dev→main first")
  [ "$changelog_state" = "present" ] ||
    blocking+=("CHANGELOG.md has no '## [$version]' section — pr-gate will fail the release PR")
else
  [ "$backend_pending" = "0" ] ||
    warnings+=("Backend dev is $backend_pending commit(s) ahead of main — promotion needed before the next release")
  [ "$pointer_state" = "matches-backend-dev" ] ||
    warnings+=("submodule pointer is behind Backend dev")
  [ "$changelog_state" = "present" ] ||
    warnings+=("CHANGELOG.md has no '## [$version]' section yet")
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
  printf '"pointer":{"sha":"%s","state":"%s","content":"%s"},' "$pointer" "$pointer_state" "$pointer_content_state"
  printf '"alembic_heads":"%s",' "$heads"
  printf '"changelog":"%s",' "$changelog_state"
  printf '"blocking":%s,' "$(json_array ${blocking[@]+"${blocking[@]}"})"
  printf '"warnings":%s' "$(json_array ${warnings[@]+"${warnings[@]}"})"
  printf '}\n'
else
  echo "Release train — verify stations"
  echo "  repos            $COOKBOOK_REPO + $BACKEND_REPO"
  echo "  version          $version (CHANGELOG section: $changelog_state)"
  echo
  printf '  %-34s %s\n' "cookbook main->dev back-sync owed" "$cookbook_backsync"
  printf '  %-34s %s\n' "cookbook dev->main pending" "$cookbook_pending"
  printf '  %-34s %s\n' "Backend  main->dev back-sync owed" "$backend_backsync"
  printf '  %-34s %s\n' "Backend  dev->main pending" "$backend_pending"
  printf '  %-34s %s (%s)\n' "submodule pointer" "${pointer:0:12}" "$pointer_state"
  printf '  %-34s %s\n' "pointer content vs Backend main" "$pointer_content_state"
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
