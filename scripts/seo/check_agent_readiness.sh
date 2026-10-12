#!/usr/bin/env bash
# Checks a deployed site against specs/AGENT_READINESS_SPEC.md, one line per
# requirement. Exit 0 when every requirement passes, 1 when any fails.
#
#   scripts/seo/check_agent_readiness.sh [base-url]
#
# Not wired to CI: it reads a deployed site, so it cannot gate a pull request.
# No pipefail: `grep -q` closes the pipe on its first match, which makes curl
# exit non-zero and would turn a pass into a fail.
set -u

BASE="${1:-https://www.tasteslikegood.org}"
BASE="${BASE%/}"
fails=0

fetch() { curl -sS -m 20 "$@" 2>/dev/null; }
status() { curl -sS -o /dev/null -m 20 -w '%{http_code}' "$@" 2>/dev/null; }
ctype() { curl -sS -o /dev/null -m 20 -w '%{content_type}' "$@" 2>/dev/null; }

report() { # id, result (0 = pass), description
  if [ "$2" -eq 0 ]; then
    printf 'PASS  %-6s %s\n' "$1" "$3"
  else
    printf 'FAIL  %-6s %s\n' "$1" "$3"
    fails=$((fails + 1))
  fi
}

robots="$(fetch "$BASE/robots.txt")"
home="$(fetch "$BASE/")"
home_headers="$(curl -sS -o /dev/null -D - -m 20 "$BASE/" 2>/dev/null)"
slug="$(fetch "$BASE/api/public/newest-recipes" | grep -oE '"slug": ?"[a-z0-9-]+"' | head -1 | grep -oE '[a-z0-9-]+"$' | tr -d '"')"

# AR-1: every named AI crawler appears in robots.txt
missing=""
for bot in GPTBot OAI-SearchBot ChatGPT-User ClaudeBot Claude-SearchBot Claude-User PerplexityBot Perplexity-User Google-Extended CCBot; do
  grep -qi "^User-agent: *$bot *\$" <<<"$robots" || missing="$missing $bot"
done
[ -z "$missing" ]
report AR-1 $? "robots.txt names the AI crawlers${missing:+ (missing:$missing)}"

grep -qi '^Content-Signal:' <<<"$robots"
report AR-2 $? "robots.txt states a Content-Signal"

[ "$(status "$BASE/llms.txt")" = 200 ] && fetch "$BASE/llms.txt" | head -1 | grep -q '^# '
report AR-3 $? "/llms.txt is served and starts with a title"

[ "$(status "$BASE/sitemap.xml")" = 200 ] && grep -qi '^Sitemap:' <<<"$robots"
report AR-4 $? "/sitemap.xml is served and listed in robots.txt"

grep -q '"@type": *"WebApplication"' <<<"$home" && grep -q '"@type": *"Organization"' <<<"$home"
report AR-5a $? "home page has WebApplication and Organization structured data"

[ -n "$slug" ] && fetch "$BASE/r/$slug" | grep -q '"@type": *"Recipe"'
report AR-5b $? "a recipe page has Recipe structured data"

grep -qi '^link:.*llms\.txt' <<<"$home_headers"
report AR-6 $? "home page Link header points at /llms.txt"

for path in / /browse "/r/${slug:-missing}"; do
  ctype -H 'Accept: text/markdown' "$BASE$path" | grep -qi '^text/markdown'
  report AR-7 $? "Accept: text/markdown on $path returns markdown"
done

[ "$(status "$BASE/api/public/openapi.json")" = 200 ] && fetch "$BASE/api/public/openapi.json" | grep -q '"openapi"'
report AR-8a $? "/api/public/openapi.json describes the public API"

ctype "$BASE/.well-known/api-catalog" | grep -qi 'linkset+json'
report AR-8b $? "/.well-known/api-catalog is a linkset"

fetch -X POST "$BASE/mcp" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"agent-readiness-check","version":"1"}}}' |
  grep -q '"serverInfo"'
report AR-9 $? "/mcp answers an MCP initialize request"

grep -qi 'gemini' <<<"$home" && fetch "$BASE/llms.txt" | grep -qi 'gemini'
report AR-10 $? "home page and llms.txt say the recipes are generated with Gemini"

echo
if [ "$fails" -eq 0 ]; then
  echo "All requirements pass for $BASE"
else
  echo "$fails requirement(s) fail for $BASE"
  exit 1
fi
