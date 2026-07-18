#!/usr/bin/env bash
# crawl-links.sh — public-site link & image crawl gate (issue #3164, AC 1).
#
# Contract (Acceptance Criterion 1):
#   - bash + curl only, no auth
#   - BASE_URL env (default https://www.tasteslikegood.org)
#   - fetch /sitemap.xml, /, every /browse page (follow rel=next), and every
#     /r/<slug> from the sitemap
#   - extract internal href/src/og:image/canonical values via grep
#   - GET each unique same-host URL with -L --max-time 30
#   - FAIL on any final status >= 400
#   - for image URLs, FAIL if the content-type prefix doesn't match
#     `file --mime-type` of the downloaded bytes
#   - print a TSV of url/status/content-type; exit non-zero on any failure
#
# Read-only: performs GETs only. Usage:
#   scripts/audit/crawl-links.sh
#   BASE_URL=http://localhost:8080 scripts/audit/crawl-links.sh

set -u

BASE_URL="${BASE_URL:-https://www.tasteslikegood.org}"
BASE_URL="${BASE_URL%/}"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

failures=0
declare -A checked=()  # url -> "status<TAB>content_type"
declare -A body_of=()  # url -> downloaded body file
declare -A link_set=() # unique same-host URLs harvested from pages
body_seq=0

note_failure() {
  failures=$((failures + 1))
  echo "FAIL: $*" >&2
}

# normalize <raw> — resolve a harvested href/src value to a same-host
# absolute URL on stdout; prints nothing for external/non-HTTP values.
normalize() {
  local raw="$1"
  raw="${raw%%#*}" # strip fragment
  [ -n "$raw" ] || return 0
  case "$raw" in
    "$BASE_URL" | "$BASE_URL"/*) printf '%s\n' "$raw" ;;
    http://* | https://* | //*) return 0 ;; # other hosts: out of scope
    mailto:* | javascript:* | data:* | tel:*) return 0 ;;
    /*) printf '%s\n' "$BASE_URL$raw" ;;
    *) return 0 ;; # page-relative paths are not emitted by our templates
  esac
}

# check_image <url> <file> <content_type> — content-type must match the bytes.
check_image() {
  local url="$1" file="$2" declared="${3%%;*}" actual
  actual="$(file --brief --mime-type "$file" 2>/dev/null || echo unknown)"
  # Only meaningful when at least one side claims to be an image.
  case "$declared,$actual" in *image/*) ;; *) return 0 ;; esac
  [ "$declared" = "$actual" ] && return 0
  # `file` versions disagree on SVG bytes (image/svg+xml vs generic XML) —
  # accept XML detections for a declared SVG; a JPEG/PNG mismatch still fails.
  if [ "$declared" = "image/svg+xml" ]; then
    case "$actual" in image/svg* | text/xml | application/xml) return 0 ;; esac
  fi
  note_failure "content-type mismatch at $url: declared '$declared', bytes are '$actual'"
}

# visit <url> — GET once (deduped), record the TSV row, run the status and
# image checks. Body path lands in body_of[<url>]. Runs in the main shell so
# the checked/failures state survives.
visit() {
  local url="$1" out result status content_type
  [ -n "${checked[$url]:-}" ] && return 0
  body_seq=$((body_seq + 1))
  out="$workdir/body.$body_seq"
  result="$(curl -sS -L --max-time 30 -o "$out" \
    -w '%{http_code}\t%{content_type}' "$url" 2>>"$workdir/curl-errors")" ||
    result=$'000\t'
  status="${result%%$'\t'*}"
  content_type="${result#*$'\t'}"
  checked[$url]="$status"$'\t'"$content_type"
  body_of[$url]="$out"
  printf '%s\t%s\t%s\n' "$url" "$status" "$content_type"
  if ! [ "$status" -ge 100 ] 2>/dev/null || [ "$status" -ge 400 ]; then
    note_failure "$url returned final status $status"
  else
    check_image "$url" "$out" "$content_type"
  fi
}

# ── 1. Sitemap ────────────────────────────────────────────────────────
visit "$BASE_URL/sitemap.xml"
mapfile -t sitemap_urls < <(
  grep -oE '<loc>[^<]+</loc>' "${body_of[$BASE_URL/sitemap.xml]}" 2>/dev/null |
    sed -E 's|</?loc>||g' | sort -u
)

# ── 2. Page set: /, /browse (+ rel=next chain), every /r/<slug> ───────
pages=("$BASE_URL/" "$BASE_URL/browse")
for url in "${sitemap_urls[@]:-}"; do
  case "$url" in
    "$BASE_URL"/r/*) pages+=("$url") ;;
  esac
done

page_files=()
i=0
while [ "$i" -lt "${#pages[@]}" ]; do
  page="${pages[$i]}"
  i=$((i + 1))
  [ -n "${checked[$page]:-}" ] && continue
  visit "$page"
  body_file="${body_of[$page]}"
  page_files+=("$body_file")
  # Follow /browse pagination via rel=next.
  next="$(grep -oE 'href="[^"]*"[^>]*rel="next"' "$body_file" 2>/dev/null |
    head -1 | sed -E 's/^href="([^"]*)".*/\1/')"
  if [ -n "$next" ]; then
    next="$(normalize "$next")"
    if [ -n "$next" ] && [ -z "${checked[$next]:-}" ]; then
      pages+=("$next")
    fi
  fi
done

# ── 3. Harvest internal href/src/og:image/canonical from every page ───
for body_file in "${page_files[@]:-}"; do
  [ -f "$body_file" ] || continue
  while IFS= read -r raw; do
    link="$(normalize "$raw")"
    [ -n "$link" ] && link_set["$link"]=1
  done < <(
    {
      grep -oE 'href="[^"]*"' "$body_file" | sed -E 's/^href="//; s/"$//'
      grep -oE 'src="[^"]*"' "$body_file" | sed -E 's/^src="//; s/"$//'
      grep -oE '<meta property="og:image" content="[^"]*"' "$body_file" |
        sed -E 's/.*content="//; s/"$//'
      grep -oE '<link rel="canonical" href="[^"]*"' "$body_file" |
        sed -E 's/.*href="//; s/"$//'
    } 2>/dev/null | sort -u
  )
done

# ── 4. GET every unique same-host URL not already visited ─────────────
mapfile -t sorted_links < <(printf '%s\n' "${!link_set[@]}" | sort)
for link in "${sorted_links[@]:-}"; do
  [ -n "$link" ] && visit "$link"
done

# ── Result ────────────────────────────────────────────────────────────
echo "checked ${#checked[@]} unique URLs; $failures failure(s)" >&2
[ "$failures" -eq 0 ]
