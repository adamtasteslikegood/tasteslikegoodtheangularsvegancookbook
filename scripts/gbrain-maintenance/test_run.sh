#!/usr/bin/env bash
# Mocked tests for run.sh's handling of the Sprites HTTP exec response.
# A fake curl writes a canned framed body; the fallback is never reached with
# credentials, so nothing touches a database or pays for embeddings.
# Run: bash scripts/gbrain-maintenance/test_run.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cat >"$tmp/curl" <<'EOF'
#!/usr/bin/env bash
while [ $# -gt 0 ]; do
  if [ "$1" = -o ]; then printf "$BODY" >"$2"; shift; fi
  shift
done
exit "${CURL_RC:-0}"
EOF
chmod +x "$tmp/curl"

fail=0
# expect: "sprite" (exit 0, no fallback) or "fallback" (fallback entered)
check() {
  local name="$1" body="$2" curl_rc="$3" expect="$4" out code got
  out=$(env -u GBRAIN_DATABASE_URL -u OPENAI_API_KEY PATH="$tmp:$PATH" \
    SPRITES_TOKEN=test BODY="$body" CURL_RC="$curl_rc" bash "$here/run.sh" 2>&1)
  code=$?
  if grep -q 'running the fallback here' <<<"$out"; then got=fallback
  elif [ "$code" = 0 ]; then got=sprite
  else got="exit $code"; fi
  if [ "$got" = "$expect" ]; then echo "ok   $name"
  else echo "FAIL $name: expected $expect, got $got"; echo "$out" | sed 's/^/     /'; fail=1; fi
}

check "success"                    '\001hi\n\001EXIT=0\n\003\000'      0  sprite
check "lock held (marker 75, 0)"   '\001EXIT=75\n\003\000'             0  sprite
check "marker 0, process exit 1"   '\001EXIT=0\n\003\001'              0  fallback
check "marker 1, process exit 1"   '\001EXIT=1\n\003\001'              0  fallback
check "marker 75, process exit 75" '\001EXIT=75\n\003\113'             0  fallback
check "no exit frame (cut short)"  '\001EXIT=0\n'                      0  fallback
check "no marker"                  '\001done\n\003\000'                0  fallback
check "stderr after marker"        '\001EXIT=0\n\002warn\n\003\000'    0  fallback
check "request failed"             '{"error":"authentication failed"}' 22 fallback
check "empty body"                 ''                                  0  fallback

exit "$fail"
