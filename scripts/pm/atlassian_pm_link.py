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
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

# Make sibling modules importable whether this file is run as a script or
# imported (e.g. by publish_session_log.py).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _atlassian_guard import validate_atlassian_site  # noqa: E402
from _canonical_pm_files import BRIEFING_SUMMARY_FILES  # noqa: E402, F401
from _jira_projects import resolve_jira_projects  # noqa: E402
from _confluence_format import markdown_to_storage  # noqa: E402, F401
from confluence_markdown import (  # noqa: E402, F401
    assignee_name,
    build_markdown,
    build_work_reflection,
    changed_files,
    current_branch,
    extract_issue_keys,
    format_work_reflection,
    infer_workstream_from_path,
    is_blocker,
    is_done,
    issue_line,
    issue_lookup,
    issue_summary,
    issue_type,
    markdown_to_storage_html,
    page_url,
    priority_name,
    recent_commits,
    run_git,
    status_name,
    strip_html,
    summarize_confluence,
    summarize_local_pm_files,
    update_legacy_jira_issues,
    updated_at,
    write_outputs,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = REPO_ROOT / ".agent-work" / "pm" / "PROJECT_PM_BRIEFING.md"
DEFAULT_CACHE = REPO_ROOT / ".agent-work" / "pm" / "atlassian-state.json"
DEFAULT_WORK_REFLECTION = REPO_ROOT / ".agent-work" / "pm" / "JIRA_KAN_WORK_REFLECTION.md"
# The briefing summary is deliberately NARROWER than the Confluence sync set —
# the briefing is injected at session start under a 12k-char cap and the sprint
# plans alone are ~91 KB. That narrowness is intentional; the duplicate
# definition was not. Both sets now live in _canonical_pm_files (KAN-187).


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

    # Defense-in-depth: refuse any site other than the repo's allowlisted
    # Atlassian site (raises AtlassianGuardError on violation — the -dev
    # service site once received misfiled work items). Use the normalized
    # hostname it returns so a pasted URL with a path (e.g. .../wiki) can't
    # leak into base_url and corrupt every request URL.
    atlassian_host = validate_atlassian_site(merged["ATLASSIAN_URL"])

    return Config(
        atlassian_url=atlassian_host,
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
