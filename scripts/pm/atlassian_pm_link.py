#!/usr/bin/env python3
"""Jira + Confluence PM briefing and sync utility.

This script is intentionally dependency-free so every agent session can run it
without a Python package install step. It reads Atlassian credentials from .env,
fetches Jira project state and relevant Confluence planning/session pages, then
writes a concise PM briefing for handoff between sessions.
"""

from __future__ import annotations

import argparse
import base64
import dataclasses
import datetime as dt
import html
import json
import os
import re
import sys
import textwrap
import urllib.error
import urllib.parse
import urllib.request
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any

# Make sibling modules importable whether this file is run as a script or
# imported (e.g. by publish_session_log.py).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _jira_projects import resolve_jira_projects  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = REPO_ROOT / ".agent-work" / "pm" / "PROJECT_PM_BRIEFING.md"
DEFAULT_CACHE = REPO_ROOT / ".agent-work" / "pm" / "atlassian-state.json"
DEFAULT_WORK_REFLECTION = REPO_ROOT / ".agent-work" / "pm" / "JIRA_KAN_WORK_REFLECTION.md"
LOCAL_PM_FILES = [
    "specs/planning_notes.md",
    "specs/plan.md",
    "specs/roadmap.md",
    "specs/design-plan.md",
]


@dataclasses.dataclass(frozen=True)
class Config:
    atlassian_url: str
    email: str
    api_token: str
    jira_project_key: str = "KAN,RCP"
    confluence_space_key: str = "TLG"
    confluence_space_id: str | None = None
    confluence_parent_page_id: str | None = None
    confluence_briefing_title: str = "Project PM Briefing - Live State"

    @property
    def base_url(self) -> str:
        value = self.atlassian_url.strip().removeprefix("https://").removeprefix("http://")
        return f"https://{value.rstrip('/')}"


class AtlassianError(RuntimeError):
    pass


class AtlassianClient:
    def __init__(self, config: Config) -> None:
        self.config = config
        token = base64.b64encode(f"{config.email}:{config.api_token}".encode("utf-8")).decode("utf-8")
        self.headers = {
            "Authorization": f"Basic {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "tlg-pm-link/1.0",
        }

    def request_json(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, Any] | None = None,
        # list payloads: some v1 endpoints (e.g. content labels) take a JSON array
        payload: dict[str, Any] | list[Any] | None = None,
    ) -> dict[str, Any]:
        url = self.config.base_url + path
        if query:
            clean_query = {k: v for k, v in query.items() if v is not None}
            url += "?" + urllib.parse.urlencode(clean_query, doseq=True)

        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")

        request = urllib.request.Request(url, data=data, method=method.upper(), headers=self.headers)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read().decode("utf-8")
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")[:1000]
            raise AtlassianError(f"{method.upper()} {path} failed: HTTP {exc.code}: {body}") from exc
        except urllib.error.URLError as exc:
            raise AtlassianError(f"{method.upper()} {path} failed: {exc.reason}") from exc

    def fetch_jira_issues(self, max_results: int) -> list[dict[str, Any]]:
        fields = [
            "summary",
            "status",
            "issuetype",
            "priority",
            "assignee",
            "updated",
            "created",
            "resolutiondate",
            "labels",
            "parent",
        ]
        issues: list[dict[str, Any]] = []
        next_page_token: str | None = None
        
        # Support multiple project keys if provided as a comma-separated string
        if "," in self.config.jira_project_key:
            project_keys = self.config.jira_project_key.split(",")
            projects_jql = ",".join(f'"{k.strip()}"' for k in project_keys)
            jql = f'project IN ({projects_jql}) ORDER BY updated DESC'
        else:
            jql = f'project = "{self.config.jira_project_key}" ORDER BY updated DESC'

        while len(issues) < max_results:
            batch_size = min(100, max_results - len(issues))
            response = self.request_json(
                "GET",
                "/rest/api/3/search/jql",
                query={
                    "jql": jql,
                    "fields": ",".join(fields),
                    "maxResults": batch_size,
                    "nextPageToken": next_page_token,
                },
            )
            issues.extend(response.get("issues", []))
            next_page_token = response.get("nextPageToken")
            if response.get("isLast", True) or not next_page_token:
                break

        return issues

    def fetch_confluence_spaces(self) -> list[dict[str, Any]]:
        response = self.request_json("GET", "/wiki/api/v2/spaces", query={"limit": 250})
        return response.get("results", [])

    def resolve_confluence_space_id(self) -> str:
        if self.config.confluence_space_id:
            return self.config.confluence_space_id
        for space in self.fetch_confluence_spaces():
            if space.get("key") == self.config.confluence_space_key:
                return str(space["id"])
        raise AtlassianError(f"Could not resolve Confluence space key {self.config.confluence_space_key!r}")

    def search_confluence_pages(self, limit: int) -> list[dict[str, Any]]:
        cql = (
            f'space = "{self.config.confluence_space_key}" AND '
            "(title ~ \"session\" OR title ~ \"planning\" OR title ~ \"status\" OR "
            "title ~ \"roadmap\" OR title ~ \"execution plan\" OR title ~ \"project\" OR "
            "text ~ \"previous session\" OR text ~ \"next steps\") "
            "ORDER BY lastmodified DESC"
        )
        response = self.request_json(
            "GET",
            "/wiki/rest/api/search",
            query={"cql": cql, "limit": limit},
        )
        return response.get("results", [])

    def fetch_confluence_page(self, page_id: str) -> dict[str, Any]:
        return self.request_json(
            "GET",
            f"/wiki/api/v2/pages/{page_id}",
            query={"body-format": "storage"},
        )

    def find_page_by_title(self, space_id: str, title: str) -> dict[str, Any] | None:
        response = self.request_json(
            "GET",
            f"/wiki/api/v2/spaces/{space_id}/pages",
            query={"title": title, "limit": 1},
        )
        pages = response.get("results", [])
        return pages[0] if pages else None

    def publish_confluence_page(self, markdown_body: str) -> str:
        space_id = self.resolve_confluence_space_id()
        title = self.config.confluence_briefing_title
        existing = self.find_page_by_title(space_id, title)
        storage_html = markdown_to_storage_html(markdown_body)

        base_payload: dict[str, Any] = {
            "spaceId": space_id,
            "status": "current",
            "title": title,
            "body": {"representation": "storage", "value": storage_html},
        }
        if self.config.confluence_parent_page_id and not existing:
            base_payload["parentId"] = self.config.confluence_parent_page_id

        if existing:
            page_id = str(existing["id"])
            page = self.request_json("GET", f"/wiki/api/v2/pages/{page_id}")
            version = int(page.get("version", {}).get("number", 1)) + 1
            payload = {
                **base_payload,
                "id": page_id,
                "version": {"number": version, "message": "Updated by PM link"},
            }
            self.request_json("PUT", f"/wiki/api/v2/pages/{page_id}", payload=payload)
            return f"updated Confluence page {page_id}: {title}"

        created = self.request_json("POST", "/wiki/api/v2/pages", payload=base_payload)
        return f"created Confluence page {created.get('id', '<unknown>')}: {title}"


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        values[key] = value
    return values


def _jira_project_keys(merged: dict[str, str]) -> str:
    # Shared resolver (see _jira_projects.py) so this and
    # sync_jira_confluence_status.py can't drift.
    return ",".join(resolve_jira_projects(merged.get))


def load_config() -> Config:
    env = load_env_file(REPO_ROOT / ".env")
    merged = {**env, **os.environ}
    required = ["ATLASSIAN_URL", "ATLASSIAN_EMAIL", "ATLASSIAN_API_TOKEN"]
    missing = [key for key in required if not merged.get(key)]
    if missing:
        joined = ", ".join(missing)
        raise SystemExit(f"Missing required .env variables: {joined}")

    return Config(
        atlassian_url=merged["ATLASSIAN_URL"],
        email=merged["ATLASSIAN_EMAIL"],
        api_token=merged["ATLASSIAN_API_TOKEN"],
        jira_project_key=_jira_project_keys(merged),
        confluence_space_key=merged.get("ATLASSIAN_CONFLUENCE_SPACE_KEY", "TLG"),
        confluence_space_id=merged.get("ATLASSIAN_CONFLUENCE_SPACE_ID") or None,
        confluence_parent_page_id=merged.get("ATLASSIAN_CONFLUENCE_PARENT_PAGE_ID") or "11796481",
        confluence_briefing_title=merged.get(
            "ATLASSIAN_CONFLUENCE_BRIEFING_TITLE", "Project PM Briefing - Live State"
        ),
    )


def status_name(issue: dict[str, Any]) -> str:
    return issue.get("fields", {}).get("status", {}).get("name", "Unknown")


def issue_type(issue: dict[str, Any]) -> str:
    return issue.get("fields", {}).get("issuetype", {}).get("name", "Unknown")


def priority_name(issue: dict[str, Any]) -> str:
    priority = issue.get("fields", {}).get("priority")
    return priority.get("name", "None") if isinstance(priority, dict) else "None"


def assignee_name(issue: dict[str, Any]) -> str:
    assignee = issue.get("fields", {}).get("assignee")
    return assignee.get("displayName", "Unassigned") if isinstance(assignee, dict) else "Unassigned"


def updated_at(issue: dict[str, Any]) -> str:
    return issue.get("fields", {}).get("updated", "")[:10]


def is_done(issue: dict[str, Any]) -> bool:
    status = issue.get("fields", {}).get("status", {})
    category = status.get("statusCategory", {}).get("key")
    return category == "done" or status.get("name", "").lower() in {"done", "closed", "resolved"}


def is_blocker(issue: dict[str, Any]) -> bool:
    status = status_name(issue).lower()
    priority = priority_name(issue).lower()
    labels = [str(label).lower() for label in issue.get("fields", {}).get("labels", [])]
    return "block" in status or "blocker" in labels or priority in {"highest", "critical"}


def strip_html(value: str) -> str:
    no_tags = re.sub(r"<[^>]+>", " ", value)
    text = html.unescape(no_tags)
    return re.sub(r"\s+", " ", text).strip()


def page_url(config: Config, result: dict[str, Any], page: dict[str, Any] | None = None) -> str:
    links = result.get("content", {}).get("_links", {}) or result.get("_links", {})
    webui = links.get("webui") or (page or {}).get("_links", {}).get("webui")
    if webui:
        return config.base_url + "/wiki" + webui if webui.startswith("/spaces") else config.base_url + webui
    page_id = result.get("content", {}).get("id") or (page or {}).get("id")
    return f"{config.base_url}/wiki/pages/{page_id}" if page_id else config.base_url


def summarize_confluence(client: AtlassianClient, config: Config, limit: int) -> list[dict[str, str]]:
    pages: list[dict[str, str]] = []
    for result in client.search_confluence_pages(limit):
        content = result.get("content") or {}
        page_id = str(content.get("id") or "")
        if not page_id:
            continue
        title = content.get("title") or result.get("title") or "Untitled"
        try:
            page = client.fetch_confluence_page(page_id)
            body = page.get("body", {}).get("storage", {}).get("value", "")
            text = strip_html(body)
        except AtlassianError:
            page = None
            text = strip_html(result.get("excerpt", ""))
        pages.append(
            {
                "id": page_id,
                "title": title,
                "url": page_url(config, result, page),
                "excerpt": textwrap.shorten(text or strip_html(result.get("excerpt", "")), width=500, placeholder="..."),
            }
        )
    return pages


def summarize_local_pm_files() -> list[dict[str, str]]:
    summaries: list[dict[str, str]] = []
    for filename in LOCAL_PM_FILES:
        path = REPO_ROOT / filename
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        headings = [line.strip("# ") for line in text.splitlines() if line.startswith("#")]
        summaries.append(
            {
                "file": filename,
                "headings": "; ".join(headings[:5]) or "No headings found",
                "excerpt": textwrap.shorten(re.sub(r"\s+", " ", text), width=350, placeholder="..."),
            }
        )
    return summaries



def run_git(args: list[str]) -> str:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=REPO_ROOT,
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


def current_branch() -> str:
    # `git branch --show-current` prints the branch name on a normal checkout
    # and an empty string on a detached HEAD. Fall back to a short SHA so the
    # reflection can still identify what's checked out; reserve "unknown" for
    # cases where git is genuinely unavailable (not a worktree, not installed,
    # command timed out).
    branch = run_git(["branch", "--show-current"])
    if branch:
        return branch
    sha = run_git(["rev-parse", "--short", "HEAD"])
    if sha:
        return f"detached@{sha}"
    return "unknown"


def changed_files() -> list[str]:
    output = run_git(["status", "--short", "--untracked-files=no"])
    files: list[str] = []
    for line in output.splitlines():
        if not line.strip() or len(line) < 4:
            continue
        path = line[3:].strip()
        if " -> " in path:
            path = path.rsplit(" -> ", 1)[1]
        files.append(path)
    return files


def recent_commits(limit: int = 10) -> list[str]:
    output = run_git(["log", f"-n{limit}", "--pretty=format:%h %s"])
    return [line.strip() for line in output.splitlines() if line.strip()]


def extract_issue_keys(*values: str) -> list[str]:
    seen: set[str] = set()
    keys: list[str] = []
    for value in values:
        for key in re.findall(r"\b[A-Z][A-Z0-9]+-\d+\b", value or ""):
            if key not in seen:
                keys.append(key)
                seen.add(key)
    return keys


def issue_lookup(issues: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(issue.get("key", "")): issue for issue in issues if issue.get("key")}


def issue_summary(config: Config, issue: dict[str, Any] | None, key: str) -> str:
    if issue:
        fields = issue.get("fields", {})
        return (
            f"[{key}]({config.base_url}/browse/{key}) - {fields.get('summary', 'No summary')} "
            f"[{issue_type(issue)}, {status_name(issue)}, {assignee_name(issue)}]"
        )
    return f"[{key}]({config.base_url}/browse/{key}) - referenced in git, not present in fetched Jira results (may be outside --max-issues); verify in Jira or rerun with a higher --max-issues"


def infer_workstream_from_path(path: str) -> str:
    if path.startswith("scripts/pm/") or path.startswith(".pi/"):
        return "PM/session automation"
    if path.startswith("specs/") or path.startswith("docs/"):
        return "planning/documentation"
    if path.startswith("Backend/"):
        return "Flask backend"
    if path.startswith("server/"):
        return "Express proxy"
    if path.startswith("src/"):
        return "Angular frontend"
    if path.startswith(".github/"):
        return "GitHub workflow"
    return "repository maintenance"


def build_work_reflection(config: Config, issues: list[dict[str, Any]]) -> dict[str, Any]:
    branch = current_branch()
    files = changed_files()
    commits = recent_commits()
    issue_map = issue_lookup(issues)
    referenced_keys = extract_issue_keys(branch, "\n".join(commits), "\n".join(files))
    referenced_issues = [issue_summary(config, issue_map.get(key), key) for key in referenced_keys]
    # Derive execution/delivery project keys from config so counts don't
    # silently break when a non-default project key is configured. The
    # configured value is a CSV of project keys; by convention the first is
    # execution (e.g. KAN) and the second, when present, is delivery (RCP).
project_keys = [part.strip() for part in config.jira_project_key.split(",") if part.strip()]
execution_key = (project_keys[0] if project_keys else "KAN").upper()
delivery_key = (project_keys[1] if len(project_keys) > 1 else execution_key).upper()
active_kan = [
    issue for issue in issues
    if str(issue.get("key", "")).upper().startswith(f"{execution_key}-") and not is_done(issue)
]
active_rcp = [
    issue for issue in issues
    if str(issue.get("key", "")).upper().startswith(f"{delivery_key}-") and not is_done(issue)
]
    workstreams = Counter(infer_workstream_from_path(path) for path in files)
    git_unavailable = branch == "unknown" and not files and not commits
    untracked_refs = not referenced_keys and not git_unavailable and (branch != "dev" or files)
    jira_status = (
        "Git unavailable"
        if git_unavailable
        else "Linked"
        if referenced_keys
        else "Needs KAN link"
        if files or branch != "dev"
        else "Clean no-op"
    )

    recommendations: list[str] = []
    if git_unavailable:
        recommendations.append(
            "Git state unavailable (not a git worktree or git not installed); cannot infer KAN linkage from local changes."
        )
    elif untracked_refs:
        recommendations.append(
            f"Create or update a {execution_key} execution issue for branch `{branch}` with the changed-file summary and current next action."
        )
    if files:
        recommendations.append(f"Add branch/PR/file refs to the active {execution_key} issue before handoff.")
    if active_rcp and (referenced_keys or files):
        recommendations.append(
            f"If this work changes sprint, epic, release, or acceptance scope, update the relevant {delivery_key} issue; otherwise leave {delivery_key} unchanged."
        )
    if not recommendations:
        recommendations.append("No Jira update is required from local git state alone.")

    return {
        "branch": branch,
        "changed_files": files,
        "recent_commits": commits,
        "referenced_issue_keys": referenced_keys,
        "referenced_issues": referenced_issues,
        "active_kan_count": len(active_kan),
        "active_rcp_count": len(active_rcp),
        "workstreams": workstreams,
        "jira_status": jira_status,
        "recommendations": recommendations,
    }


def format_work_reflection(config: Config, reflection: dict[str, Any]) -> str:
    generated = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    lines = [
        "# Jira/KAN Work Reflection",
        "",
        f"Generated: {generated}",
        f"Branch: `{reflection['branch']}`",
        f"Jira linkage status: **{reflection['jira_status']}**",
        "",
        "## Local Git Signal",
        "",
    ]
    files = reflection["changed_files"]
    if files:
        for path in files[:30]:
            lines.append(f"- `{path}` ({infer_workstream_from_path(path)})")
        if len(files) > 30:
            lines.append(f"- …and {len(files) - 30} more changed files")
    else:
        lines.append("- No modified tracked files detected.")

    lines.extend(["", "## Referenced Jira Issues", ""])
    if reflection["referenced_issues"]:
        lines.extend(f"- {item}" for item in reflection["referenced_issues"])
    else:
        lines.append("- No Jira issue key found in branch name, recent commit subjects, or changed tracked file paths.")

    lines.extend(["", "## Workstream Signals", ""])
    if reflection["workstreams"]:
        for stream, count in reflection["workstreams"].most_common():
            lines.append(f"- {stream}: {count} changed file(s)")
    else:
        lines.append("- No local file-change signal.")

    lines.extend(["", "## Recommended Jira/KAN Updates", ""])
    for item in reflection["recommendations"]:
        lines.append(f"- {item}")

    lines.extend(
        [
            "",
            "## Board Role Reminder",
            "",
            "- KAN should reflect active branch/work ownership, blockers, handoffs, and immediate next actions.",
            "- RCP should reflect delivery scope, epics, sprint commitments, and acceptance changes only when this work affects them.",
            "- Confluence should receive the durable session narrative and PM drift notes.",
            "",
        ]
    )
    return "\n".join(lines)

def issue_line(config: Config, issue: dict[str, Any]) -> str:
    key = issue.get("key", issue.get("id", "UNKNOWN"))
    fields = issue.get("fields", {})
    summary = fields.get("summary", "No summary")
    return (
        f"- [{key}]({config.base_url}/browse/{key}) - {summary} "
        f"[{issue_type(issue)}, {status_name(issue)}, {priority_name(issue)}, {assignee_name(issue)}, updated {updated_at(issue)}]"
    )


def build_markdown(config: Config, issues: list[dict[str, Any]], pages: list[dict[str, str]]) -> str:
    generated = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    status_counts = Counter(status_name(issue) for issue in issues)
    type_counts = Counter(issue_type(issue) for issue in issues)
    assignee_counts = Counter(assignee_name(issue) for issue in issues if not is_done(issue))
    open_issues = [issue for issue in issues if not is_done(issue)]
    done_issues = [issue for issue in issues if is_done(issue)]
    blockers = [issue for issue in open_issues if is_blocker(issue)]
    active = [issue for issue in open_issues if status_name(issue).lower() in {"in progress", "in review", "review"}]
    recent = issues[:15]
    local_pm = summarize_local_pm_files()
    work_reflection = build_work_reflection(config, issues)

    lines = [
        "# Project PM Briefing",
        "",
        f"Generated: {generated}",
        f"Jira project: `{config.jira_project_key}`",
        f"Confluence space: `{config.confluence_space_key}`",
        "",
        "## Executive Snapshot",
        "",
        f"- Total Jira issues fetched: {len(issues)}",
        f"- Open issues: {len(open_issues)}",
        f"- Done issues: {len(done_issues)}",
        f"- Active issues: {len(active)}",
        f"- Blockers or critical items: {len(blockers)}",
        f"- Confluence planning/session pages fetched: {len(pages)}",
        f"- Local git/Jira linkage: {work_reflection['jira_status']}",
        "",
        "## Current Work Reflection",
        "",
        f"- Branch: `{work_reflection['branch']}`",
        f"- Changed tracked files: {len(work_reflection['changed_files'])}",
        f"- Referenced Jira issues: {', '.join(work_reflection['referenced_issue_keys']) if work_reflection['referenced_issue_keys'] else 'None detected'}",
        "- Recommended board action: " + work_reflection['recommendations'][0],
        "",
        "## Status Counts",
        "",
    ]

    for status, count in status_counts.most_common():
        lines.append(f"- {status}: {count}")

    lines.extend(["", "## Issue Type Counts", ""])
    for item_type, count in type_counts.most_common():
        lines.append(f"- {item_type}: {count}")

    lines.extend(["", "## Active Jira Work", ""])
    if active:
        lines.extend(issue_line(config, issue) for issue in active[:15])
    else:
        lines.append("- No issues currently marked In Progress or In Review.")

    lines.extend(["", "## Blockers And Critical Items", ""])
    if blockers:
        lines.extend(issue_line(config, issue) for issue in blockers[:15])
    else:
        lines.append("- No blockers or critical-priority open issues detected by status, priority, or labels.")

    lines.extend(["", "## Highest Priority Open Backlog", ""])
    open_by_priority = sorted(
        open_issues,
        key=lambda issue: (
            {"highest": 0, "critical": 0, "high": 1, "medium": 2, "low": 3, "lowest": 4}.get(
                priority_name(issue).lower(), 5
            ),
            status_name(issue),
            issue.get("key", ""),
        ),
    )
    if open_by_priority:
        lines.extend(issue_line(config, issue) for issue in open_by_priority[:20])
    else:
        lines.append("- No open backlog items returned.")

    lines.extend(["", "## Recent Jira Updates", ""])
    if recent:
        lines.extend(issue_line(config, issue) for issue in recent)
    else:
        lines.append("- No Jira issues returned.")

    lines.extend(["", "## Open Load By Assignee", ""])
    if assignee_counts:
        for assignee, count in assignee_counts.most_common():
            lines.append(f"- {assignee}: {count}")
    else:
        lines.append("- No open assignee load detected.")

    lines.extend(["", "## Confluence Session And Planning Context", ""])
    if pages:
        for page in pages:
            lines.append(f"### {page['title']}")
            lines.append("")
            lines.append(f"- Page: {page['url']}")
            lines.append(f"- Excerpt: {page['excerpt'] or 'No readable excerpt.'}")
            lines.append("")
    else:
        lines.append("- No matching Confluence planning/session pages were found.")

    lines.extend(["", "## Local PM Artifacts", ""])
    if local_pm:
        for artifact in local_pm:
            lines.append(f"### {artifact['file']}")
            lines.append("")
            lines.append(f"- Headings: {artifact['headings']}")
            lines.append(f"- Excerpt: {artifact['excerpt']}")
            lines.append("")
    else:
        lines.append("- No local PM files found.")

    lines.extend(
        [
            "",
            "## Recommended Session Startup",
            "",
            "1. Start sessions with `npm run pm:start` or at minimum `npm run pm:brief`.",
            "2. Treat KAN as the who/what/now board for active branches, assignees, and in-flight work.",
            "3. Treat RCP as the delivery board for epics, sprint commitments, and acceptance criteria.",
            "4. Treat Confluence as the durable planning/session narrative source and sync non-destructively.",
            "5. Regenerate with `npm run pm:brief`, publish with `npm run pm:sync`, and inspect live state with `npm run pm:status`.",
            "",
            "## Source Of Truth Notes",
            "",
            "- Jira KAN is the authoritative source for active execution ownership and branch-level work tracking.",
            "- Jira RCP is the authoritative source for delivery planning: epics, sprints, scope, and acceptance criteria.",
            "- Confluence is the authoritative historical context and planning narrative source, updated non-destructively.",
            "- Local markdown files are working copies that feed Confluence; they should be synced after planning changes.",
            "",
        ]
    )
    return "\n".join(lines)


def markdown_to_storage_html(markdown_text: str) -> str:
    html_lines: list[str] = []
    in_ul = False
    in_ol = False
    in_code = False
    code_buffer: list[str] = []

    def close_lists() -> None:
        nonlocal in_ul, in_ol
        if in_ul:
            html_lines.append("</ul>")
            in_ul = False
        if in_ol:
            html_lines.append("</ol>")
            in_ol = False

    for raw_line in markdown_text.splitlines():
        line = raw_line.rstrip()
        if line.startswith("```"):
            if in_code:
                html_lines.append(f"<pre><code>{html.escape('\n'.join(code_buffer))}</code></pre>")
                code_buffer = []
                in_code = False
            else:
                close_lists()
                in_code = True
            continue
        if in_code:
            code_buffer.append(line)
            continue
        if not line.strip():
            close_lists()
            continue

        heading = re.match(r"^(#{1,6})\s+(.*)$", line)
        if heading:
            close_lists()
            level = len(heading.group(1))
            html_lines.append(f"<h{level}>{html.escape(heading.group(2))}</h{level}>")
            continue

        bullet = re.match(r"^-\s+(.*)$", line)
        if bullet:
            if in_ol:
                html_lines.append("</ol>")
                in_ol = False
            if not in_ul:
                html_lines.append("<ul>")
                in_ul = True
            html_lines.append(f"<li>{inline_markdown_to_html(bullet.group(1))}</li>")
            continue

        numbered = re.match(r"^\d+\.\s+(.*)$", line)
        if numbered:
            if in_ul:
                html_lines.append("</ul>")
                in_ul = False
            if not in_ol:
                html_lines.append("<ol>")
                in_ol = True
            html_lines.append(f"<li>{inline_markdown_to_html(numbered.group(1))}</li>")
            continue

        close_lists()
        html_lines.append(f"<p>{inline_markdown_to_html(line)}</p>")

    close_lists()
    if in_code:
        html_lines.append(f"<pre><code>{html.escape('\n'.join(code_buffer))}</code></pre>")
    return "\n".join(html_lines)


def inline_markdown_to_html(value: str) -> str:
    escaped = html.escape(value)
    escaped = re.sub(r"`([^`]+)`", r"<code>\1</code>", escaped)
    escaped = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', escaped)
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", escaped)
    return escaped


def write_outputs(markdown_body: str, state: dict[str, Any], output: Path, cache: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    cache.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(markdown_body, encoding="utf-8")
    cache.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


def update_legacy_jira_issues(config: Config, issues: list[dict[str, Any]]) -> None:
    lines = []
    for issue in issues:
        key = issue.get("key", "UNKNOWN")
        fields = issue.get("fields", {})
        summary = fields.get("summary", "No summary")
        lines.append(f"{key}  {summary} [{issue_type(issue)}, {status_name(issue)}]")
    (REPO_ROOT / "jira_issues.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def run_brief(args: argparse.Namespace) -> int:
    config = load_config()
    client = AtlassianClient(config)
    issues = client.fetch_jira_issues(args.max_issues)
    pages = summarize_confluence(client, config, args.confluence_limit)
    markdown_body = build_markdown(config, issues, pages)
    state = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "jira_project_key": config.jira_project_key,
        "confluence_space_key": config.confluence_space_key,
        "jira_issue_count": len(issues),
        "confluence_page_count": len(pages),
        "jira_issues": issues,
        "confluence_pages": pages,
    }
    reflection = build_work_reflection(config, issues)
    reflection_body = format_work_reflection(config, reflection)
    state["work_reflection"] = {**reflection, "workstreams": dict(reflection["workstreams"])}
    write_outputs(markdown_body, state, Path(args.output), Path(args.cache))
    reflection_path = Path(args.work_reflection_output)
    reflection_path.parent.mkdir(parents=True, exist_ok=True)
    reflection_path.write_text(reflection_body, encoding="utf-8")
    if args.update_legacy_files:
        update_legacy_jira_issues(config, issues)
    print(f"Wrote PM briefing: {Path(args.output)}")
    print(f"Wrote work reflection: {reflection_path}")
    print(f"Wrote Atlassian cache: {Path(args.cache)}")
    return 0



def run_reflect(args: argparse.Namespace) -> int:
    config = load_config()
    client = AtlassianClient(config)
    issues = client.fetch_jira_issues(args.max_issues)
    reflection = build_work_reflection(config, issues)
    reflection_body = format_work_reflection(config, reflection)
    reflection_path = Path(args.work_reflection_output)
    reflection_path.parent.mkdir(parents=True, exist_ok=True)
    reflection_path.write_text(reflection_body, encoding="utf-8")
    print(f"Wrote work reflection: {reflection_path}")
    print(f"Jira/KAN linkage: {reflection['jira_status']}")
    for item in reflection["recommendations"]:
        print(f"- {item}")
    return 0

def run_sync(args: argparse.Namespace) -> int:
    config = load_config()
    client = AtlassianClient(config)
    issues = client.fetch_jira_issues(args.max_issues)
    pages = summarize_confluence(client, config, args.confluence_limit)
    markdown_body = build_markdown(config, issues, pages)
    state = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "jira_project_key": config.jira_project_key,
        "confluence_space_key": config.confluence_space_key,
        "jira_issue_count": len(issues),
        "confluence_page_count": len(pages),
        "jira_issues": issues,
        "confluence_pages": pages,
    }
    reflection = build_work_reflection(config, issues)
    reflection_body = format_work_reflection(config, reflection)
    state["work_reflection"] = {**reflection, "workstreams": dict(reflection["workstreams"])}
    write_outputs(markdown_body, state, Path(args.output), Path(args.cache))
    reflection_path = Path(args.work_reflection_output)
    reflection_path.parent.mkdir(parents=True, exist_ok=True)
    reflection_path.write_text(reflection_body, encoding="utf-8")
    if args.update_legacy_files:
        update_legacy_jira_issues(config, issues)
    result = client.publish_confluence_page(markdown_body)
    print(f"Wrote PM briefing: {Path(args.output)}")
    print(f"Wrote work reflection: {reflection_path}")
    print(f"Wrote Atlassian cache: {Path(args.cache)}")
    print(f"Confluence sync: {result}")
    return 0


def run_check(_: argparse.Namespace) -> int:
    config = load_config()
    client = AtlassianClient(config)
    issues = client.fetch_jira_issues(1)
    space_id = client.resolve_confluence_space_id()
    print(f"Atlassian URL: {config.base_url}")
    print(f"Jira project: {config.jira_project_key} ({len(issues)} sample issue fetched)")
    print(f"Confluence space: {config.confluence_space_key} (id {space_id})")
    print("Connection check passed")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Create a Jira + Confluence PM briefing for agent sessions.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_common(subparser: argparse.ArgumentParser) -> None:
        subparser.add_argument("--max-issues", type=int, default=100, help="Maximum Jira issues to fetch.")
        subparser.add_argument("--confluence-limit", type=int, default=10, help="Maximum Confluence pages to fetch.")
        subparser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Markdown briefing output path.")
        subparser.add_argument("--cache", default=str(DEFAULT_CACHE), help="JSON cache output path.")
        subparser.add_argument(
            "--work-reflection-output",
            default=str(DEFAULT_WORK_REFLECTION),
            help="Markdown output path for local git-to-Jira/KAN reflection.",
        )
        subparser.add_argument(
            "--update-legacy-files",
            action="store_true",
            help="Also refresh legacy jira_issues.txt for older workflows.",
        )

    brief = subparsers.add_parser("brief", help="Fetch Jira/Confluence state and write a local PM briefing.")
    add_common(brief)
    brief.set_defaults(func=run_brief)

    sync = subparsers.add_parser("sync", help="Write a local briefing and publish/update it in Confluence.")
    add_common(sync)
    sync.set_defaults(func=run_sync)

    reflect = subparsers.add_parser("reflect", help="Write the local git-to-Jira/KAN work reflection without Confluence sync.")
    add_common(reflect)
    reflect.set_defaults(func=run_reflect)

    check = subparsers.add_parser("check", help="Verify Jira and Confluence connectivity without writing files.")
    check.set_defaults(func=run_check)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except AtlassianError as exc:
        print(f"Atlassian PM link failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
