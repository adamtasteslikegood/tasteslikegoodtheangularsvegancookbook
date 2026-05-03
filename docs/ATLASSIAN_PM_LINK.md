# Atlassian PM Link

This repo has a lightweight PM/session bridge for Jira and Confluence. It is designed to give each agent session a current project briefing before work starts, then publish the same state back to Confluence when needed.

## Source Of Truth

- Jira project: `KAN`
- Confluence space: `TLG`
- Local briefing output: `.agent-work/pm/PROJECT_PM_BRIEFING.md`
- Local JSON cache: `.agent-work/pm/atlassian-state.json`

## Required Environment

Put real credentials in `.env` only. Do not commit `.env`.

```sh
ATLASSIAN_URL=tasteslikegood.atlassian.net
# ATLASSIAN_EMAIL=your-atlassian-email@example.com
# ATLASSIAN_API_TOKEN=your-atlassian-api-token
ATLASSIAN_JIRA_PROJECT_KEY=KAN
ATLASSIAN_CONFLUENCE_SPACE_KEY=TLG
ATLASSIAN_CONFLUENCE_SPACE_ID=11042818
ATLASSIAN_CONFLUENCE_PARENT_PAGE_ID=11796481
ATLASSIAN_CONFLUENCE_BRIEFING_TITLE=Project PM Briefing - Live State
```

## Commands

```sh
npm run pm:check
```

Verifies Jira and Confluence connectivity without writing files.

```sh
npm run pm:brief
```

Fetches Jira issues and Confluence planning/session pages, then writes the local briefing and cache. It also refreshes `jira_issues.txt` for older workflows.

```sh
npm run pm:sync
```

Runs the same briefing flow, then creates or updates the Confluence page named by `ATLASSIAN_CONFLUENCE_BRIEFING_TITLE`.

## MCP Daemon

`auto_pm_mcp.json` defines a `pm-daemon` MCP server. It runs `scripts/pm/run_pm_daemon.sh`, which creates `alirez-claude-skills/pm-daemon/.venv` on first launch, installs the daemon requirements, and starts the file watcher/MCP tools.

The daemon launcher requires Python `venv` support. On Debian/Ubuntu, install it with `sudo apt install python3.12-venv` if first launch reports that `ensurepip` is unavailable.

The daemon exposes:

- `get_project_status`: refreshes the Jira/Confluence briefing and returns it for session startup.
- `sync_pm_documents`: syncs local PM docs and publishes the live briefing to Confluence.
- `create_epic_from_roadmap`: creates a Jira epic in the configured project, then refreshes PM state.

## Session Startup Workflow

1. Run `npm run pm:brief`.
2. Read `.agent-work/pm/PROJECT_PM_BRIEFING.md`.
3. Treat Jira as task/status authority and Confluence as planning/session authority.
4. After planning or status changes, run `npm run pm:sync` to publish the current state.

## What The Briefing Contains

- Jira status counts and issue type counts.
- Active work, blockers, high-priority backlog, recent updates, and open load by assignee.
- Recent Confluence planning/session context from pages matching planning, status, roadmap, project, next steps, or previous session terms.
- Local PM artifact summaries from `planning_notes.md`, `plan.md`, `roadmap.md`, and `design-plan.md`.

## Implementation

The implementation lives in `scripts/pm/atlassian_pm_link.py`. It uses only Python standard-library modules so it can run before Python project dependencies are installed.
