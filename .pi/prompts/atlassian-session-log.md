---
description: Generate a Confluence-ready session log with KAN/RCP/Confluence alignment assessment
argument-hint: "[focus]"
---
Generate a Confluence-ready session log for this repo.

Use the schema in `.pi/skills/atlassian-session-log/references/SESSION_LOG_SCHEMA.md`.
Use the operating model in `.pi/skills/atlassian-session-log/references/AOTA_MODEL.md`.

Focus override: $@

Requirements:
- Treat **KAN** as execution truth
- Treat **RCP** as delivery truth
- Treat **Confluence** as durable planning/session truth
- Keep the output non-destructive and handoff-friendly
- Explicitly assess whether Atlassian is aligned, partially aligned, or drifting from the work done in this session
- Include concrete branch / PR / Jira / Confluence refs when available
- Include PM sync health (`pm:start`, `pm:sync`, `pm:status`, daemon state) when known
- Never include raw secrets, tokens, or `.env` values
- Include concrete next actions for the next agent or teammate
