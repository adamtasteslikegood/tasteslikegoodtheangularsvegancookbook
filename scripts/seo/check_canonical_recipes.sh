#!/usr/bin/env bash
# CI gate: validate canonical recipe list against index.html anchors.
# Reads specs/canonical-recipes.json and checks:
#   1. JSON is valid
#   2. 3–8 recipes listed (Phase 0/1 bound)
#   3. Every slug has a matching <a href="/r/{slug}"> in index.html <noscript>
#   4. No anchors in index.html that aren't in the canonical list
#
# Usage: scripts/seo/check_canonical_recipes.sh [--live URL]
#   --live URL  Also curl each /r/<slug> on the given base URL and assert 200,
#               and every /browse/tag/<slug> hub in its sitemap (200 + self-canonical).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CANONICAL_FILE="$REPO_ROOT/specs/canonical-recipes.json"
INDEX_FILE="$REPO_ROOT/index.html"

LIVE_BASE=""
if [[ "${1:-}" == "--live" ]]; then
  if [[ -z "${2:-}" ]]; then
    echo "FAIL: --live requires a base URL, e.g. --live https://www.tasteslikegood.org"
    exit 1
  fi
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

# 2. Count check (3–8). Raised from 7 for KAN-158: the upper bound exists to keep
# the noscript nav a curated set rather than a dump of the whole catalog, so it
# moves deliberately, one slug at a time, with Adam's approval on the PR. Keep
# this in sync with maxItems in specs/canonical-recipes.schema.json.
count=$(jq '.recipes | length' "$CANONICAL_FILE")
if (( count < 3 || count > 8 )); then
  echo "FAIL: canonical list has $count recipes (must be 3–8)"
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
    status=$(curl -s -o /dev/null -w '%{http_code}' -- "$LIVE_BASE/r/$slug" 2>/dev/null || true)
    if [[ "$status" != "200" ]]; then
      echo "FAIL: $LIVE_BASE/r/$slug returned HTTP $status (expected 200)"
      errors=$((errors + 1))
    else
      echo "OK: $LIVE_BASE/r/$slug → 200"
    fi
  done

  # 6. Category hubs (KAN-274): every /browse/tag/<slug> the sitemap lists must
  #    answer 200 with a self-referencing canonical. Hubs ship from the Backend,
  #    so an older deploy that lists none is reported, not failed.
  hub_urls=()
  if sitemap=$(curl --fail --silent --show-error -- "$LIVE_BASE/sitemap.xml"); then
    mapfile -t hub_urls < <(printf '%s' "$sitemap" | grep -oP '(?<=<loc>)[^<]*/browse/tag/[^<]+' || true)
    if (( ${#hub_urls[@]} == 0 )); then
      echo "INFO: no /browse/tag/ hubs in $LIVE_BASE/sitemap.xml"
    fi
  else
    echo "FAIL: unable to fetch $LIVE_BASE/sitemap.xml"
    errors=$((errors + 1))
  fi

  for hub in "${hub_urls[@]}"; do
    if [[ "$hub" != "$LIVE_BASE/browse/tag/"* ]]; then
      echo "FAIL: sitemap hub URL '$hub' is outside $LIVE_BASE/browse/tag/"
      errors=$((errors + 1))
      continue
    fi

    body=$(curl -s -w '\n%{http_code}' -- "$hub" 2>/dev/null || true)
    status="${body##*
fi

if (( errors > 0 )); then
  echo ""
  echo "FAILED: $errors error(s) found"
  exit 1
fi

echo "OK: $count canonical recipes validated (JSON ↔ index.html consistent)"
\n'}"
    canonical=$(printf '%s' "$body" | grep -oP '(?<=<link rel="canonical" href=")[^"]+' | head -1 || true)
    if [[ "$status" != "200" ]]; then
      echo "FAIL: $hub returned HTTP $status (expected 200)"
      errors=$((errors + 1))
    elif [[ "$canonical" != "$hub" ]]; then
      echo "FAIL: $hub canonical is '$canonical' (expected self)"
      errors=$((errors + 1))
    else
      echo "OK: $hub → 200, self-canonical"
    fi
  done
fi

if (( errors > 0 )); then
  echo ""
  echo "FAILED: $errors error(s) found"
  exit 1
fi

echo "OK: $count canonical recipes validated (JSON ↔ index.html consistent)"
