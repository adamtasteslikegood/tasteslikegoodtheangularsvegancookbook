#!/usr/bin/env python3
"""Publish a non-destructive Confluence session log page from a markdown file."""

from __future__ import annotations

import argparse
import os
from datetime import datetime, timezone
from pathlib import Path

from atlassian_pm_link import AtlassianClient, AtlassianError, load_config, markdown_to_storage_html


def default_title(markdown_path: Path) -> str:
    # Seconds precision: two logs published in the same minute would otherwise
    # collide on Confluence's unique page-title constraint.
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    stem = markdown_path.stem.replace("_", " ").replace("-", " ").strip()
    return f"Session Log - {timestamp} - {stem}" if stem else f"Session Log - {timestamp}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish a markdown session log to Confluence.")
    parser.add_argument("--file", required=True, help="Markdown file to publish")
    parser.add_argument("--title", help="Confluence page title override")
    parser.add_argument("--parent-id", help="Parent page ID override")
    args = parser.parse_args()

    markdown_path = Path(args.file).resolve()
    if not markdown_path.exists():
        raise SystemExit(f"Markdown file not found: {markdown_path}")

    config = load_config()
    client = AtlassianClient(config)
    space_id = client.resolve_confluence_space_id()
    parent_id = (
        args.parent_id
        or os.environ.get("ATLASSIAN_CONFLUENCE_SESSION_LOG_PARENT_PAGE_ID")
        or config.confluence_parent_page_id
    )
    title = args.title or default_title(markdown_path)
    body = markdown_to_storage_html(markdown_path.read_text(encoding="utf-8"))

    payload = {
        "spaceId": space_id,
        "status": "current",
        "title": title,
        "body": {"representation": "storage", "value": body},
    }
    if parent_id:
        payload["parentId"] = parent_id

    created = client.request_json("POST", "/wiki/api/v2/pages", payload=payload)
    page_id = str(created.get("id", "<unknown>"))
    print(f"Created Confluence session log page {page_id}: {title}")
    print(f"URL: {config.base_url}/wiki/spaces/{config.confluence_space_key}/pages/{page_id}")

    # The Agent Session Logs index requires the agent-session-log label on
    # every entry (CQL filtering). Labels can't ride on the v2 create payload,
    # so apply via the v1 API; a label failure shouldn't fail the publish.
    try:
        client.request_json(
            "POST",
            f"/wiki/rest/api/content/{page_id}/label",
            payload=[{"prefix": "global", "name": "agent-session-log"}],
        )
        print("Label: agent-session-log")
    except AtlassianError as exc:
        print(f"Warning: agent-session-log label not applied: {exc}")


if __name__ == "__main__":
    try:
        main()
    except AtlassianError as exc:
        raise SystemExit(f"Confluence publish failed: {exc}") from exc
