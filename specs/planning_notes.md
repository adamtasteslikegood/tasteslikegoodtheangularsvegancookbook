# Planning Session Review & Notes: v0.2 Anti-Recipe Site

_Date:_ 2026-04-18
_Participants:_ Adam Schoen, Gemini CLI (plan-ceo-review, plan-eng-review, plan-design-review)

## 1. Executive Summary & CEO Roadmap Decisions

The project successfully completed a CEO-level roadmap review transitioning from a single-user authenticated app (v0.1) to an **SEO-driven public distribution platform (v0.2 Anti-Recipe Site)**.

### Strategic Priorities (v0.2):

- **Zero-Fluff Distribution:** Public SSR recipes with high performance (<500ms).
- **SEO:** Schema.org JSON-LD implementation and canonical URL structure (`/r/<slug>`).
- **Conversion:** "Save to your cookbook" CTAs utilizing the SPA guest session flow.
- **Deferred Scope (v0.3+):** Rate limits, moderation flows, social sharing, and pantry-aware meal planners are out of scope for v0.2 to focus strictly on distribution.

## 2. Engineering Review Action Items

The execution plan (`plan.md`) was reviewed against the "Boil the Lake" completeness principle.
Key architectural adjustments identified:

- **Database:** A robust retry loop catching `IntegrityError` should be implemented during slug generation to prevent concurrent race conditions on publish.
- **Alembic Migration:** A dedicated unit test for the backfill migration is necessary.
- **Code Quality:** A `RecipePresenter` service will be established to isolate SEO JSON-LD transformation from the route controller.
- **Performance:** Eager loading (`joinedload`) must be used on the `/browse` route to prevent N+1 query lag.

## 3. Design Review Specifications

A comprehensive UI/UX review produced the following foundational anti-AI slop design tokens to define the v0.2 aesthetic:

- **Typography:** Playfair Display (headings), Monospaced font (ingredients/steps) for a terminal/typewriter feel.
- **Borders & Colors:** Stark black (`#000`), true white (`#FFF`), `1px solid #000` borders, `0px` border-radius, and **no drop shadows**.
- **Spacing:** Aggressive margins (`rem(4)`).
- **Interaction States:** Clear UI states (Loading, Empty, Error, Success) were defined for the `/browse` view and publish toggles.
- **Responsive/A11y:** Mobile collapsing at `768px` and `44px` minimum touch targets for all CTAs.

## Next Steps

All artifacts (`roadmap.md`, `plan.md`, test plans) have been documented. The next technical phase is implementing the Alembic data migrations and backend SSR proxy routing on the `feat/v0.2-public-recipes` branch.

**Immediate Bug Fix (Added 2026-04-20):**

- **Authentication UI Mismatch (KAN-60):** The website currently shows all recipes as if the user is logged in (when returning in a previously authenticated browser), but the login button incorrectly renders in a logged-out state. This needs to be addressed immediately.

## Post-Launch Findings (v0.2.0 → v0.2.5)

_Date:_ 2026-05-06

Six releases shipped between 2026-04-29 and 2026-05-06. Most were corrective. Capturing what we learned so the next phase (`/plan-eng-review` for v0.3) starts from a clean baseline.

### Incidents

1. **Migrations-not-running outage (v0.2.0/v0.2.1).** The Anti-Recipe Site shipped schema changes (`recipe.is_public`, `recipe.slug`, `recipe.status`) without any mechanism to run `flask db upgrade` against Cloud SQL. The new Flask revisions deployed against a stale schema and 500'd on every authenticated request. Resolved in v0.2.2 by introducing a `flask-backend-migrate` Cloud Run Job, wired into `cloudbuild.yaml` between Flask image push and Flask service deploy. v0.2.3 fixed a follow-on issue where the Job container didn't have the Cloud SQL Unix socket mounted.
   - **Lesson:** Schema-changing PRs are not safe to ship until the migrate Job has been verified end-to-end. CLAUDE.md now codifies this in the "Database migrations" section.
2. **`is_public` flag never flipped the DB column (v0.2.0–v0.2.3).** The Angular UI's publish toggle wrote `is_public` to localStorage and the recipe payload, but `Backend/blueprints/recipes_api_bp.py:create_recipe()` never copied the field into the SQLAlchemy column the `/browse` query filtered on. Public recipes simply never appeared. Fixed in v0.2.4 (Backend issue #118).
   - **Lesson:** Round-trip tests for new columns — write through the API, query through the public path, assert the row.
3. **OAuth scope-bundling 500 for returning users (v0.2.5).** An earlier deploy briefly requested `cloud-platform`; Google retained that grant on those accounts and bundled it back into subsequent token responses. `oauthlib.validate_token_parameters` raised on the scope-set mismatch and the callback returned `{"error":"Authentication failed"}`. Two-part fix in Backend PR #128: drop `include_granted_scopes=true` from the auth URL, and set `OAUTHLIB_RELAX_TOKEN_SCOPE=1` as defense-in-depth.
   - **Lesson:** Removing an OAuth scope is not a clean deploy — Google keeps the grant. Either keep the scope's superset, or relax `oauthlib`'s scope validation. Document scope changes as "permanent" decisions; don't rely on rolling them back.

### Known regressions / open

- **Public-page SSR formatting.** Adam's review of v0.2.5 in production: "the UI for the public pages is either gone or not routing through the code. The Jinja-Flask templates for the `tasteslikegood.com` repo were better-formatted than the current SSR." Captured as a P1 open item in `roadmap.md` under "v0.3 Priorities". Needs to be triaged with `/plan-eng-review` and `/plan-design-review` before any new feature work begins.
- **Legacy `is_public` recipes won't surface until re-toggled.** Acceptable for now (single-user profile by design); a one-shot SQL backfill is available if the user list grows.

### Process notes

- `dev → main` PR flow held up well across six releases. The branch model is documented in `CLAUDE.md` and is being honored.
- The `release.yml` workflow plus the GCP-side tag-push Cloud Build trigger fire reliably; total release time from `dev → main` merge to production is ~8 minutes (incl. migrate Job).
- `specs/` move (v0.2.4) was clean; `pm-daemon` watcher matches by basename so it didn't need code changes.
- gbrain MCP server is configured but is **not** capturing release/incident memory for this project. Treat as "wired but unused" until v0.3 decides what's worth recording and how.

## v-tlg-brain Initiative (planned, not yet wired)

_Captured 2026-05-06_

The PM/Atlassian-sync stack already has the right shape but isn't running end-to-end. Goal: turn it into a **versioned external mirror** of the project's `specs/*.md` files in Confluence — independent of git history, continuously updated by a background daemon, so any agent or human session can resume with full context without re-reading the repo from scratch.

### Current state

- **`scripts/pm/atlassian_pm_link.py`** — stdlib-only briefing generator. Reads `specs/{plan,roadmap,planning_notes,design-plan}.md` + Jira + Confluence and emits `.agent-work/pm/PROJECT_PM_BRIEFING.md`. Works today; needs to be on the agent-handoff path.
- **`scripts/pm/sync_jira_confluence_status.py`** — release-time syncer. Reads version from `package.json`, fetches Jira/Confluence/PR status for that version. Works today; should be invoked by the release flow.
- **`scripts/pm/run_pm_daemon.sh`** + **`alirez-claude-skills/pm-daemon/pm_daemon.py`** — FastMCP server + watchdog observer. Watches `specs/*.md` and is _intended_ to push updates to Confluence on save. Auto-spawned from `.mcp.json` per CLAUDE.md, but the actual sync path is incomplete (or silently no-oping when Atlassian creds aren't loaded).

### Target architecture

```
specs/*.md  ──[watchdog on save]──►  pm-daemon  ──[flash/mini assistant]──►  Confluence (versioned)
                                        ▲
                                        │  (also serves FastMCP tools to agents over stdio)
                                        │
                                  any agent session
```

Key design decisions to make:

1. **Token-cost optimization** — the daemon should not invoke a frontier model on every save. The user's plan: route Confluence-sync rendering through a Flash/Mini assistant (e.g., `claude-haiku-4-5-20251001` or Gemini Flash) so background syncs cost ~10× less than the agent doing the actual work.
2. **Versioning** — Confluence's native page-version history is acceptable for v1; a richer diff view (e.g., embedded git-style blame) is v2.
3. **Direction** — one-way (`specs/` → Confluence) for now. Two-way would create merge conflicts the daemon can't resolve.
4. **Independence from git history** — the user explicitly does not want the daemon entangled with `git log`/commits. Confluence is a parallel persistence layer, not a derivative one.

### Known gaps before v-tlg-brain is "working properly"

- pm-daemon's Confluence write path is unverified. Watchdog detects saves; the next step is confirming pages actually update and that idempotency is correct.
- Flash/mini assistant indirection is a design idea, not implemented. Currently the daemon would either no-op (no creds) or call the agent's main model.
- No integration test. We need a fixture-driven check that "save `specs/roadmap.md` → Confluence page reflects the update within N seconds" before declaring this real.
- No connection between the daemon and gbrain. Whether v-tlg-brain and gbrain converge or stay separate is an open question (gbrain is currently project-agnostic and largely empty for this repo).

### Proposed next steps (do not start without prioritization)

1. **End-to-end smoke test** — wire the daemon to a sandbox Confluence space, save `specs/roadmap.md`, confirm the page updates. If yes, the bones are sound; if no, decide build vs buy (e.g., GitHub Actions Confluence sync action).
2. **Flash/mini swap** — once the path works, route the rendering step through a cheaper model. Measure cost-per-save before and after.
3. **Wire to release flow** — call `sync_jira_confluence_status.py` from a Cloud Build step or post-merge hook so the v0.X.Y release page in Confluence is always current.
4. **Decide v-tlg-brain vs gbrain** — either consolidate (gbrain becomes the back-end of v-tlg-brain) or stay separate (v-tlg-brain is project-scoped, gbrain is cross-project). Pick one before investing more.
