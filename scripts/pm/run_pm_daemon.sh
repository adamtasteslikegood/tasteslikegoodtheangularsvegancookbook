#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pm_dir="$repo_root/scripts/pm"
venv_dir="$pm_dir/.venv"
venv_python="$venv_dir/bin/python"
requirements="$pm_dir/requirements.txt"

if [[ ! -x "$venv_python" ]]; then
  echo "PM scripts venv not found. Creating $venv_dir" >&2
  if ! python3 -m venv "$venv_dir"; then
    cat >&2 <<'EOF'
Failed to create the PM scripts virtualenv. Install Python venv support, then retry.
Debian/Ubuntu example: sudo apt install python3.12-venv
EOF
    exit 1
  fi
  "$venv_python" -m pip install --upgrade pip >/dev/null
  "$venv_python" -m pip install -r "$requirements"
fi

cd "$repo_root"
# Pass all arguments to the daemon script (e.g. --watch-only)
exec "$venv_python" "$pm_dir/pm_daemon.py" "$@"
