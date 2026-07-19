---
name: harness-qa-loop
description: >-
  Use when driving a goal through this repo's agent-harness (any of the 18
  domains) and you want a QA gate on the compiled plan before spending loop
  budget — after goal_compiler emits plan.json, before loop_controller init.
  Triggers: "run this goal through the harness with a QA/approval gate",
  reviewing a plan.json before init, hardening a run so verifications aren't
  tautological or smoke-only, dogfooding a domain loop, cs-harness plus an
  explicit qa-session and approval step. Not for authoring the harness itself
  (agent-harness) or Workflow .js scripts (workflow-builder).
---

# Harness QA Loop

## Overview

A goal-to-close run over the agent-harness with one thing added: an explicit
**QA session on the compiled plan** between compile and init. Raw `cs-harness`
goes compile → glance at plan → drive. That skips the cheapest place to catch a
bad run — the plan itself, before any budget is spent.

**Core principle:** the plan is a trust boundary and the loop budget is finite.
QA and approve the plan *before* you spend either. A plan with a tautological or
smoke-only check will "verify" a task that never happened; a plan missing a task
will close a goal that isn't done. Both are cheap to catch on paper, expensive to
catch mid-loop.

**REQUIRED SUB-SKILL:** Use `agent-harness` (and its `/cs:harness` entry point)
for the compile and loop mechanics — this skill does not restate them, it inserts
a gate. Read its SKILL.md for exit codes and the state machine.

## When to use

- You have a goal and a domain and want it driven to a *verified* close, not a
  vibes close.
- A `plan.json` exists and you want it reviewed before `loop_controller init`.
- You are dogfooding or hardening a domain harness and want weak verifications
  surfaced mechanically.

**Not when:** authoring a new domain manifest or the harness scripts themselves
(`agent-harness`), or writing deterministic `.js` Workflow-tool scripts
(`workflow-builder`).

## Setup (paths)

The harness scripts ship in the `engineering/agent-harness` plugin, not this
repo. Resolve them once, and keep run state in `.agent-harness/` at repo root:

```bash
AH="$(dirname "$(find ~/.claude/plugins -path '*/agent-harness/scripts/goal_compiler.py' 2>/dev/null | head -1)")"
SKILL_DIR="$(dirname "$0")"   # this skill's dir; holds plan_qa.py
mkdir -p .agent-harness
```

## The four phases (gates are blocking — never skip forward)

### 1. Compile → `.agent-harness/plan.json`

Delegate to `agent-harness`. A vague goal is rejected (exit 3) with forcing
questions — relay them one at a time, recommended answer first, recompile. No
skill match (exit 4) — fix the domain or the goal.

```bash
python3 "$AH/goal_compiler.py" --goal "<goal>" \
  --manifest "$AH/../assets/harnesses/<domain>.json" --out .agent-harness/plan.json
```

### 2. QA the plan (the gate this skill adds)

Run the mechanical linter, then answer the human checklist it prints. If
`plan_qa.py` exits 1 — or the checklist finds spurious tasks or checks that don't
test the real outcome — do **not** advance as-is. Fix the plan first: recompile
with a sharper goal or a different domain, **or** author a corrected plan by hand
when the manifest's generic checks can't express the repo-real outcome (e.g. a
specific `pytest` path the auto-compiler can't know). Correcting a plan means
making checks *stronger and truer* — real outcome checks tied to `done_when` —
never weaker; then re-run `plan_qa.py` and let the human approve the corrected
plan at the gate. What you may **not** do is edit a check *after init* to dodge a
failure (see The one rule).

```bash
python3 "$SKILL_DIR/plan_qa.py" --plan .agent-harness/plan.json   # exit 1 = blocked
```

| The linter flags (mechanical) | Only a human decides (checklist) |
|---|---|
| Task with no runnable verification → will escalate | Do the tasks *together* achieve the goal? |
| Tautological check (`true`, `echo …`) → reward-hackable | Does any task touch a no-touch path? |
| Smoke/sample-only check → proves tool runs, not outcome | Is each task's skill the right match? |
| Iteration budget < task count → can't finish | Which steps need secrets/human input (→ waivers)? |

### 3. Approve — the only human gate

Present the QA report **and** the plan (tasks, verifications, caps) to the human
and get an explicit go/no-go. This is the single approval gate in the loop; you
do not self-approve. Steps that need secrets or human input are named here as
pre-work or planned **waivers**, never disguised as machine checks.

### 4. Execute the loop

Init, then repeat `next → execute the task per its skill → record → verify` until
the directive is `close`. Escalate (stop, show evidence, let the human decide) on
exit 2 (attempts exhausted) or exit 5 (iteration cap). Never report an exhausted
budget as success; waivers are the human's call.

```bash
python3 "$AH/loop_controller.py" init  --plan .agent-harness/plan.json --state .agent-harness/state.json
python3 "$AH/loop_controller.py" next  --state .agent-harness/state.json
# … do the task's real work …
python3 "$AH/loop_controller.py" record --state .agent-harness/state.json --task <T> --phase execute --exit-code <n>
python3 "$AH/loop_controller.py" verify --state .agent-harness/state.json --task <T> --cwd "$PWD"
python3 "$AH/loop_controller.py" close --state .agent-harness/state.json   # refused (exit 4) while a task is unverified
```

## Quick reference

| Phase | Command | Gate |
|---|---|---|
| Compile | `goal_compiler.py … --out .agent-harness/plan.json` | exit 3 vague / exit 4 no-match |
| **QA** | `plan_qa.py --plan .agent-harness/plan.json` | **exit 1 → fix plan, don't approve** |
| Approve | present QA report + plan to human | explicit go/no-go |
| Execute | `loop_controller.py` init/next/record/verify/close | exit 2/5 → escalate |

## Common mistakes

- **Approving a REVIEW/BLOCK plan anyway.** A smoke-only check is not proof. Add
  an outcome check tied to `done_when`, or accept it out loud as a known gap.
- **Editing a check to pass QA.** Same reward-hacking failure the harness forbids
  in the loop — it applies to the plan too. Recompile instead.
- **Turning a secrets/human step into a fake check.** If a step needs a
  credential you can't create, it is a waiver with a reason, not a green check.
- **Skipping QA "because the goal is small."** The linter is one command; a bad
  plan wastes the whole loop budget.

## The one rule

Once the loop is initialized, never modify a gate you are judged by — not the
plan's checks, not the manifest — to make a failing task pass. That is
reward-hacking. (*Before* init, correcting an unfaithful plan into *stronger*
checks is the whole point of the QA gate, and the human approves the result.)
Approval is *human*, verification is *the controller's*. You operate the loop;
you do not adjudicate it.
