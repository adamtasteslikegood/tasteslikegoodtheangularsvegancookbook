#!/usr/bin/env python3
"""Drive the pm-daemon MCP server (scripts/pm/pm_daemon.py) over stdio.

Spawns `bash scripts/pm/run_pm_daemon.sh` from the repo root, performs the
MCP JSON-RPC handshake, then runs one command and exits cleanly:

    driver.py list                          # handshake + list the 5 MCP tools
    driver.py status                        # call get_project_status (read-only)
    driver.py call <tool> [--args '{...}']  # call any tool by name

Stdlib only -- the client side needs no venv. The daemon side bootstraps its
own venv at scripts/pm/.venv on first run (pip output goes to stderr; give it
time -- see --timeout).

WRITE WARNING: sync_pm_documents, refresh_project_briefing(publish=true),
create_epic_from_roadmap and log_agent_session write to Confluence/Jira.
`list` and `status` are safe; `refresh_project_briefing` without args only
rewrites the local briefing file but reads live Jira/Confluence.
"""

from __future__ import annotations  # PEP 604 unions on Python < 3.10

import argparse
import json
import os
import select
import subprocess
import sys
from pathlib import Path

PROTOCOL_VERSION = "2024-11-05"


def find_repo_root() -> Path:
    d = Path(__file__).resolve()
    for parent in d.parents:
        if (parent / "scripts/pm/pm_daemon.py").exists():
            return parent
    sys.exit("error: could not locate scripts/pm/pm_daemon.py above driver")


class Daemon:
    def __init__(self, repo_root: Path, timeout: float):
        self.timeout = timeout
        self.proc = subprocess.Popen(
            ["bash", "scripts/pm/run_pm_daemon.sh"],
            cwd=repo_root,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=sys.stderr,  # daemon logs + first-run pip output stay visible
            text=True,
            bufsize=1,
        )
        self._id = 0

    def _send(self, msg: dict):
        try:
            self.proc.stdin.write(json.dumps(msg) + "\n")
            self.proc.stdin.flush()
        except (BrokenPipeError, OSError):
            code = self.proc.poll()
            sys.exit(f"error: daemon exited (code {code}) before accepting "
                     "input -- see its stderr output above")

    def request(self, method: str, params: dict | None = None) -> dict:
        self._id += 1
        self._send({"jsonrpc": "2.0", "id": self._id, "method": method,
                    "params": params or {}})
        return self._read_response(self._id)

    def notify(self, method: str):
        self._send({"jsonrpc": "2.0", "method": method})

    def _read_response(self, want_id: int) -> dict:
        fd = self.proc.stdout
        while True:
            ready, _, _ = select.select([fd], [], [], self.timeout)
            if not ready:
                self.close()
                sys.exit(f"error: no response to id={want_id} within "
                         f"{self.timeout}s (first run? venv bootstrap can be "
                         f"slow -- retry with --timeout 600)")
            line = fd.readline()
            if not line:
                self.close()
                sys.exit("error: daemon closed stdout (see stderr above)")
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue  # stray non-JSON line; daemon logs go to stderr
            if msg.get("id") == want_id:
                if "error" in msg:
                    self.close()
                    sys.exit(f"RPC error: {json.dumps(msg['error'])}")
                return msg["result"]
            # server-initiated requests/notifications are ignored


    def handshake(self):
        info = self.request("initialize", {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "run-pm-daemon-driver", "version": "1.0"},
        })
        self.notify("notifications/initialized")
        return info

    def close(self):
        try:
            self.proc.stdin.close()
            self.proc.wait(timeout=10)
        except Exception:
            self.proc.kill()


def text_of(result: dict) -> str:
    parts = result.get("content", [])
    return "\n".join(p.get("text", "") for p in parts if p.get("type") == "text")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["list", "status", "call"],
                    nargs="?", default="list")
    ap.add_argument("tool", nargs="?", help="tool name (for 'call')")
    ap.add_argument("--args", default="{}", help="JSON arguments for 'call'")
    ap.add_argument("--timeout", type=float, default=120,
                    help="seconds to wait per response (default 120)")
    opts = ap.parse_args()

    call_args = {}
    if opts.command == "call":
        if not opts.tool:
            ap.error("'call' needs a tool name")
        try:
            call_args = json.loads(opts.args)
        except json.JSONDecodeError as e:
            ap.error(f"--args is not valid JSON: {e}")
        if not isinstance(call_args, dict):
            ap.error("--args must be a JSON object, e.g. '{\"publish\": true}'")

    repo_root = find_repo_root()
    os.chdir(repo_root)
    d = Daemon(repo_root, opts.timeout)
    try:
        info = d.handshake()
        server = info.get("serverInfo", {})
        print(f"connected: {server.get('name')} {server.get('version', '')}".strip(),
              file=sys.stderr)

        if opts.command == "list":
            tools = d.request("tools/list").get("tools", [])
            for t in tools:
                desc = (t.get("description") or "").strip().splitlines()
                print(f"- {t['name']}: {desc[0] if desc else ''}")
        elif opts.command == "status":
            print(text_of(d.request("tools/call",
                                    {"name": "get_project_status", "arguments": {}})))
        else:
            print(text_of(d.request("tools/call",
                                    {"name": opts.tool, "arguments": call_args})))
    finally:
        d.close()


if __name__ == "__main__":
    main()
