# PLAN — Cookbook CI/CD Refresh (2026-07)

Top-level plan for restoring **enforced** build gates to the cookbook repo,
mirroring the just-completed Backend refresh. Read this first, then the specs.

## TL;DR

The Backend submodule got a full CI/CD refresh; the cookbook (parent) repo never
did. The cookbook's **code is green** (lint/format/type-check/test/build all
pass) — so unlike the Backend there is no rot to fix. The gaps are:

1. **No branch protection at all** (`gh api .../protection` → 404 on `dev` and
   `main`). The `pr-gate.yml` `Gate — all checks passed` job was built to be the
   single required check but was never wired up → every PR, including Dependabot
   auto-merges, can land ungated.
2. **Three workflows run the same lint/test/build** on every PR (`ci.yml`,
   `pr-gate.yml`, `ci-cd.yml`) — ~3× runner minutes, ambiguous authority.
   `ci-cd-backend.yml` is a fourth that only runs on `main` and never on `dev`.
3. **CI never builds the production Docker images** — the exact gap that let the
   v0.3.4 release tag burn on an Express `Dockerfile` bug.

## Objective

One authoritative, **required** PR gate; the Docker image validated in CI; the
redundant workflows retired; AI/agentic/deploy workflows kept advisory.

## Approach (mirrors Backend refresh)

| Phase | What | Gate change? |
|---|---|---|
| 0 | ✅ Decisions resolved 2026-07-15 → [DECISIONS.md](DECISIONS.md) | none |
| 1 | Consolidate → `pr-gate.yml` is the one blocking gate; delete `ci-cd.yml`, `ci-cd-backend.yml`; trim `ci.yml` | informational |
| 2 | Add `docker-build` job (Express image) to the gate | new advisory job |
| 3 | **Branch protection** on `dev`+`main` requiring the gate (+ CodeQL, +opt Dependency Review) — **escalate first** | gates become enforced |
| 4 | Housekeeping: pin Node once; verify `gc-build-deploy.yml` isn't double-deploying | none |
| 5 | SPEC-02 safety confirm (no AI/deploy check is required; advisory fails open) | none |
| 6 | Docs close-out | none |

Order is deliberate: consolidate and add the Docker gate *before* making anything
required, so protection is turned on against a green, non-redundant tree.

## Documents

| File | Purpose |
|---|---|
| [SPEC-01-ci-quality-gates.md](SPEC-01-ci-quality-gates.md) | Main proposal: measured baseline, target pipeline, consolidation, Docker gate, branch protection, open decisions |
| [SPEC-02-ai-and-deploy-workflows.md](SPEC-02-ai-and-deploy-workflows.md) | The advisory/agentic/deploy fleet and the rule that keeps them out of required checks |
| [TODO.md](TODO.md) | Phase-by-phase checklist; every item carries its verify command |
| [PROMPT.md](PROMPT.md) | Agent-harness goal: task table with verifies, retry caps, escalation, close condition |
| [DECISIONS.md](DECISIONS.md) | ADR: the four resolved decisions (D1–D4) + the gc-build-deploy code-review correction |
| [diagram-current-state.md](diagram-current-state.md) | Mermaid — today's ungated, redundant state |
| [diagram-target-pipeline.md](diagram-target-pipeline.md) | Mermaid — one gate + Docker job + protection |
| [diagram-workflow-map.md](diagram-workflow-map.md) | Mermaid + table — every workflow classified blocking/advisory/event |
| [diagram-harness-loop.md](diagram-harness-loop.md) | Mermaid — the bounded execution loop |
| `skill/` | (bonus) reusable "CI refresh devex" skill that generates this doc set for any repo |

## Stop-gate

This doc set is the **plan**, produced up to the stop-gate. Execution (the
workflow edits + branch protection in Phases 1–3) is a **separate, approved**
step — run PROMPT.md through `agent-harness:cs-harness` (domain `engineering`)
only after a human signs off on the remaining escalation point — **branch
protection** (Phase 3). The four design decisions are already resolved
([DECISIONS.md](DECISIONS.md)); `gc-build-deploy.yml` is verified inert (D4).

## Relationship to the Backend refresh

| | Backend `docs/ci/refresh/` | Cookbook (this) |
|---|---|---|
| Core problem | Rotted tree + dead `ci.yml` triggers | Green tree, **unenforced** + redundant gates |
| Baseline | black/flake8/mypy/pytest all ❌ | all ✅ |
| Main fix | Fix the code, re-arm CI, then protect | Consolidate + add Docker gate, then protect |
| Shared trap | CodeQL context is `Analyze (<lang>)`, never `CodeQL` | same |
| Shared rule | AI/Gemini checks never required | AI/Junie/gh-aw/deploy never required |
