# Workflow Map — every cookbook workflow, classified (2026-07-15)

GitHub-renderable Mermaid source. Which workflows should be **blocking**
(required to merge), which are **advisory** (run, comment, never block), and
which are **event/deploy** (fire on tags, schedules, or comments). Canonical
context: [SPEC-01](SPEC-01-ci-quality-gates.md) ·
[SPEC-02](SPEC-02-ai-and-deploy-workflows.md).

```mermaid
flowchart TB
    subgraph BLOCK["BLOCKING — required to merge (target)"]
        PG["pr-gate.yml → Gate — all checks passed"]
        CQ["codeql-analysis.yml → Analyze (javascript-typescript)"]
        DR["dependency-review.yml → Dependency Review"]
    end
    subgraph ADV["ADVISORY — run + comment, never required"]
        JR["junie-review.yml (Code Review, continue-on-error)"]
        PRD["run-prettier-formatting-with-reviewdog.yml"]
        GC["gc-build-deploy.yml (Google Cloud Build Gate)"]
    end
    subgraph EVENT["EVENT / DEPLOY / AGENTIC — not PR gates"]
        REL["release.yml (push→main: tag + GH release + Cloud Build)"]
        JT["junie-tag.yml (@junie-agent comments)"]
        SEC["security-alert-issues.yml (schedule → issues)"]
        AW["gh-aw: daily-repo-status · issue-arborist ·<br/>agentics-maintenance · relevance-summary"]
        UP["upload-global-configuration.yml"]
    end
    subgraph RETIRE["RETIRE / CONSOLIDATE"]
        CI["ci.yml — redundant lint/test/build on PR<br/>(keep push-only format job or delete)"]
        CD["ci-cd.yml — redundant lint + vitest"]
        CDB["ci-cd-backend.yml — pytest, PR→main only<br/>(never runs on dev; delete)"]
    end
    CI -.->|"fold into"| PG
    CD -.->|"fold into"| PG
    CDB -.->|"delete — covered by"| PG
    style BLOCK fill:#14532d,color:#fff
    style RETIRE fill:#7c2d12,color:#fff
```

| Workflow | Today's trigger | Class | Action |
|---|---|---|---|
| `pr-gate.yml` | PR `[main,dev,dev/**]` | **Blocking** | Keep; make `gate` a required context |
| `codeql-analysis.yml` | PR `[main,dev]` + weekly | **Blocking** | Keep; require `Analyze (javascript-typescript)` |
| `dependency-review.yml` | PR `[main,dev]` | **Blocking** | Keep; optionally require |
| `ci.yml` | push+PR `[main,dev,dev/**]` | Redundant | Trim to push-only format, or delete |
| `ci-cd.yml` | push `main`+tags, PR `[main,dev,dev/**]` | Redundant | Delete (folded into pr-gate) |
| `ci-cd-backend.yml` | push `main`+tags, PR `[main]` | Redundant+narrow | Delete (never runs on `dev`) |
| `release.yml` | push `main` | Deploy | Keep unchanged |
| `gc-build-deploy.yml` | push `**` + PR all | Advisory/deploy | Scope triggers; keep out of required |
| `junie-review.yml` | PR `[main]` | Advisory | Keep out of required |
| `run-prettier-...-reviewdog.yml` | PR `[main,dev]` | Advisory | Keep out of required |
| `junie-tag.yml` | `@junie-agent` events | Event | Unchanged |
| `security-alert-issues.yml` | schedule + dispatch | Event | Unchanged |
| gh-aw (`daily-repo-status`, `issue-arborist`, `agentics-maintenance`, `relevance-summary`) | schedule / dispatch | Agentic | Unchanged, never required |
| `upload-global-configuration.yml` | — | Event | Unchanged |
