#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mon_dir="$repo_root/scripts/monitoring"
venv_dir="$mon_dir/.venv"
venv_python="$venv_dir/bin/python"
requirements="$mon_dir/requirements.txt"
deps_stamp="$venv_dir/.deps-installed"

# Claude Code cloud environments build the venv in the environment's setup
# script, which runs BEFORE the repo is cloned — so it can't live at
# $venv_dir and instead sits at a fixed path baked into the snapshot (see
# docs/MCP_GCP_MONITORING.md). Use it when it's real, skipping the slow
# in-repo bootstrap that races the MCP client's startup timeout.
for prebuilt in "${GCP_MONITOR_VENV:-}" /opt/gcp-monitor-venv; do
  prebuilt_python="$prebuilt/bin/python"
  if [[ -n "$prebuilt" && -x "$prebuilt_python" ]] && "$prebuilt_python" - <<'EOF' 2>/dev/null
import importlib.util as u
import sys

sys.exit(0 if u.find_spec("mcp") and u.find_spec("google.cloud.monitoring_v3") else 1)
EOF
  then
    if [[ "${1:-}" == "--bootstrap-only" ]]; then
      echo "Prebuilt venv OK: $prebuilt" >&2
      exit 0
    fi
    cd "$repo_root"
    exec "$prebuilt_python" "$mon_dir/gcp_mcp_server.py" "$@"
  fi
done

# The stamp is written only after pip succeeds, so an interrupted first run
# (e.g. the MCP client's startup timeout killing us mid-install) re-installs
# on the next launch instead of exec'ing a half-built venv.
if [[ ! -x "$venv_python" || ! -f "$deps_stamp" ]]; then
  echo "GCP monitor venv not ready. Bootstrapping $venv_dir" >&2
  if [[ ! -x "$venv_python" ]] && ! python3 -m venv "$venv_dir"; then
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
  touch "$deps_stamp"
fi

# Pre-build the venv without starting the server, so the first real MCP
# launch is fast enough to beat the client's startup timeout:
#   bash scripts/monitoring/run_gcp_monitor.sh --bootstrap-only
if [[ "${1:-}" == "--bootstrap-only" ]]; then
  echo "Bootstrap complete: $venv_dir" >&2
  exit 0
fi

cd "$repo_root"
exec "$venv_python" "$mon_dir/gcp_mcp_server.py" "$@"
