#!/usr/bin/env bash
#
# Alembic head count for the pinned Backend submodule.
#
# Why this is its own script rather than an inline block: two callers need the
# same answer at different moments, and a second implementation would drift.
#
#   1. scripts/release/train-verify.sh — station 4, at release time.
#   2. .github/workflows/pr-gate.yml   — the required status check, on every PR.
#
# (2) is the one that actually blocks a merge. Before it existed, the check ran
# only on release-train.yml's manual dispatch and its daily 15:00 cron, so a PR
# that moved the submodule pointer onto a branched-head Backend merged clean and
# the drift surfaced hours later — or at deploy time, which is worse: two heads
# make `flask db upgrade` refuse, the flask-backend-migrate Cloud Run Job fails,
# and cloudbuild.yaml aborts the release mid-flight with the old revision left
# serving.
#
# Heads are parsed out of the migration files rather than shelled out to
# `flask db heads` on purpose: that keeps this runnable with nothing but
# python3 — no Backend virtualenv, no uv sync, no DATABASE_URL, no app import.
# A gate that needs a database to tell you the database migration is malformed
# is a gate that gets skipped.
#
# Usage:
#   alembic-heads.sh            prints the head count, or "error"; always exits 0
#                               (train-verify.sh captures this and renders its
#                               own BLOCK line, so it must not die on failure)
#   alembic-heads.sh --check    prints a human verdict; exits 1 unless exactly
#                               one head was found
#
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
versions_dir="${ALEMBIC_VERSIONS_DIR:-$repo_root/Backend/migrations/versions}"

count_heads() {
  VERSIONS_DIR="$versions_dir" python3 - <<'PY' 2>/dev/null || echo "error"
import os, pathlib, re, sys

# Heads = revisions nobody names as a parent, which is how alembic computes
# them. The down_revision pattern deliberately allows a tuple to span lines: a
# merge migration's `down_revision = ('a', 'b')` is one line as alembic writes
# it, but a formatter will wrap a long one, and missing those parents would
# over-count heads and block a release that is fine.
versions = pathlib.Path(os.environ["VERSIONS_DIR"])
if not versions.is_dir():
    print("error")
    sys.exit(0)

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
}

list_heads() {
  VERSIONS_DIR="$versions_dir" python3 - <<'PY' 2>/dev/null || true
import os, pathlib, re

versions = pathlib.Path(os.environ["VERSIONS_DIR"])
revisions, parents, where = set(), set(), {}
for path in versions.glob("*.py"):
    text = path.read_text(encoding="utf-8", errors="replace")
    match = re.search(r"^revision(?::\s*str)?\s*=\s*['\"]([^'\"]+)['\"]", text, re.M)
    if match:
        revisions.add(match.group(1))
        where[match.group(1)] = path.name
    for down in re.findall(
        r"down_revision(?:\s*:[^=]*)?\s*=\s*(\([^)]*\)|\[[^\]]*\]|['\"][^'\"]*['\"])",
        text,
        re.S,
    ):
        parents.update(re.findall(r"['\"]([^'\"]+)['\"]", down))
for head in sorted(revisions - parents):
    print(f"  {head}  {where.get(head, '?')}")
PY
}

heads=$(count_heads)

if [ "${1:-}" != "--check" ]; then
  echo "$heads"
  exit 0
fi

case "$heads" in
  1)
    echo "OK: Alembic has exactly one head."
    list_heads
    exit 0
    ;;
  error)
    echo "FAIL: could not determine Alembic heads."
    echo "  Looked in: $versions_dir"
    echo "  Is the Backend submodule checked out? (actions/checkout needs submodules: true)"
    exit 1
    ;;
  *)
    echo "FAIL: Alembic has $heads heads — 'flask db upgrade' will refuse to run."
    echo
    echo "Heads found:"
    list_heads
    echo
    echo "This would fail the flask-backend-migrate Cloud Run Job and abort the"
    echo "deploy, leaving the previous Flask revision serving. Unify them with:"
    echo
    echo "  cd Backend && uv run flask db merge -m 'merge <topic-a> and <topic-b> heads' <revA> <revB>"
    echo
    echo "Commit the resulting *_merge_*.py alongside this change."
    exit 1
    ;;
esac
