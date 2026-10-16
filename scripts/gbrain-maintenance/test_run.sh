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
printf '%s\n' "$@" >"$ARGV_FILE"
while [ $# -gt 0 ]; do
  if [ "$1" = -o ]; then printf "$BODY" >"$2"; shift; fi
  shift
done
exit "${CURL_RC:-0}"
EOF
chmod +x "$tmp/curl"

fail=0
# expect: "sprite" (exit 0, no fallback), "fallback" (fallback entered) or
# "skipped" (exit 3: the sprite may still be running, so no fallback)
check() {
  local name="$1" body="$2" curl_rc="$3" expect="$4" out code got
  out=$(env -u GBRAIN_DATABASE_URL -u OPENAI_API_KEY PATH="$tmp:$PATH" \
    SPRITES_TOKEN=test BODY="$body" CURL_RC="$curl_rc" ARGV_FILE="$tmp/argv" \
    bash "$here/run.sh" 2>&1)
  code=$?
  if grep -q 'running the fallback here' <<<"$out"; then got=fallback
  elif [ "$code" = 0 ]; then got=sprite
  elif [ "$code" = 3 ]; then got=skipped
  else got="exit $code"; fi
  if [ "$got" = "$expect" ]; then echo "ok   $name"
  else echo "FAIL $name: expected $expect, got $got"; echo "$out" | sed 's/^/     /'; fail=1; fi
}

check "success"                    '\001hi\n\001EXIT=0\n\003\000'      0  sprite
check "lock held (marker 75, 0)"   '\001EXIT=75\n\003\000'             0  sprite
check "marker 0, process exit 1"   '\001EXIT=0\n\003\001'              0  fallback
check "marker 1, process exit 1"   '\001EXIT=1\n\003\001'              0  fallback
check "marker 75, process exit 75" '\001EXIT=75\n\003\113'             0  fallback
check "no exit frame (cut short)"  '\001EXIT=0\n'                      0  skipped
check "no marker"                  '\001done\n\003\000'                0  fallback
check "stderr after marker"        '\001EXIT=0\n\002warn\n\003\000'    0  sprite
check "request failed (HTTP 401)"  '{"error":"authentication failed"}' 22 fallback
check "connect failed"             ''                                  7  fallback
check "timeout mid-run"            '\001working\n'                     28 skipped
check "connection dropped mid-run" '\001working\n'                     56 skipped
check "empty 200 body"             ''                                  0  skipped

# The request itself: method, query-string args in order, auth header, URL.
check "request shape (success)" '\001EXIT=0\n\003\000' 0 sprite
argv=$(cat "$tmp/argv")
expect_argv() {
  if grep -qxF -- "$1" <<<"$argv"; then echo "ok   curl arg: $1"
  else echo "FAIL curl arg missing: $1"; fail=1; fi
}
expect_argv "-G"
expect_argv "POST"
expect_argv "Authorization: Bearer test"
expect_argv "https://api.sprites.dev/v1/sprites/spawn-sprite-hermes222/exec"
cmds=$(grep '^cmd=' <<<"$argv" | paste -sd' ')
if [ "$cmds" = "cmd=bash cmd=-l cmd=/home/sprite/.hermes/scripts/gbrain-remote-run.sh" ]; then
  echo "ok   cmd args in order"
else echo "FAIL cmd args: $cmds"; fail=1; fi
if grep -qx -- '-X' <<<"$argv" && [ "$(grep -A1 -x -- '-X' <<<"$argv" | tail -1)" = POST ]; then
  echo "ok   -X POST"
else echo "FAIL -X POST missing"; fail=1; fi

exit "$fail"
