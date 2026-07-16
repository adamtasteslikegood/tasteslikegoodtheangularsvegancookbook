# ci-refresh-devex — install & folder recommendation

This folder stages the **bonus** reusable skill that regenerates the
`docs/ci/refresh/` doc set for any repo whose build gates need adding/restoring.
It is staged here (not installed) because agent skills are `.gitignore`d in this
repo and writing into `.claude/skills/**` is guarded in background sessions.

## Recommended install folder

Install as a **personal (user) skill** so it works across all your repos:

```
~/.claude/skills/ci-refresh-devex/
  SKILL.md
  templates.md
```

Install:

```bash
mkdir -p ~/.claude/skills/ci-refresh-devex
cp docs/ci/refresh/skill/SKILL.md      ~/.claude/skills/ci-refresh-devex/
cp docs/ci/refresh/skill/templates.md  ~/.claude/skills/ci-refresh-devex/
```

Then invoke with the Skill tool as `ci-refresh-devex`, or reference it as the
custom skill folder when starting `agent-harness:cs-harness`.

### Alternatives

- **Project-scoped (shared with the team):** `.claude/skills/ci-refresh-devex/`
  in the repo root. Note this repo `.gitignore`s `skills/` and `.claude/` skill
  paths, and background sessions block `.md` writes there — a human must place
  the files (or the write is done from an interactive session).
- **Plugin bundle:** add to an existing skills plugin (e.g. alongside
  `engineering-advanced-skills`) if you distribute skills that way.

## Relationship to existing skills

- Composes with `engineering-advanced-skills:ci-cd-pipeline-builder` (use its
  `stack_detector.py` / `pipeline_generator.py` for Stage 1 audit + baseline
  YAML).
- Hands off to `agent-harness:cs-harness` (Stage 6) for verified execution.
- Q/A gate pattern follows `pm-skills:cs-grill-pm` / `product-skills:cs-grill-product`.
