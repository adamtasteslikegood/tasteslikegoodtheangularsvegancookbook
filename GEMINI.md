# GEMINI.md

**Read [`CLAUDE.md`](./CLAUDE.md) and [`AGENTS.md`](./AGENTS.md) first:**

- **[`CLAUDE.md`](./CLAUDE.md)** is the single source of truth for this
  repository: architecture, commands, branching (`dev` / `main`), CI, testing,
  deployment, PM tooling (`KAN` / `RCP` on `tasteslikegood.atlassian.net`), and
  the release train.
- **[`AGENTS.md`](./AGENTS.md)** carries the harness delta for **Antigravity
  (`agy`)**, **Gemini CLI (`gemini`)**, and other non-Claude agents — including
  [`garrytan/gstack`](https://github.com/garrytan/gstack) installation
  (`./scripts/install-gstack.sh --host agy`), skill loading
  (`~/.gemini/antigravity-cli/skills/gstack-*`, `~/.gemini/skills/`,
  `.agents/skills/`), tool-name translation, and skill routing.
- When working inside the `Backend/` submodule, read `Backend/CLAUDE.md` and
  `Backend/AGENTS.md` (or `Backend/GEMINI.md`).

This file previously held a separate project overview and `gemstack` submodule
instructions. `gemstack` is retired in favour of
[`garrytan/gstack`](https://github.com/garrytan/gstack), and Antigravity (`agy`)
automatically loads both `AGENTS.md` and `GEMINI.md` in every workspace
directory. Keeping repo facts in [`CLAUDE.md`](./CLAUDE.md) and Antigravity /
Gemini CLI harness guidance in [`AGENTS.md`](./AGENTS.md) prevents drift and
avoids loading duplicate rules into context.
