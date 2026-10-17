# Sprint planning and close-out

Moved out of `CLAUDE.md` (KAN-416) so it loads only when a sprint is being chartered, changed or closed. `CLAUDE.md` keeps the trigger and a pointer here.

## Every sprint item needs an RCP acceptance row, or the board shows nothing

**Applies to: chartering any sprint, and any time work is added to a running one.**

`KAN` is execution, `RCP` is delivery planning — and **board 168 filters
`project = RCP ORDER BY Rank ASC`.** KAN is a separate, team-managed project, so
**a KAN key added to a sprint is a member that no column can ever render.** The
Agile API accepts the add and reports the issue as a sprint member; the board
displays nothing. Both facts are true at once, and that gap is the trap.

So the sprint is tracked by **RCP rows, one per SI**, exactly as Sprint 8 did it:

| Artifact           | Project | Shape                                                     |
| ------------------ | ------- | --------------------------------------------------------- |
| Delivery epic      | `RCP`   | one per sprint (`RCP-80` S8, `RCP-88` S9)                 |
| **Acceptance row** | `RCP`   | **one Story per SI**, `S<N> acceptance: <what> (KAN-###)` |
| Execution ticket   | `KAN`   | the actual work; stays in the sprint too                  |

Each acceptance row: labelled `acceptance` + `sprint-N`, `Relates`-linked to its
KAN execution row(s), added to the sprint, and moved only with its evidence named
on the ticket. **Label the KAN execution rows `sprint-N` as well** — that label is
what `scripts/pm/check_sprint_lane.sh` grades, and it is the current sprint's
label the CI `sprint-lane` job resolves from board 168's active sprint.

**This is not optional polish, and it has silently regressed before.** Sprint 9
opened with epic `RCP-88` and _zero_ acceptance rows; ten bare KAN keys went into
the sprint and the board rendered **one row for four days** while two separate
gates reported green — each passing vacuously on its own documented limit
(KAN-260). Both gates are now tightened, but the convention is the fix and the
gates are only the backstop:

```bash
bash scripts/pm/check_sprint_lane.sh            # active sprint labelled + no orphans
python3 scripts/harness/sprint9_hard_gate.py    # every SI has a board-rendered row
```

Never "fix" a board-visibility failure by removing KAN rows from the sprint. They
belong there; the missing half is the RCP row.

## Planning a sprint? Read the Confluence retro FIRST (not the repo close-out)

**Applies to: chartering or planning any sprint, `/cs:grill-pm`, and any charter or plan document.**

A sprint's retrospective lives in **two** places with **different content**, and the one an agent naturally finds is the incomplete one:

| Artifact          | Where                                                                               | What it has                                                                                |
| ----------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Close-out         | `specs/SPRINT_<N>_PLAN.md` → `## Close-out`                                         | What shipped, what rolled, gate results                                                    |
| **Retrospective** | **Confluence space `TLG`** → "Sprint Close Retrospectives" (parent page `50298881`) | 4Ls, decisions, and an **"Actions for Next Sprint" table that exists nowhere in the repo** |

**Do this before drafting any charter:**

```
searchConfluenceUsingCql: text ~ "retrospective" AND type = page ORDER BY lastmodified DESC
```

Then walk the retro's **actions table row by row** against your proposed scope and state, explicitly, which actions are _not_ committed and why. Treat that table as a **required input, not a summary** of the close-out. Scope remains Adam's call — surface the gap, never self-authorize the addition.

**Closing a sprint is not done until the retro page exists.** As the final close-out step, create it yourself — read the template body from page `50495489`, fill it from the close-out plus the board data, and `POST` it as a child of parent `50298881`. Title format: `Sprint <N> Retrospective — <YYYY-MM-DD>`. The **"Actions for Next Sprint" table is the point** — it exists nowhere in the repo. Do not build a Jira automation for this; the agent already holds the gate evidence.
