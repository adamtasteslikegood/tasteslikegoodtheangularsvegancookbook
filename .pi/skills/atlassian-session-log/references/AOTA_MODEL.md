# AOTA Model

AOTA = Atlassian Outside The Agent.

This repo treats Atlassian as the cross-agent source of truth outside git.

## Board / space roles

- **Git** = code truth
- **KAN** = execution truth
- **RCP** = delivery truth
- **Confluence** = durable planning, documentation, and session-history truth

## Meaning

### KAN
Use KAN for:
- active branch ownership
- who is currently working on what
- in-flight execution state
- blockers and handoffs
- immediate next actions

### RCP
Use RCP for:
- release-candidate planning
- sprint scope
- epics and delivery slices
- acceptance criteria
- scope changes that affect delivery commitments

### Confluence
Use Confluence for:
- durable planning history
- session logs
- documentation
- decision narrative
- handoff context that should outlive local chat and local files

## Alignment rubric

### Aligned
- Active work is visible in KAN
- Delivery impact is visible in RCP
- Durable narrative/context is visible in Confluence
- Session log matches the branch/PR state

### Partially aligned
- One of KAN, RCP, or Confluence is stale or missing key updates
- Work is visible, but not enough for a new agent to resume cleanly

### Drifting
- Code/branch/PR work materially differs from Jira or Confluence
- A future agent would make the wrong assumption from Atlassian alone

## Non-destructive rule

Session logging should be additive.

Prefer:
- new Confluence pages
- append-only logs
- versioned updates
- explicit references to branch, PR, and timestamp

Avoid destructive overwrites of historical narrative.
