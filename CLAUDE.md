# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Session start: sync before you act (ALWAYS DO THIS FIRST)

Local checkouts on this machine routinely lag `origin`, and parallel agent sessions (other machines, cloud sessions, routines) may already be working the same area. Skipping these checks has repeatedly produced duplicate fixes and conflicting branches. Run them at session start, and again immediately before creating any branch or worktree:

1. **Fetch, always.** `git fetch origin --prune && git submodule update --init Backend && git -C Backend fetch --prune`. Initializing the submodule first ensures `git -C Backend fetch` never fails on a partial or fresh checkout. `Backend` is the only _required_ submodule — `alirez-claude-skills` and `gemstack` are optional skill collections; do not force-init them. `git status` alone never contacts the remote — do not trust it for freshness.
2. **Check divergence.** `scripts/git/ahead-behind.sh --base dev . Backend` shows ahead/behind for the repo and `Backend/` in one shot (`--base dev` pins the comparison to `dev` regardless of either repo's default branch; naming `. Backend` explicitly skips the optional submodules, which may be uninitialized). Step 1 must run first: against an _uninitialized_ `Backend/` the script does not fail — it silently reports the parent repo's branches under the Backend heading. Fallback: `git log --oneline dev..origin/dev`, repeated as `git -C Backend log --oneline dev..origin/dev`. If local `dev` is behind, fast-forward it with `git switch dev && git pull --ff-only` (never merge — `--ff-only` aborts rather than create an accidental merge commit). In a secondary worktree, `git switch dev` fails when `dev` is checked out elsewhere — that's fine: skip the fast-forward and just branch from `origin/dev`. Base every new branch on the remote tip, not the local branch: `git switch -c fix/<topic> origin/dev`.
3. **Map the task onto the repo, then scan in-flight work.** First identify which files/areas the task will touch. Then look for anyone already there: `gh pr list --state open` here, `gh pr list -R adamtasteslikegood/tasteslikegood.com --state open` for Backend, `git branch -r --sort=-committerdate | head` for fresh unmerged branches, and `git log --oneline -10 origin/dev -- <paths>` for recent landings in those areas. Read anything that overlaps — it may already solve part of the task, supersede it, or be about to conflict. Surface overlaps to Adam and build on the in-flight work instead of duplicating it.
4. **Check cross-session context.** Jira (KAN/RCP) and Confluence are the source of truth across agents, machines, and sessions. Skim the PM briefing and the latest entries under Confluence → Agent Session Logs for related work in flight or recent decisions that constrain the task.
5. **Preflight the branch before working on it, and again before opening a PR.** `scripts/git/branch-preflight.sh` fails (exit 1) when the current branch is behind `origin/dev` or when its Backend gitlink, committed or staged, is not `origin/dev`'s pointer or a descendant of it (a merge would roll Backend back). Exit 2 means it could not inspect; treat that as a failure, not a pass. `--max-behind N` tolerates drift on a long-running branch. It exists because a stale branch cost four sessions in Sprint 8 and another would have rolled the Backend pointer back 18 commits with no gate catching it (KAN-303).
6. **Respect commit/push order for submodule work.** When a change spans `Backend/`, use `scripts/git/git-workflow.sh` — it commits submodules before the parent repo and pushes in the correct order (supports `--dry-run` and `--interactive`).

Only after these checks: create the branch or worktree and start the work.

### Starting work: branch or worktree

After the sync above confirms local `dev` is up to date with `origin/dev`, choose one:

**Option A — Feature branch (default for most work):**

```bash
git switch -c feat/my-topic origin/dev   # always base on the remote tip
# ... work, commit, push ...
git push -u origin feat/my-topic
gh pr create --base dev
```

**Option B — Worktree (parallel work or long-running tasks):**

```bash
git worktree add .claude/worktrees/my-topic -b feat/my-topic origin/dev
cd .claude/worktrees/my-topic
# ... work in isolation, commit, push, PR as above ...
```

Both options base the branch on `origin/dev` (not local `dev`) to guarantee freshness.

### Branch protection — what it means for you

`dev` and `main` are protected: **direct pushes are rejected**. All changes reach them via PR only. If you try `git push` to `dev` you will get `push declined due to repository rule violations`. This is not a bug — create a branch, push it, and open a PR.

**Merge method (cookbook):** `dev` and `main` both allow **`merge` or `rebase` only — squash is blocked**. Use `gh pr merge <n> --merge`. Backend `dev` and `main` block squash too (verified 2026-09-19 against the live `dev` ruleset — GitHub rejects `--squash` with "Merge method squash merging is not allowed on this repository"; pending Backend #315 changes the Dependabot auto-merge workflow to pick rebase or merge per PR). `required_linear_history` is **not** set on any branch in either repo — if a doc tells you otherwise it is stale, and squashing to satisfy it destroys the ancestry that history reconciliation depends on.

**Unresolved review threads block the merge** (`required_review_thread_resolution`). Answer and resolve every thread, or the PR sits at `BLOCKED` with all checks green.

Required status checks are the **union of legacy branch protection and the rulesets**. Both are enforced, and both change, so this file deliberately lists no check names: a copied list here went stale and was then trusted (KAN-302). Read the live state for the branch you are merging into:

```bash
target_branch=dev  # or main
gh api repos/{owner}/{repo}/rulesets                                  # which rulesets exist
gh api "repos/{owner}/{repo}/rules/branches/${target_branch}" \
  --jq '.[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context'
gh api "repos/{owner}/{repo}/branches/${target_branch}/protection/required_status_checks" --jq '.contexts[]'
```

The required set is everything the last two commands print.

### Run checks locally before pushing

Run these before `git push` to avoid CI failures:

```bash
npm run lint          # ESLint
npm run format:check  # Prettier (or `npm run format` to auto-fix)
npm run type-check    # TypeScript (both tsconfigs)
npm test              # Vitest (server + src)
cd Backend && uv run pytest  # Backend tests (if Backend touched)
```

For docs-only or config-only changes, `npm run format:check` is sufficient — the other checks won't fail on non-code files. When in doubt, run the full set; it takes ~60 seconds locally vs waiting for CI.

### Chartering, changing or closing a sprint? Read `docs/pm/SPRINT_PLANNING.md` first

**Applies to: chartering or planning any sprint, adding work to a running one, `/cs:grill-pm`, any charter or plan document, and sprint close-out.** Read that file before acting. It is not optional: each rule in it exists because skipping it went unnoticed while gates reported green. In short:

- **Every sprint item needs an RCP acceptance row**, or board 168 shows nothing (it filters `project = RCP`). Label the KAN execution rows `sprint-N` too. Never fix board visibility by removing KAN rows from the sprint (KAN-260).
- **Read the Confluence retro before drafting a charter.** Its "Actions for Next Sprint" table exists nowhere in the repo. Walk it row by row, and surface the gaps without self-authorizing scope.
- **Closing a sprint is not done until the retro page exists** in Confluence `TLG`, as a child of page `50298881`.

## Project

**Vegangenius Chef** — vegan recipe generator and personal cookbook app. Users generate recipes via Google Gemini (`gemini-3.8-flash`), get AI food photos via Gemini image generation (`gemini-3-pro-image`, Nano Banana Pro), and manage cookbooks. Auth via Google OAuth or guest (localStorage).

- **Production:** `https://www.tasteslikegood.org` (canonical host; apex `tasteslikegood.org` 301-redirects to `www`)
- **Version:** See `package.json` `version` field (currently v0.6.0)
- **Other agents:** See `AGENTS.md` for OpenCode / non-Claude agent instructions

## Commands

### Frontend + Express proxy (root)

```bash
npm install
npm run dev          # Angular :3000 + Express :8080; proxies /api to Flask and /rum + /privacy-policy to Express
npm run build        # ng build + compile server/tsconfig.server.json → server/dist/
npm start            # node server/dist/index.js (production, port 8080)
npm run lint         # ESLint (src/ + server/)
npm run lint:fix     # ESLint auto-fix
npm run format       # Prettier write
npm run format:check # Prettier check (CI)
npm run type-check   # tsc --noEmit (both tsconfigs)
npm test             # Vitest (server tests)
npm run test:ci      # Vitest with coverage
```

### Backend (Python/Flask)

```bash
cd Backend
uv sync              # Install deps via uv (preferred over pip)
cp .env.example .env
./init_database.sh   # Initialize DB + run migrations
python app.py        # Flask dev server on :5000
pytest               # Run all tests
pytest tests/test_normalization.py::TestNormalization::test_normalize_unit  # Single test
```

### Cloud deployment

```bash
gcloud builds submit --config=cloudbuild.yaml  # Build + deploy both services to Cloud Run
```

## Architecture

```
Browser → Express :8080 → Flask :5000 → Cloud SQL (PostgreSQL)
```

**All browser traffic routes through Express** (single origin, no CORS). Express proxies `/api/*` to Flask as a raw HTTP stream. Angular only ever uses relative URLs (`/api/...`).

- **Layer 1 — Angular 22 SPA** (`src/`): Standalone components with Signals API, flat route config in `src/app.routes.ts`. See `src/` directory structure for component tree.
- **Layer 2 — Express reverse proxy** (`server/`): Helmet, rate limiting, Valkey, validation, response compression, cache headers for the built assets. No AI logic and no recipe logic of its own: proxy, static hosting, and the home page.
  - **Home page composition:** `/` is the Angular build's `index.html`, the one crawlable page Flask does not render, so Express composes it. Today it writes the newest-recipes row into it from Flask's `GET /api/public/newest-recipes` (`server/newest-recipes.ts`, KAN-348): fetched at startup, kept three minutes, served as built when Flask has no list. Flask decides order and visibility. A GET for `/` that names `text/markdown` in `Accept` gets `server/public/home.md` with the same newest-recipes links (`server/home-markdown.ts`, KAN-397); every answer for `/` carries `Vary: Accept`. Express is not limited to proxying and may do more for `/` when the work calls for it (Adam, 2026-10-12).
- **Layer 3 — Flask API** (`Backend/`): Modular blueprints. For Backend architecture, auth, and API details: `Backend/CLAUDE.md`
- **Public SSR surface**: Express proxies `/r/<slug>`, `/browse`, `/sitemap.xml`, `/static/*` to Flask for server-side rendering before the SPA catch-all.
- **Persistence**: `PersistenceService` writes localStorage first (instant UI), then syncs to Flask. Cloud SQL is authoritative; SQLite for local dev.

For full architecture details: `docs/DOCUMENTATION_INDEX.md`

## Key environment variables

**Root (`.env.local`):** `GEMINI_API_KEY` (required), `FLASK_BACKEND_URL` (default `http://localhost:5000`)

**Backend (`.env`):** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_API_KEY`, `FLASK_SECRET_KEY`, `DATABASE_URL`

In production all secrets come from Google Secret Manager, injected at Cloud Run runtime.

## Branching strategy

Both this repo and the `Backend/` submodule follow: `main` (release) ← `dev` (integration) ← `feat/*`/`fix/*`/`chore/*` (short-lived). Never commit directly to `main` or `dev`. Branch protection enforced since 2026-07-18; for the current required checks and merge methods see **Branch protection — what it means for you** above (read them live with the commands there; do not trust a copied list).

To ship a Backend change:

1. PR into Backend `dev` (in `Backend/` submodule).
2. Promote Backend `dev` → `main`, then back-sync `main` → `dev`.
3. In this repo, pin **Backend `main`'s own SHA** (`git -C Backend checkout origin/main && git add Backend`) and commit that pointer in a cookbook PR off `dev`; then `dev` → `main`, which tags and releases.

**Do not use `git submodule update --remote Backend`** — `.gitmodules` tracks `dev`, so `--remote` resolves to Backend `dev`'s tip and always blocks train-verify Station 3.

**The full ordered procedure is @scripts/release/RUNBOOK.md**, driven by `scripts/release/train-run.sh`.

## Commit and push cadence

On feature branches, commit and push after every significant work-run so work is recoverable from the remote if the VM/session dies. Stage only intentional files, keep commits scoped, and push immediately after each local commit unless the user explicitly says not to.

## Pull request lifecycle

Every PR you author, work on or wait on is yours until it merges, without being asked. The rules below are binding; `docs/agents/PR_LIFECYCLE.md` has the full text, commands and the incidents behind each one.

- **Jira key in the title (REQUIRED)**, in this repo and in `Backend/`: `KAN-###` or `RCP-###`. A Linear `TAS-####` key alone does not create the Jira link. No issue yet? File one first.
- **Monitor it**: comments, inline comments and checks, each time you return and before calling related work done.
- **Read every review body in full** before merging or calling review debt zero: `gh api --paginate repos/{owner}/{repo}/pulls/<n>/reviews`. Keep `--paginate`. Copilot findings under **Suppressed comments** or **Previously missed** never become threads, so answer them as PR comments.
- **Answer every comment** with a fix commit or a concrete rebuttal. Invoke `superpowers:receiving-code-review` BEFORE responding.
- **Persist non-trivial review insights to GitHub Discussions** (category Ideas), linking the PR.
- **Never write a bot's command text in a comment, not even in backticks.** Say "DocBot's approval command" instead (KAN-310).
- **Sign replies posted on Adam's behalf** with a final line: _Replied by Claude on Adam's behalf_
- **Loop until merged.** Surface calls only Adam can make, and note on the thread that they await him.

## Database migrations

Backend migrations live in `Backend/migrations/versions/` (Alembic via Flask-Migrate). Applied in production by Cloud Run Job `flask-backend-migrate`, wired into `cloudbuild.yaml` between image push and service deploy. A failure aborts the build; the old Flask revision keeps serving.

Detect branched heads: `cd Backend && uv run flask db heads` (must be one line). Unify with:

```bash
cd Backend && uv run flask db merge -m "merge <topic-a> and <topic-b> heads" <revA> <revB>
```

For full migration details: `Backend/DATABASE_SETUP.md`

## Deployment & CI

Two Cloud Run services (`express-frontend`, `flask-backend`) plus one Job (`flask-backend-migrate`) in `us-central1`. Release flow: PR to `dev` → PR `dev`→`main` (bumps version + CHANGELOG) → `release.yml` creates tag → Cloud Build trigger (`^v[0-9]+\.[0-9]+\.[0-9]+$`) runs `cloudbuild.yaml`.

PR gate (`.github/workflows/pr-gate.yml`): lint, TypeScript, build, Vitest+coverage, pytest, Docker image, CHANGELOG check, SEO canonical, all aggregated into `Gate — all checks passed` (required status check). Additional: CodeQL, Dependency Review.

**A stuck or red run: read the affected run's jobs before its logs.** All jobs `queued` with none started means a platform or scheduling cause, not code. A run conclusion of `action_required` means GitHub is holding it for approval, so nothing ran. Neither is fixed by re-pushing. Commands and the full decision tree: `docs/ci/CI_TRIAGE.md` (KAN-304).

For full CI/CD details: `docs/ci/refresh/SPEC-01-ci-quality-gates.md`, `docs/deployment/DEPLOYMENT_CHECKLIST.md`

## Testing

- **Frontend:** Vitest (`npm test`). Both `*.test.ts` and `*.spec.ts` under `server/` and `src/` run. Coverage thresholds (60% lines, 50% branches, 40% functions) apply to `server/**/*.ts` only.
- **Backend:** pytest (`cd Backend && uv run pytest`). Tests in `Backend/tests/`.
- **No E2E harness.** UI changes verified by running dev server and testing in browser.

## Startup (agent sessions) & PM tooling

Project MCP servers declared in `.mcp.json`: `pm-daemon` and `gcp-monitor`. Full documentation: `docs/PM_TOOLING.md`

**Key facts for every session:**

- `pm-daemon` serves FastMCP tools over stdio AND runs a file watcher (singleton via `flock`). Expect many `pm_daemon.py` processes — one per session, that's correct. Never kill them.
- `gcp-monitor` exposes read-only Cloud Monitoring tools. Requires `GOOGLE_APPLICATION_CREDENTIALS` in `.env`.
- Canonical PM files synced to Confluence are defined in `scripts/pm/_canonical_pm_files.py` — never re-add a hardcoded list.
- **Jira project keys** (on `tasteslikegood.atlassian.net`): `KAN` (execution), `RCP` (delivery planning). Writes limited to these two. `PLZG`/`TO` are read-only (Plaza game, different repo).
- `ATLASSIAN_URL` must be `tasteslikegood.atlassian.net`. The `-dev` site is a frozen service shell.

```bash
npm run pm:status            # live Jira + PR + Confluence + prod status
npm run pm:brief             # refresh local PM context
npm run pm:sync              # publish to Confluence
npm run pm:daemon:status     # check if daemon is alive
```

## Non-obvious patterns

- **Rate limiter** uses Valkey for distributed state. GH #163/#162 are FIXED (2026-04-15). Live concerns are Flask-side: IAM token-refresh (Backend #247) and response-cache lost in merge `07123c2` (KAN-151).
- **AI model names** — API entries carry `models/` prefix; `Backend/config.py` uses bare IDs. Both forms in active use. The model choice itself is **settled**: `gemini-3.8-flash` (text; moved from `gemini-3.7-flash` on 2026-09-28, KAN-282) and `gemini-3-pro-image` (images, Nano Banana Pro) — both GA, both verified on the live API surface, and pinned in `cloudbuild.yaml`. Since v0.5.0 the pinned Backend (`d43b58f`, via Backend #323) defaults `Backend/config.py` to the same pair, so the pins are belt-and-braces rather than load-bearing: an unset env var no longer yields an older model. Keep the pins and the defaults moving together. There is no GA Gemini 3.x _Pro_ text model, so `gemini-3.1-pro-preview` is not an alternative: it is a preview model, and preview-model retirement is what took production down when Imagen 4.0 was withdrawn. Do not propose reverting either.
- **Backend submodule** — remote: `adamtasteslikegood/tasteslikegood.com`, tracked branch `dev`. Always check for open Backend PRs and unsynced commits before backend work or releases.
- **gbrain and Backend** — Backend indexed as separate source `gstack-code-backend`; queries need `--source gstack-code-backend` or they silently miss. Never run `/sync-gbrain` from inside `Backend/`.
- **TypeScript pinned exactly** (`6.0.3`) — Angular 22 needs TS >=6.0 <6.1. Bump TS + all `@angular/*` + `@angular-eslint/*` together.

## Further reading

An `@path` entry is loaded into every session, so only the release runbook is imported; read the others when the task needs them. Keep it that way: a new import costs every session, whatever the task (KAN-416).

- `Backend/CLAUDE.md` — authoritative Backend reference
- `Backend/API.md` — Flask API endpoint reference
- `Backend/DATABASE_SETUP.md` — migration steps
- `docs/DOCUMENTATION_INDEX.md` — full docs index
- `docs/ci/refresh/` — CI pipeline specs and decisions
- @scripts/release/RUNBOOK.md — release train procedure
- `docs/PM_TOOLING.md` — PM daemon, Confluence sync and session logging
- `docs/pm/SPRINT_PLANNING.md` — sprint acceptance rows, retro, close-out
- `docs/agents/PR_LIFECYCLE.md` — PR rules with the incidents behind them
- `docs/ci/CI_TRIAGE.md` — stuck or red runs: platform or code
- `docs/MCP_GCP_MONITORING.md` — GCP monitoring MCP setup
- `docs/architecture/rate_limit.md` — rate limiting details

## gstack

Use the `/browse` skill from gstack for **all web browsing**. Never use `mcp__claude-in-chrome__*` tools directly.

**Team setup:** gstack is not vendored into this repo (the `skills` and `.gstack/` `.gitignore` entries keep agent skills out of git). To get the skills below, run `./scripts/install-gstack.sh` once — it clones gstack into `~/.claude/skills/gstack` and registers the skills. Re-running it updates an existing install. Requires [bun](https://bun.sh) and `git`.

Available gstack skills:

| Skill                  | Skill                    | Skill               | Skill                 |
| ---------------------- | ------------------------ | ------------------- | --------------------- |
| `/office-hours`        | `/plan-ceo-review`       | `/plan-eng-review`  | `/plan-design-review` |
| `/design-consultation` | `/design-shotgun`        | `/design-html`      | `/review`             |
| `/ship`                | `/land-and-deploy`       | `/canary`           | `/benchmark`          |
| `/browse`              | `/connect-chrome`        | `/qa`               | `/qa-only`            |
| `/design-review`       | `/setup-browser-cookies` | `/setup-deploy`     | `/setup-gbrain`       |
| `/retro`               | `/investigate`           | `/document-release` | `/document-generate`  |
| `/codex`               | `/cso`                   | `/autoplan`         | `/plan-devex-review`  |
| `/devex-review`        | `/careful`               | `/freeze`           | `/guard`              |
| `/unfreeze`            | `/gstack-upgrade`        | `/learn`            |                       |

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:

- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health

## Behavioral Guidelines

Follow the four Karpathy principles when writing or modifying code in this project:

1. **Think Before Coding** — understand the problem fully before writing. Read existing code, check for prior art, verify assumptions.
2. **Simplicity First** — prefer the simplest solution that works. Avoid premature abstraction, speculative features, and unnecessary indirection.
3. **Surgical Changes** — make the smallest diff that solves the problem. Don't refactor surrounding code, add unrelated improvements, or "clean up while you're there."
4. **Goal-Driven Execution** — every action should move toward a verifiable success criterion. State what "done" looks like before starting.

For the full reference, see the `karpathy-check` slash command / `karpathy-coder` skill / `cs-karpathy-reviewer` agent under the **optional** `alirez-claude-skills/` submodule (not initialized by default — see the Submodules note in the "Session start" section).

## GBrain Search Guidance (configured by /sync-gbrain)

<!-- gstack-gbrain-search-guidance:start -->

GBrain is set up and synced on this machine. The agent should prefer gbrain
over Grep when the question is semantic or when you don't know the exact
identifier yet.

**This worktree is pinned to a worktree-scoped code source** via the
`.gbrain-source` file in the repo root (kubectl-style context).
`gbrain code-def`, `code-refs`, `code-callers`, `code-callees`, `search`, and
`query` from anywhere under this worktree route to that source by default —
no `--source` flag needed (gbrain >= 0.41.38.0; on older gbrain the call-graph
commands need `--source "$(cat .gbrain-source)"`). Conductor sibling worktrees
of the same repo each have their own pin and their own indexed pages, so
semantic results match the code on disk here.

Call-graph queries (`code-callers`/`code-callees`) also need the graph to be
built first — run `/sync-gbrain --dream` (or `--full`) if they return
`count: 0`. This only works if this source's gbrain schema pack extracts code
symbols; on a non-code-aware pack `--dream` completes but the graph stays empty
and reports a WARN. `code-def`/`code-refs` need the same extraction.

Two indexed corpora available via the `gbrain` CLI:

- This worktree's code (auto-pinned via `.gbrain-source`).
- `~/.gstack/` curated memory (registered as `gstack-brain-<user>` source via
  the existing federation pipeline).

Prefer gbrain when:

- "Where is X handled?" / semantic intent, no exact string yet:
  `gbrain search "<terms>"` or `gbrain query "<question>"`
- "Where is symbol Y defined?" / symbol-based code questions:
  `gbrain code-def <symbol>` or `gbrain code-refs <symbol>`
- "What calls Y?" / "What does Y depend on?":
  `gbrain code-callers <symbol>` / `gbrain code-callees <symbol>`
- "What did we decide last time?" / past plans, retros, learnings:
  `gbrain search "<terms>" --source gstack-brain-<user>`

Grep is still right for known exact strings, regex, multiline patterns, and
file globs. Run `/sync-gbrain` after meaningful code changes; for ongoing
auto-sync across all worktrees, run `gbrain autopilot --install` once per
machine — gbrain's daemon handles incremental refresh on a schedule.

Safety: don't run `/sync-gbrain` while `gbrain autopilot` is active — the
orchestrator refuses destructive source ops when it detects a running autopilot
to avoid racing it (#1734). Prefer registering user repos with `gbrain sources
add --path <dir>` (no `--url`): URL-managed sources can auto-reclone, and the
sync code walk for them requires an explicit `--allow-reclone` opt-in.

<!-- gstack-gbrain-search-guidance:end -->
