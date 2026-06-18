---
name: atlassian-session-log
description: Generate non-destructive Confluence-ready session logs and KAN/RCP alignment assessments for this repo's Atlassian workflow. Use when compacting context, handing off between agents, publishing durable session context, or checking whether Jira and Confluence match the actual branch/PR work.
---

# Atlassian Session Log

Adapted for pi from the intent of these Claude-oriented PM skills:
- `atlassian-templates`
- `atlassian-admin`
- `jira-expert`
- `confluence-expert`
- `senior-pm`

This pi adaptation narrows the scope to one job:

> turn volatile session context into durable, non-destructive Atlassian context that survives branch switches, agent changes, and compaction.

## Use this skill when

- context is getting tight and you need a durable handoff
- work is moving faster than Jira / Confluence updates
- a new branch or PR has changed the state of execution
- you want a session log page in Confluence that future agents can trust

## Workflow

1. Refresh PM state first (`pm:brief`, `pm:status`, or daemon data).
2. Summarize the actual session, not just the final code diff.
3. Assess alignment using `references/AOTA_MODEL.md`.
4. Emit a session log using `references/SESSION_LOG_SCHEMA.md`.
5. If follow-up work is needed, emit TODOs using `references/TODO_SCHEMA.md`.
6. Prefer non-destructive publication patterns.

## Core rule

Do not confuse these systems:

- **KAN** answers: what is actively being worked on right now?
- **RCP** answers: what does this mean for delivery scope and release planning?
- **Confluence** answers: what durable narrative and context should survive this session?

## References

- `references/AOTA_MODEL.md`
- `references/SESSION_LOG_SCHEMA.md`
- `references/TODO_SCHEMA.md`
