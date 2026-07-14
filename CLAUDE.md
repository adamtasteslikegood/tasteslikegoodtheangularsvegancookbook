# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Session start: sync before you act (ALWAYS DO THIS FIRST)

Local checkouts on this machine routinely lag `origin`, and parallel agent sessions (other machines, cloud sessions, routines) may already be working the same area. Skipping these checks has repeatedly produced duplicate fixes and conflicting branches. Run them at session start, and again immediately before creating any branch or worktree:

1. **Fetch, always.** `git fetch origin --prune && git submodule update --init Backend && git -C Backend fetch --prune`. Initializing the submodule first ensures `git -C Backend fetch` never fails on a partial or fresh checkout. `Backend` is the only _required_ submodule — `alirez-claude-skills` and `gemstack` are optional skill collections; do not force-init them. `git status` alone never contacts the remote — do not trust it for freshness.
2. **Check divergence.** `scripts/git/ahead-behind.sh --base dev . Backend` shows ahead/behind for the repo and `Backend/` in one shot (`--base dev` pins the comparison to `dev` regardless of either repo's default branch; naming `. Backend` explicitly skips the optional submodules, which may be uninitialized). Step 1 must run first: against an _uninitialized_ `Backend/` the script does not fail — it silently reports the parent repo's branches under the Backend heading. Fallback: `git log --oneline dev..origin/dev`, repeated as `git -C Backend log --oneline dev..origin/dev`. If local `dev` is behind, fast-forward it with `git switch dev && git pull --ff-only` (never merge — `--ff-only` aborts rather than create an accidental merge commit). In a secondary worktree, `git switch dev` fails when `dev` is checked out elsewhere — that's fine: skip the fast-forward and just branch from `origin/dev`. Base every new branch on the remote tip, not the local branch: `git switch -c fix/<topic> origin/dev`.
3. **Map the task onto the repo, then scan in-flight work.** First identify which files/areas the task will touch. Then look for anyone already there: `gh pr list --state open` here, `gh pr list -R adamtasteslikegood/tasteslikegood.com --state open` for Backend, `git branch -r --sort=-committerdate | head` for fresh unmerged branches, and `git log --oneline -10 origin/dev -- <paths>` for recent landings in those areas. Read anything that overlaps — it may already solve part of the task, supersede it, or be about to conflict. Surface overlaps to Adam and build on the in-flight work instead of duplicating it.
4. **Check cross-session context.** Jira (KAN/RCP) and Confluence are the source of truth across agents, machines, and sessions. Skim the PM briefing and the latest entries under Confluence → Agent Session Logs for related work in flight or recent decisions that constrain the task.
5. **Respect commit/push order for submodule work.** When a change spans `Backend/`, use `scripts/git/git-workflow.sh` — it commits submodules before the parent repo and pushes in the correct order (supports `--dry-run` and `--interactive`).

Only after these checks: create the branch or worktree and start the work.

## Project

**Vegangenius Chef** — vegan recipe generator and personal cookbook app. Users generate recipes via Google Gemini, get AI food photos via Imagen, and manage cookbooks. Auth via Google OAuth or guest (localStorage).

## Commands

### Frontend + Express proxy (root)

```bash
npm install
npm run dev          # Angular dev server on :3000, proxies /api → Flask :5000
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

### Three-tier request flow

```
Browser → Express :8080 → Flask :5000 → Cloud SQL (PostgreSQL)
```

**All browser traffic routes through Express** (single origin, no CORS). Express proxies `/api/*` to Flask as a raw HTTP stream — mounted **before** `express.json()` so Flask handles body parsing itself. Flask's `url_for(_external=True)` resolves correctly via `X-Forwarded-*` headers set by Express. Angular only ever uses relative URLs (`/api/...`).

### Layer 1 — Angular 22 SPA (`src/`)

- Standalone components with **Signals API** (`signal()`, `computed()`, `effect()`) — no RxJS
- Three services: `GeminiService` (recipe + image generation), `AuthService` (OAuth + guest), `PersistenceService` (localStorage-first, background sync to Flask)
- Type definitions: `recipe.types.ts`, `auth.types.ts`
- Dev server port 3000; `proxy.conf.json` maps `/api` → Flask :5000
- Entry: `index.tsx` (tsconfig uses `jsx: react-jsx`, hence `.tsx`)

### Layer 2 — Express reverse proxy (`server/`)

- `server/index.ts` — startup, graceful shutdown (drains HTTP, closes Valkey)
- `server/proxy.ts` — `createFlaskProxy()`, raw streaming to Flask
- `server/security.ts` — Helmet, rate limiting (300 req/15 min general, 20 req/hr AI), request logger
- `server/valkey.ts` — Valkey (Redis alternative) client for distributed rate limiting; falls back to in-memory
- `server/validation.ts` — express-validator rules for the AI endpoints (`POST /api/generate`, `POST /api/generate_image`): buffers the JSON body (10kb cap), validates it, and stashes the raw bytes on `req.rawBody` for the proxy to replay to Flask verbatim; all other `/api/*` routes keep raw streaming
- No AI logic lives here; it's purely proxy + static hosting

### Layer 3 — Flask API (`Backend/`)

Modular blueprint architecture (the `Backend/CLAUDE.md` is **outdated** — ignore its monolithic description):

- `auth.py` + `blueprints/auth_api_bp.py` — Google OAuth 2.0 flow, sessions
- `blueprints/generation_bp.py` — `/api/generate` (Gemini text), `/api/generate_image` (Imagen)
- `blueprints/recipes_api_bp.py` — CRUD for recipes
- `blueprints/collections_api_bp.py` — CRUD for cookbooks
- `services/` — business logic (Gemini, Imagen, stock images)
- `repositories/` — data access with file locking
- `validators/` — JSON Schema Draft 7 validation
- `models/` — SQLAlchemy: User, Recipe, Collection
- `migrations/` — Alembic via Flask-Migrate

### Persistence strategy

- `PersistenceService` writes localStorage first (instant UI), then syncs to Flask
- On OAuth login, guest localStorage data merges into the authenticated session
- Cloud SQL (PostgreSQL) is authoritative; SQLite used for local dev

### Authentication

- Dual-auth: Flask tries user OAuth credentials first, falls back to server `GOOGLE_API_KEY`
- `ProxyFix` middleware in Flask trusts `X-Forwarded-*` from Express for external URL generation

## Key environment variables

**Root (`.env.local`):**

- `GEMINI_API_KEY` — required
- `FLASK_BACKEND_URL` — default `http://localhost:5000`

**Backend (`.env`):**

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — OAuth
- `GOOGLE_API_KEY` — Gemini fallback key
- `FLASK_SECRET_KEY` — session signing
- `DATABASE_URL` — PostgreSQL (prod) / SQLite (local)

In production all secrets come from Google Secret Manager, injected at Cloud Run runtime.

## Branching strategy (FINAL)

Both this repo and the `Backend/` submodule follow the same model:

- **`main`** — release branch. Stable. Only the bot's release commit and merges from `dev` land here. Tags fire from `main`.
- **`dev`** — integration branch. All feature work merges here first.
- **`feat/*`, `fix/*`, `chore/*`** — short-lived branches off `dev`. PR back into `dev`.

Never commit directly to `main` or `dev`. Always branch off `dev`.

The `.gitmodules` `Backend` entry tracks `dev`, so `git submodule update --remote Backend` fast-forwards to the Backend integration tip. To ship a Backend change:

1. PR into Backend `dev` (in `Backend/` submodule).
2. After it lands, in this repo: `git submodule update --remote Backend`, commit the new pointer in a cookbook PR off `dev`, merge to `main`, release.

There is no path that ships Backend code without a corresponding cookbook PR — production deploys whatever SHA the cookbook submodule pins at the moment of the release tag.

## Pull request lifecycle

Opening a PR is not the end of the task. Every PR you author, or are actively working on or waiting on, is yours until it merges — this applies by default, without being asked:

- **Monitor it.** While the PR is open, check for new review comments, inline comments, and failing checks (`gh pr view <n> --comments`, `gh api repos/{owner}/{repo}/pulls/<n>/comments`, `gh pr checks <n>`). Re-check whenever you return to the PR and before declaring any related work done — a PR with unaddressed feedback is not finished.
- **Answer every comment.** For each piece of reviewer feedback, do one of two things: push a fix commit and reply confirming what changed, or reply with a concrete technical rebuttal explaining why no change is needed. Never leave feedback unanswered or silently ignored. Verify claims against the code before agreeing or pushing a fix (the `superpowers:receiving-code-review` skill covers this — apply it when the superpowers plugin is installed).
- **Sign replies posted on Adam's behalf.** Replies go out under Adam's GitHub account, so make authorship explicit by ending each one with a plain attribution line (`Co-authored-by:` trailers belong in commit messages, not comments):

  > _Replied by Claude on Adam's behalf_

- **Loop until merged.** Repeat monitor → fix or rebut → reply until the PR is merged (or closed, or Adam says stop). If feedback requires a judgment call only Adam can make — scope changes, product decisions — surface it to him instead of guessing, but still reply on the thread noting it's awaiting his call.

## Database migrations

Backend migrations live in `Backend/migrations/versions/` (Alembic via Flask-Migrate). They are applied in production by a Cloud Run **Job** named `flask-backend-migrate`, wired into `cloudbuild.yaml` between "Push Flask Backend Version Tag" and "Deploy Flask Backend". The job:

- Reuses the just-pushed `flask-backend:$SHORT_SHA` image
- Overrides the container command to `flask db upgrade`
- Mirrors the Flask service's env + secrets (`DATABASE_URL`, `FLASK_SECRET_KEY`, `FLASK_ENV=production`, etc.)
- Runs in the same VPC/subnet so it can reach Cloud SQL via private IP
- Runs to completion with `--wait`; a failure aborts the build and the old Flask revision keeps serving traffic

When two PRs both add migrations off the same parent revision, Alembic ends up with branched heads and `flask db upgrade` refuses to run. Detect with `cd Backend && uv run flask db heads` (must be one line). To unify, generate a merge migration:

```bash
cd Backend && uv run flask db merge -m "merge <topic-a> and <topic-b> heads" <revA> <revB>
```

Commit the resulting `*_merge_*.py` file with the PR. The merge migration's `upgrade()`/`downgrade()` are typically empty — it exists only to unify the DAG. Recipe of last resort if production is already broken: run the Cloud Run job manually with `gcloud run jobs execute flask-backend-migrate --region=us-central1 --wait`.

## Deployment

Two Cloud Run services in `us-central1`, plus one Cloud Run Job:

- `express-frontend` — Node.js service, port 8080, public
- `flask-backend` — Python (gunicorn) service, port 5000, no public auth
- `flask-backend-migrate` — Cloud Run **Job** that runs `flask db upgrade` before each Flask service deploy (see "Database migrations" above)

`cloudbuild.yaml` builds both Docker images, runs the migrate Job, then deploys both services in sequence. Express Dockerfile is at root; Flask Dockerfile is at `Backend/Dockerfile`.

### Release flow

1. Feature work on a `feat/*` / `fix/*` / `chore/*` branch off `dev`. PR into `dev`.
2. When ready to ship: PR `dev` → `main`, bumping `package.json` version + CHANGELOG. Merge.
3. `.github/workflows/release.yml` extracts `version` from `package.json`, creates the git tag `vX.Y.Z`, pushes the tag, and publishes a GitHub Release with the matching CHANGELOG section. Idempotent — re-running on an existing tag is a no-op.
4. The tag push hits a **Cloud Build trigger configured on the GCP side** (not in this repo). The trigger watches for tag pushes matching the regex below and runs `cloudbuild.yaml` with `_VERSION=vX.Y.Z`.
5. `cloudbuild.yaml` builds both images, runs the `flask-backend-migrate` Job (blocking), then deploys Flask service, then Express service.

### Cloud Build tag-push trigger (production deploy)

The tag-push trigger lives in Cloud Build — **GCP Console → Cloud Build → Triggers** (or `gcloud builds triggers list`). Its tag pattern MUST be:

```
^v[0-9]+\.[0-9]+\.[0-9]+$
```

Anchored, digits-only, leading `v`, no trailing pre-release or metadata. This is a deliberate gate so:

- `v0.2.0`, `v1.0.0`, `v2.13.7` — match → production deploy fires
- `v0.2.0-rc.1`, `v0.2.0-beta` — pre-release tags → **do not match**, no production deploy
- `v0.2.0+build.123`, `v0.2.0+sha.abc` — metadata tags → **do not match**, no production deploy
- `latest`, `dev`, `0.2.0` (missing leading `v`) — **do not match**

If you ever need to ship a release candidate without triggering production, push a tag like `v0.3.0-rc.1` and it'll create a GitHub Release without a Cloud Run deploy. To verify the trigger is configured correctly:

```bash
gcloud builds triggers list --filter='name~deploy OR name~release' \
  --format='value(name, github.push.tag, filename)'
```

The `github.push.tag` field on the matching trigger should print `^v[0-9]+\.[0-9]+\.[0-9]+$`.

## Startup (agent sessions)

Project MCP servers are declared in `.mcp.json` at the repo root. When Claude Code (or any compatible agent) starts a session in this directory, it auto-spawns the servers listed there as stdio child processes. Currently registered:

- `pm-daemon` — runs `scripts/pm/run_pm_daemon.sh`, which creates the venv on first run if missing, then launches `scripts/pm/pm_daemon.py`. The daemon does two things in one process: serves the FastMCP tools (`get_project_status`, `sync_pm_documents`, `refresh_project_briefing`, `create_epic_from_roadmap`, `log_agent_session`) over stdio for the agent, and runs a `watchdog` Observer in the background that syncs `specs/plan.md`, `specs/roadmap.md`, `specs/planning_notes.md`, `specs/design-plan.md`, `specs/SCRUM_BOOTSTRAP_AND_BOARD_PLAN.md`, `specs/SPRINT_0_PLAN.md`, and `specs/ATLASSIAN_PM_LINK.md` to Confluence on save.

- `gcp-monitor` — runs `scripts/monitoring/run_gcp_monitor.sh`, which creates its venv on first run, then launches `scripts/monitoring/gcp_mcp_server.py`. Exposes read-only Cloud Monitoring tools (`check_system_health`, `list_available_metrics`, `query_metric`) covering the production stack (Cloud Run frontend/backend, Cloud SQL, Valkey, Pub/Sub). Requires `GOOGLE_APPLICATION_CREDENTIALS` (+ optional `GCP_PROJECT_ID`) in `.env`; without them the tools register but return a credential error instead of metrics. The `/system-health-check` skill (`.claude/skills/system-health-check/`) drives the full SRE health-report routine. Setup: `docs/MCP_GCP_MONITORING.md`.

  `gcp-monitor` is available in cloud sessions as a first-class MCP connector. Streamable HTTP deployment (`MCP_TRANSPORT=http`) remains documented for connector hosting and setup details (see `docs/MCP_GCP_MONITORING.md` § 4.5).

Requirements for `pm-daemon` to actually sync:

- `.env` (project root) must contain `ATLASSIAN_EMAIL` and `ATLASSIAN_API_TOKEN`. Without them the MCP tools register but Confluence sync logs `WARNING: Atlassian credentials missing` and no-ops.
- `ATLASSIAN_URL` must be `tasteslikegood.atlassian.net` — the only Atlassian site for work items. `scripts/pm/_atlassian_guard.py` enforces this allowlist across all `scripts/pm/` tooling and restricts Jira writes to the `KAN` and `RCP` projects (read-only rollups/briefings may also include `PLZG`/`TO`); any other site (including the `tasteslikegood-dev.atlassian.net` service shell) or project key raises a loud error instead of proceeding.
- `python3 -m venv` must work (Debian/Ubuntu: `sudo apt install python3.12-venv`).

To verify the daemon is running during a session: `ps -ef | grep pm_daemon | grep -v grep`. If you don't see it, your agent isn't reading `.mcp.json` — check the agent's MCP loader logs.

**Expect MANY `pm_daemon.py` processes — one per session, and that's correct.** Every agent session (each Claude Code window, each Copilot CLI, each background job, each worktree) spawns its own daemon as an MCP stdio child; they each need their own server on their own pipes. Only the **file watcher** is a singleton: the first daemon to take `.claude/pm-daemon-watcher.lock` (an exclusive `flock` in the main checkout) runs the `watchdog` Observer, and every other daemon logs `File watcher already owned by another pm_daemon (pid N); serving MCP tools only` and comes up fully functional minus the watcher. Before this lock existed, N sessions meant N observers all racing to PUT the same Confluence pages on every save (13 were seen at once). Do not "fix" the extra daemons by killing them — killing a live session's daemon breaks that session's MCP tools. See `docs/PM_TOOLING.md` § *The watcher is a singleton*.

## Non-obvious patterns

- **Rate limiter** uses Valkey for distributed state across Express replicas; `server/valkey.ts` has open GH issues (#163, #162) for edge cases under broken connections — see KAN-16, KAN-17
- **AI model names** include `models/` prefix (e.g., `models/gemini-3.1-pro-preview`); filter by `generateContent` in `supported_generation_methods`
- **Backend submodule** — `Backend/` is a git submodule (remote: `adamtasteslikegood/tasteslikegood.com`, tracked branch `dev`) and accounts for roughly half of the project. Before starting any backend work or shipping a release, ALWAYS check the Backend repo for open PRs and recent commits that may not yet be reflected in the parent's submodule pointer. Quick checks:
  - `gh pr list -R adamtasteslikegood/tasteslikegood.com --state open` — open Backend PRs
  - `git -C Backend fetch && git -C Backend log --oneline HEAD..origin/dev` — commits on `dev` the pointer hasn't picked up yet
  - `git -C Backend log --oneline origin/main..origin/dev` — commits on `dev` not yet promoted to Backend `main`
  - `cd Backend && uv run flask db heads` — must print exactly one line with `(head)`. Two heads = unmerged migrations, deploy will break.
  - `git submodule update --remote Backend` — fast-forward the pointer to the latest `dev` tip when ready
- **CI auto-formats** — Prettier runs as a CI job and commits fixes on push; don't be alarmed by bot commits
- **TypeScript is pinned exactly** (`6.0.3`) — Angular majors peer-require specific TS majors (Angular 22 needs TS >=6.0 <6.1), so TS and Angular must move together, manually. Dependabot ignores `@angular/*` semver-major updates; when upgrading Angular, bump `typescript`, all `@angular/*`, and `@angular-eslint/*` in the same PR

## Further reading

- `Backend/API.md` — Flask API endpoint reference
- `Backend/DATABASE_SETUP.md` — migration steps
- `docs/PHASE_3/` — database architecture and data models
- `docs/DEPLOYMENT_CHECKLIST.md` — pre-production checklist
- `docs/rate_limit.md` — rate limiting details

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

## GBrain Configuration (configured by /setup-gbrain)

- Mode: local-stdio
- Engine: postgres (Railway TCP proxy, dedicated `gbrain` database; schema v122)
- gbrain version: 0.42.56.0 (reconfigured 2026-07-04 to Railway Postgres)
- Embeddings: openai:text-embedding-3-large (1536d)
- chat/expansion: openai:gpt-5.2
- Config file: `~/.gbrain/config.json` (mode 0600)
- MCP registered: yes (user scope, `gbrain serve` via `~/.bun/bin/gbrain`)
- Artifacts repo: https://github.com/adamtasteslikegood/gstack-artifacts-adam
- Artifacts sync: full (federated source `gstack-artifacts-adam`)
- Transcript ingest: incremental (initial bulk of 24 files done 2026-07-04)
- Current repo policy: read-write (code imported: 134 pages, 831 chunks, embedded)
- Trust policy: personal
- Rollback backup: old 0.18.x brain (252 pages, last write 2026-05-07)
  preserved untouched in the `railway` database on the same Railway server

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
