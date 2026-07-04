# PM Tooling

This document describes the project management automation tools in `scripts/pm/`.

## Overview

The PM tooling integrates the local development workflow with Atlassian (Jira + Confluence) to keep planning docs and session logs in sync without manual effort.

## Components

### 1. PM Daemon (`scripts/pm/pm_daemon.py`)

An MCP server + file watcher that runs during agent sessions.

**Auto-start:** Declared in `.mcp.json` — agents that support MCP will spawn it automatically.

**Manual start:**
```bash
scripts/pm/run_pm_daemon.sh
```

#### MCP Tools

| Tool | Description |
|------|-------------|
| `get_project_status` | Returns current planning file contents as a briefing |
| `sync_pm_documents` | Force-sync all `specs/*.md` files to Confluence |
| `create_epic_from_roadmap` | Create a Jira Epic from roadmap planning |
| `log_agent_session` | Log a structured agent session summary to Confluence |

#### File Watcher

The daemon watches `specs/` for changes to these files and auto-syncs them to Confluence:
- `plan.md`, `roadmap.md`, `planning_notes.md`
- `design-plan.md`, `SCRUM_BOOTSTRAP_AND_BOARD_PLAN.md`
- `SPRINT_0_PLAN.md`, `ATLASSIAN_PM_LINK.md`

### 2. Session Logging (`log_agent_session`)

Creates structured Confluence pages for each agent session with:
- Session metadata (ID, agent, timestamp, duration)
- Summary of work completed
- Key decisions and trade-offs
- Files changed
- Follow-up TODOs
- Links to related PRs/issues

**Template:** See `scripts/pm/templates/session_log.md`

**Confluence location:** Pages are created under the Session Logs parent page (configured via `ATLASSIAN_CONFLUENCE_SESSION_LOG_PARENT_PAGE_ID` env var, defaults to the Project Documentation parent).

### 3. Jira/Confluence Status (`scripts/pm/sync_jira_confluence_status.py`)

Fetches live project status from:
- Jira issues (KAN, RCP projects)
- Open GitHub PRs
- Confluence pages
- Production health check

```bash
cd scripts/pm && python sync_jira_confluence_status.py
```

### 4. Atlassian Link Utility (`scripts/pm/atlassian_pm_link.py`)

Standalone utility for Atlassian API operations. Dependency-free (uses only the Python stdlib — `urllib`, no `requests`).

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `ATLASSIAN_EMAIL` | Atlassian account email |
| `ATLASSIAN_API_TOKEN` | Atlassian API token |
| `ATLASSIAN_URL` | Atlassian instance (default: `tasteslikegood.atlassian.net`) |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ATLASSIAN_CONFLUENCE_SPACE_ID` | `11042818` | Target Confluence space |
| `ATLASSIAN_CONFLUENCE_PARENT_PAGE_ID` | `11796481` | Parent page for synced docs |
| `ATLASSIAN_CONFLUENCE_SESSION_LOG_PARENT_PAGE_ID` | Same as parent | Parent page for session logs |
| `ATLASSIAN_JIRA_PROJECT_KEY` | `KAN` | Default Jira project for epics |

## Skills

### `/sync-and-clear`

An agent skill (`.claude/skills/sync-and-clear.md`) that:
1. Summarizes the current session
2. Logs it to Confluence via `log_agent_session`
3. Syncs any modified planning docs
4. Confirms the log was created with a URL

Use at the end of long sessions to persist context before clearing.

## Dependencies

```bash
pip install watchdog mcp markdown requests python-dotenv
# Or use the venv:
cd scripts/pm && pip install -r requirements.txt
```
