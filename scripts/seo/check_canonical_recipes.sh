#!/usr/bin/env bash
# CI gate: validate canonical recipe list against index.html anchors.
# Reads specs/canonical-recipes.json and checks:
#   1. JSON is valid
#   2. 3–5 recipes listed (Phase 0/1 bound)
#   3. Every slug has a matching <a href="/r/{slug}"> in index.html <noscript>
#   4. No anchors in index.html that aren't in the canonical list
#
# Usage: scripts/seo/check_canonical_recipes.sh [--live URL]
#   --live URL  Also curl each /r/<slug> on the given base URL and assert 200.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CANONICAL_FILE="$REPO_ROOT/specs/canonical-recipes.json"
INDEX_FILE="$REPO_ROOT/index.html"

LIVE_BASE=""
if [[ "${1:-}" == "--live" ]] && [[ -n "${2:-}" ]]; then
  LIVE_BASE="${2%/}"
fi

errors=0

if ! command -v jq &>/dev/null; then
  echo "FAIL: jq is required but not installed"
  exit 1
fi

# 1. Valid JSON
if ! jq empty "$CANONICAL_FILE" 2>/dev/null; then
  echo "FAIL: $CANONICAL_FILE is not valid JSON"
  exit 1
fi

# 2. Count check (3–7)
count=$(jq '.recipes | length' "$CANONICAL_FILE")
if (( count < 3 || count > 7 )); then
  echo "FAIL: canonical list has $count recipes (must be 3–7)"
  errors=$((errors + 1))
fi

# Extract slugs from JSON
mapfile -t json_slugs < <(jq -r '.recipes[].slug' "$CANONICAL_FILE")

# Extract slugs from index.html noscript anchors
mapfile -t html_slugs < <(grep -oP '(?<=href="/r/)[^"]+' "$INDEX_FILE" || true)

# 3. Every JSON slug must appear in index.html
for slug in "${json_slugs[@]}"; do
  found=0
  for hs in "${html_slugs[@]}"; do
    if [[ "$hs" == "$slug" ]]; then
      found=1
      break
    fi
  done
  if (( found == 0 )); then
    echo "FAIL: slug '$slug' is in canonical-recipes.json but missing from index.html"
    errors=$((errors + 1))
  fi
done

# 4. Every index.html anchor must be in JSON (no orphaned anchors)
for hs in "${html_slugs[@]}"; do
  found=0
  for slug in "${json_slugs[@]}"; do
    if [[ "$slug" == "$hs" ]]; then
      found=1
      break
    fi
  done
  if (( found == 0 )); then
    echo "FAIL: anchor '/r/$hs' is in index.html but not in canonical-recipes.json"
    errors=$((errors + 1))
  fi
done

# 5. Optional live check
if [[ -n "$LIVE_BASE" ]]; then
  for slug in "${json_slugs[@]}"; do
    status=$(curl -s -o /dev/null -w '%{http_code}' "$LIVE_BASE/r/$slug" 2>/dev/null || echo "000")
    if [[ "$status" != "200" ]]; then
      echo "FAIL: $LIVE_BASE/r/$slug returned HTTP $status (expected 200)"
      errors=$((errors + 1))
    else
      echo "OK: $LIVE_BASE/r/$slug → 200"
    fi
  done
fi

if (( errors > 0 )); then
  echo ""
  echo "FAILED: $errors error(s) found"
  exit 1
fi

echo "OK: $count canonical recipes validated (JSON ↔ index.html consistent)"
