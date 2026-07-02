# Sprint 0 Plan — Agile Operating System

Generated: 2026-04-27
Duration: 1 week recommended

## Sprint Goal

Create the minimum agile operating system needed to run predictable work across Tasteslikegood.org and 10110 Tasteslikegood Plaza.

## Commitment

Target commitment: 10-15 points because there is no historical velocity baseline.

## Sprint Backlog

| ID | Work Item | Acceptance Criteria | Points |
|---|---|---|---:|
| S0-1 | Define board topology | `KAN` ops kanban, `TLG Delivery Scrum`, and `TO` Plaza workstream decision documented | 2 |
| S0-2 | Define working agreements | DoR, DoD, WIP limits, ceremony cadence documented | 2 |
| S0-3 | Label and rank top Jira backlog | Top 15 open items have product area labels and stack-ranked order | 3 |
| S0-4 | Split TLG web and Plaza concerns | Plaza execution path chosen: `KAN-34` mirror or `TO` software migration | 3 |
| S0-5 | Select Sprint 1 backlog | Sprint 1 candidate issues sized and ready | 3 |

## Risks

- `KAN board` does not support sprints, so sprint analytics require a new Scrum board or project.
- `TO` is a business project, so it is better for workstream visibility than software sprint reporting.
- Current backlog mixes website delivery, infrastructure, identity, branding, and Plaza game work.

## Definition Of Done For Sprint 0

- Board strategy is documented.
- Sprint 1 backlog candidates are ready and sized.
- No more than two active product streams are allowed in the same sprint.
- Project PM briefing can be regenerated with `npm run pm:brief`.
- Confluence PM briefing can be updated with `npm run pm:sync`.

## Retro Prompts

- Did the board structure reduce ambiguity?
- Were any items too large to estimate confidently?
- Did we separate operational interrupts from delivery work?
- What one agreement should change before Sprint 1?
