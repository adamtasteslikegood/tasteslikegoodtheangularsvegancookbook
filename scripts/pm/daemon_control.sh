#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pm_dir="$repo_root/scripts/pm"
state_dir="$repo_root/.agent-work/pm"
pid_file="$state_dir/pm-daemon.pid"
log_file="$state_dir/pm-daemon.log"
cmd="${1:-status}"

mkdir -p "$state_dir"

is_running() {
  if [[ ! -f "$pid_file" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

start_daemon() {
  if is_running; then
    echo "pm-daemon already running (pid $(cat "$pid_file"))"
    return 0
  fi

  rm -f "$pid_file"
  touch "$log_file"

  (
    cd "$repo_root"
    nohup bash scripts/pm/run_pm_daemon.sh --watch-only >>"$log_file" 2>&1 &
    echo $! >"$pid_file"
  )

  sleep 2
  if is_running; then
    echo "pm-daemon started (pid $(cat "$pid_file"))"
    echo "log: $log_file"
    return 0
  fi

  echo "pm-daemon failed to start" >&2
  echo "log: $log_file" >&2
  tail -n 40 "$log_file" >&2 || true
  rm -f "$pid_file"
  return 1
}

stop_daemon() {
  if ! is_running; then
    echo "pm-daemon is not running"
    rm -f "$pid_file"
    return 0
  fi

  local pid
  pid="$(cat "$pid_file")"
  kill "$pid" 2>/dev/null || true

  for _ in $(seq 1 20); do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$pid_file"
      echo "pm-daemon stopped"
      return 0
    fi
    sleep 0.5
  done

  kill -9 "$pid" 2>/dev/null || true
  rm -f "$pid_file"
  echo "pm-daemon force-stopped"
}

status_daemon() {
  if is_running; then
    echo "pm-daemon running (pid $(cat "$pid_file"))"
    echo "log: $log_file"
  else
    echo "pm-daemon not running"
    echo "log: $log_file"
    rm -f "$pid_file"
  fi
}

logs_daemon() {
  if [[ ! -f "$log_file" ]]; then
    echo "No log file yet: $log_file"
    return 0
  fi
  tail -n 80 "$log_file"
}

case "$cmd" in
  start)
    start_daemon
    ;;
  stop)
    stop_daemon
    ;;
  restart)
    stop_daemon
    start_daemon
    ;;
  status)
    status_daemon
    ;;
  logs)
    logs_daemon
    ;;
  *)
    echo "Usage: bash scripts/pm/daemon_control.sh {start|stop|restart|status|logs}" >&2
    exit 1
    ;;
esac
