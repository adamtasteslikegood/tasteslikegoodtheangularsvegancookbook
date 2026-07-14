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

#### The watcher is a singleton (one per machine, not one per session)

Every agent session — each Claude Code window, each Copilot CLI, each background
job, each git worktree — spawns its **own** `pm_daemon.py` as an MCP stdio child.
That is correct for the MCP *tools*: each session needs its own server on its own
pipes. Expect to see several `pm_daemon.py` processes and don't be alarmed.

It was very wrong for the *watcher*. Each daemon also started a `watchdog`
Observer, so N sessions meant N observers all watching the same `specs/*.md` and
all racing to PUT the same Confluence pages on every save. **13 concurrent
daemons were observed in the wild**, i.e. 13 writers fighting over one page.

The watcher is now elected by an exclusive `flock` (`scripts/pm/_watcher_lock.py`):

- The first daemon to grab `.claude/pm-daemon-watcher.lock` runs the Observer.
- Every other daemon logs `File watcher already owned by another pm_daemon (pid N);
  serving MCP tools only` and comes up **fully functional minus the watcher**. MCP
  tools are never degraded by losing the election.
- The lock lives in the **main checkout**, resolved via `git rev-parse
  --git-common-dir`. Worktrees share one Confluence space, so they must share one
  lock — a per-worktree lock would elect one watcher per worktree and reintroduce
  the exact race.
- **No stale-lock recovery path exists, by design.** The kernel releases an `flock`
  when the holder dies, however it dies (SIGKILL, crash, power loss). A PID file
  would have needed liveness checks and would have deadlocked the watcher on a
  dead session's leftover file.
- `--watch-only` **exits 1** if it cannot take the lock, rather than idling and
  looking healthy while watching nothing.

Set `PM_DAEMON_DISABLE_WATCHER=1` to force a daemon to skip the watcher entirely
and serve MCP tools only.

If saves aren't syncing to Confluence, check who holds the lock:

```bash
cat .claude/pm-daemon-watcher.lock   # the watching daemon's pid
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
- Session metadata (ID, agent, timestamp, duration, branch)
- Summary of work completed
- Key decisions and trade-offs
- Files changed
- KAN execution refs/updates so active branch work is visible on the board
- RCP delivery refs/updates when sprint, epic, release, acceptance, or scope changes
- Follow-up TODOs
- Links to related PRs/issues

**Template:** See `scripts/pm/templates/session_log.md`

**Confluence location:** Pages are created under the Session Logs parent page (configured via `ATLASSIAN_CONFLUENCE_SESSION_LOG_PARENT_PAGE_ID` env var, or its alias `CONFLUENCE_SESSION_LOGS_PARENT_ID`; defaults to the Project Documentation parent). Point it at the "Agent Session Logs" index page (`34635777` in the TLG space) — the separate "AI Session Logs" page is reserved for conversational Rovo sessions.

**Label:** Both `log_agent_session` and `publish_session_log.py` automatically apply the `agent-session-log` label to each page, per the Agent Session Logs index conventions. Filter with CQL: `type = page AND label = "agent-session-log"`.

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

Standalone utility for Atlassian API operations. Dependency-free (uses only the Python stdlib — `urllib`, no `requests`). The `brief`, `reflect`, and `sync` commands write `.agent-work/pm/JIRA_KAN_WORK_REFLECTION.md`, which compares local git state (branch, changed tracked files, recent issue keys) with fetched Jira state and names the KAN/RCP update needed before handoff. Use `npm run pm:reflect` when you only need the local work-to-board alignment check.

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `ATLASSIAN_EMAIL` | Atlassian account email |
| `ATLASSIAN_API_TOKEN` | Atlassian API token |
| `ATLASSIAN_URL` | Atlassian instance (default: `tasteslikegood.atlassian.net` — the only allowed value, see allowlist below) |

### Site and project allowlist

`scripts/pm/_atlassian_guard.py` enforces a defense-in-depth allowlist across all
PM scripts (added after tooling once pointed at the wrong site and misfiled work
items):

- **Site:** `tasteslikegood.atlassian.net` is the ONLY Atlassian site for work
  items. Any other host — including the `tasteslikegood-dev.atlassian.net`
  service-site shell, whose former `TO` project is frozen as `TOSVC`
  ("SERVICE-HOLD — do not use") — raises `AtlassianGuardError` at config load.
- **Jira projects:** writes are limited to `KAN` and `RCP`. Read-only
  rollups/briefings (the `resolve_jira_projects()` consumers) may also include
  the plaza-game `PLZG`/`TO`. Any other key — including the frozen `TOSVC` —
  is refused with an error naming the allowlist.
  Tests: `python3 -m unittest discover -s scripts/pm -p 'test_*.py'`.

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ATLASSIAN_CONFLUENCE_SPACE_ID` | `11042818` | Target Confluence space |
| `ATLASSIAN_CONFLUENCE_PARENT_PAGE_ID` | `11796481` | Parent page for synced docs |
| `ATLASSIAN_CONFLUENCE_SESSION_LOG_PARENT_PAGE_ID` | Same as parent | Parent page for session logs (alias: `CONFLUENCE_SESSION_LOGS_PARENT_ID`; the prefixed name wins if both are set) |
| `ATLASSIAN_JIRA_PROJECT_KEY` | `KAN` | Execution Jira project for active work |
| `ATLASSIAN_JIRA_DELIVERY_PROJECT_KEY` | `RCP` | Delivery Jira project for epics/sprints/scope |
| `JIRA_PROJECTS` | `KAN,RCP` | Optional explicit CSV of Jira projects to include in PM briefings (read-only: `KAN,RCP,PLZG,TO` allowed; anything else refused by the allowlist) |

## Session logging

There are two paths, and they cover different things. Use both.

### `/sync-and-clear` (alias: `/wrap`) — the deliberate path

An agent skill (`.claude/skills/sync-and-clear/SKILL.md`; `/wrap` is a thin alias) that:

1. Summarizes the current session **from context** (not from a script — the agent already has the session in front of it)
2. Logs it to Confluence via `log_agent_session`
3. Syncs any modified planning docs
4. Verifies the page was created and reports the URL

Run this at the end of a session **instead of typing `/clear`**, then clear.

**Why it must be user-invoked:** `/clear` gives the model no turn. Context is dropped
instantly — no hook fires, no instruction can run. There is no way to make a summary
write itself "just before `/clear`". The only reliable capture is a step you invoke
first. That's this skill.

### `PreCompact` hook — the safety net

`.claude/hooks/precompact-session-log.sh`, registered on the `PreCompact` event in
`.claude/settings.json`. Fires before `/compact` **and before auto-compact** — i.e. the
other way context gets destroyed, which usually happens mid-task with no warning.

It:

1. Condenses the session transcript with `scripts/pm/transcript_digest.py` (drops tool
   results, keeps human asks + assistant prose + files touched + commands run — roughly
   a 30x reduction; a 292 KB transcript becomes a 9 KB digest)
2. Hands the digest to a **Haiku** subagent (`claude -p`) to write the summary — this is
   compression, not reasoning, so the cheap model is the right one
3. Publishes it via `scripts/pm/run_pm_script.sh publish_session_log.py`

Properties worth knowing:

- **It never blocks compaction.** Every failure path exits 0, and the slow work is
  detached to the background. A broken session log must not wedge a session.
- **It is best-effort, not a guarantee.** Failures land in `.claude/session-log-hook.log`,
  not in your face. If you need a log you can rely on, run `/wrap`.
- **It does not fire on `/clear`.** Nothing can. See above.
- **Worktree-aware.** This repo runs most sessions in `.claude/worktrees/*`, where
  `CLAUDE_PROJECT_DIR` is the worktree — which has no `.env` and no `scripts/pm/.venv`.
  The hook resolves the main checkout via `git rev-parse --git-common-dir` and reads
  credentials and the venv from there, while still recording the worktree's actual branch.
- **Recursion-guarded.** The summarizer subagent inherits this repo's hooks; the
  `CLAUDE_PM_SESSION_LOG_ACTIVE` env var stops it re-triggering itself.

## Dependencies

```bash
pip install watchdog mcp markdown requests python-dotenv
# Or use the venv:
cd scripts/pm && pip install -r requirements.txt
```
