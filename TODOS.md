# TODOS

Outstanding work tracked in-tree so it survives across sessions and isn't lost in the issue queue. Each entry links to its GitHub issue (or upstream Backend issue) for discussion + resolution. Items grouped by area, then ordered by priority (P0 = blocker, P4 = nice-to-have). Move completed items to `## Completed` at the bottom with the version that closed them.

Format reference: `.claude/skills/review/TODOS-format.md` (gstack convention).

---

## CI/CD

### P1 — Verify Cloud Build trigger regex

- **Issue:** [#2898](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/2898)
- **What:** CLAUDE.md and AGENTS.md document that the production-deploy trigger MUST match `^v[0-9]+\.[0-9]+\.[0-9]+$`. `v0.2.0` and `v0.2.1` both fired green in the GCP Console, so the trigger exists. But `gcloud builds triggers list --project=comdottasteslikegood` returns `[]` — the CLI can't see it, so we can't verify the actual pattern from outside the Console.
- **Risk:** If the Console pattern is loose (e.g., `v.*`), a future tag like `v0.3.0-rc.1` would deploy unstable code to production.
- **Action:** Open Console → Cloud Build → Triggers, confirm regex matches docs, tighten if loose. Bonus: figure out why `gcloud builds triggers list` doesn't see it (likely 2nd-gen / non-default region) and document the right query in CLAUDE.md.

### P2 — Reconcile `.gcloudignore` `.git` exclusion with submodule init

- **Issue:** [#2896](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/2896)
- **What:** `cloudbuild.yaml` runs `git submodule update --init --recursive` (needs `.git` + `.gitmodules`). `.gcloudignore` excludes `.git`. Trigger-based builds work because Cloud Build clones from GitHub directly. `gcloud builds submit` from a local dir would fail.
- **Action:** Either remove the `gcloud builds submit` instructions from CLAUDE.md (they don't actually work as documented), or adjust `.gcloudignore` so local source uploads include git history.

### P3 — Solo-repo merge friction (ruleset + auto-merge)

- **Issue:** [#2895](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/2895)
- **What:** Branch ruleset on `main` requires 1 approving review. `allow_auto_merge: false` at repo level. Solo dev → every release needs `gh pr merge --admin`. v0.2.0 and v0.2.1 both shipped this way.
- **Action:** Either enable auto-merge at the repo (`gh repo edit --enable-auto-merge`) so future PRs can `--auto --admin`, or drop the review-required rule entirely (it's theatrical for solo work). Keep CI required-checks rule either way.

### P4 — Decide on `.cloudbuildignore`

- **Issue:** [#2897](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/2897)
- **What:** Original /ship request mentioned three ignore files. We shipped `.dockerignore` and `.gcloudignore`. `.cloudbuildignore` doesn't exist as a documented gcloud feature — would be an orphan file. Could symlink to `.gcloudignore` for symmetry, or leave absent.
- **Action:** Decide. Default: leave absent and close the issue as wontfix.

---

## Backend

### P2 — Pre-existing pytest failure: `test_backfill_slugs_retry_loop`

- **Issue:** [adamtasteslikegood/tasteslikegood.com#118](https://github.com/adamtasteslikegood/tasteslikegood.com/issues/118)
- **What:** `Backend/tests/test_migration_backfill_slug.py::test_backfill_slugs_retry_loop` fails with `table recipe has no column named status`. Test was added in Backend PR #116 alongside the `status`/`slug`/`is_public` columns. Has been failing on every Backend CI run since merge. v0.2.0 and v0.2.1 both shipped through this failure (admin override).
- **Hypothesis (in the issue):** the test fixture sets `SQLALCHEMY_DATABASE_URI` to `:memory:` *after* `create_app()` initializes the engine, so `db.create_all()` runs against a stale engine that was bound to a pre-existing on-disk DB without the `status` column. Compare against `tests/test_public_ssr.py` (which uses `create_all` against `:memory:` and works) to find the working pattern.
- **Action:** Land a Backend PR that fixes the fixture, then bump the Backend submodule pointer in this repo.

---

## Completed

<!-- Move items here when their issue closes. Include the version that shipped the fix. -->
