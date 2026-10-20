# AGENTS.md

**Read [`CLAUDE.md`](./CLAUDE.md) first — it is the single source of truth** for
this repository: architecture, commands, branching, CI, testing, deployment,
the PM tooling, and the release train.

This file used to be a parallel copy of those sections. That failed the way
duplicated documentation always fails: on 2026-07-25 the two files disagreed on
four separate facts, including flatly contradicting each other about what
`ci.yml` does. Everything shared now lives in `CLAUDE.md` only, so the two
cannot drift again. What remains here is the delta for non-Claude agents
(Antigravity `agy`, Gemini CLI, OpenCode, Codex).

## What to skip in CLAUDE.md

These sections describe Claude Code specifics and do not apply verbatim:

- **gstack** — the `/browse`, `/ship`, `/review` … table in `CLAUDE.md` uses
  Claude Code's unprefixed slash commands and `Skill` tool. Use the host-specific
  install and skill-loading instructions below instead.
- **Startup (agent sessions)** — `.mcp.json` auto-spawn is Claude Code behaviour.
  The PM daemon facts in that section (watcher singleton, "expect many
  daemons", the `npm run pm:*` loop, the Jira project-key allowlist) are true
  for every harness.

Wherever `CLAUDE.md` says "invoke it using the Skill tool", use your own
harness's equivalent (`read_file` on the skill's `SKILL.md` in Antigravity /
Gemini CLI, or the `skill` tool in OpenCode).

## Installing gstack (`garrytan/gstack`)

`gemstack` is retired and no longer the `gstack` source. The canonical upstream
repository is [`garrytan/gstack`](https://github.com/garrytan/gstack), bootstrapped
by [`scripts/install-gstack.sh`](./scripts/install-gstack.sh):

```bash
# Clone/update garrytan/gstack into ~/.claude/skills/gstack and register skills:
./scripts/install-gstack.sh --host agy     # Antigravity CLI (agy)
./scripts/install-gstack.sh --host auto    # every detected agent (Claude, agy, OpenCode, Codex, …)

# Or directly from a standalone clone:
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup --host agy
./setup --status
```

## Skill loading by harness

- **Antigravity (`agy`):** `./setup --host agy` installs global skills at
  `~/.gemini/antigravity-cli/skills/gstack-*/SKILL.md` (prefixed with `gstack-`
  so `/gstack-plan-*` does not shadow Antigravity's built-in `/plan`). Project
  skills live in `.agents/skills/<name>/SKILL.md`. Both appear in `<skills>` in
  your system prompt. Load a skill by reading its `SKILL.md` with `read_file`
  (read remaining line ranges if truncated at 800 lines). When a `gstack` skill
  references Claude Code tool names, translate them to Antigravity tools:
  - `Bash` → `run_command`
  - `Read` → `read_file`
  - `Write` → `write_file`
  - `Edit` → `edit_file`
  - `Agent` → `invoke_subagent`
  - `AskUserQuestion` → `ask_question`
- **Gemini CLI (`gemini`):** Reads `GEMINI.md` and loads skills from
  `.agents/skills/<name>/SKILL.md` and `~/.gemini/skills/`. In GitHub Actions
  (`run-gemini-cli` workflows), `GEMINI_CLI_TRUST_WORKSPACE: 'true'` is required
  so `gemini` trusts the checkout.
- **OpenCode:** Loads skills from `.opencode/skills/` and
  `~/.config/opencode/skills/`. Check `available_skills` in your system prompt
  and load the closest match with the `skill` tool.

## Skill routing

When the user's request matches an available skill, load it as your FIRST action
(`read_file` on its `SKILL.md` in Antigravity / Gemini CLI, or the `skill` tool
in OpenCode). Do NOT answer directly, do NOT use other tools first. The skill
has specialized workflows that produce better results than an ad-hoc answer.

- Product ideas, "is this worth building", brainstorming → `office-hours` (`/gstack-office-hours`)
- Bugs, errors, "why is this broken", 500 errors → `investigate` (`/gstack-investigate`)
- Ship, deploy, push, create PR → `ship` (`/gstack-ship`)
- QA, test the site, find bugs → `qa` (`/gstack-qa`)
- Code review, check my diff → `review` (`/gstack-review`)
- Update docs after shipping → `document-release` (`/gstack-document-release`)
- Weekly retro → `retro` (`/gstack-retro`)
- Design system, brand → `design-consultation` (`/gstack-design-consultation`)
- Visual audit, design polish → `design-review` (`/gstack-design-review`)
- Architecture review → `plan-eng-review` (`/gstack-plan-eng-review`)
- Save progress / resume → `context-save` / `context-restore`
- Code quality, health check → `health` (`/gstack-health`)

## Editing this file

Add something here only if it is **false or inapplicable for Claude Code**.
Anything true for every agent belongs in [`CLAUDE.md`](./CLAUDE.md). Restating a
shared fact here recreates the drift this file was collapsed to prevent.
