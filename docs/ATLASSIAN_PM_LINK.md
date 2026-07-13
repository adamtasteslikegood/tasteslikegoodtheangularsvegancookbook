# Atlassian PM Link

This repo has a lightweight PM/session bridge for Jira and Confluence. It is designed to give each agent session a current project briefing before work starts, then publish the same state back to Confluence when needed.

## Source Of Truth

- Atlassian site: `tasteslikegood.atlassian.net` (the ONLY site for work items)
- Jira execution project: `KAN`
- Jira delivery project: `RCP`
- Confluence space: `TLG`
- Local briefing output: `.agent-work/pm/PROJECT_PM_BRIEFING.md`
- Local JSON cache: `.agent-work/pm/atlassian-state.json`

`scripts/pm/_atlassian_guard.py` enforces this: any other site (including the
`tasteslikegood-dev.atlassian.net` service shell) is refused at config load.
Jira writes are restricted to `KAN`/`RCP`; read-only rollups/briefings may also include `PLZG`/`TO` when explicitly configured (via `JIRA_PROJECTS`).

## Required Environment

Put real credentials in `.env` only. Do not commit `.env`.

```sh
ATLASSIAN_URL=tasteslikegood.atlassian.net
# ATLASSIAN_EMAIL=your-atlassian-email@example.com
# ATLASSIAN_API_TOKEN=your-atlassian-api-token
ATLASSIAN_JIRA_PROJECT_KEY=KAN
ATLASSIAN_JIRA_DELIVERY_PROJECT_KEY=RCP
# Optional explicit project list for brief/status fetches:
# JIRA_PROJECTS=KAN,RCP
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

Fetches Jira issues and Confluence planning/session pages, then writes the local briefing, cache, and `.agent-work/pm/JIRA_KAN_WORK_REFLECTION.md`. The reflection file compares local git state to Jira refs so KAN can show the work actually happening on branches/worktrees. It also refreshes `jira_issues.txt` for older workflows when requested.

```sh
npm run pm:reflect
```

Standalone alternative that regenerates only the work reflection file without refreshing the full briefing or cache. `pm:brief` and `pm:sync` already write this file, so use `pm:reflect` when you want the reflection-only view without paying the cost of a full briefing.

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

- Jira status counts and issue type counts across KAN/RCP.
- Current local branch/file-change reflection and whether a KAN execution link is missing.
- Active work, blockers, high-priority backlog, recent updates, and open load by assignee.
- Recent Confluence planning/session context from pages matching planning, status, roadmap, project, next steps, or previous session terms.
- Local PM artifact summaries from `planning_notes.md`, `plan.md`, `roadmap.md`, and `design-plan.md`.

## Implementation

The implementation lives in `scripts/pm/atlassian_pm_link.py`. It uses only Python standard-library modules so it can run before Python project dependencies are installed.
