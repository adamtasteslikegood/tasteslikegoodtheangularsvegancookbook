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

### Planning a sprint? Read the Confluence retro FIRST (not the repo close-out)

**Applies to: chartering or planning any sprint, `/cs:grill-pm`, and any charter or plan document.**

A sprint's retrospective lives in **two** places with **different content**, and the one an agent
naturally finds is the incomplete one:

| Artifact          | Where                                                                               | What it has                                                                                |
| ----------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Close-out         | `specs/SPRINT_<N>_PLAN.md` → `## Close-out`                                         | What shipped, what rolled, gate results                                                    |
| **Retrospective** | **Confluence space `TLG`** → "Sprint Close Retrospectives" (parent page `50298881`) | 4Ls, decisions, and an **"Actions for Next Sprint" table that exists nowhere in the repo** |

Working from a checkout you only ever see the close-out. Chartering Sprint 5 that way **missed two
actions the retro had assigned to Sprint 5** — wiring `check_sprint_lane.sh` into `pr-gate.yml`, and
retitling RCP-55. Neither appears in the close-out's own "Carried to Sprint 5" list.

**Do this before drafting any charter:**

```
searchConfluenceUsingCql: text ~ "retrospective" AND type = page ORDER BY lastmodified DESC
```

Then walk the retro's **actions table row by row** against your proposed scope and state, explicitly,
which actions are _not_ committed and why. Treat that table as a **required input, not a summary** of
the close-out. Scope remains Adam's call — surface the gap, never self-authorize the addition.

Note the sync is one-way: `specs/SPRINT_*_PLAN.md` publishes repo → Confluence via the glob in
`scripts/pm/_canonical_pm_files.py`, but the retro is authored **in Confluence** and never lands in
the repo. Since Sprint 4 these pages are generated by a Jira/Atlassian automation from a custom
template, so expect the structure to be consistent across sprints.

## Project

**Vegangenius Chef** — vegan recipe generator and personal cookbook app. Users generate recipes via Google Gemini, get AI food photos via Imagen, and manage cookbooks. Auth via Google OAuth or guest (localStorage).

- **Production:** `https://www.tasteslikegood.org` (canonical host; apex `tasteslikegood.org` 301-redirects to `www`)
- **Version:** See `package.json` `version` field (currently v0.4.2)
- **Other agents:** See @AGENTS.md for OpenCode / non-Claude agent instructions (kept in sync with core sections here)

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
- **Angular Router** with flat route config (`src/app.routes.ts`): `/` (Generator, eager), `/kitchen` (lazy), `/recipe/:id` (lazy)
- `PreloadAllModules` for background chunk fetching; build produces 3+ chunks
- `ssrEntryGuard` on root route handles `?save=<slug>`, `?auth=success`, `#kitchen` redirects
- Services: `GeminiService` (recipe + image), `AuthService` (OAuth + guest), `PersistenceService` (localStorage-first), `RecipeStateService` (shared recipe state facade), `ToastService` (signal-based toast queue), `ModalService` (cross-component modal coordination), `SsrEntryService` (SSR entry side effects)
- Component tree:
  - `AppComponent` (75 lines — composition root: router-outlet + header + footer + modals + toast)
  - `components/header/` — nav links derived from `Router.url`, auth status
  - `components/footer/` — static footer
  - `components/generator/` — recipe generation (default route, eager)
  - `components/kitchen/` — cookbook management (lazy loaded)
  - `components/recipe-detail/` — recipe detail with cold deep link fetch fallback (lazy loaded)
  - `components/shared/save-toast` — subscribes to ToastService
  - `modals/{auth,create-cookbook,manual-entry,add-to-cookbook}/` — self-contained modal components
- Guards: `guards/ssr-entry.guard.ts` — functional `CanActivateFn` for SSR CTA save/auth/hash redirects
- Utils: `utils/slug.ts` (slug generation), `utils/public-link.ts` (public recipe URL), `utils/in-app-browser.ts` (webview detection)
- Type definitions: `recipe.types.ts`, `auth.types.ts`
- Dev server port 3000; `proxy.conf.json` maps `/api` → Flask :5000
- Entry: `index.tsx` (tsconfig uses `jsx: react-jsx`, hence `.tsx`)

### Public SSR surface (Flask-rendered, proxied through Express)

Express proxies a set of public routes to Flask for server-side rendering **before** the Angular SPA catch-all, so crawlers receive fully rendered HTML instead of an empty shell:

- `/r/<slug>` — individual public recipe page (Schema.org JSON-LD, OG tags, canonical URL)
- `/browse` — paginated public recipe index (`/browse/` with trailing slash 301-redirects to `/browse`)
- `/sitemap.xml` — auto-generated sitemap
- `/static/*` — Flask static assets (CSS tokens, fonts) for SSR templates

These routes are GET-only and share the same rate limiter as the SPA shell. The SSR templates live in `Backend/templates/public/` and use a separate base template (`base_public.html`) from the legacy dev-only Flask UI.

### Layer 2 — Express reverse proxy (`server/`)

- `server/index.ts` — startup, graceful shutdown (drains HTTP, closes Valkey)
- `server/proxy.ts` — `createFlaskProxy()`, raw streaming to Flask
- `server/security.ts` — Helmet, rate limiting (300 req/15 min general, 20 req/hr AI), request logger
- `server/valkey.ts` — Valkey (Redis alternative) client for distributed rate limiting; falls back to in-memory
- `server/validation.ts` — express-validator rules for the AI endpoints (`POST /api/generate`, `POST /api/generate_image`): buffers the JSON body (10kb cap), validates it, and stashes the raw bytes on `req.rawBody` for the proxy to replay to Flask verbatim; all other `/api/*` routes keep raw streaming
- No AI logic lives here; it's purely proxy + static hosting

### Layer 3 — Flask API (`Backend/`)

Modular blueprint architecture — `Backend/CLAUDE.md` is the authoritative reference for Backend details:

- `auth.py` + `blueprints/auth_api_bp.py` — Google OAuth 2.0 flow, sessions
- `blueprints/generation_api_bp.py` — `/api/generate` (Gemini text), `/api/generate_image` (Imagen); `generation_bp.py` is legacy HTML-form helpers
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

- Gemini credentials: Flask's `get_genai_client(session_credentials)` prefers caller-supplied user OAuth credentials and falls back to the server `GOOGLE_API_KEY` — but both live generation call sites pass `None`, so generation runs on the server key; only the model-list refresh (`POST /api/models/refresh`) forwards session OAuth credentials
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

Since 2026-07-18 this is enforced by branch protection: `dev` and `main` both carry required status checks `Gate — all checks passed` (the pr-gate aggregate, which includes the Express Docker image build), `Analyze (javascript-typescript)`, and `Dependency Review` (strict off, 0 approvals, admin break-glass audited; SPEC-01 §4.3, `docs/ci/refresh/`).

To ship a Backend change:

1. PR into Backend `dev` (in `Backend/` submodule).
2. Promote Backend `dev` → `main`, then back-sync `main` → `dev`. No build fires on either — only the cookbook tag push reaches Cloud Build.
3. In this repo, pin **Backend `main`'s own SHA** and commit that pointer in a cookbook PR off `dev`; then `dev` → `main`, which tags and releases.

```bash
git -C Backend fetch origin --prune
git -C Backend checkout origin/main   # main's tip, NOT --remote
git add Backend
```

**Do not use `git submodule update --remote Backend` to bump the release pointer.** `.gitmodules` tracks `dev`, so `--remote` resolves to Backend **`dev`**'s tip, and `scripts/release/train-verify.sh` Station 3 requires **`main`**'s tip. They can never agree: each promotion + back-sync cycle creates two distinct merge commits (`main = merge(old_main, dev)`, `dev = merge(dev, main)`), so `dev`'s tip is structurally never `main`'s tip again. This instruction previously said `--remote` and produced a Station 3 block every release — v0.3.9 shipped that way and v0.4.8 nearly did (KAN-191). Trees are identical either way, so this is not about what runs in production; it is about "which Backend commit is in production?" being answerable from one ref.

There is no path that ships Backend code without a corresponding cookbook PR — production deploys whatever SHA the cookbook submodule pins at the moment of the release tag.

**The full ordered procedure is `scripts/release/RUNBOOK.md`**, driven interactively by `scripts/release/train-run.sh`. Follow it rather than reconstructing the order from memory; the traps it documents each cost a real release.

## Commit and push cadence

On feature branches, commit and push after every significant work-run so work is recoverable from the remote if the VM/session dies. Stage only intentional files, keep commits scoped, and push immediately after each local commit unless the user explicitly says not to.

## Pull request lifecycle

Opening a PR is not the end of the task. Every PR you author, or are actively working on or waiting on, is yours until it merges — this applies by default, without being asked:

- **Jira key in the title (REQUIRED).** Every PR title — in this repo AND in `Backend/` — must contain the Jira issue key (`KAN-###` or `RCP-###`), e.g. `feat(seo): SSR crawlable links on home shell (TAS-2896) [KAN-114]`. Jira's GitHub integration links PRs/branches/commits to an issue by scanning for the key in the PR title; a Linear `TAS-####` key alone does NOT create the Jira link (Linear↔Jira sync maps issues to issues, not GitHub attachments — Jira depends on this key-in-title convention). Put the key in the branch name and commit messages too where practical, same scanner. Forgot it? Edit the PR title after the fact — Jira picks it up within ~2 minutes (verified on #3185, 2026-07-20). If no Jira issue exists for the work, that's the smell: file one first.
- **Monitor it.** While the PR is open, check for new review comments, inline comments, and failing checks (`gh pr view <n> --comments`, `gh api repos/{owner}/{repo}/pulls/<n>/comments`, `gh pr checks <n>`). Re-check whenever you return to the PR and before declaring any related work done — a PR with unaddressed feedback is not finished.
- **Answer every comment.** For each piece of reviewer feedback, do one of two things: push a fix commit and reply confirming what changed, or reply with a concrete technical rebuttal explaining why no change is needed. Never leave feedback unanswered or silently ignored. When you receive review feedback on a PR you own, you MUST invoke the `superpowers:receiving-code-review` skill BEFORE responding — verify each claim against the code first, so replies are grounded in the code rather than performative agreement (the superpowers plugin is enabled in `.claude/settings.json`). A non-blocking PreToolUse hook (`.claude/hooks/pretooluse-pr-review-nudge.sh`) reinforces this by reminding you right before you post a PR reply, but the skill invocation is on you — the hook is a backstop, not the gate.
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

## CI pipeline

PR gate (`.github/workflows/pr-gate.yml`) runs on every PR to `main`, `dev`, or `dev/**`. All jobs must pass — the `gate` aggregator is the single required status check:

| Job                                | What it checks                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Frontend — lint + format`         | ESLint + Prettier (`npm run lint`, `npm run format:check`)                                                                                       |
| `Frontend — TypeScript`            | `tsc --noEmit` on both tsconfigs                                                                                                                 |
| `Frontend — build`                 | Full `npm run build` (Angular + server TS)                                                                                                       |
| `Frontend — unit tests + coverage` | Vitest (`npm test`) over `server/**` and `src/**`, with `server/**/*.ts` coverage thresholds: lines/stmts ≥ 60%, branches ≥ 50%, functions ≥ 40% |
| `Backend — pytest`                 | `uv run pytest` inside `Backend/`                                                                                                                |
| `Docker — Express image build`     | Builds the production Express Docker image                                                                                                       |
| `CHANGELOG entry for this version` | Verifies `CHANGELOG.md` has a `## [<version>]` (or `## <version>`) section matching `package.json`                                               |
| `SEO — canonical recipes`          | Runs `scripts/seo/check_canonical_recipes.sh`                                                                                                    |
| `Gate — all checks passed`         | Aggregator — this is the required status check in branch protection                                                                              |

Additional required checks (separate workflows): `Analyze (javascript-typescript)` (CodeQL), `Dependency Review`.

Other workflows: `ci.yml` (push-only Prettier auto-commit safety net), `release.yml` (tag + GitHub Release on `main`), `claude-review.yml` / `junie-review.yml` (AI code review on PRs).

## Testing

- **Express/server + Angular units:** Vitest (`npm test`). `vitest.config.ts` includes `server/**/*.{test,spec}.ts` AND `src/**/*.{test,spec}.ts`, so **both** `*.test.ts` and `*.spec.ts` under `src/` run in the same suite — 9 files today, and `.test.ts` is the majority spelling (only `src/utils/public-link.spec.ts` and `src/services/gemini.service.spec.ts` use `.spec.ts`). Either extension works; don't assume `.test.ts` under `src/` is excluded. Coverage thresholds apply to `server/**/*.ts` only and `src/**` coverage is not gated — and note `vitest.config.ts` further excludes `server/index.ts`, `server/proxy.ts`, and `server/types.ts` from the coverage denominator, so the 60% line/statement gate does not cover all of `server/`.
- **Backend/Flask:** pytest (`cd Backend && uv run pytest`). Tests in `Backend/tests/`.
- **Angular components/E2E:** No component or browser-driven test harness (Karma/Jest/Playwright) is wired up. UI changes still need to be verified by running the dev server and testing in the browser — but plain unit-level Angular logic can and should be covered via the Vitest suite above.

## Startup (agent sessions)

Project MCP servers are declared in `.mcp.json` at the repo root. When Claude Code (or any compatible agent) starts a session in this directory, it auto-spawns the servers listed there as stdio child processes. Currently registered:

- `pm-daemon` — runs `scripts/pm/run_pm_daemon.sh`, which creates the venv on first run if missing, then launches `scripts/pm/pm_daemon.py`. The daemon does two things in one process: serves the FastMCP tools (`get_project_status`, `sync_pm_documents`, `refresh_project_briefing`, `create_epic_from_roadmap`, `log_agent_session`) over stdio for the agent, and runs a `watchdog` Observer in the background that syncs the canonical PM files to Confluence on save. That set — the curated `specs/plan.md`, `roadmap.md`, `planning_notes.md`, `design-plan.md`, `SCRUM_BOOTSTRAP_AND_BOARD_PLAN.md`, `SPRINT_0_PLAN.md`, `ATLASSIAN_PM_LINK.md`, **plus a `specs/SPRINT_*_PLAN.md` glob** — is defined once in `scripts/pm/_canonical_pm_files.py` and imported by both the daemon and the SessionStart briefing hook. Never re-add a hardcoded list to either: KAN-187 was exactly that, and it silently kept four sprint plans out of Confluence while syncing an empty `SPRINT_0` stub. Other `specs/*.md` (`ux-backlog.md`, `KAN-119_LOOP_PLAN.md`, `CANONICAL_RECIPES_ROLLOUT.md`) are deliberately not synced.

- `gcp-monitor` — runs `scripts/monitoring/run_gcp_monitor.sh`, which creates its venv on first run, then launches `scripts/monitoring/gcp_mcp_server.py`. Exposes read-only Cloud Monitoring tools (`check_system_health`, `list_available_metrics`, `query_metric`) covering the production stack (Cloud Run frontend/backend, Cloud SQL, Valkey, Pub/Sub). Requires `GOOGLE_APPLICATION_CREDENTIALS` (+ optional `GCP_PROJECT_ID`) in `.env`; without them the tools register but return a credential error instead of metrics. The `/system-health-check` skill (`.claude/skills/system-health-check/`) drives the full SRE health-report routine. Setup: `docs/MCP_GCP_MONITORING.md`.

  `gcp-monitor` is available in cloud sessions as a first-class MCP connector. Streamable HTTP deployment (`MCP_TRANSPORT=http`) remains documented for connector hosting and setup details (see `docs/MCP_GCP_MONITORING.md` § 4.5).

Requirements for `pm-daemon` to actually sync:

- `.env` (project root) must contain `ATLASSIAN_EMAIL` and `ATLASSIAN_API_TOKEN`. Without them the MCP tools register but Confluence sync logs `WARNING: Atlassian credentials missing` and no-ops.
- `ATLASSIAN_URL` must be `tasteslikegood.atlassian.net` — the only Atlassian site for work items. `scripts/pm/_atlassian_guard.py` enforces this allowlist across all `scripts/pm/` tooling and restricts Jira writes to the `KAN` and `RCP` projects (read-only rollups/briefings may also include `PLZG`/`TO`); any other site (including the `tasteslikegood-dev.atlassian.net` service shell) or project key raises a loud error instead of proceeding.
- `python3 -m venv` must work (Debian/Ubuntu: `sudo apt install python3.12-venv`).

### Driving the PM tooling

```bash
npm run pm:start             # verify connectivity + build local briefing
npm run pm:brief             # refresh local PM context
npm run pm:sync              # publish non-destructive briefing update to Confluence
npm run pm:status            # inspect live Jira + PR + Confluence + prod status
npm run pm:daemon            # start the PM daemon in background on this VM
npm run pm:daemon:status     # check if the daemon is alive
npm run pm:daemon:logs       # tail daemon logs
npm run pm:daemon:stop       # stop the background daemon
npm run pm:daemon:foreground # foreground mode for debugging
```

`scripts/pm/sync_jira_confluence_status.py` backs `pm:status` — live Jira issues (KAN + RCP), open GitHub PRs, Confluence page info, and a production health check. Deps: `bash scripts/pm/run_pm_script.sh sync_jira_confluence_status.py`. Env: `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`, `ATLASSIAN_URL`, `GITHUB_TOKEN`.

**Jira project keys** (all on `tasteslikegood.atlassian.net`, the only site for work items):

- **Recipe app (this repo):** `KAN` = active execution, branch/work ownership, in-flight state; `RCP` = delivery planning, epics, sprint scope, acceptance criteria. These are the ONLY projects this repo's tooling may write to.
- **Plaza game (different repo — do not touch from here):** `PLZG` (software), `TO` (business/creative); Confluence space `PLZA`.
- `tasteslikegood-dev.atlassian.net` is a service-site shell; its former `TO` project is frozen and re-keyed `TOSVC` ("SERVICE-HOLD — do not use").
- `JIRA_PROJECTS=...` overrides are validated by `scripts/pm/_atlassian_guard.py`: writes limited to `KAN,RCP`; read-only rollups/briefings may also include `PLZG,TO`. Anything else (including `TOSVC`) is refused with an error.

Set `ATLASSIAN_JIRA_PROJECT_KEY=KAN` and `ATLASSIAN_JIRA_DELIVERY_PROJECT_KEY=RCP` in `.env`. Set `PM_DAEMON_DISABLE_WATCHER=1` to opt a daemon out of watching.

To verify the daemon is running during a session: `ps -ef | grep pm_daemon | grep -v grep`. If you don't see it, your agent isn't reading `.mcp.json` — check the agent's MCP loader logs.

**Expect MANY `pm_daemon.py` processes — one per session, and that's correct.** Every agent session (each Claude Code window, each Copilot CLI, each background job, each worktree) spawns its own daemon as an MCP stdio child; they each need their own server on their own pipes. Only the **file watcher** is a singleton: the first daemon to take `.claude/pm-daemon-watcher.lock` (an exclusive `flock` in the main checkout) runs the `watchdog` Observer, and every other daemon logs `File watcher already owned by another pm_daemon (pid N); serving MCP tools only` and comes up fully functional minus the watcher. Before this lock existed, N sessions meant N observers all racing to PUT the same Confluence pages on every save (13 were seen at once). Do not "fix" the extra daemons by killing them — killing a live session's daemon breaks that session's MCP tools. See `docs/PM_TOOLING.md` § _The watcher is a singleton_.

## Non-obvious patterns

- **Rate limiter** uses Valkey for distributed state across Express replicas. GH #163/#162 (Express client edge cases under broken connections, KAN-16/KAN-17) were **fixed and closed 2026-04-15** — do not attribute new Valkey errors to them. The live Valkey concerns are Flask-side and separate: IAM token-refresh auth failures (Backend #247) and the response-cache code lost in merge `07123c2` (KAN-151)
- **AI model names** — entries from the model-list API carry the `models/` prefix (e.g., `models/gemini-3.1-pro-preview`; filter by `generateContent` in `supported_generation_methods`), while `Backend/config.py` `DEFAULT_MODEL` and the generation paths use bare IDs (`gemini-3.1-pro-preview`); both forms are in active use
- **Backend submodule** — `Backend/` is a git submodule (remote: `adamtasteslikegood/tasteslikegood.com`, tracked branch `dev`) and accounts for roughly half of the project. Before starting any backend work or shipping a release, ALWAYS check the Backend repo for open PRs and recent commits that may not yet be reflected in the parent's submodule pointer. Quick checks:
  - `gh pr list -R adamtasteslikegood/tasteslikegood.com --state open` — open Backend PRs
  - `git -C Backend fetch && git -C Backend log --oneline HEAD..origin/dev` — commits on `dev` the pointer hasn't picked up yet
  - `git -C Backend log --oneline origin/main..origin/dev` — commits on `dev` not yet promoted to Backend `main`
  - `cd Backend && uv run flask db heads` — must print exactly one line with `(head)`. Two heads = unmerged migrations, deploy will break.
  - `git -C Backend checkout origin/main && git add Backend` — pin the release pointer. **Backend `main`'s tip, not `--remote`** (which resolves to `dev` and always blocks train-verify Station 3 — see the branching section and `scripts/release/RUNBOOK.md`)
- **gbrain and the Backend submodule** — if gbrain is configured on your machine, `Backend/` is indexed as a _separate, non-federated_ source (`gstack-code-backend`), so `code-def`/`code-refs`/`search`/`query` against Backend Python need an explicit `--source gstack-code-backend` or they silently miss. Never run a bare `/sync-gbrain` from inside `Backend/`: it has no `.gbrain-source` pin, so the code stage registers the cwd as a _new_ federated source and re-indexes the whole repo alongside the existing one. The nested-path guard does not catch it (the real source lives in gbrain's managed clone dir, so there is no path overlap). Verified with `--dry-run` 2026-07-24. Re-sync with `gbrain sync --source gstack-code-backend --strategy code`.
- **CI auto-formats** — `ci.yml` is now just a push-only Prettier auto-commit safety net: PRs are already gated by `format:check` in pr-gate and direct pushes to `dev`/`main` are blocked by branch protection, so it's a near-no-op and bot format commits are rare rather than routine
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

## Behavioral Guidelines

Follow the four Karpathy principles when writing or modifying code in this project:

1. **Think Before Coding** — understand the problem fully before writing. Read existing code, check for prior art, verify assumptions.
2. **Simplicity First** — prefer the simplest solution that works. Avoid premature abstraction, speculative features, and unnecessary indirection.
3. **Surgical Changes** — make the smallest diff that solves the problem. Don't refactor surrounding code, add unrelated improvements, or "clean up while you're there."
4. **Goal-Driven Execution** — every action should move toward a verifiable success criterion. State what "done" looks like before starting.

For the full reference, see the `karpathy-check` slash command / `karpathy-coder` skill / `cs-karpathy-reviewer` agent under the **optional** `alirez-claude-skills/` submodule (not initialized by default — see the Submodules note in the "Session start" section).
