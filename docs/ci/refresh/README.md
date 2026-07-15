# Cookbook CI/CD Refresh — 2026-07

Proposal to restore **enforced** build gates to the cookbook
(`adamtasteslikegoodtheangularsvegancookbook`) repo, mirroring the Backend
submodule's completed `docs/ci/refresh/`. The cookbook tree is green; the gaps
are enforcement (no branch protection), redundancy (three workflows run the same
checks), and one missing gate (CI never builds the Docker images — the v0.3.4
burn).

Start with [PLAN.md](PLAN.md).

| File | What it is |
|---|---|
| [PLAN.md](PLAN.md) | Top-level plan, phases, stop-gate, Backend comparison |
| [SPEC-01-ci-quality-gates.md](SPEC-01-ci-quality-gates.md) | Main proposal: baseline, target pipeline, consolidation, Docker gate, branch protection, open decisions |
| [SPEC-02-ai-and-deploy-workflows.md](SPEC-02-ai-and-deploy-workflows.md) | Advisory/agentic/deploy fleet; the rule keeping them out of required checks |
| [TODO.md](TODO.md) | Phase-by-phase execution checklist with verify commands |
| [PROMPT.md](PROMPT.md) | Agent-harness goal: task table, verifies, retry caps, escalation, close condition |
| [DECISIONS.md](DECISIONS.md) | ADR: the four resolved decisions (D1–D4) + gc-build-deploy correction |
| [diagram-current-state.md](diagram-current-state.md) | Mermaid — ungated, redundant today |
| [diagram-target-pipeline.md](diagram-target-pipeline.md) | Mermaid — one gate + Docker + protection |
| [diagram-workflow-map.md](diagram-workflow-map.md) | Mermaid + table — every workflow classified |
| [SPEC-03-claude-independent-review.md](SPEC-03-claude-independent-review.md) | Independent Claude PR reviewer on a cheaper model (advisory) |
| [diagram-harness-loop.md](diagram-harness-loop.md) | Mermaid — bounded execution loop |
| [diagram-claude-review.md](diagram-claude-review.md) | Mermaid — the independent-review decision flow |
| `skill/` | (bonus) reusable devex skill that regenerates this doc set for any repo |

All diagrams are GitHub-renderable Mermaid in Markdown code blocks — no SVG
exports (deliberate: the source renders inline on GitHub and stays diffable).
