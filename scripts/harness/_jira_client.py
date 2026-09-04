#!/usr/bin/env python3
"""Minimal Jira REST + Agile API client for the Sprint 9 harness.

Stdlib only, matching the conventions in ``scripts/pm/`` — no ``requests``,
credentials read from the repo-root ``.env``, and every call routed through
``_atlassian_guard`` so the tooling can never be pointed at the frozen ``-dev``
service site.

Worktree note: this repo runs most agent sessions in ``.claude/worktrees/*``,
which have no ``.env`` of their own. ``repo_root()`` resolves the MAIN checkout
via ``git rev-parse --git-common-dir`` (the same trick the PreCompact session-log
hook uses) so a worktree run reads the real credentials instead of dying on a
missing file.

The Agile API (``/rest/agile/1.0/``) is deliberately hand-rolled: the Atlassian
MCP tools wrap only the platform API, so boards and sprints are unreachable
through them.
"""

import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pm"))
from _atlassian_guard import validate_atlassian_site  # noqa: E402


def repo_root() -> Path:
    """The MAIN checkout, even when called from a linked worktree."""
    try:
        common = subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        if common:
            return Path(common).parent
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    return Path(__file__).resolve().parents[2]


def load_env() -> dict:
    env = {}
    path = repo_root() / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            env[key.strip()] = val.strip().strip("'\"")
    # Real environment wins, so CI can inject credentials without a file.
    for key in ("ATLASSIAN_URL", "ATLASSIAN_EMAIL", "ATLASSIAN_API_TOKEN"):
        if os.environ.get(key):
            env[key] = os.environ[key]
    return env


class Jira:
    def __init__(self):
        env = load_env()
        missing = [k for k in ("ATLASSIAN_EMAIL", "ATLASSIAN_API_TOKEN") if not env.get(k)]
        if missing:
            raise SystemExit("missing credentials in .env: %s" % ", ".join(missing))
        self.host = validate_atlassian_site(
            env.get("ATLASSIAN_URL", "tasteslikegood.atlassian.net"))
        token = base64.b64encode(
            ("%s:%s" % (env["ATLASSIAN_EMAIL"], env["ATLASSIAN_API_TOKEN"])).encode()
        ).decode()
        self._auth = "Basic %s" % token

    def call(self, method, path, body=None):
        url = "https://%s%s" % (self.host, path)
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", self._auth)
        req.add_header("Accept", "application/json")
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode()[:600]
            raise RuntimeError("%s %s -> %s: %s" % (method, path, exc.code, detail)) from None
        except urllib.error.URLError as exc:
            # Network-layer failures (DNS, refused, timeout) must funnel through
            # RuntimeError so callers' `except RuntimeError` blocks catch them
            # and produce the documented exit-2 "API error" path instead of a
            # raw traceback that looks like a real gate failure.
            raise RuntimeError("%s %s -> network error: %s" % (method, path, exc.reason)) from None

    # --- reads -----------------------------------------------------------
    def issue(self, key, fields="summary,status,issuetype,parent,resolution", expand=None):
        path = "/rest/api/3/issue/%s?fields=%s" % (key, fields)
        if expand:
            path += "&expand=%s" % expand
        return self.call("GET", path)

    def issue_changelog(self, key):
        """Return every changelog history for an issue, oldest-page first."""
        out, start = [], 0
        while True:
            page = self.call(
                "GET", "/rest/api/3/issue/%s/changelog?startAt=%d&maxResults=100"
                % (key, start))
            values = page.get("values", [])
            out.extend(values)
            if not values or len(out) >= page.get("total", 0):
                return out
            start += len(values)

    def sprints(self, board_id):
        out, start = [], 0
        while True:
            page = self.call(
                "GET", "/rest/agile/1.0/board/%d/sprint?startAt=%d&maxResults=50"
                % (board_id, start))
            values = page.get("values", [])
            out.extend(values)
            if page.get("isLast", True) or not values:
                return out
            start += len(values)

    def board_sprint_issues(self, board_id, sprint_id):
        """Only what the BOARD RENDERS for a sprint — its filter applies here.

        This is NOT ``sprint_issues`` with an extra argument. ``sprint_issues``
        returns sprint MEMBERSHIP and ignores the board filter entirely. A board
        filter can therefore hide sprint members from every column; for example,
        board 168 filters ``project = RCP`` and cannot render KAN execution rows.
        Reading only membership is what let Sprint 9 report a green gate over a
        board displaying one row."""
        out, start = [], 0
        while True:
            page = self.call(
                "GET", "/rest/agile/1.0/board/%d/sprint/%d/issue?startAt=%d"
                       "&maxResults=50&fields=summary,status,issuetype"
                       % (board_id, sprint_id, start))
            issues = page.get("issues", [])
            out.extend(issues)
            if not issues or len(out) >= page.get("total", 0):
                return out
            start += len(issues)

    def sprint_issues(self, sprint_id):
        out, start = [], 0
        while True:
            page = self.call(
                "GET", "/rest/agile/1.0/sprint/%d/issue?startAt=%d&maxResults=50"
                       "&fields=summary,status,issuetype" % (sprint_id, start))
            issues = page.get("issues", [])
            out.extend(issues)
            if not issues or len(out) >= page.get("total", 0):
                return out
            start += len(issues)

    # --- writes ----------------------------------------------------------
    def create_sprint(self, board_id, name, start_iso, end_iso, goal=""):
        return self.call("POST", "/rest/agile/1.0/sprint", {
            "name": name, "originBoardId": board_id,
            "startDate": start_iso, "endDate": end_iso, "goal": goal,
        })

    def start_sprint(self, sprint_id, start_iso, end_iso):
        return self.call("POST", "/rest/agile/1.0/sprint/%d" % sprint_id, {
            "state": "active", "startDate": start_iso, "endDate": end_iso,
        })

    def add_to_sprint(self, sprint_id, keys):
        return self.call("POST", "/rest/agile/1.0/sprint/%d/issue" % sprint_id,
                         {"issues": list(keys)})

    def transitions(self, key):
        return self.call("GET", "/rest/api/3/issue/%s/transitions" % key).get("transitions", [])

    def transition_to(self, key, status_name):
        """Move an issue to a status BY NAME. Returns the transition used, or
        None when the issue already sits there."""
        current = self.issue(key)["fields"]["status"]["name"]
        if current.strip().lower() == status_name.strip().lower():
            return None
        target = status_name.strip().lower()
        available = self.transitions(key)
        for t in available:
            if t["to"]["name"].strip().lower() == target:
                self.call("POST", "/rest/api/3/issue/%s/transitions" % key,
                          {"transition": {"id": t["id"]}})
                return t
        raise RuntimeError(
            "no transition from %r to %r on %s (available: %s)"
            % (current, status_name, key,
               ", ".join(t["to"]["name"] for t in available)))

    def comment(self, key, text):
        return self.call("POST", "/rest/api/3/issue/%s/comment" % key, {
            "body": {"type": "doc", "version": 1, "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": text}]}]},
        })
