---
name: run-pm-daemon
description: Run and drive the PM daemon (scripts/pm) — the FastMCP stdio server that syncs specs/ planning docs to Confluence and exposes PM tools. Use when asked to run, start, test, or drive the pm-daemon, call its MCP tools (get_project_status, sync_pm_documents, refresh_project_briefing), run a PM script (fetch_atlassian, atlassian_pm_link, update_jira), or check Atlassian connectivity.
---

The PM daemon (`scripts/pm/pm_daemon.py`) is a **stdio MCP server** (FastMCP)
plus a watchdog file-watcher that pushes seven `specs/*.md` planning docs to
Confluence on save. There is no GUI. Drive it programmatically via
`.claude/skills/run-pm-daemon/driver.py` — a stdlib-only MCP client that
spawns the daemon, handshakes, and calls tools. All paths below are written
relative to the repo root, but every entry point (`driver.py`, the
`run_*.sh` launchers, `daemon_control.sh`) locates the repo root itself and
cds there before running, so they can be invoked from anywhere — `.env`
resolution and output files always land at the repo root.

## Prerequisites

- `python3` **3.10+** with venv support (Debian/Ubuntu package
  `python3.12-venv`). The daemon's venv is created with the system `python3`,
  and `pm_daemon.py` uses PEP 604 unions evaluated at import time — an older
  system Python fails at daemon startup, not at install time.
- Repo-root `.env` with `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`,
  `ATLASSIAN_URL` (see CLAUDE.md). Without them the daemon still starts and
  `list`/`status` work; anything touching Atlassian returns a credentials error.

## Setup / Build

None. First launch auto-creates `scripts/pm/.venv` and pip-installs
`scripts/pm/requirements.txt` (about a minute; output goes to stderr because
stdout is the MCP channel). Nothing else to build.

## Run (agent path) — the driver

```bash
python3 .claude/skills/run-pm-daemon/driver.py list      # handshake + list the 5 MCP tools
python3 .claude/skills/run-pm-daemon/driver.py status    # get_project_status (read-only)
python3 .claude/skills/run-pm-daemon/driver.py call refresh_project_briefing --args '{}'
```

| command | what it does |
|---|---|
| `list` | initialize + tools/list; prints the 5 tool names/descriptions |
| `status` | calls `get_project_status`; prints the PM briefing (falls back to `specs/*.md` heads when `.agent-work/pm/PROJECT_PM_BRIEFING.md` is absent) |
| `call <tool> --args '{json}'` | calls any tool; `--timeout N` for slow ones |

The 5 tools: `get_project_status` (read-only), `sync_pm_documents`
(**writes Confluence**), `refresh_project_briefing` (reads live Jira/Confluence,
writes local briefing; `{"publish": true}` **writes Confluence**),
`create_epic_from_roadmap` (**writes Jira**), `log_agent_session`
(**writes Confluence**). Don't call the writers casually.

First run: use `--timeout 600` so the venv bootstrap doesn't trip the
response timeout.

## Run: background watcher (--watch-only)

File-watcher only, no MCP transport. State lands in `.agent-work/pm/`
(gitignored): `pm-daemon.pid`, `pm-daemon.log`.

```bash
bash scripts/pm/daemon_control.sh start    # nohup'd watch-only daemon
bash scripts/pm/daemon_control.sh status
tail -3 .agent-work/pm/pm-daemon.log       # "Running in --watch-only mode..."
bash scripts/pm/daemon_control.sh stop
```

While ANY daemon instance runs (watch-only or MCP), saving one of the seven
watched files (`specs/plan.md`, `roadmap.md`, `planning_notes.md`,
`design-plan.md`, `SCRUM_BOOTSTRAP_AND_BOARD_PLAN.md`, `SPRINT_0_PLAN.md`,
`ATLASSIAN_PM_LINK.md`) pushes it to Confluence immediately — real writes.

## Run: CLI scripts

`run_pm_script.sh` runs any `scripts/pm/*.py` inside the shared venv:

```bash
bash scripts/pm/run_pm_script.sh atlassian_pm_link.py check   # read-only connectivity smoke
# → "Connection check passed", exit 0
bash scripts/pm/run_pm_script.sh fetch_atlassian.py           # dumps jira_data.json + confluence_spaces.json into cwd
```

`atlassian_pm_link.py` modes: `check` (read-only), `brief` (writes local
briefing), `reflect` (local git-to-Jira reflection), `sync` (**writes
Confluence**).

## Run (human path)

`bash scripts/pm/run_pm_daemon.sh` from the repo root starts the MCP server
on stdin/stdout — useless interactively (it waits for JSON-RPC). In practice
humans never run it directly: `.mcp.json` auto-spawns it for agent sessions.
Ctrl+C stops it.

## Test

```bash
python3 scripts/pm/test_atlassian_guard.py   # stdlib unittest, no venv needed
```

Live smoke checks: `driver.py list` (exit 0, 5 tools) and
`run_pm_script.sh atlassian_pm_link.py check` (exit 0, "Connection check passed").

## Gotchas

- **stdout is the MCP wire.** Any print to stdout inside the daemon corrupts
  the protocol — that's why `run_pm_daemon.sh` routes pip output to stderr.
  Debug via stderr or `.agent-work/pm/pm-daemon.log`, never stdout.
- **cwd is normalized, not free.** The daemon resolves `.env`, `specs/`, and
  `.agent-work/` from cwd — the launchers make that safe by cd'ing to the
  repo root first, but if you exec `pm_daemon.py` by hand, do it from the
  repo root. (In a git worktree under `.claude/worktrees/`, the worktree root
  is "the repo root"; pm_daemon.py's `.env` walk-up still finds the main
  checkout's `.env`.)
- **`.env` loading varies by script.** `pm_daemon.py`,
  `sync_jira_confluence_status.py`, `atlassian_pm_link.py`, and
  `update_jira.py` load the repo-root `.env` themselves.
  `fetch_atlassian.py` reads only `os.environ` — export the `ATLASSIAN_*`
  vars first if your shell doesn't already have them.
- **Atlassian targets are allowlisted** (`_atlassian_guard.py`): only the
  `tasteslikegood.atlassian.net` site, with writes restricted to Jira
  projects KAN/RCP. Pointing `.env` at another site or project raises
  `AtlassianGuardError` by design — fix the config, don't bypass the guard.
- **`fetch_atlassian.py` litters cwd** with `jira_data.json` and
  `confluence_spaces.json` (both untracked). Delete after use.
- **Starting the daemon starts the watcher instantly** — don't edit watched
  specs files while experimenting unless you mean to publish them.
- **A pm-daemon may already be running.** `.mcp.json` auto-spawns one per
  agent session. A second instance is harmless for `list`/`status`, but two
  watchers = duplicate Confluence syncs on save.

## Troubleshooting

- **`error: no response to id=1 within 120s` on first run**: venv bootstrap
  (pip install) hadn't finished. Re-run with `--timeout 600`, or pre-warm:
  `bash scripts/pm/run_pm_script.sh atlassian_pm_link.py check`. The retry is
  safe — the launchers re-run pip until an install completes once
  (`scripts/pm/.venv/.deps-installed` stamp).
- **`Failed to create the PM scripts virtualenv`**: missing venv module —
  install your distro's python3-venv package.
- **`WARNING: Atlassian credentials missing from .env`** in stderr/log:
  daemon found no usable `.env` above cwd. `list`/`status` still work;
  Atlassian tools return errors until `.env` is fixed.
- **`Jira fetch failed: HTTP Error 401`** from `fetch_atlassian.py`:
  `ATLASSIAN_*` not exported in your shell (see Gotchas) — export `.env`
  first.
