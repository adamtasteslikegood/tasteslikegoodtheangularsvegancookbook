# Atlassian PM Link

This document makes the Atlassian workflow official for this repo.

## Purpose

Jira + Confluence are the cross-agent, cross-team, cross-session source of truth that live **outside git** and do not depend on any one agent's local file context.

Use them together like this:

- **Jira KAN** = who is working on what right now
- **Jira RCP** = delivery planning, epics, sprints, and acceptance scope
- **Confluence TLG** = durable planning history, session context, and documentation
- **Local markdown in `specs/`** = working copies that feed Confluence non-destructively

## Official source-of-truth model

### Jira execution board: `KAN`

Use `KAN` for active execution state:

- current branch/workstream ownership
- in-progress implementation tasks
- handoffs between agents or humans
- blocker tracking
- "what is being worked on right now"

If a branch exists and work is active, `KAN` should reflect it.

### Jira delivery board: `RCP`

Use `RCP` for delivery planning state:

- epics
- sprint scope
- release-candidate planning
- acceptance criteria
- roadmap slices that need coordinated delivery

If work affects sprint commitments, release scope, or epic-level progress, `RCP` should reflect it.

### Confluence space: `TLG`

Use Confluence for durable narrative context:

- planning docs
- design docs
- execution plans
- session briefings
- historical decisions
- status snapshots

**Non-destructive rule:** Confluence should accumulate context and updates. Do not use it like a scratchpad that deletes prior planning history.

## Official workflow

### Session startup

Run:

```bash
npm run pm:start
```

This verifies connectivity and generates the local PM briefing.

Read first:

- `.agent-work/pm/PROJECT_PM_BRIEFING.md`
- relevant files in `specs/`

### During the session

1. Update `KAN` when active execution status changes.
2. Update `RCP` when sprint/epic/delivery scope changes.
3. Update the working markdown files in `specs/` when plans or design change.
4. Let the PM daemon sync those docs into Confluence.
5. Use Confluence as the durable narrative record, not git comments or chat history.

### Before handoff or after a significant work-run

Run:

```bash
npm run pm:brief
npm run pm:sync
npm run pm:status
```

That ensures:

- the local PM briefing is fresh
- Confluence has the latest planning/session context
- Jira/PR/prod status is visible to the next actor

## PM daemon / MCP role

The `pm-daemon` MCP server is part of the official workflow.

It exists to:

- expose PM tools to agents over MCP
- keep Confluence synced with planning docs in `specs/`
- refresh the local PM briefing from Jira + Confluence for the current workspace
- provide current session/project context to future agents without relying on chat memory

## Commands

```bash
npm run pm:start             # check connectivity + build local briefing
npm run pm:brief             # rebuild local PM briefing
npm run pm:sync              # rebuild briefing + publish/update Confluence briefing
npm run pm:publish           # alias for pm:sync
npm run pm:status            # live Jira + PR + Confluence + prod snapshot
npm run pm:daemon            # start the PM daemon in background on this VM
npm run pm:daemon:status     # verify the daemon is alive
npm run pm:daemon:logs       # tail daemon logs
npm run pm:daemon:stop       # stop the background daemon
npm run pm:daemon:foreground # foreground debug mode
```

## Required environment

```bash
ATLASSIAN_URL=tasteslikegood.atlassian.net
ATLASSIAN_EMAIL=...
ATLASSIAN_API_TOKEN=...
ATLASSIAN_JIRA_PROJECT_KEY=KAN
ATLASSIAN_JIRA_DELIVERY_PROJECT_KEY=RCP
ATLASSIAN_CONFLUENCE_SPACE_KEY=TLG
ATLASSIAN_CONFLUENCE_SPACE_ID=11042818
ATLASSIAN_CONFLUENCE_PARENT_PAGE_ID=11796481
ATLASSIAN_CONFLUENCE_BRIEFING_TITLE=Project PM Briefing - Live State
```

Optional override:

```bash
JIRA_PROJECTS=KAN,RCP
```

## What "official" means here

For this repo, agents and humans should assume:

1. **Git is the source of truth for code.**
2. **KAN is the source of truth for active execution state.**
3. **RCP is the source of truth for delivery planning state.**
4. **Confluence is the source of truth for durable planning/session context.**
5. **The PM daemon and PM scripts are the supported bridge across those systems.**

If those disagree, update the PM systems intentionally so the next actor can trust them.
