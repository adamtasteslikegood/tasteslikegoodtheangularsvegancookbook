"""Confluence and Jira Markdown formatting, reflection, and storage conversion helpers.

Extracted from atlassian_pm_link.py (KAN-467) to separate Markdown/HTML formatting
and local git workstream reflection from the Atlassian HTTP client and CLI entrypoint.
"""

from __future__ import annotations

import datetime as dt
import html
import json
import re
import subprocess
import sys
import textwrap
from collections import Counter
from pathlib import Path
from typing import TYPE_CHECKING, Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _canonical_pm_files import BRIEFING_SUMMARY_FILES  # noqa: E402
from _confluence_format import markdown_to_storage  # noqa: E402

if TYPE_CHECKING:
    from atlassian_pm_link import AtlassianClient, Config

REPO_ROOT = Path(__file__).resolve().parents[2]


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
        except RuntimeError:
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
    for filename in BRIEFING_SUMMARY_FILES:
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
            "- **A sprint item is only tracked once it has an RCP acceptance row.** Board 168 filters "
            "`project = RCP`, so a KAN key added to a sprint is a member NO COLUMN CAN RENDER. Every SI "
            "needs an RCP Story `S<N> acceptance: <what> (KAN-###)`, labelled `acceptance` + `sprint-N`, "
            "`Relates`-linked to its KAN row, in the sprint. The KAN execution rows stay in the sprint too "
            "and must ALSO carry `sprint-N`. Verify with `bash scripts/pm/check_sprint_lane.sh`; see "
            "CLAUDE.md for the full rule. Sprint 9 shipped ten bare KAN keys and the board showed one row "
            "for four days (KAN-260).",
            "- Confluence is the authoritative historical context and planning narrative source, updated non-destructively.",
            "- Local markdown files are working copies that feed Confluence; they should be synced after planning changes.",
            "",
        ]
    )
    return "\n".join(lines)


def markdown_to_storage_html(markdown_text: str) -> str:
    """Convert Markdown to Confluence storage format.

    Thin wrapper kept for import stability (publish_session_log imports this
    name). Delegates to the shared md2cf-based converter; the previous
    hand-rolled line parser only understood bullets/code/paragraphs and
    emitted non-storage HTML for anything else.
    """
    return markdown_to_storage(markdown_text)


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
