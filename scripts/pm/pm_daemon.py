import os
import sys
import html
import logging
import base64
import subprocess
import requests
import markdown
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from mcp.server.fastmcp import FastMCP
from dotenv import load_dotenv

# Make sibling modules importable whether this file is run as a script or imported.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _atlassian_guard import AtlassianGuardError, validate_atlassian_site, validate_jira_project_key

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
        
        title = f"v0.2 {filepath.name.replace('.md', '').replace('_', ' ').title()}"
        if filepath.name == "roadmap.md":
            title = "v0.2 Project Roadmap"
        elif filepath.name == "plan.md":
            title = "v0.2 Execution Plan"
        elif filepath.name == "planning_notes.md":
            title = "v0.2 Planning Session Review & Notes"
        elif filepath.name == "design-plan.md":
            title = "v0.2 Design Implementation Plan"
        elif filepath.name == "SCRUM_BOOTSTRAP_AND_BOARD_PLAN.md":
            title = "v0.2 Scrum Bootstrap & Board Plan"
        elif filepath.name == "SPRINT_0_PLAN.md":
            title = "v0.2 Sprint 0 Plan"
        elif filepath.name == "ATLASSIAN_PM_LINK.md":
            title = "v0.2 Atlassian PM Link"

        try:
            content = filepath.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            logger.error(f"Failed to read {filepath}: {e}")
            return False

        logger.info(f"Syncing content of {filepath.name} to Confluence: {title}")
        
        html_content = markdown.markdown(content, extensions=['fenced_code', 'tables'])
        
        # 1. Search for existing page
        search_url = f"https://{URL_BASE}/wiki/api/v2/spaces/{SPACE_ID}/pages?title={requests.utils.quote(title)}"
        page_id = None
        version = 1
        
        try:
            resp = requests.get(search_url, headers=HEADERS, timeout=TIMEOUT)
            if resp.status_code == 200:
                results = resp.json().get('results', [])
                if results:
                    page_id = results[0]['id']
                    # Get current version. If we can't read it, abort instead of
                    # POSTing with a stale version=1 — an update against an
                    # existing page would be rejected by Confluence (or risk
                    # clobbering it).
                    page_resp = requests.get(f"https://{URL_BASE}/wiki/api/v2/pages/{page_id}", headers=HEADERS, timeout=TIMEOUT)
                    if page_resp.status_code == 200:
                        version = page_resp.json().get('version', {}).get('number', 0) + 1
                    else:
                        logger.error(
                            f"Could not read current version of existing page {page_id} "
                            f"(HTTP {page_resp.status_code}); aborting sync of '{title}'"
                        )
                        return False
        except Exception as e:
            # Don't swallow and continue with version=1; abort this file's sync.
            logger.error(f"Error checking page existence for '{title}': {e}")
            return False

        payload = {
            "spaceId": SPACE_ID,
            "status": "current",
            "title": title,
            "parentId": PARENT_PAGE_ID,
            "body": {
                "representation": "storage",
                "value": html_content
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
            response = req_func(url, headers=HEADERS, json=payload, timeout=TIMEOUT)
            if response.status_code in [200, 201]:
                logger.info(f"Successfully synced: {title}")
                return True
            else:
                logger.error(f"Failed to sync {title}: {response.status_code} {response.text}")
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
    logger.info(f"Starting file watcher on workspace: {workspace_dir}")
    event_handler = PMFileEventHandler(workspace_dir)
    observer = Observer()
    observer.schedule(event_handler, workspace_dir, recursive=True)
    observer.start()
    return observer

if __name__ == "__main__":
    import time
    workspace_dir = os.getcwd()
    observer = start_watcher(workspace_dir)
    watch_only = "--watch-only" in sys.argv
    try:
        if watch_only:
            logger.info("Running in --watch-only mode (no MCP transport). Press Ctrl+C to stop.")
            while True:
                time.sleep(60)
        else:
            mcp.run()
    except KeyboardInterrupt:
        pass
    finally:
        observer.stop()
        observer.join()
