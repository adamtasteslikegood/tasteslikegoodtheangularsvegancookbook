# Sprint agent harnesses

## Sprint 10 (current)

The executable half of [`specs/SPRINT_10_PLAN.md`](../SPRINT_10_PLAN.md): one task per
SI (S1–S16), plus T0 (board honesty) and T17 (close-out).

| File                                                                                         | Role                                                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`SPRINT_10_HARNESS_PLAN.json`](./SPRINT_10_HARNESS_PLAN.json)                               | The plan — 18 tasks, each with its lane, its checks, and its skill              |
| [`../../scripts/harness/sprint10_hard_gate.py`](../../scripts/harness/sprint10_hard_gate.py) | **The gate.** `--charter` is the day-1 form; the bare command is the close gate |
| [`../../scripts/harness/sprint10_driver.py`](../../scripts/harness/sprint10_driver.py)       | **The PM driver.** Starts one task per controller state, in charter order       |

### How the run is driven

The pinned `loop_controller.py` runs one plan strictly in list order, drops lane and
gate metadata at `init`, and keeps one global iteration counter. A single 18-task state
could not run the lanes in parallel or enforce charter D6 (3 attempts per task, 12
iterations per goal, WIP ≤ 3). So the plan is the **source of task definitions** and
`sprint10_driver.py` decides what may start:

- **Goal = one SI.** `start T<n>` writes a one-task plan and initializes its own state
  under `.agent-harness/sprint10/` (gitignored), capped at 12 iterations and 3 attempts.
  A happy-path task costs 3 iterations and a failed attempt at most 3, so 3 attempts fit.
  Reading "goal" as one SI is a choice, named here so Adam can overrule it.
- **Order.** Each task's `depends_on` must be verified before it starts.
- **WIP ≤ 3.** A fourth open task is refused; an escalated task keeps its slot until a
  human resolves it.
  The charter's day-1 schedule names four items (S1, S2, S5, S10). **Adam, 2026-09-29:
  WIP stays 3 as written.** After T0, start T1, T2 and T5; T10 waits for the first free
  slot. A refused `start T10` on day 1 is the rule working, not a defect.
- **Irreversible starts.** T11 (the launch post) also carries `requires_done`:
  `start T11` refuses unless RCP-98, RCP-101, RCP-103 and RCP-104…RCP-108 are exactly
  `Done`. In Review is not enough, because the post cannot be taken back.

Each refusal was observed on 2026-09-29 against scratch states: T3 (T1 not verified),
a fourth open task (WIP 3), and T11 against live Jira (all eight gate rows To Do).
After `start`, the controller runs untouched:

```bash
python3 .claude/skills/harness-qa-loop/plan_qa.py --plan specs/harness/SPRINT_10_HARNESS_PLAN.json --strict
python3 scripts/harness/sprint10_driver.py status          # WIP, and what may start now
python3 scripts/harness/sprint10_driver.py start T0        # refused unless deps/WIP/Done allow
HC=~/.claude/plugins/cache/claude-code-skills/agent-harness/1.0.0/skills/agent-harness/scripts/loop_controller.py
S=.agent-harness/sprint10/T0.state.json
python3 $HC next   --state $S                              # → directive
python3 $HC record --state $S --task T0 --phase execute --exit-code 0
python3 $HC verify --state $S --task T0 --cwd "$PWD"
python3 $HC close  --state $S
```

The driver reads the controller path from `HARNESS_CONTROLLER` (default: the `HC` path
above), so a different plugin cache needs only that variable.

### Kickoff — only after both PRs merge (Adam, 2026-09-29)

The loop does **not** start from the chartering session. It starts only after the charter PR
(#3539: plan + `sprint10_hard_gate.py`) and this harness PR have both merged to `dev`,
and then in a **fresh session and a clean worktree** based on a freshly synced `dev` in
**both** repos:

```bash
git fetch origin --prune && git submodule update --init Backend && git -C Backend fetch --prune
scripts/git/ahead-behind.sh --base dev . Backend      # both repos level with origin/dev
git worktree add .claude/worktrees/sprint10-loop -b chore/sprint10-loop-KAN-269 origin/dev
cd .claude/worktrees/sprint10-loop
git submodule update --init Backend                  # Backend at the pinned SHA; never re-pin here
# Backend work (T1, T7, T9): branch inside Backend/ from its origin/dev, e.g.
#   git -C Backend switch -c fix/kan-268-<topic> origin/dev
# and leave the cookbook gitlink alone until the release step pins Backend main.
python3 scripts/harness/sprint10_hard_gate.py --charter   # board still honest: exit 0
python3 scripts/harness/sprint10_driver.py status          # then start T0, per "How the run is driven"
```

What changed from Sprint 9, and why:

- **Repo scope (Sprint 9 retro action g).** Sprint 9's T9 looked for a Backend-only
  ticket's PR in this repo, so its artifact check could not pass. Every artifact check
  for Backend work now passes `-R adamtasteslikegood/tasteslikegood.com`: T1 (KAN-268),
  T2 (KAN-292), T5 (KAN-294), T8 (KAN-297), and the Backend-template halves of T7
  and T9. The plan records the rule under
  `repo_scope`.
- **Content checks for the process items.** S13, S14 and S16 are verified against
  `origin/dev:CLAUDE.md`, and S15 against a `scripts/git/*preflight*` file on
  `origin/dev`. Each check was confirmed failing on 2026-09-29, so none can pass
  before the work lands.
- **No sprint-board script.** Sprint 10 was created, filled and started at charter, so
  T0 re-proves the board with `--charter` and the lane gate instead of a
  `sprint9_board.py` equivalent.

---

# Sprint 9 agent harness (closed 2026-09-05)

The executable half of [`specs/SPRINT_9_PLAN.md`](../SPRINT_9_PLAN.md). The charter
says what Sprint 9 commits to; this drives it and refuses to call it finished on
anything but evidence.

| File                                                                                       | Role                                                                      |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| [`SPRINT_9_HARNESS_PLAN.json`](./SPRINT_9_HARNESS_PLAN.json)                               | The plan — one task per SI, each with its lane, its checks, and its skill |
| [`../../scripts/harness/sprint9_hard_gate.py`](../../scripts/harness/sprint9_hard_gate.py) | **The gate.** Read-only. Do not edit to make a run pass                   |
| [`../../scripts/harness/sprint9_board.py`](../../scripts/harness/sprint9_board.py)         | Board operations — sprint, membership, truth reset, evidenced transitions |
| [`../../scripts/harness/_jira_client.py`](../../scripts/harness/_jira_client.py)           | Stdlib Jira REST + **Agile** client (the MCP tools do not wrap Agile)     |

Run state lives in `.agent-harness/sprint9-state.json`, which is gitignored —
the plan is per-goal and committed, the state is per-run and disposable.

## Driving it

```bash
HC=~/.claude/plugins/cache/claude-code-skills/agent-harness/1.0.0/skills/agent-harness/scripts/loop_controller.py

python3 $HC init   --plan specs/harness/SPRINT_9_HARNESS_PLAN.json --state .agent-harness/sprint9-state.json
python3 $HC next   --state .agent-harness/sprint9-state.json          # → directive
# ...do the task with its skill...
python3 $HC record --state .agent-harness/sprint9-state.json --task T1 --phase execute --exit-code 0
python3 $HC verify --state .agent-harness/sprint9-state.json --task T1 --cwd "$PWD"
python3 $HC close  --state .agent-harness/sprint9-state.json          # refused while anything is unverified
```

`verify` runs each check itself in a subprocess. You do not get to declare a task
verified; recording a passing verify without `--evidence` is rejected outright.

## The hard gate

```bash
python3 scripts/harness/sprint9_hard_gate.py          # full sprint
python3 scripts/harness/sprint9_hard_gate.py --issues KAN-151
```

**No committed Sprint 9 item may sit in To Do.** Done, In Progress and In Review
all pass, matching the sprint's definition of done: delivered, in review, or
consciously dropped.

It also refuses to pass vacuously. A missing sprint fails; a sprint that no
longer contains a required item fails. Only S5/S7/S8 (`KAN-209`, `RCP-67`,
`KAN-176`) may be removed — that is D6's pre-authorised drop, and removal from
the sprint is the board-visible act of dropping.

> **This paragraph was false on one axis until 2026-09-01 (KAN-260), and the gate
> was green the whole time it was false.** Rules 2 and 3 read
> `/rest/agile/1.0/sprint/{id}/issue`, which returns sprint MEMBERSHIP and ignores
> the board filter. Board 168 filters `project = RCP`, so the ten KAN keys in
> sprint 52 were members no column could render. The gate reported "12 items, none
> in To Do" for four days while the board displayed **one row**. That is precisely
> a vacuous pass, on the axis this paragraph names.
>
> **Rule 4** now asserts board visibility: every committed SI has an RCP
> `S<N> acceptance:` Story present in the BOARD-SCOPED result
> (`/rest/agile/1.0/board/168/sprint/{id}/issue`). It is deliberately **not** a
> member-vs-rendered delta — that rule would be red on Sprint 8, the one sprint
> that got this right (13 members, 6 rendered), because KAN execution rows are
> _supposed_ to be members and structurally cannot render.
>
> `scripts/pm/check_sprint_lane.sh` had the matching hole and was fixed in the same
> commit: it passed over an empty set because **zero** rows carried `sprint-9`, so
> label discovery fell back to `sprint-8`, whose rows are all Done. It now keys off
> board 168's ACTIVE sprint and fails when nothing carries that sprint's label.

Observed failing at baseline on 2026-08-27 with 11 violations, which is the bar
Sprint 8 retro action 4 sets: a check nobody has watched fail is not a gate.

**Status alone is weak evidence.** A Jira global rule still moves a ticket
`To Do → In Progress` when a branch is created for it, so an item can leave To Do
with no work behind it. That is why every task pairs the gate with an artifact
check and a named-evidence requirement. The gate proves the board is honest, not
that the sprint is done.

## Task map

| Task   | SI  | Jira                | Lane | Skill                                      |
| ------ | --- | ------------------- | ---- | ------------------------------------------ |
| T0     | —   | RCP-88              | PM   | `pm-skills`                                |
| **T1** | S2  | KAN-151 · ANCHOR    | A    | `/plan-eng-review`                         |
| T2     | S5  | KAN-209 · droppable | D    | `/plan-eng-review`                         |
| T3     | S7  | RCP-67 · droppable  | D    | `/plan-eng-review`                         |
| T4     | S8  | KAN-176 · droppable | D    | `/plan-eng-review`                         |
| T5     | S3  | KAN-249 / KAN-250   | C    | `/plan-devex-review`                       |
| T6     | S4  | KAN-258             | A    | `/plan-devex-review`                       |
| T7     | S1a | KAN-255 / KAN-256   | B    | `/plan-eng-review` + `/plan-design-review` |
| T8     | S1b | KAN-257             | B    | `/plan-eng-review` + `/plan-design-review` |
| T9     | S6  | KAN-195             | B    | `/plan-eng-review`                         |
| T10    | —   | RCP-88              | PM   | `pm-skills`                                |

T1 runs alone first (charter execution order: Lane A on day 1). T2–T4 are the
IP/middleware rate-limiting cluster. Lanes B, C and D open once T1's Backend
promotion PR exists. Each task's objective carries its lane's **must-not-touch**
paths — R3, after Sprint 8 produced three duplicate fixes from parallel sessions.

## Board notes

Sprint 9 is **id 52** on board **168** (`RCP Scrum Board` — Sprint 8's
`originBoardId`; sprints belong to their origin board, so a different board makes
a different sprint). KAN and RCP rows coexist in it, as they did in Sprint 8.

Two `Automation for Jira` sweeps corrupted the board on 2026-08-27 — `11:28:16Z`
moved a batch `To Do → In Progress`, `16:58:34Z` moved everything `→ Done`,
including three bugs filed that morning and never worked. `reset-truth` repairs
this by restoring **the last status a human set**, per issue, from its own
changelog; repairing only the newer sweep would have left rows at a fabricated
"In Progress" that satisfies a no-To-Do gate with no work behind it. The offending
global rules were disabled on 2026-08-27; the surviving one moves
`To Do → In Progress` on branch creation.

`sprint9_board.py transition` requires `--evidence` and posts it as a comment
_before_ moving the row, so D4's "no acceptance row moves without its named
evidence linked" holds by construction rather than by discipline.

### Automation that wears a human's name

`.github/workflows/jira-auto-transition.yml` (KAN-97/RCP-39) moves KAN rows to
Done when a PR whose **title** carries their key merges into `dev` or `main`. It
authenticates with `secrets.ATLASSIAN_API_TOKEN` — Adam's personal token — so
Jira attributes every one of its transitions to **"Adam Schoen"**, and it posts
no comment. There is no Jira-side fingerprint distinguishing it from a person.

It closed KAN-249 and KAN-258 seconds after their PRs merged on 2026-08-28, and
both read as deliberate human decisions until the workflow runs were checked.

`reset-truth` therefore does not rely on the author name alone: it also asks
GitHub when PRs carrying each key were merged, and treats a move to **Done**
landing within `MERGE_CORRELATION_WINDOW_S` (120s) of such a merge as automated.
That is the workflow's exact signature — it only ever moves to Done, and only on
a merge — so a human who merges and then closes the row hours later is untouched.
`--github-correlate` enables this heuristic explicitly. Without that flag, `reset-truth` preserves human-attributed transitions and uses author matching only.

Two standing consequences worth knowing:

- **This workflow does what retro action 8 forbids.** "No row moves on a merge
  alone" (D4) and an automation that closes rows on merge alone are in direct
  tension. The workflow was added in Sprint 6 to fix six consecutively-missed
  board updates, so both rules exist for good reasons; the conflict is real and
  unresolved.
- **It assumes one PR per ticket.** A ticket spanning several PRs closes on the
  first one. KAN-258 covers the model tail _and_ the v0.4.13 release cut, so
  merging #3439 closed it with the release half untouched.

### KAN-248 is not the S4 ticket

The charter's S4 cites `KAN-248`, and PRs #3439 and Backend #298 carry it in
their titles. `KAN-248` is really _"Migrate staging DB from Railway Postgres to
CloudSQL"_, a subtask of KAN-244, and it genuinely completed on 2026-08-24.
The model-selection tail and the v0.4.13 cut are tracked as **`KAN-258`**, filed
2026-08-27. The harness uses KAN-258; the two PR titles still need re-keying.
