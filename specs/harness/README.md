# Sprint agent harnesses

## Sprint 11 (current)

The executable half of [`specs/SPRINT_11_PLAN.md`](../SPRINT_11_PLAN.md): one task per
SI (T1 to T27 are S1 to S27), plus T0 (board honesty and the charter row) and T28
(close-out). The rows kept for Sprint 12 (KAN-277, KAN-299, KAN-352) have no task.

| File                                                                                         | Role                                                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`SPRINT_11_HARNESS_PLAN.json`](./SPRINT_11_HARNESS_PLAN.json)                               | The plan: 29 tasks, each with its lane, its checks, and its skill               |
| [`../../scripts/harness/sprint11_hard_gate.py`](../../scripts/harness/sprint11_hard_gate.py) | **The gate.** `--charter` is the day-1 form; the bare command is the close gate |
| [`../../scripts/harness/sprint11_driver.py`](../../scripts/harness/sprint11_driver.py)       | **The PM driver.** The Sprint 10 driver, run on this plan and its own state dir |

The driver's rules are Sprint 10's and are described under
[How the run is driven](#how-the-run-is-driven): one controller state per SI, WIP ≤ 3,
12 iterations and 3 attempts per SI. State lives in `.agent-harness/sprint11/` in the
main checkout. What is specific to Sprint 11:

- **The order of work is the charter's ordered list.** The driver enforces only part of
  it: T0 first, T28 last, the four waits below, and T26's exact-Done rule. WIP 3 and the ordered
  list decide the rest. There is no day-1 priority ruling for Sprint 11; Adam can add one.
- **The crawl lane starts in order, without waiting for a release.** T2 is refused until
  T1 has started, and T3 until T2 has (`after_started`). They are not chained with
  `depends_on`, because the three share one session and one batched Backend release, and
  `depends_on` would force a release per SI. The cost is that the lane can hold all three
  WIP slots at once. That is a choice, named here so Adam can overrule it.
- **T15 waits until T16 has started, and T27 until T25 has.** In both, the real condition
  is something the driver cannot read: Adam's fill-or-decline on the seven rich-result
  warnings (on RCP-140) sets S15's scope, and S27's build PR needs both reviews linked on
  RCP-148. Those are human checks, stated in each task's objective. `after_started` only
  keeps the later task from opening first.
- **What Adam does first is not gated by the driver.** S22's profile edits, the staging
  checks for S8 and S10, and the two conditions above live in objectives and manual
  evidence. The driver reads task state and Jira status only. An enforced human start
  gate would be a new rule, and is Adam's to add.
- **The readiness walk needs exact Done.** `start T26` is refused until T4, T5 and T6 are
  verified and RCP-128, RCP-129 and RCP-130 are exactly `Done`.
- **A dated item holds no WIP slot** (charter D6). A task that has not started holds no
  slot, so work that waits on Adam first (S22's profile edits, the staging checks for S8
  and S10) is simply not started. T12, T20 and T25 wait on a dated count after their work
  is recorded; they declare `soak_window_hours` and are soaked. T25 also declares its
  absolute 2026-10-23 deadline, so a late soak cannot move the sprint-box date.
- **S6 carries no detail.** Both repos are public and KAN-335 is not fixed. Its task says
  the detail is on the ticket, and a test keeps it that way.

Observed on 2026-10-09 against a scratch state dir and live Jira: `start T0 --dry-run`
allowed; `start T2` refused (T0 not verified, T1 not started); `start T26` refused (its
dependencies, and RCP-128, RCP-129 and RCP-130 in To Do). T0's own board check fails
today because RCP-123 is in To Do, which is the state T0 exists to change.

```bash
HC="${HARNESS_CONTROLLER:-$HOME/.claude/plugins/cache/claude-code-skills/agent-harness/1.0.0/skills/agent-harness/scripts/loop_controller.py}"
export HARNESS_CONTROLLER="$HC"
python3 .claude/skills/harness-qa-loop/plan_qa.py --plan specs/harness/SPRINT_11_HARNESS_PLAN.json --strict
python3 scripts/harness/sprint11_driver.py status          # WIP, and what may start now
python3 scripts/harness/sprint11_driver.py start T0        # refused unless deps/WIP/Done allow
S="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.agent-harness/sprint11/T0.state.json"
python3 $HC next   --state $S                              # → directive
python3 $HC record --state $S --task T0 --phase execute --exit-code 0
python3 $HC verify --state $S --task T0 --cwd "$PWD"
python3 $HC close  --state $S
```

The board-automation notes under Sprint 10 still hold: a merge moves no row to Done, and
creating a branch moves a row out of To Do with no work behind it.

## Sprint 10 (closed)

The executable half of [`specs/SPRINT_10_PLAN.md`](../SPRINT_10_PLAN.md): one task per
SI (S1–S20; S17–S20 added mid-sprint are tasks T18–T21), plus T0 (board honesty) and T17
(close-out). **T10, T11 and T19 (S10, S11, S18) were carried to epic RCP-119 on
2026-10-01 and must not be started.** Each carries `carried_to` in the tracked plan:
`start` refuses it on any checkout, it holds no WIP slot, it satisfies T17's
dependencies, and `status` prints `carried to RCP-119`. The sequencing notes below
that name T10 and T11 are the charter-day record, not instructions.

| File                                                                                         | Role                                                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`SPRINT_10_HARNESS_PLAN.json`](./SPRINT_10_HARNESS_PLAN.json)                               | The plan — 22 tasks, each with its lane, its checks, and its skill              |
| [`../../scripts/harness/sprint10_hard_gate.py`](../../scripts/harness/sprint10_hard_gate.py) | **The gate.** `--charter` is the day-1 form; the bare command is the close gate |
| [`../../scripts/harness/sprint10_driver.py`](../../scripts/harness/sprint10_driver.py)       | **The PM driver.** Starts one task per controller state, in charter order       |

### How the run is driven

The pinned `loop_controller.py` runs one plan strictly in list order, drops lane and
gate metadata at `init`, and keeps one global iteration counter. A single 22-task state
could not run the lanes in parallel or enforce charter D6 (3 attempts per task, 12
iterations per goal, WIP ≤ 3). So the plan is the **source of task definitions** and
`sprint10_driver.py` decides what may start:

- **Goal = one SI.** `start T<n>` writes a one-task plan and initializes its own state
  under `.agent-harness/sprint10/` (gitignored), capped at 12 iterations and 3 attempts.
  A happy-path task costs 3 iterations and a failed attempt at most 3, so 3 attempts fit.
  Reading "goal" as one SI is a choice, named here so Adam can overrule it.
- **Order.** Each task's `depends_on` must be verified before it starts.
  The graph enforces Lane D's T15 → T14 → T13 → T16 order (Lane C's T10 → T11 order
  was carried to RCP-119 with both tasks).
- **WIP ≤ 3.** A fourth open task is refused; an escalated task keeps its slot until a
  human resolves it.
  The charter's day-1 schedule names four items (S1, S2, S5, S10). **Adam, 2026-09-29:
  WIP stays 3 as written.** After T0, start T1, T2 and T5; T10 waits for the first free
  slot. WIP alone limits how many tasks are open, not which go first, so T10, T14 and T15
  also carry `after_started: [T1, T2, T5]` and are refused until all three have started.
  A refused `start T10` on day 1 is the rule working, not a defect. Since
  2026-10-01 `start T10` is refused permanently: T10 was carried to RCP-119.
- **Irreversible starts** (T11 is now carried to RCP-119; kept as the record of the
  rule for the next charter). T11 (the launch post) also carries `requires_done`:
  `start T11` refuses unless RCP-98, RCP-101, RCP-103 and RCP-104…RCP-108 are exactly
  `Done`. In Review is not enough, because the post cannot be taken back.

Each refusal was observed on 2026-09-29 against scratch states: T3 (T1 not verified),
a fourth open task (WIP 3), and T11 against live Jira (all eight gate rows To Do).
After `start`, the controller runs untouched:

```bash
HC="${HARNESS_CONTROLLER:-$HOME/.claude/plugins/cache/claude-code-skills/agent-harness/1.0.0/skills/agent-harness/scripts/loop_controller.py}"
export HARNESS_CONTROLLER="$HC"
python3 .claude/skills/harness-qa-loop/plan_qa.py --plan specs/harness/SPRINT_10_HARNESS_PLAN.json --strict
python3 scripts/harness/sprint10_driver.py status          # WIP, and what may start now
python3 scripts/harness/sprint10_driver.py start T0        # refused unless deps/WIP/Done allow
S="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.agent-harness/sprint10/T0.state.json"   # the shared state dir
python3 $HC next   --state $S                              # → directive
python3 $HC record --state $S --task T0 --phase execute --exit-code 0
python3 $HC verify --state $S --task T0 --cwd "$PWD"
python3 $HC close  --state $S
```

The driver reads the controller path from `HARNESS_CONTROLLER` (default: the `HC` path
above), so a different plugin cache needs only that variable.

### Board automation — what moves a row, and what does not (2026-09-29)

- **A merge moves nothing to Done.** `.github/workflows/jira-auto-transition.yml`
  has been `disabled_manually` since 2026-08-28 12:06Z (its last run was 11:28Z that
  day). The Sprint 9 section below describes it as history. A merged PR leaves its KAN
  and RCP rows where they were. Each task moves its own rows by hand, evidence first,
  as the charter requires (KAN-269 stayed In Progress after #3540 merged and was closed
  by hand).
- **Creating a branch still moves `To Do → In Progress`** (a live Jira rule, confirmed by
  Adam 2026-09-29). A row can leave To Do with no work behind it, which is why status
  alone is never evidence and every task pairs the gate with an artifact check.

### Kickoff — only after both PRs merge (Adam, 2026-09-29)

The loop does **not** start from the chartering session. It starts only after the charter PR
(#3539: plan + `sprint10_hard_gate.py`) and this harness PR have both merged to `dev`,
and then in a **fresh session and a clean worktree** based on a freshly synced `dev` in
**both** repos:

```bash
git fetch origin --prune && git submodule update --init Backend && git -C Backend fetch --prune
scripts/git/ahead-behind.sh --base dev . Backend      # both repos level with origin/dev
ROOT=$(git rev-parse --show-toplevel)
STATE_DIR="$ROOT/.agent-harness/sprint10"              # one absolute shared PM state
mkdir -p "$STATE_DIR"
export HARNESS_CONTROLLER="${HARNESS_CONTROLLER:-$HOME/.claude/plugins/cache/claude-code-skills/agent-harness/1.0.0/skills/agent-harness/scripts/loop_controller.py}"

python3 scripts/harness/sprint10_hard_gate.py --charter
python3 scripts/harness/sprint10_driver.py --state-dir "$STATE_DIR" status
python3 scripts/harness/sprint10_driver.py --state-dir "$STATE_DIR" start T0
# Drive and verify T0 before opening the three day-1 implementation tasks.

git worktree add "$ROOT/.claude/worktrees/sprint10-t1" -b fix/kan-268-sprint10 origin/dev
git worktree add "$ROOT/.claude/worktrees/sprint10-t2" -b feat/kan-292-sprint10 origin/dev
git worktree add "$ROOT/.claude/worktrees/sprint10-t5" -b feat/kan-294-sprint10 origin/dev
for WT in sprint10-t1 sprint10-t2 sprint10-t5; do
  git -C "$ROOT/.claude/worktrees/$WT" submodule update --init Backend
done

# Each concurrent task owns its cookbook worktree and its private Backend checkout.
git -C "$ROOT/.claude/worktrees/sprint10-t1/Backend" switch -c fix/kan-268-sprint10 origin/dev
git -C "$ROOT/.claude/worktrees/sprint10-t2/Backend" switch -c feat/kan-292-sprint10 origin/dev
git -C "$ROOT/.claude/worktrees/sprint10-t5/Backend" switch -c feat/kan-294-sprint10 origin/dev

(cd "$ROOT/.claude/worktrees/sprint10-t1" && python3 scripts/harness/sprint10_driver.py --state-dir "$STATE_DIR" start T1)
(cd "$ROOT/.claude/worktrees/sprint10-t2" && python3 scripts/harness/sprint10_driver.py --state-dir "$STATE_DIR" start T2)
(cd "$ROOT/.claude/worktrees/sprint10-t5" && python3 scripts/harness/sprint10_driver.py --state-dir "$STATE_DIR" start T5)
```

Never run two open tasks from the same cookbook worktree, and never switch a Backend
branch underneath another task. Give every later concurrent task its own worktree and
submodule checkout from fresh `origin/dev`, while passing the same absolute
`--state-dir "$STATE_DIR"` to every `status` and `start` command. Leave each
cookbook gitlink unchanged until that task's release step intentionally pins Backend main.

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

> **Disabled since 2026-08-28 12:06Z. Merges no longer close rows.** The workflow
> below was switched off right after it auto-closed KAN-249 and KAN-258. This section
> is kept because `reset-truth --github-correlate` still has to recognise its old
> transitions in Sprint 9 changelogs. For current behaviour, see Sprint 10 → "Board
> automation" above.

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
