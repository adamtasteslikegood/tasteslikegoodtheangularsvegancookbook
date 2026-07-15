# Agent-Harness Loop — CI Refresh execution

GitHub-renderable Mermaid source. Canonical context:
[PROMPT.md](PROMPT.md). This is the bounded loop the `agent-harness` /
`agent-harness:cs-harness` driver runs over the task table in PROMPT.md: every
task has a machine verify, a retry cap, and an escalation path; the loop refuses
to close until every task is verified green or explicitly human-waived.

```mermaid
flowchart TD
    START([Pick next unverified task]) --> SYNC["Sync: fetch --prune,<br/>submodule update, in-flight PR scan"]
    SYNC --> WORK["Branch off origin/dev → implement → local verify"]
    WORK --> V{Local verify<br/>passes?}
    V -->|no, retries left| WORK
    V -->|no, retries exhausted| ESC
    V -->|yes| PR["Open PR → wait CI → address review"]
    PR --> CIV{CI + review<br/>clean?}
    CIV -->|no, retries left| WORK
    CIV -->|no, retries exhausted| ESC["ESCALATE to human:<br/>task id, attempts, failing output,<br/>proposed options"]
    CIV -->|yes| MERGE["Merge (PR into dev)"]
    MERGE --> REG{Global suite<br/>still green?}
    REG -->|regressed| HALT["HALT — fix regression<br/>before any new task"]
    REG -->|green| NEXT{All tasks verified<br/>or waived?}
    NEXT -->|no| START
    NEXT -->|yes| CLOSE([CLOSE: emit final report])
    ESC -->|human waives| NEXT
    ESC -->|human redirects| WORK
    style ESC fill:#b91c1c,color:#fff
    style HALT fill:#b91c1c,color:#fff
    style CLOSE fill:#2d6a4f,color:#fff
```

**Hard escalation points (never improvise):** branch-protection changes
(Phase 4 — always escalate before applying), scoping/altering
`gc-build-deploy.yml` deploy behavior, retries exhausted, or an in-flight PR by
someone else overlapping a task.
