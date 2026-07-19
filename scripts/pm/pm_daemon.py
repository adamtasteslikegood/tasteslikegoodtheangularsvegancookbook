import os
import sys
import html
import logging
import base64
import subprocess
import requests
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from mcp.server.fastmcp import FastMCP
from dotenv import load_dotenv

# Make sibling modules importable whether this file is run as a script or imported.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _atlassian_guard import AtlassianGuardError, validate_atlassian_site, validate_jira_project_key
from _confluence_format import markdown_to_storage
from _watcher_lock import (
    DISABLE_ENV,
    acquire_watcher_lock,
    read_lock_holder,
    release_watcher_lock,
    watcher_disabled,
)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
logger = logging.getLogger(__name__)

# Find .env in the current directory or parents
def find_dotenv():
    current = Path(os.getcwd())
    for parent in [current, *current.parents]:
        dotenv_path = parent / '.env'
        if dotenv_path.exists():
            return dotenv_path
    return None

dotenv_path = find_dotenv()
if dotenv_path:
    load_dotenv(dotenv_path)
    logger.info(f"Loaded .env from {dotenv_path}")
else:
    logger.warning("Could not find .env file")

# validate_atlassian_site strips any scheme/port/path and raises loudly
# (AtlassianGuardError) if .env points at any site other than the repo's
# allowlisted tasteslikegood.atlassian.net — e.g. the -dev service site.
URL_BASE = validate_atlassian_site(os.environ.get('ATLASSIAN_URL', 'tasteslikegood.atlassian.net'))
EMAIL = os.environ.get('ATLASSIAN_EMAIL')
TOKEN = os.environ.get('ATLASSIAN_API_TOKEN')

# Request timeouts
TIMEOUT = 30

if EMAIL and TOKEN:
    AUTH_STR = f"{EMAIL}:{TOKEN}"
    AUTH_B64 = base64.b64encode(AUTH_STR.encode('utf-8')).decode('utf-8')
    HEADERS = {
        "Authorization": f"Basic {AUTH_B64}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
else:
    HEADERS = {}
    logger.warning("Atlassian credentials missing from .env")

SPACE_ID = os.environ.get('ATLASSIAN_CONFLUENCE_SPACE_ID') or os.environ.get('CONFLUENCE_SPACE_ID', "11042818")  # TLG space ID
PARENT_PAGE_ID = os.environ.get('ATLASSIAN_CONFLUENCE_PARENT_PAGE_ID') or os.environ.get('CONFLUENCE_PARENT_PAGE_ID', "11796481")  # Project Documentation page ID
BRIEFING_FILE = Path('.agent-work/pm/PROJECT_PM_BRIEFING.md')

# Initialize FastMCP server
mcp = FastMCP("PM Daemon")

CANONICAL_PM_FILES = [
    Path("specs/plan.md"),
    Path("specs/roadmap.md"),
    Path("specs/planning_notes.md"),
    Path("specs/design-plan.md"),
    Path("specs/SCRUM_BOOTSTRAP_AND_BOARD_PLAN.md"),
    Path("specs/SPRINT_0_PLAN.md"),
    Path("specs/ATLASSIAN_PM_LINK.md"),
]
WATCHED_FILES = [path.name for path in CANONICAL_PM_FILES]

# Stable, version-free Confluence page titles per canonical PM file. Titles must
# NOT carry a release version: the daemon looks pages up by title, so a moving
# prefix (the old hardcoded "v0.2 ...") would strand each page under its old name
# and spawn a duplicate on the next bump. See KAN-109.
CANONICAL_PAGE_TITLES = {
    "roadmap.md": "Project Roadmap",
    "plan.md": "Execution Plan",
    "planning_notes.md": "Planning Session Review & Notes",
    "design-plan.md": "Design Implementation Plan",
    "SCRUM_BOOTSTRAP_AND_BOARD_PLAN.md": "Scrum Bootstrap & Board Plan",
    "SPRINT_0_PLAN.md": "Sprint 0 Plan",
    "ATLASSIAN_PM_LINK.md": "Atlassian PM Link",
}


def _page_title_for(filepath: Path) -> str:
    """Stable Confluence page title for a canonical PM file (no version prefix)."""
    return CANONICAL_PAGE_TITLES.get(
        filepath.name,
        filepath.name.replace(".md", "").replace("_", " ").title(),
    )


def _find_confluence_page_id(title: str) -> str | None:
    """Return the id of the current page with this exact title in SPACE_ID, or None.

    Raises on HTTP/transport error so callers abort instead of creating a
    duplicate when the lookup itself failed.
    """
    search_url = (
        f"https://{URL_BASE}/wiki/api/v2/spaces/{SPACE_ID}/pages"
        f"?title={requests.utils.quote(title)}&limit=1"
    )
    resp = requests.get(search_url, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    results = resp.json().get("results", [])
    return results[0]["id"] if results else None


class PMFileEventHandler(FileSystemEventHandler):
    def __init__(self, workspace_dir):
        self.workspace_dir = Path(workspace_dir)
        self.canonical_files = [self.workspace_dir / path for path in CANONICAL_PM_FILES]
        super().__init__()

    def _is_canonical_pm_file(self, filepath: Path) -> bool:
        try:
            resolved = filepath.resolve()
        except FileNotFoundError:
            return False
        return any(resolved == candidate.resolve() for candidate in self.canonical_files if candidate.exists())

    def on_modified(self, event):
        if event.is_directory:
            return

        filepath = Path(event.src_path)
        if self._is_canonical_pm_file(filepath):
            logger.info(f"Detected change in {filepath.name}. Triggering PM sync...")
            self.sync_to_confluence(filepath)

    def sync_to_confluence(self, filepath) -> bool:
        """Sync a file to Confluence. Returns True on success, False otherwise."""
        if not HEADERS:
            logger.error("Cannot sync to confluence: No auth headers.")
            return False
        
        title = _page_title_for(filepath)
        # One-time migration off the old hardcoded "v0.2 ..." titles: if a page
        # still lives under the legacy name, update THAT page in place so
        # Confluence renames it, rather than creating a duplicate. (KAN-109)
        legacy_title = f"v0.2 {title}"

        try:
            content = filepath.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            logger.error(f"Failed to read {filepath}: {e}")
            return False

        logger.info(f"Syncing content of {filepath.name} to Confluence: {title}")
        
        storage_body = markdown_to_storage(content)
        
        # Look up the page by its stable title, then (one-time migration) by the
        # legacy "v0.2 ..." title, so an existing page is updated in place
        # instead of duplicated. A lookup error aborts rather than risk a dupe.
        page_id = None
        version = 1
        try:
            page_id = _find_confluence_page_id(title) or _find_confluence_page_id(legacy_title)
        except Exception as e:
            logger.error(f"Error checking page existence for '{title}': {e}")
            return False

        if page_id:
            # Read the live version; abort if unreadable rather than POST a stale
            # version=1 that Confluence would reject (or that could clobber).
            try:
                page_resp = requests.get(
                    f"https://{URL_BASE}/wiki/api/v2/pages/{page_id}",
                    headers=HEADERS,
                    timeout=TIMEOUT,
                )
                page_resp.raise_for_status()
                version = page_resp.json().get("version", {}).get("number", 0) + 1
            except Exception as e:
                logger.error(
                    f"Could not read current version of existing page {page_id} "
                    f"for '{title}': {e}; aborting sync"
                )
                return False

        payload = {
            "spaceId": SPACE_ID,
            "status": "current",
            "title": title,
            "parentId": PARENT_PAGE_ID,
            "body": {
                "representation": "storage",
                "value": storage_body
            }
        }
        
        if page_id:
            # Update existing page
            url = f"https://{URL_BASE}/wiki/api/v2/pages/{page_id}"
            payload["id"] = page_id
            payload["version"] = {"number": version, "message": "Updated by PM Daemon"}
            req_func = requests.put
            logger.info(f"Updating existing Confluence page: {page_id} to version {version}")
        else:
            # Create new page
            url = f"https://{URL_BASE}/wiki/api/v2/pages"
            req_func = requests.post
            logger.info(f"Creating new Confluence page: {title}")

        try:
            for attempt in range(2):
                response = req_func(url, headers=HEADERS, json=payload, timeout=TIMEOUT)
                if response.status_code in (200, 201):
                    logger.info(f"Successfully synced: {title}")
                    return True
                # A concurrent writer (another session's watcher, or a manual
                # sync_pm_documents call that does not hold the watcher lock) can
                # bump the version between our read and this PUT, yielding 409.
                # Re-read the live version once and retry. (KAN-108)
                if page_id and response.status_code == 409 and attempt == 0:
                    logger.warning(
                        f"Version conflict on '{title}' (409); re-reading version and retrying once"
                    )
                    reread = requests.get(
                        f"https://{URL_BASE}/wiki/api/v2/pages/{page_id}",
                        headers=HEADERS,
                        timeout=TIMEOUT,
                    )
                    reread.raise_for_status()
                    payload["version"] = {
                        "number": reread.json().get("version", {}).get("number", 0) + 1,
                        "message": "Updated by PM Daemon (retry after 409)",
                    }
                    continue
                logger.error(f"Failed to sync {title}: {response.status_code} {response.text}")
                return False
            return False
        except Exception as e:
            logger.error(f"Error syncing page {title}: {e}")
            return False

@mcp.tool()
def get_project_status() -> str:
    """Get the current project status and active sprint data from PM notes.
    Call this tool at the beginning of a session to brief the agent on what to do.
    """
    workspace_dir = Path(os.getcwd())
    briefing_path = workspace_dir / BRIEFING_FILE
    if briefing_path.exists():
        try:
            content = briefing_path.read_text(encoding="utf-8", errors="replace")
            return "CURRENT PM BRIEFING:\n" + content[:12000] + ("..." if len(content) > 12000 else "")
        except Exception as e:
            logger.error(f"Failed to read {briefing_path}: {e}")

    status = []
    for relative_path in CANONICAL_PM_FILES:
        filepath = workspace_dir / relative_path
        if not filepath.exists():
            continue
        try:
            content = filepath.read_text(encoding="utf-8", errors="replace")
            label = str(filepath.relative_to(workspace_dir))
            status.append(f"--- {label} ---\n{content[:1500]}" + ("..." if len(content) > 1500 else ""))
        except Exception as e:
            logger.error(f"Failed to read {filepath}: {e}")

    if not status:
        return "No local planning files found in the current workspace."

    return "CURRENT PM BRIEFING:\n" + "\n".join(status)

@mcp.tool()
def sync_pm_documents() -> str:
    """Force a non-destructive sync of the local PM documents to Confluence.
    Call this tool when you want to immediately publish planning-doc changes.
    Jira remains the source of truth for issue status and delivery workflow.
    """
    workspace_dir = Path(os.getcwd())
    handler = PMFileEventHandler(workspace_dir)
    synced = []
    failed = []
    for relative_path in CANONICAL_PM_FILES:
        filepath = workspace_dir / relative_path
        if not filepath.exists():
            continue
        if handler.sync_to_confluence(filepath):
            synced.append(str(filepath.relative_to(workspace_dir)))
        else:
            failed.append(str(filepath.relative_to(workspace_dir)))
            
    result = []
    if synced:
        result.append(f"Sync successful for: {', '.join(synced)}")
    if failed:
        result.append(f"Sync failed for: {', '.join(failed)}")
        
    if not result:
        return "No local planning files found to sync."
        
    return ". ".join(result) + ". The PM Daemon has finished updating the documents in Atlassian."

@mcp.tool()
def refresh_project_briefing(publish: bool = False) -> str:
    """Refresh the project PM briefing from Jira + Confluence.
    Set publish=true to also update the Confluence briefing page.
    """
    script = Path(os.getcwd()) / 'scripts/pm/atlassian_pm_link.py'
    if not script.exists():
        return f"Error: briefing script not found at {script}"

    mode = 'sync' if publish else 'brief'
    try:
        result = subprocess.run(
            [sys.executable, str(script), mode],
            cwd=os.getcwd(),
            capture_output=True,
            text=True,
            timeout=180,
            check=False,
        )
    except Exception as e:
        return f"Error refreshing PM briefing: {e}"

    output = (result.stdout or '').strip()
    error = (result.stderr or '').strip()
    if result.returncode != 0:
        return f"PM briefing refresh failed ({result.returncode}): {error or output}"
    return output or f"PM briefing refresh complete via '{mode}'."


@mcp.tool()
def create_epic_from_roadmap(epic_name: str, description: str, project_key: str = None) -> str:
    """Create a new Epic in the delivery Jira project based on roadmap planning."""
    if not HEADERS:
        return "Error: Atlassian credentials missing."

    # Default epics into the delivery project (RCP), not the execution board (KAN).
    # validate_jira_project_key raises AtlassianGuardError for anything outside
    # the repo write allowlist (KAN, RCP) — e.g. the plaza-game projects PLZG/TO.
    # Surface that as a normal tool error string so MCP callers get a clean
    # failure response instead of a tool-level exception.
    try:
        target_project = validate_jira_project_key(
            project_key
            or os.environ.get('ATLASSIAN_JIRA_DELIVERY_PROJECT_KEY')
            or os.environ.get('JIRA_PROJECT_KEY')
            or 'RCP'
        )
    except AtlassianGuardError as exc:
        return f"Error: {exc}"

    url = f"https://{URL_BASE}/rest/api/3/issue"
    payload = {
        "fields": {
            "project": {"key": target_project},
            "summary": epic_name,
            "description": {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [
                            {"type": "text", "text": description}
                        ]
                    }
                ]
            },
            "issuetype": {"name": "Epic"}
        }
    }
    
    try:
        response = requests.post(url, headers=HEADERS, json=payload, timeout=TIMEOUT)
        if response.status_code == 201:
            issue_key = response.json().get('key')
            return f"Successfully created Epic: {issue_key}"
        else:
            return f"Failed to create Epic in {target_project}: {response.status_code} {response.text}"
    except Exception as e:
        return f"Error creating Epic: {e}"

# Parent page ID for session logs; falls back to the Project Documentation parent when unset
SESSION_LOGS_PARENT_ID = os.environ.get('ATLASSIAN_CONFLUENCE_SESSION_LOG_PARENT_PAGE_ID') or os.environ.get('CONFLUENCE_SESSION_LOGS_PARENT_ID', PARENT_PAGE_ID)

def _render_session_log_html(
    session_id: str,
    agent_name: str,
    summary: str,
    key_decisions: list[str],
    files_changed: list[str],
    follow_up_items: list[str],
    pr_links: list[str] | None = None,
    duration_minutes: int | None = None,
    branch: str = "",
    kan_issue: str = "",
    rcp_issue: str = "",
    atlassian_alignment: str = "",
    jira_updates: list[str] | None = None,
    kan_updates: list[str] | None = None,
) -> str:
    """Render an agent session log as Confluence storage-format HTML."""
    from datetime import datetime, timezone

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    duration_str = f"{duration_minutes} min" if duration_minutes else "—"

    # Escape all caller-provided values before embedding them in Confluence
    # storage-format HTML to prevent injection / broken rendering.
    agent_name = html.escape(agent_name)
    summary = html.escape(summary)
    session_id = html.escape(session_id)

    decisions_html = "".join(f"<li>{html.escape(d)}</li>" for d in key_decisions) if key_decisions else "<li>None</li>"
    files_html = "".join(f"<li><code>{html.escape(f)}</code></li>" for f in files_changed) if files_changed else "<li>None</li>"
    followups_html = "".join(f"<li>{html.escape(item)}</li>" for item in follow_up_items) if follow_up_items else "<li>None</li>"
    links_html = "".join(f"<li><a href=\"{html.escape(link, quote=True)}\">{html.escape(link)}</a></li>" for link in (pr_links or []))
    jira_updates_html = "".join(f"<li>{html.escape(item)}</li>" for item in (jira_updates or [])) or "<li>No Jira/RCP delivery updates recorded.</li>"
    kan_updates_html = "".join(f"<li>{html.escape(item)}</li>" for item in (kan_updates or [])) or "<li>No KAN execution updates recorded.</li>"
    branch = html.escape(branch or "—")
    kan_issue = html.escape(kan_issue or "—")
    rcp_issue = html.escape(rcp_issue or "—")
    alignment = html.escape(atlassian_alignment or "Not assessed")

    return f"""
<ac:structured-macro ac:name="info"><ac:rich-text-body>
<p><strong>Agent Session Log</strong> — {agent_name} | {timestamp}</p>
</ac:rich-text-body></ac:structured-macro>

<table>
<tr><th>Session ID</th><td>{session_id}</td></tr>
<tr><th>Agent</th><td>{agent_name}</td></tr>
<tr><th>Timestamp</th><td>{timestamp}</td></tr>
<tr><th>Duration</th><td>{duration_str}</td></tr>
<tr><th>Branch</th><td>{branch}</td></tr>
<tr><th>KAN issue</th><td>{kan_issue}</td></tr>
<tr><th>RCP issue</th><td>{rcp_issue}</td></tr>
</table>

<h2>Atlassian Alignment</h2>
<p>{alignment}</p>

<h2>Summary</h2>
<p>{summary}</p>

<h2>Key Decisions</h2>
<ul>{decisions_html}</ul>

<h2>Files Changed</h2>
<ul>{files_html}</ul>

<h2>KAN Execution Updates</h2>
<ul>{kan_updates_html}</ul>

<h2>RCP / Delivery Updates</h2>
<ul>{jira_updates_html}</ul>

<h2>Follow-up TODOs</h2>
<ul>{followups_html}</ul>

{"<h2>Related PRs / Issues</h2><ul>" + links_html + "</ul>" if links_html else ""}
"""


@mcp.tool()
def log_agent_session(
    summary: str,
    agent_name: str = "Unknown Agent",
    session_id: str = "",
    key_decisions: list[str] | None = None,
    files_changed: list[str] | None = None,
    follow_up_items: list[str] | None = None,
    pr_links: list[str] | None = None,
    duration_minutes: int | None = None,
    branch: str = "",
    kan_issue: str = "",
    rcp_issue: str = "",
    atlassian_alignment: str = "",
    jira_updates: list[str] | None = None,
    kan_updates: list[str] | None = None,
) -> str:
    """Log an agent session to Confluence as a structured page.

    Creates a new page under the Session Logs parent with a standardized
    template including summary, decisions, files changed, and follow-ups.
    Call this at the end of a session to persist context before clearing.
    """
    if not HEADERS:
        return "Error: Atlassian credentials missing. Cannot log session."

    from datetime import datetime, timezone

    if not session_id:
        session_id = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    title = f"Session Log: {agent_name} — {session_id}"

    html_content = _render_session_log_html(
        session_id=session_id,
        agent_name=agent_name,
        summary=summary,
        key_decisions=key_decisions or [],
        files_changed=files_changed or [],
        follow_up_items=follow_up_items or [],
        pr_links=pr_links,
        duration_minutes=duration_minutes,
        branch=branch,
        kan_issue=kan_issue,
        rcp_issue=rcp_issue,
        atlassian_alignment=atlassian_alignment,
        jira_updates=jira_updates,
        kan_updates=kan_updates,
    )

    payload = {
        "spaceId": SPACE_ID,
        "status": "current",
        "title": title,
        "parentId": SESSION_LOGS_PARENT_ID,
        "body": {
            "representation": "storage",
            "value": html_content,
        },
    }

    url = f"https://{URL_BASE}/wiki/api/v2/pages"
    try:
        response = requests.post(url, headers=HEADERS, json=payload, timeout=TIMEOUT)
        if response.status_code in [200, 201]:
            created_page = response.json()
            page_id = created_page.get("id", "")
            webui_path = (created_page.get("_links") or {}).get("webui")
            if webui_path:
                page_url = f"https://{URL_BASE}/wiki{webui_path}" if webui_path.startswith("/spaces") else f"https://{URL_BASE}{webui_path}"
            else:
                page_url = f"https://{URL_BASE}/wiki/pages/viewpage.action?pageId={page_id}"
            # The Agent Session Logs index requires every entry to carry this
            # label for CQL filtering. Labels aren't supported on the v2 page
            # create payload, so apply via the v1 API; best-effort only.
            label_note = ""
            try:
                label_resp = requests.post(
                    f"https://{URL_BASE}/wiki/rest/api/content/{page_id}/label",
                    headers=HEADERS,
                    json=[{"prefix": "global", "name": "agent-session-log"}],
                    timeout=TIMEOUT,
                )
                if label_resp.status_code not in [200, 201]:
                    label_note = f"\nWarning: agent-session-log label not applied: {label_resp.status_code} {label_resp.text[:200]}"
            except Exception as e:
                label_note = f"\nWarning: agent-session-log label not applied: {e}"
            return f"Session logged successfully: {title}\nConfluence URL: {page_url}{label_note}"
        else:
            return f"Failed to log session: {response.status_code} {response.text}"
    except Exception as e:
        return f"Error logging session: {e}"


def start_watcher(workspace_dir: str):
    """Start the Confluence file watcher, but ONLY if this process wins the lock.

    Every agent session spawns its own pm_daemon as an MCP stdio child. Each one
    used to start its own Observer, so N sessions meant N watchers racing to PUT
    the same Confluence pages on every save (13 were seen concurrently). The
    watcher is now a singleton elected by an exclusive flock; losers still serve
    their MCP tools, they just don't watch.

    Returns (observer, lock_handle). Either may be None. The lock handle must be
    kept referenced for as long as the watcher runs — closing it frees the lock.
    """
    if watcher_disabled():
        logger.info(f"File watcher disabled via {DISABLE_ENV}; serving MCP tools only.")
        return None, None

    lock = acquire_watcher_lock(workspace_dir)
    if lock is None:
        holder = read_lock_holder(workspace_dir)
        logger.info(
            "File watcher already owned by another pm_daemon"
            + (f" (pid {holder})" if holder else "")
            + "; serving MCP tools only. This is expected with concurrent sessions."
        )
        return None, None

    logger.info(f"Acquired watcher lock. Starting file watcher on workspace: {workspace_dir}")
    event_handler = PMFileEventHandler(workspace_dir)
    observer = Observer()
    observer.schedule(event_handler, workspace_dir, recursive=True)
    observer.start()
    return observer, lock


if __name__ == "__main__":
    import time
    workspace_dir = os.getcwd()
    observer, watcher_lock = start_watcher(workspace_dir)
    watch_only = "--watch-only" in sys.argv
    try:
        if watch_only:
            if observer is None:
                # --watch-only with no watcher would be a process that does nothing
                # at all. Fail loudly rather than idle and look healthy.
                logger.error(
                    "Cannot run --watch-only: another pm_daemon owns the watcher lock "
                    f"(or {DISABLE_ENV} is set). Stop the other daemon, or drop --watch-only."
                )
                raise SystemExit(1)
            logger.info("Running in --watch-only mode (no MCP transport). Press Ctrl+C to stop.")
            while True:
                time.sleep(60)
        else:
            mcp.run()
    except KeyboardInterrupt:
        pass
    finally:
        if observer is not None:
            observer.stop()
            observer.join()
        # Release explicitly so the next daemon can take over immediately rather
        # than waiting on interpreter teardown to close the fd.
        release_watcher_lock(watcher_lock)
