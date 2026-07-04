# Session Log Schema

Use this markdown structure for every generated session log.

```md
# Session Log — {timestamp} — {branch}

## Session Snapshot
- Branch:
- Repo:
- Session file / identifier:
- Trigger:
- Summarizer model:
- Publish target:

## Relevant Refs
- Root PR:
- Backend PR:
- KAN issue:
- RCP issue:
- Prior Confluence refs:

## Summary
Short narrative of what happened in this session.

## Completed Since Last Sync
- item
- item

## Active Work State
- what branch/workstream is active
- what is still in flight
- what is already reviewable / merged / published

## Atlassian Alignment
- Verdict: Aligned | Partially aligned | Drifting
- KAN:
- RCP:
- Confluence:
- PM daemon / sync status:

## Atlassian Sync Status
- `pm:start`:
- `pm:brief`:
- `pm:sync`:
- `pm:status`:
- daemon status:
- Confluence session-log publish status:

## Risks / Drift
- possible mismatch
- missing update
- stale assumption

## Sensitive Data / Redactions
- secrets intentionally omitted
- .env / raw tokens intentionally omitted
- anything else excluded from the durable page

## Artifacts Created
- PRs
- Jira updates
- docs / scripts / extensions / skills
- other durable outputs

## Recommended Updates
### Jira KAN
- execution-side updates to make

### Jira RCP
- delivery-side updates to make

### Confluence
- durable context pages or docs to update

## Next Recommended Actions
1. action
2. action
3. action

## Resumption Instructions
What the next agent should read or do first.
```

## Notes
- Keep the log non-destructive and handoff-friendly.
- Mention concrete branch, PR, Jira, and Confluence refs when available.
- State alignment explicitly.
- Include PM sync health, not just code summary.
- Prefer short, operational writing over essay prose.
- Never include raw credentials, tokens, or `.env` values.
