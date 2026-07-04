"""Shared Jira project-key resolution for the PM scripts.

Single source of truth so atlassian_pm_link.py and sync_jira_confluence_status.py
can't drift. Standard-library only, so it stays importable before project
dependencies are installed (same constraint as atlassian_pm_link.py).
"""

from __future__ import annotations

from typing import Callable, Optional

# Canonical default project set (matches Config.jira_project_key).
DEFAULT_JIRA_PROJECTS = ["KAN", "RCP", "PLZA", "TO"]


def resolve_jira_projects(get: Callable[[str], Optional[str]]) -> list[str]:
    """Resolve the ordered, de-duplicated list of Jira project keys.

    ``get`` is a lookup callable such as ``dict.get`` or ``os.environ.get``.
    Precedence: explicit ``JIRA_PROJECTS`` / ``ATLASSIAN_JIRA_PROJECTS`` (CSV)
    wins; else the individual ``ATLASSIAN_JIRA_PROJECT_KEY`` /
    ``ATLASSIAN_JIRA_DELIVERY_PROJECT_KEY`` vars; else the comprehensive
    default set.
    """
    explicit = get("JIRA_PROJECTS") or get("ATLASSIAN_JIRA_PROJECTS")
    if explicit:
        parts = [part.strip() for part in explicit.split(",") if part.strip()]
    else:
        primary = get("ATLASSIAN_JIRA_PROJECT_KEY")
        delivery = get("ATLASSIAN_JIRA_DELIVERY_PROJECT_KEY")
        if primary or delivery:
            parts = [primary or "KAN", delivery or "RCP"]
        else:
            parts = list(DEFAULT_JIRA_PROJECTS)
    ordered: list[str] = []
    seen: set[str] = set()
    for part in parts:
        if part and part not in seen:
            ordered.append(part)
            seen.add(part)
    return ordered or list(DEFAULT_JIRA_PROJECTS)
