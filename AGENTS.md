# AGENTS.md

**Read [`CLAUDE.md`](./CLAUDE.md) first — it is the single source of truth** for
this repository: architecture, commands, branching, CI, testing, deployment,
the PM tooling, and the release train.

This file used to be a parallel copy of those sections. That failed the way
duplicated documentation always fails: on 2026-07-25 the two files disagreed on
four separate facts, including flatly contradicting each other about what
`ci.yml` does. Everything shared now lives in `CLAUDE.md` only, so the two
cannot drift again. What remains here is the delta for non-Claude agents.

## What to skip in CLAUDE.md

These sections describe Claude Code specifics and do not apply to you:

- **gstack** — the `/browse`, `/ship`, `/review` … skill table
- **GBrain Configuration** / **GBrain Search Guidance** — written for Claude Code:
  it assumes the `/sync-gbrain` and `/browse` skills and the `.gbrain-source`
  worktree pin those skills manage
- **Startup (agent sessions)** — `.mcp.json` auto-spawn is Claude Code behaviour.
  The PM daemon facts in that section (watcher singleton, "expect many
  daemons", the `npm run pm:*` loop, the Jira project-key allowlist) are true
  for every harness.

Wherever `CLAUDE.md` says "invoke it using the Skill tool", use your own
harness's equivalent.

## Skill loading

OpenCode loads skills from `.opencode/skills/` and `~/.config/opencode/skills/`.
The full skill list is in your system prompt. When in doubt, check
`available_skills` and load the closest match.

## Skill routing

When the user's request matches an available skill, load it using the `skill`
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than an ad-hoc
answer.

- Product ideas, "is this worth building", brainstorming → `office-hours`
- Bugs, errors, "why is this broken", 500 errors → `investigate`
- Ship, deploy, push, create PR → `ship`
- QA, test the site, find bugs → `qa`
- Code review, check my diff → `review`
- Update docs after shipping → `document-release`
- Weekly retro → `retro`
- Design system, brand → `design-consultation`
- Visual audit, design polish → `design-review`
- Architecture review → `plan-eng-review`
- Save progress / resume → `context-save` / `context-restore`
- Code quality, health check → `health`

## Editing this file

Add something here only if it is **false or inapplicable for Claude Code**.
Anything true for every agent belongs in `CLAUDE.md`. Restating a shared fact
here recreates the drift this file was collapsed to prevent.
