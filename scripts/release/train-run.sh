#!/usr/bin/env bash
# Release-train driver (KAN-191) — the interactive half of scripts/release/.
#
# Walks the ordered procedure in RUNBOOK.md, keeps a checklist on disk, and
# STOPS BEFORE EVERY MUTATING STEP to print the exact state it is about to act
# on. Nothing here merges, tags, or deploys without a typed confirmation.
#
# Why a driver at all: the train spans two repos, ten steps, and four traps that
# have each cost a real release. Every one of those misses was an ordering or
# staleness error a human made while holding the whole sequence in their head —
# not a hard step. This holds the sequence instead.
#
# Why interactive rather than full auto: the mutating steps need a credential or
# a judgment the automation should not own (version choice, CHANGELOG prose,
# merging the release PR = deploying). Run it enough times with confirmations
# and the safe steps can graduate to --yes; the checklist is the record of which
# ones have earned it.
#
# Exit codes:
#   0  the run reached its end state
#   1  a step failed, or a precondition was violated
#   2  usage / environment error (could not determine)
#
# Usage:
#   ./scripts/release/train-run.sh                 # walk from where you are
#   ./scripts/release/train-run.sh --status        # print checklist + state, do nothing
#   ./scripts/release/train-run.sh --verify-only   # step 9 (production check) alone
#   ./scripts/release/train-run.sh --verify-only --marker 'some new string'
#                                                # non-interactive: pass the marker
#   ./scripts/release/train-run.sh --bump 0.4.9    # step 5: version + CHANGELOG scaffold
#   ./scripts/release/train-run.sh --reset         # clear the checklist, start a fresh release
#   ./scripts/release/train-run.sh --dry-run       # print every command, run none of them

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
cd "$ROOT" || exit 2

STATE_DIR="$ROOT/.agent-work/release"
STATE="$STATE_DIR/train-state.json"
BACKEND_REPO="adamtasteslikegood/tasteslikegood.com"
PROD="https://www.tasteslikegood.org"

DRY_RUN=0
MODE="walk"
MARKER=""
BUMP_TO=""

while [ $# -gt 0 ]; do
  case "$1" in
    --status) MODE="status" ;;
    --verify-only) MODE="verify" ;;
    --reset) MODE="reset" ;;
    --dry-run) DRY_RUN=1 ;;
    --bump)
      shift
      [ $# -gt 0 ] || { echo "--bump needs a version (X.Y.Z)" >&2; exit 2; }
      MODE="bump"
      BUMP_TO="$1"
      ;;
    --marker)
      shift
      [ $# -gt 0 ] || { echo "--marker needs a value" >&2; exit 2; }
      MARKER="$1"
      ;;
    -h | --help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

# ── output ──────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; C=$'\033[36m'; X=$'\033[0m'
else
  B=""; DIM=""; R=""; G=""; Y=""; C=""; X=""
fi

say()  { printf '%s\n' "$*"; }
head2(){ printf '\n%s%s%s\n' "$B" "$*" "$X"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$X" "$*"; }
bad()  { printf '  %s✗%s %s\n' "$R" "$X" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$X" "$*"; }
info() { printf '  %s·%s %s\n' "$DIM" "$X" "$*"; }
die()  { printf '%serror:%s %s\n' "$R" "$X" "$*" >&2; exit 2; }

# ── checklist state ─────────────────────────────────────────────────────────
# One JSON object: {"version": "...", "steps": {"2": "done", ...}}. Kept under
# .agent-work/ (gitignored) so a half-finished train is never committed.
mkdir -p "$STATE_DIR" 2>/dev/null || die "cannot create $STATE_DIR"
[ -f "$STATE" ] || printf '{"version":null,"steps":{}}\n' > "$STATE"

state_get() {
  python3 - "$STATE" "$1" <<'PY' 2>/dev/null || echo ""
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print(""); raise SystemExit
print(d.get("steps", {}).get(sys.argv[2], "") or "")
PY
}

state_set() {
  python3 - "$STATE" "$1" "$2" <<'PY' || die "could not write $STATE"
import json, sys
p = sys.argv[1]
try:
    d = json.load(open(p))
except Exception:
    d = {"version": None, "steps": {}}
d.setdefault("steps", {})[sys.argv[2]] = sys.argv[3]
json.dump(d, open(p, "w"), indent=2)
PY
}

state_version_set() {
  python3 - "$STATE" "$1" <<'PY' || true
import json, sys
p = sys.argv[1]
try:
    d = json.load(open(p))
except Exception:
    d = {"version": None, "steps": {}}
d["version"] = sys.argv[2]
json.dump(d, open(p, "w"), indent=2)
PY
}

if [ "$MODE" = "reset" ]; then
  printf '{"version":null,"steps":{}}\n' > "$STATE"
  ok "checklist cleared — $STATE"
  exit 0
fi

# ── confirmation ────────────────────────────────────────────────────────────
# Typed word, not y/n. A mutating step that fires the production deploy should
# cost more than a reflexive keystroke.
confirm() {
  local word="$1" prompt="$2"
  if [ "$DRY_RUN" = "1" ]; then
    info "dry-run: would ask to confirm with '$word'"
    return 1
  fi
  if [ ! -t 0 ]; then
    warn "not a TTY — cannot confirm interactively. Re-run in a terminal, or do this step by hand."
    return 1
  fi
  printf '\n  %s%s%s\n  type %s%s%s to proceed (anything else skips): ' "$Y" "$prompt" "$X" "$B" "$word" "$X"
  local answer=""
  read -r answer
  [ "$answer" = "$word" ]
}

run() {
  if [ "$DRY_RUN" = "1" ]; then
    info "would run: $*"
    return 0
  fi
  "$@"
}

# ── state gathering (read-only, always safe) ────────────────────────────────
gather() {
  git fetch origin --prune --quiet 2>/dev/null || warn "git fetch failed — state below may be stale"
  if [ -e Backend/.git ] || [ -f Backend/.git ]; then
    git -C Backend fetch origin --prune --quiet 2>/dev/null || warn "Backend fetch failed — state below may be stale"
  else
    die "Backend/ submodule is not initialized — run: git submodule update --init Backend"
  fi

  VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
  CB_DEV=$(git rev-parse --short origin/dev)
  CB_MAIN=$(git rev-parse --short origin/main)
  CB_PENDING=$(git rev-list --count origin/main..origin/dev)
  CB_BACKSYNC=$(git rev-list --count origin/dev..origin/main)
  BE_DEV=$(git -C Backend rev-parse --short origin/dev)
  BE_MAIN=$(git -C Backend rev-parse --short origin/main)
  BE_PENDING=$(git -C Backend rev-list --count origin/main..origin/dev)
  BE_BACKSYNC=$(git -C Backend rev-list --count origin/dev..origin/main)
  POINTER=$(git rev-parse origin/dev:Backend)
  POINTER_SHORT=${POINTER:0:12}
  BE_MAIN_FULL=$(git -C Backend rev-parse origin/main)
  TAG_EXISTS=$(git ls-remote --tags origin "refs/tags/v$VERSION" 2>/dev/null | head -1)

  # Trees, not commit counts. After a back-sync, Backend dev is permanently 1
  # ahead of main (dev = merge(dev, main)) with an IDENTICAL tree — that is the
  # steady state, not unshipped work. Counting commits alone reports a promotion
  # owed forever and trains the reader to ignore the line. Caught by running this
  # driver against a just-released repo, where it did exactly that.
  BE_DEV_TREE=$(git -C Backend rev-parse origin/dev^{tree})
  BE_MAIN_TREE=$(git -C Backend rev-parse origin/main^{tree})
  if [ "$BE_DEV_TREE" = "$BE_MAIN_TREE" ]; then
    BE_PROMOTION_OWED=0
  else
    BE_PROMOTION_OWED=1
  fi
}

print_state() {
  head2 "State"
  printf '  %-34s %s\n' "cookbook dev / main"  "$CB_DEV / $CB_MAIN"
  printf '  %-34s %s\n' "  dev→main pending"   "$CB_PENDING"
  printf '  %-34s %s\n' "  main→dev back-sync owed" "$CB_BACKSYNC"
  printf '  %-34s %s\n' "Backend dev / main"   "$BE_DEV / $BE_MAIN"
  printf '  %-34s %s\n' "  dev→main pending"   "$BE_PENDING"
  printf '  %-34s %s\n' "  main→dev back-sync owed" "$BE_BACKSYNC"
  printf '  %-34s %s\n' "submodule pointer"    "$POINTER_SHORT"
  if [ "$POINTER" = "$BE_MAIN_FULL" ]; then
    ok "pointer == Backend main"
  else
    bad "pointer != Backend main (${BE_MAIN_FULL:0:12}) — see RUNBOOK step 4"
  fi
  printf '  %-34s %s\n' "version"              "$VERSION"
  if [ -n "$TAG_EXISTS" ]; then
    bad "v$VERSION is ALREADY TAGGED — a re-merge deploys nothing and reports success"
  else
    ok "v$VERSION not yet tagged"
  fi
}

STEPS=(
  "0|Establish starting state (fetch both repos, read the stations)"
  "1|Backend change merged to Backend dev"
  "2|Backend dev → main promotion"
  "3|Backend main → dev back-sync"
  "4|Pin pointer to Backend main's own SHA"
  "5|Version bump + CHANGELOG on a branch → cookbook dev"
  "6|Cookbook dev → main release PR"
  "7|Tag vX.Y.Z pushed → Cloud Build fires"
  "8|Back-sync both repos"
  "9|Verify production by content"
  "10|Close out (stations green, drift zero, Jira moved with evidence)"
)

# ── does the CHANGELOG section for $VERSION exist, and does it name the pointer?
# RUNBOOK step 5 requires both: train-verify checks the section against the
# ACTUAL pointer, so the SHA in the prose and the gitlink must agree.
# Prints one of: missing | absent | section-only | named
changelog_state() {
  python3 - "$VERSION" "$POINTER" <<'PY' 2>/dev/null || echo "missing"
import re, sys
ver, pointer = sys.argv[1], sys.argv[2]
try:
    text = open("CHANGELOG.md").read()
except OSError:
    print("missing"); raise SystemExit
m = re.search(r"^##\s*\[?" + re.escape(ver) + r"\]?.*?$(.*?)(?=^##\s|\Z)", text, re.M | re.S)
if not m:
    print("absent"); raise SystemExit
body = m.group(1)
for sha in re.findall(r"\b[0-9a-f]{7,40}\b", body):
    if pointer.startswith(sha) or sha.startswith(pointer[:7]):
        print("named"); raise SystemExit
print("section-only")
PY
}

# ── derive checklist state from what is OBSERVABLY true ─────────────────────
# Before this, the driver declared ten steps and only ever marked four (2, 4, 6,
# 8) — the ones it performs itself. Steps 0/1/3/5/7/9 rendered "[ ]" forever
# even after you had done them, so a completed release still showed a mostly
# empty checklist. A checklist that cannot be completed is one nobody reads,
# which is the same failure the RUNBOOK names about the back-sync count.
#
# Every mark below is derived from a decisive observable, never from "we
# probably did that by now". A step with no decisive signal stays blank on
# purpose — an unticked box is honest, a wrongly ticked one is not.
#
# Derived marks are AUTHORITATIVE IN BOTH DIRECTIONS — each run sets or clears
# them. Only setting would be worse than not marking at all: the state file
# outlives a release, so a step that was true for vX.Y.Z would stay ticked into
# the next train and the checklist would quietly describe the previous release.
# The state file is not reset on a version change, because the version legitimately
# changes mid-train at step 5.
derive_steps() {
  local mark

  # 0 — gather() has fetched both repos and read the stations by the time this runs.
  state_set 0 "done"

  # 1 — a Backend change is on Backend dev. Decisive either way:
  #     trees differ  → work is on dev, not yet promoted
  #     trees match AND the pointer already pins main → nothing Backend-side this release
  if [ "$BE_PROMOTION_OWED" -eq 1 ]; then
    state_set 1 "done"
  elif [ "$POINTER" = "$BE_MAIN_FULL" ]; then
    state_set 1 "skipped"
  else
    state_set 1 ""
  fi

  # 3 — the Backend back-sync specifically (step 8 is the both-repos sweep).
  [ "$BE_BACKSYNC" -eq 0 ] && mark="done" || mark=""
  state_set 3 "$mark"

  # 5 — version + CHANGELOG. Only "named" counts: a section that does not name
  #     the pinned SHA is exactly what train-verify blocks on, so marking it
  #     done would tick a box the gate still refuses.
  if [ "$(changelog_state)" = "named" ] && [ -z "$TAG_EXISTS" ]; then
    state_set 5 "done"
  else
    state_set 5 ""
  fi

  # 7 — the tag exists on the remote, which is what actually fires Cloud Build.
  [ -n "$TAG_EXISTS" ] && mark="done" || mark=""
  state_set 7 "$mark"

  # 9 — "verified in production" cannot be true for a version that was never
  #     tagged, so an untagged current version clears last release's proof.
  #     Setting it stays exclusive to verify_prod's content check.
  [ -z "$TAG_EXISTS" ] && state_set 9 ""

  # 8 — both repos clean.
  if [ "$BE_BACKSYNC" -eq 0 ] && [ "$CB_BACKSYNC" -eq 0 ]; then
    state_set 8 "done"
  else
    state_set 8 ""
  fi

  # 10 — close-out: nothing pending, nothing owed, and the tag is pushed. The
  #      Jira half of step 10 is not observable from here and stays human.
  if [ -n "$TAG_EXISTS" ] && [ "$CB_PENDING" -eq 0 ] &&
    [ "$CB_BACKSYNC" -eq 0 ] && [ "$BE_BACKSYNC" -eq 0 ]; then
    state_set 10 "done"
  else
    state_set 10 ""
  fi
}

print_checklist() {
  head2 "Checklist  ${DIM}($STATE)${X}"
  local id label mark
  for entry in "${STEPS[@]}"; do
    id=${entry%%|*}; label=${entry#*|}
    mark=$(state_get "$id")
    case "$mark" in
      done)    printf '  %s[x]%s %s. %s\n' "$G" "$X" "$id" "$label" ;;
      skipped) printf '  %s[-]%s %s. %s %s(skipped)%s\n' "$Y" "$X" "$id" "$label" "$DIM" "$X" ;;
      *)       printf '  [ ] %s. %s\n' "$id" "$label" ;;
    esac
  done
}

# ── step 9: production verification ─────────────────────────────────────────
# Greps EVERY served asset, not main-*.js. On v0.4.8 the deploy was live while a
# main-only poller reported "not deployed" for twenty minutes, because the
# publish code ships in a shared chunk-*.js. A bundle-hash change alone proves a
# deploy happened, not WHICH build landed.
verify_prod() {
  local marker="${1:-}"
  head2 "Step 9 — verify production by content"

  local code
  for path in "/" "/browse" "/sitemap.xml"; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$PROD$path" || echo "000")
    if [ "$code" = "200" ]; then ok "$path → 200"; else bad "$path → $code"; fi
  done

  if [ -z "$marker" ]; then
    warn "no marker string given — cannot prove WHICH build is live"
    info "re-run as: $0 --verify-only   then enter a string that is new in this release"
    if [ -t 0 ] && [ "$DRY_RUN" != "1" ]; then
      printf '\n  %smarker string (new in this release, absent from the previous one):%s ' "$Y" "$X"
      read -r marker
    fi
  fi
  [ -n "$marker" ] || { warn "skipping content check"; return 1; }

  local assets hits total=0
  assets=$(curl -s --max-time 20 "$PROD/" | grep -oE '(main|chunk|polyfills)-[A-Z0-9]+\.js' | sort -u)
  [ -n "$assets" ] || { bad "could not list served JS assets"; return 1; }

  info "searching every served asset for: $marker"
  local tmp; tmp=$(mktemp)
  for a in $assets; do
    curl -s --max-time 30 "$PROD/$a" -o "$tmp" || continue
    # `grep -c` ALREADY prints 0 when it matches nothing, and exits 1. A
    # `|| echo 0` on top of that yields the two-line string "0\n0", which then
    # blows up $(( )) with an arithmetic syntax error and derails the whole
    # mode. Found by running this against the live v0.4.8 deploy.
    hits=$(grep -c -- "$marker" "$tmp" 2>/dev/null)
    [ -n "$hits" ] || hits=0
    total=$((total + hits))
    printf '    %-28s %8s bytes  hits=%s\n' "$a" "$(wc -c < "$tmp")" "$hits"
  done
  rm -f "$tmp"

  if [ "$total" -gt 0 ]; then
    ok "marker found in $total place(s) — this release IS live"
    # Step 9 is proven by content, so mark it only here — never from "the merge
    # went green", which is what the RUNBOOK's step 9 trap is about.
    state_set 9 "done"
    return 0
  fi
  bad "marker not found in any served asset — the deploy is not live yet (or the marker is wrong)"
  info "a marker present in BOTH builds proves nothing; pick one only this release has"
  return 1
}

# ── step 5 assist: the mechanical half of the version bump ──────────────────
# RUNBOOK step 5 is "deliberately still human" for the CHANGELOG *prose* and the
# version *choice*. The edits around that prose are not judgment, they are
# fiddly: package.json, BOTH package-lock self-references (the runbook calls out
# "both" because missing the second is a known miss), and a CHANGELOG section
# that must name the pinned Backend SHA or train-verify blocks.
#
# This writes those mechanics and leaves the prose as a TODO for a human. It
# does not commit, branch, or push — the release branch and the words stay
# yours.
do_bump() {
  local to="$1"
  head2 "Step 5 — version bump + CHANGELOG scaffold"

  [[ "$to" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
    die "--bump needs a bare X.Y.Z (no leading v, no pre-release): got '$to'"
  [ "$to" != "$VERSION" ] || die "already at $to — pick the next version"
  if git ls-remote --tags origin "refs/tags/v$to" 2>/dev/null | grep -q .; then
    die "v$to is already tagged — release.yml would skip the tag AND report success"
  fi

  info "version   $VERSION → $to"

  # Read the pointer THIS WORKING TREE will ship, not origin/dev's.
  #
  # gather()'s $POINTER is `git rev-parse origin/dev:Backend`, which is right
  # for the status display but wrong here: RUNBOOK step 4 stages the re-pin
  # locally on the release branch, and it does not reach origin/dev until this
  # release PR merges. Comparing against origin/dev at step 5 therefore refuses
  # a correctly-ordered release — caught on this guard's first real use, cutting
  # v0.4.9, where step 4 had just pinned Backend main and the guard still saw
  # dev's old pointer.
  #
  # The index is the right source: it holds the gitlink that will be committed.
  local local_pointer local_short
  local_pointer=$(git rev-parse :Backend 2>/dev/null || git rev-parse HEAD:Backend 2>/dev/null || echo "")
  [ -n "$local_pointer" ] || die "could not read the Backend gitlink from this tree"
  local_short=${local_pointer:0:12}

  # Step 5 comes AFTER step 4 for a reason: the CHANGELOG section names the
  # pinned SHA, and train-verify checks that name against the actual gitlink.
  # Scaffolding it while the pointer still pins Backend dev bakes the KAN-191
  # trap into the prose, where it reads as deliberate.
  if [ "$local_pointer" = "$BE_MAIN_FULL" ]; then
    info "pointer   $local_short (Backend main) ✓"
  else
    bad "pointer   $local_short does NOT pin Backend main (${BE_MAIN_FULL:0:12})"
    info "RUNBOOK step 4 comes first, or this CHANGELOG will name the wrong SHA:"
    info "  git -C Backend fetch origin --prune && git -C Backend checkout origin/main && git add Backend"
    die "refusing to scaffold a CHANGELOG against a non-main pointer"
  fi

  if [ "$DRY_RUN" = "1" ]; then
    info "would rewrite: package.json, package-lock.json (both self-refs), CHANGELOG.md"
    return 0
  fi

  python3 - "$to" "$local_short" <<'PY' || die "bump failed"
import json, re, sys, datetime

to, pointer = sys.argv[1], sys.argv[2]

pkg = json.load(open("package.json"))
pkg["version"] = to
with open("package.json", "w") as f:
    json.dump(pkg, f, indent=2)
    f.write("\n")

# BOTH self-references: the top-level "version" and packages[""]["version"].
# Missing the second leaves the lockfile disagreeing with package.json.
lock = json.load(open("package-lock.json"))
lock["version"] = to
if "" in lock.get("packages", {}):
    lock["packages"][""]["version"] = to
with open("package-lock.json", "w") as f:
    json.dump(lock, f, indent=2)
    f.write("\n")

text = open("CHANGELOG.md").read()
if re.search(r"^##\s*\[?" + re.escape(to) + r"\]?", text, re.M):
    print(f"CHANGELOG already has a section for {to} — left untouched")
else:
    today = datetime.date.today().isoformat()
    section = (
        f"## [{to}] - {today}\n\n"
        f"### Changed\n\n"
        f"- TODO: describe this release. Backend pointer pinned at `{pointer}`.\n\n"
    )
    m = re.search(r"^##\s", text, re.M)
    text = text[: m.start()] + section + text[m.start() :] if m else text + "\n" + section
    open("CHANGELOG.md", "w").write(text)
    print(f"CHANGELOG section [{to}] inserted, naming pointer {pointer}")
PY

  ok "package.json + package-lock.json (both self-refs) → $to"
  say ""
  warn "STILL YOURS: replace the CHANGELOG TODO with real prose, then:"
  info "  npx prettier --write CHANGELOG.md package.json package-lock.json"
  info "  ./scripts/release/train-verify.sh --for-release    # must exit 0"
  info "  open the PR into dev — never straight to main"
}

# ── modes ───────────────────────────────────────────────────────────────────
gather
derive_steps

if [ "$MODE" = "verify" ]; then
  verify_prod "$MARKER"
  exit $?
fi

if [ "$MODE" = "bump" ]; then
  do_bump "$BUMP_TO"
  exit $?
fi

print_state
print_checklist

if [ "$MODE" = "status" ]; then
  head2 "Stations"
  "$SCRIPT_DIR/train-verify.sh" --no-fetch || true
  exit 0
fi

# ── walk ────────────────────────────────────────────────────────────────────
head2 "Stations"
"$SCRIPT_DIR/train-verify.sh" --no-fetch
VERIFY_RC=$?

[ "$VERSION" = "unknown" ] && die "could not read package.json version"
state_version_set "$VERSION"

head2 "Next action"

# Step 2/3 — Backend promotion and its back-sync.
if [ "$BE_PROMOTION_OWED" -eq 1 ]; then
  bad "Backend dev has content main lacks — promotion owed (RUNBOOK step 2)"
  git -C Backend log --oneline origin/main..origin/dev | sed 's/^/      /'
  say ""
  info "TRAP: a promotion goes stale the moment anything else lands on Backend dev."
  info "After it merges, re-run this driver rather than ticking step 2 off by memory."
  if confirm "PROMOTE" "Open the Backend dev → main PR?"; then
    run gh pr create -R "$BACKEND_REPO" --base main --head dev \
      --title "release: promote Backend dev → main [KAN-###]" \
      --body "Promotes Backend dev → main so the cookbook pointer can pin main's own SHA. No build fires on this merge." \
      && state_set 2 "done"
  else
    info "skipped — nothing was opened"
  fi
  exit 1
fi
if [ "$BE_PENDING" -gt 0 ]; then
  ok "Backend dev content == main ($BE_PENDING ancestry-only commit(s): the back-sync merge)"
else
  ok "Backend dev == main (nothing to promote)"
fi
[ -n "$(state_get 2)" ] || state_set 2 "done"

if [ "$BE_BACKSYNC" -gt 0 ] || [ "$CB_BACKSYNC" -gt 0 ]; then
  bad "back-sync owed — cookbook $CB_BACKSYNC, Backend $BE_BACKSYNC (RUNBOOK step 3/8)"
  info "must be a MERGE commit; squashing rewrites commits and the count never reaches zero"
  if confirm "BACKSYNC" "Run train-backsync.sh --apply --merge?"; then
    run "$SCRIPT_DIR/train-backsync.sh" --apply --merge && state_set 8 "done"
  else
    info "skipped — run it before cutting, the stations block on this"
  fi
  exit 1
fi
ok "no back-sync debt on either repo"

# Step 4 — pointer.
if [ "$POINTER" != "$BE_MAIN_FULL" ]; then
  bad "pointer $POINTER_SHORT != Backend main ${BE_MAIN_FULL:0:12} (RUNBOOK step 4)"
  info "do NOT use 'git submodule update --remote Backend' — .gitmodules tracks dev,"
  info "and dev's tip is structurally never main's tip after a promotion+back-sync."
  say ""
  info "  git -C Backend checkout origin/main && git add Backend"
  exit 1
fi
ok "pointer pins Backend main"
[ -n "$(state_get 4)" ] || state_set 4 "done"

# Step 7 — spent version is the quietest failure in the train.
if [ -n "$TAG_EXISTS" ]; then
  bad "v$VERSION is already tagged"
  info "release.yml would skip the tag, the Release, and the Cloud Build trigger — and report success."
  info "Bump package.json (patch at minimum) and add a CHANGELOG section before cutting."
  exit 1
fi

# Step 6 — the release PR. This is the deploy.
if [ "$CB_PENDING" -eq 0 ]; then
  ok "nothing pending: cookbook dev == main — the train is at rest"
  [ "$VERIFY_RC" -eq 0 ] && exit 0 || exit 1
fi

if [ "$VERIFY_RC" -ne 0 ]; then
  bad "stations are blocking — fix those before opening the release PR"
  exit 1
fi

ok "stations clean, $CB_PENDING commit(s) ready to ship as v$VERSION"
say ""
warn "The NEXT step merges cookbook dev → main. That pushes tag v$VERSION,"
warn "which fires Cloud Build and DEPLOYS TO PRODUCTION."
warn "The freeze is already open: dev→main merges dev's LIVE tip, so anything"
warn "landing on dev between now and the merge ships silently, outside the CHANGELOG."

if confirm "RELEASE" "Open the cookbook dev → main release PR? (opening only — merging stays manual)"; then
  run gh pr create --base main --head dev \
    --title "release: v$VERSION [KAN-###]" \
    --body "Release v$VERSION. Pointer $POINTER_SHORT (Backend main). Stations clean via train-verify --for-release. Merging this pushes the tag and deploys." \
    && state_set 6 "done"
  say ""
  info "Merge it with: gh pr merge <n> --merge     (merge commit; squash is blocked on main)"
  info "Then:          $0            # picks up at back-sync + verification"
else
  info "skipped — nothing was opened"
fi

print_checklist
exit 0
