#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mon_dir="$repo_root/scripts/monitoring"
venv_dir="$mon_dir/.venv"
venv_python="$venv_dir/bin/python"
requirements="$mon_dir/requirements.txt"

if [[ ! -x "$venv_python" ]]; then
  echo "GCP monitor venv not found. Creating $venv_dir" >&2
  if ! python3 -m venv "$venv_dir"; then
    cat >&2 <<'EOF'
Failed to create the GCP monitor virtualenv. Install Python venv support, then retry.
Debian/Ubuntu example: sudo apt install python3.12-venv
EOF
    exit 1
  fi
  # stdout is the MCP JSON-RPC channel — pip output must go to stderr or it
  # corrupts the protocol stream on first run
  "$venv_python" -m pip install --upgrade pip >&2
  "$venv_python" -m pip install -r "$requirements" >&2
fi

cd "$repo_root"
exec "$venv_python" "$mon_dir/gcp_mcp_server.py" "$@"
