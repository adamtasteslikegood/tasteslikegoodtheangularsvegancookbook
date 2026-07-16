# templates.md — doc-set skeleton for ci-refresh-devex

Copy these skeletons into `docs/ci/refresh/` (or the repo's convention) and fill
from the Stage-1 audit. A worked, filled example is this very folder's parent —
`docs/ci/refresh/` in the cookbook repo. Keep all diagrams as Mermaid in Markdown
code blocks; do not export SVG.

## File set

| File | Contains |
|---|---|
| `README.md` | Index/table linking every file; one-paragraph TL;DR |
| `PLAN.md` | TL;DR, objective, phase table, documents table, **stop-gate**, sibling-repo comparison |
| `SPEC-01-ci-quality-gates.md` | Problem statement, **measured baseline table**, goals/non-goals, current-vs-target, design (consolidation, new gates, branch protection §4.3 with exact context names), acceptance criteria, risks, **Open decisions (Q/A)** |
| `SPEC-02-ai-and-deploy-workflows.md` | Inventory+classification of advisory/agentic/deploy workflows; the "never in required checks" rules; acceptance |
| `TODO.md` | Phase 0..N; **every item has a `— verify:` command**; one PR per group |
| `PROMPT.md` | Agent-harness goal: operating constraints, global verify suite + baseline, **task table (# / task / verify / retries)**, loop protocol, close condition |
| `diagram-current-state.md` | Mermaid: today's gaps |
| `diagram-target-pipeline.md` | Mermaid: the target gate(s) + protection |
| `diagram-workflow-map.md` | Mermaid + table: every workflow → blocking/advisory/event/retire |
| `diagram-harness-loop.md` | Mermaid: the bounded task→verify→PR→merge→escalate loop |

## PROMPT.md task-row contract

Each row must be independently machine-verifiable:

```
| # | Task | Verify (exit 0 / condition) | Retries |
| T4 | Add docker-build job to the gate | job green on PR; red on broken-Dockerfile scratch branch, reverted | 3 |
```

## Non-negotiables to carry into every generated doc set

- Measured baseline (not guessed) in SPEC-01 and PROMPT.md.
- CodeQL required context is `Analyze (<language>)`, never `CodeQL`.
- AI/agentic/deploy workflows enumerated in SPEC-02 as **never required**.
- Branch-protection + deploy-behavior changes are **escalate-first** in TODO/PROMPT.
- Stop-gate before execution; harness (`agent-harness:cs-harness`, domain
  `engineering`) runs only after human approval.
