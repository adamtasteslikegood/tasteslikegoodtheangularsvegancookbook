# TODO Schema

> **Provenance.** Ported verbatim from
> `.pi/skills/atlassian-session-log/references/TODO_SCHEMA.md`, which remains in
> place as the pi agent's copy. Unlike the AOTA rubric, this schema is NOT
> inlined into the auto-capture hooks — splitting follow-ups into KAN / RCP /
> Confluence buckets needs judgement about delivery scope that a Haiku
> transcript-compression pass should not be making. Use it in the deliberate
> path: when `sync-and-clear` runs and the session left real follow-up work.

Use this structure when converting a session log into follow-up work.

```md
# Session Follow-up TODOs — {timestamp}

## Session Refs
- Branch:
- Root PR:
- Backend PR:
- KAN issue:
- RCP issue:
- Session log page:

## KAN Execution TODOs
- **What:**
  - **Why:**
  - **Owner / actor:**
  - **Branch / PR refs:**
  - **Status to set:**
  - **Done when:**

## RCP Delivery TODOs
- **What:**
  - **Why:**
  - **Sprint / epic impact:**
  - **Branch / PR refs:**
  - **Acceptance / done criteria:**
  - **Done when:**

## Confluence TODOs
- **What page / log / doc should change:**
  - **Why:**
  - **Source session / branch:**
  - **Non-destructive update pattern:**
  - **Done when:**

## Optional Drift Fixes
- **Mismatch:**
  - **Correction to make:**
  - **Why it matters for the next actor:**
```

## Rules
- KAN items should describe active execution work.
- RCP items should describe delivery-plan work.
- Confluence items should preserve durable context.
- Include refs so a fresh agent can jump directly to the right board, PR, or page.
- Every TODO should be explicit enough for a fresh agent to pick up.
