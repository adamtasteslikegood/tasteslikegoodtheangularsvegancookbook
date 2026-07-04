---
description: Convert a session log into KAN/RCP/Confluence follow-up TODOs
argument-hint: "[focus]"
---
Convert the current session log or pasted session summary into actionable follow-up items.

Use the schema in `.pi/skills/atlassian-session-log/references/TODO_SCHEMA.md`.
Use the operating model in `.pi/skills/atlassian-session-log/references/AOTA_MODEL.md`.

Focus override: $@

Requirements:
- Separate execution updates for **KAN** from delivery updates for **RCP**
- Call out Confluence documentation follow-ups separately
- Keep each TODO small, explicit, and branch/PR aware
- Include branch / PR / Jira / session-log refs where available
- Include drift-fix TODOs when Atlassian is stale
- Prefer handoff-ready bullets over abstract recommendations
