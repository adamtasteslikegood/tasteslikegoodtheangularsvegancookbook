---
name: ci-refresh-devex
description: Use when a repository's CI/CD build gates are missing, unenforced, redundant, or drifted — symptoms include "add build gates", "restore CI", "branch protection is 404 / nothing is required", "workflows run the same checks 3x", "the deploy tag burned on something CI never built", or "do the CI refresh the other repo got". Produces a plan + spec + TODO + agent-harness prompt + Mermaid diagrams, gated by human Q/A and a stop-gate, then hands off to agent-harness for verified execution.
---

# CI Refresh Devex Workflow

## Overview

A repeatable devex workflow that turns "our build gates are a mess" into an
**executable, human-approved, verifiable** refresh. It does NOT edit workflows
itself — it produces the planning doc set that a bounded agent loop
(`agent-harness` / `agent-harness:cs-harness`) executes and machine-verifies.

**Core principle:** author the plan against a *measured* baseline, force the
load-bearing decisions through a Q/A gate, compile them into
verify-per-task harness specs, then STOP for human approval before any workflow
or branch-protection change runs.

Output mirrors a proven template (e.g. `Backend/docs/ci/refresh/`): `PLAN.md`,
`SPEC-01`, `SPEC-02`, `TODO.md`, `PROMPT.md`, and `diagram-*.md` (Mermaid in
Markdown code blocks — never SVG exports; source renders on GitHub and stays
diffable).

## When to Use

- A repo lost/never had enforced build gates; a sibling repo just got refreshed.
- `gh api .../branches/<b>/protection` returns 404 (nothing required).
- Multiple workflows run the same lint/test/build on every PR.
- A release/deploy broke on something CI never validated (e.g. a Docker image).
- You want the CI change driven by an auditable, verify-per-task agent loop.

**When NOT to use:** a single one-line workflow tweak (just edit it); authoring a
brand-new app's first pipeline from a template (use
`engineering-advanced-skills:ci-cd-pipeline-builder` directly); non-CI work.

## The Workflow (6 stages)

```
1 AUDIT → 2 Q/A GATE → 3 AUTHOR DOCS → 4 PROMPT-ENGINEER → 5 STOP-GATE → 6 HARNESS
```

### Stage 1 — Audit against a MEASURED baseline

Never plan from guesses. Collect, and cite in the spec:

- Every workflow file: name, `on:` triggers, jobs, and whether it's blocking /
  advisory / event/deploy / agentic. Build a classification table.
- Branch protection reality: `gh api repos/<o>/<r>/branches/<b>/protection --jq
  '.required_status_checks.contexts'` for `dev` and `main` (404 = unprotected).
- Tree health: run the repo's own gates and record pass/fail
  (`npm run lint|format:check|type-check|test:ci|build`, or the stack's
  equivalent — `stack_detector.py` from `ci-cd-pipeline-builder` helps here).
- Coverage gaps: what does prod build/run that CI never exercises? (Docker
  images are the classic miss.)
- Redundancy: which workflows duplicate each other's jobs.

Distinguish **rot** (tree fails — fix code first) from **unenforced/redundant**
(tree green — enforcement + consolidation). The plan's narrative depends on which.

### Stage 2 — Q/A gate (resolve load-bearing decisions)

Surface the choices that change the spec, each with a **recommended** answer, and
get them decided before writing final docs. Typical decisions: consolidate vs
minimal vs full-rebuild; single aggregate required context vs enumerated
per-job contexts; which advisory/deploy workflows to scope; Docker gate scope.
If `AskUserQuestion` is unavailable (background job, don't-ask mode), record the
decisions as an **"Open decisions"** section in the spec with recommendations and
proceed on the recommended path — the human resolves them at the stop-gate.

Consider the domain grill skills for a rigorous interrogation before locking:
`pm-skills:cs-grill-pm` / `product-skills:cs-grill-product` are precedents for
the "refuse to proceed until decisions are locked" pattern.

### Stage 3 — Author the doc set (mirror the template)

Produce, in `docs/ci/refresh/` (or the repo's convention):
`PLAN.md` (TL;DR + phases + stop-gate), `SPEC-01` (baseline, target, design,
acceptance, risks, open decisions), `SPEC-02` (advisory/agentic/deploy fleet +
the "never required" rule), `TODO.md` (phased, verify per item), and
`diagram-*.md` (current-state, target-pipeline, workflow-map, harness-loop).
**Mermaid in Markdown only.** See [templates.md](templates.md) for the skeleton.

### Stage 4 — Prompt-engineer the harness spec (`PROMPT.md`)

Compile the plan into a bounded-loop goal: hard operating constraints
(branch/PR rules, "never lower a bar", "AI checks never required", escalation
points), a **global verification suite** with a measured baseline for
regression detection, a **task table** where every row has a machine-checkable
`verify:` and a retry cap, and a close condition. This is the contract the
harness cannot exit without satisfying.

### Stage 5 — STOP-GATE (mandatory human approval)

STOP. Present the doc set. Do **not** run the execution. Branch-protection and
deploy-behavior changes are escalation-only. The human approves the open
decisions and the escalation points before anything mutates CI.

### Stage 6 — Hand off to the harness

Only after approval: run `PROMPT.md` through `agent-harness:cs-harness`.
Recommend the **`engineering`** domain (CI/CD/devex). If a custom skill folder is
wanted, point it at this skill's folder. The harness drives task→verify→PR→merge
with retries and escalation, and refuses to close until every task is verified
green or human-waived.

## Quick Reference

| Stage | Output | Gate |
|---|---|---|
| Audit | Classification table + measured baseline | — |
| Q/A | Locked decisions (or "Open decisions" section) | human/grill |
| Author | PLAN/SPEC-01/SPEC-02/TODO + diagram-*.md | — |
| Prompt-eng | PROMPT.md (task table w/ verifies) | — |
| Stop-gate | Present, await approval | **HUMAN** |
| Harness | agent-harness:cs-harness execution | verify-per-task |

## Common Mistakes

- **Planning from guesses.** No measured baseline = wrong narrative (calling a
  green tree "rotted", or vice-versa). Always run the gates.
- **Requiring the CodeQL *workflow* name.** Matrix contexts are
  `Analyze (<language>)`, never `CodeQL`; requiring `CodeQL` blocks every PR
  forever on a context that never reports.
- **Sweeping an AI/advisory job into required checks.** They fail open and have
  no PR context on schedules — they become permanent merge blockers. Keep a
  dedicated SPEC section listing them as "never required."
- **SVG diagrams.** Use Mermaid in Markdown code blocks — diffable, renders on
  GitHub, no binary churn.
- **Skipping the stop-gate.** Branch protection and deploy changes are
  escalation-only; never let the doc-authoring flow slide straight into mutation.
- **One omnibus PR.** The TODO/PROMPT define one-concern-per-PR boundaries; the
  harness must honor them.

## Testing status (author's note)

This skill was authored from a real refresh but has **not** yet been
subagent-pressure-tested per `superpowers:writing-skills` (Iron Law: no skill
without a failing test first). Before treating it as bulletproof, run the RED
baseline (a repo with messy CI, no skill) and GREEN (with skill) scenarios and
fold any new rationalizations into a Common Mistakes / rationalization update.
