# Scrum Bootstrap And Board Plan

Generated: 2026-04-27
Scrum Master lens: initialize agile operating system from current Jira + Confluence PM briefing.

## What S.C.R.U.M. Really Stands For Here

Scrum is not historically an acronym; it comes from rugby. For this project, use `S.C.R.U.M.` as the operating mnemonic:

- `S` — Small, shippable slices: every backlog item must be small enough to complete, review, and demo.
- `C` — Cadence: fixed planning, standup, review, and retro loops create accountability.
- `R` — Roles and review: Product Owner chooses outcomes, Scrum Master protects flow, Developers deliver increments, stakeholders review real demos.
- `U` — Unblock daily: blockers are not notes; they are work items with owners and escalation deadlines.
- `M` — Measure and mature: track completion, predictability, scope churn, blocker age, and retro action follow-through.

The practical point: Scrum is not meetings. Scrum is a lightweight control system for turning ambiguous work into inspected increments.

## Current Jira Reality

### `KAN` — Tasteslikegood-dot-Org

- Project type: Jira Software.
- Existing board: `KAN board`, board id `34`.
- Board type: `simple`.
- Columns: `To Do`, `In Progress`, `In Review`, `Done`.
- Sprint support: not supported by this board.
- Current fetched state: 60 issues, 43 open, 17 done, 11 active, 0 detected blockers.

This is a usable Kanban board. It is not a Scrum sprint board.

### `TO` — 10110 Tasteslikegood Plaza

- Project type: business.
- Issue types: `Workstream`, `Task`, `Sub-task`.
- Existing Agile board: none found through Jira Agile API.
- Local repo cloned to: `/root/projects/10110TasteslikegoodPlaza`.
- Source planning docs found under `Docs/files/`.

This is suitable for high-level workstream tracking. It is not currently suitable for Jira Software sprint reporting unless it is moved into a software project or mirrored into `KAN`.

## Recommended Board Topology

### Board 1: `KAN board` — Operations Kanban

Keep the existing board for continuous flow:

| Column | Policy | WIP Limit |
|---|---|---:|
| To Do | Prioritized and ready enough to discuss | none |
| In Progress | Actively being changed now | 2 |
| In Review | PR, test evidence, or stakeholder review pending | 3 |
| Done | Merged, documented, and verified | none |

Use for bugs, security fixes, CI/CD, release chores, and urgent production work.

### Board 2: `TLG Delivery Scrum` — Recommended New Scrum Board

Create a Jira Software Scrum board from a saved filter:

```jql
project = KAN AND labels in (sprint-candidate, delivery) ORDER BY Rank ASC
```

Use this for timeboxed feature work, starting with the v0.2 anti-recipe site and then the Plaza prototype if you want sprint reporting in Jira.

Required fields:

- `Story point estimate` or `Story Points`.
- `Sprint`.
- `Parent` / Epic relationship.
- `Labels`: `delivery`, `sprint-candidate`, `v0.2`, `plaza`, `ops`, as relevant.

### Board 3: `TO Plaza Workstreams` — Recommended Business Kanban

If `TO` remains a business project, use it as a high-level workstream board:

| Workstream | Purpose |
|---|---|
| Plaza Pre-work | Content, naming, story, data export |
| Plaza Phase 1 | Godot prototype |
| Plaza Phase 2 | WebSocket bridge and live output |
| Plaza Phase 3 | Full office expansion |

If you need sprint reports, burnups, velocity, and sprint fields for Plaza, mirror executable work into `KAN` under Epic `KAN-34` or create a new Jira Software project for Plaza.

## Team Roles

| Role | Owner For Now | Responsibility |
|---|---|---|
| Product Owner | Adam Schoen | Ordering work by product value and launch risk |
| Scrum Master | Agent-assisted | Flow, ceremonies, blockers, health metrics, retro actions |
| Developers | Adam + agent workers | Delivering increments and test evidence |
| Stakeholders | Adam / project users | Reviewing demos and accepting outcomes |

## Ceremony Cadence

Assumption: solo-founder / small agent-assisted team. Keep ceremony weight low.

| Ceremony | Cadence | Timebox | Output |
|---|---:|---:|---|
| Backlog refinement | Weekly | 30 min | Top 10 items sized and ordered |
| Sprint planning | Every 2 weeks | 45 min | Sprint goal + committed backlog |
| Daily standup | Daily async | 5 min | Yesterday, today, blocker |
| Sprint review | End of sprint | 30 min | Demo and acceptance notes |
| Retrospective | End of sprint | 30 min | 1-3 improvement actions |

## Definition Of Ready

A work item can enter a sprint only when:

- It has a clear user/business outcome.
- It has acceptance criteria.
- Dependencies are known or explicitly called out.
- It is sized at 1, 2, 3, 5, or 8 points.
- It can be completed within one sprint.
- Test or verification evidence is defined.

## Definition Of Done

A work item is done only when:

- Code or artifact is complete.
- Tests or verification steps were run and documented.
- Docs are updated when behavior or process changes.
- Security/config implications are checked.
- Jira issue is updated with evidence.
- Work is merged or intentionally published.

## Starter Sprint Structure

### Sprint 0 — Agile Operating System

Goal: make work visible, measurable, and ready for sprinting.

Candidate items:

| Source | Item | Outcome | Points |
|---|---|---|---:|
| Process | Create Scrum board/filter strategy | Delivery work can be sprinted separately from ops | 2 |
| Process | Add labels and point estimates to top backlog | Sprint planning becomes possible | 3 |
| Process | Define DoR/DoD and WIP limits | Shared quality bar | 2 |
| KAN | Triage 43 open issues | Close stale, rank live work, identify blockers | 5 |
| KAN | Split Plaza from web work where needed | No mixed product backlog | 3 |

Recommended commitment: 10-15 points until actual velocity exists.

### Sprint 1 — v0.2 Anti-Recipe Delivery

Goal: complete the public SSR distribution slice enough to demo `/r/<slug>` and `/browse` end-to-end.

Candidate items:

| Jira | Item | Notes | Points |
|---|---|---|---:|
| KAN-56 | v0.2 SSR Routes & Express Proxy Config | Already in progress; finish and verify route ordering | 5 |
| KAN-59 | v0.2 Jinja Templates & Design System | Needed for visible demo quality | 5 |
| KAN-55 | v0.2 SEO, JSON-LD & Distribution | Needed for distribution value | 5 |
| KAN-54 | v0.2 Vanilla JS Interactions | Include only if template scope is stable | 3 |

Recommended commitment: 10-13 points for first real sprint.

### Sprint 2 — Publish UI And Release Hardening

Goal: make publishing controllable from Angular and reduce release risk.

Candidate items:

| Jira | Item | Notes | Points |
|---|---|---|---:|
| KAN-58 | v0.2 Angular Editor Publish UI | Publish toggle and slug edit flow | 5 |
| KAN-17 | Valkey stale client bug | Reliability fix | 3 |
| KAN-25 | Express-layer request validation | Security/release hardening | 5 |
| KAN-20 | Publish official numbered release | Release ceremony output | 3 |

Recommended commitment: 10-13 points.

## Plaza Sprint Roadmap

Use `KAN-34` as the Jira epic for executable sprint work unless `TO` is converted to or mirrored by a Jira Software project.

| Sprint | Goal | Candidate Jira Items | Output |
|---|---|---|---|
| Plaza Sprint 0 | Pre-work and content definition | KAN-39, KAN-40, KAN-41, KAN-42 | Named assistant, startup backstory, `agents.json`, art direction |
| Plaza Sprint 1 | Walkable grey-box prototype | KAN-43, KAN-44 | Godot project, FPS controller, lobby/server/office layout |
| Plaza Sprint 2 | First agent-as-NPC interaction | KAN-45, KAN-46 | Agent registry, Systems Architect NPC, dialogue panel |
| Plaza Sprint 3 | Assistant and unlock loop | KAN-47, KAN-48 | Chat overlay, gate system, building map |
| Plaza Sprint 4 | Local I/O bridge | KAN-49 | Python WebSocket bridge and Godot client |
| Plaza Sprint 5 | Prototype complete | KAN-50, KAN-51 | First live agent output in-world, Phase 3 planning |

## Metrics To Start Tracking Now

Do not run velocity forecasting yet. There are zero real sprints in the current data.

Start collecting:

- Planned points per sprint.
- Completed points per sprint.
- Added/removed scope after sprint start.
- Blocker opened/resolved dates.
- Standup participation.
- Review acceptance notes.
- Retro action item owner and due date.

Velocity analysis needs at least 3 completed sprints. Six sprints is the first statistically useful baseline.

## Immediate Actions

1. Keep `KAN board` as operational Kanban.
2. Create or request a new Jira Software Scrum board named `TLG Delivery Scrum` using the filter above.
3. Decide whether Plaza execution lives under `KAN-34` or whether `TO` should become a software project.
4. Add points and labels to Sprint 0 candidate items.
5. Run the first Sprint 0 planning session and commit no more than 10-15 points.
