# SPEC-01 — Cookbook CI Quality Gates Refresh

**Repository:** `adamtasteslikegood/tasteslikegoodtheangularsvegancookbook` (the
Angular + Express frontend/proxy repo; `Backend/` is a submodule with its own,
already-refreshed CI)
**Status:** Proposal
**Date:** 2026-07-15
**Companion docs:** [PLAN](PLAN.md) · [SPEC-02 AI & deploy workflows](SPEC-02-ai-and-deploy-workflows.md) · [TODO](TODO.md) · [PROMPT.md](PROMPT.md)
**Sibling precedent:** the Backend repo's `docs/ci/refresh/` (this doc set mirrors it for the cookbook side).

---

## 1. Problem statement

The Backend submodule just completed a full CI/CD refresh. The cookbook (parent)
repo never got the equivalent. Unlike the Backend — whose tree had *rotted*
(Black/Flake8/mypy/pytest all failing) — the cookbook's **code is green**. Its
problem is enforcement, redundancy, and one real coverage gap:

1. **No branch is protected — the gates are theater.** `pr-gate.yml` builds an
   aggregate `Gate — all checks passed` job whose header comment says it is "the
   single required check (configure in GitHub branch protection)" and cites
   KAN-26/27/33. But:

   ```
   $ gh api .../branches/dev/protection   → 404 Branch not protected
   $ gh api .../branches/main/protection  → 404 Branch not protected
   ```

   Nothing is required. Every PR — including Dependabot auto-merges, which
   `dependabot-automerge.yml` approves and enables auto-merge on — can land with
   zero passing checks. `CLAUDE.md` says "Never commit directly to `main` or
   `dev`," but nothing *enforces* it.

2. **Three workflows run the same checks on every PR.** `ci.yml` (build, lint,
   test, type-check), `pr-gate.yml` (frontend lint/type/build/test + backend
   pytest + changelog + gate), and `ci-cd.yml` (lint + vitest) all trigger on
   PRs into `dev`/`main` and all run `npm ci` + lint + test. That is ~3× the
   runner minutes and makes it ambiguous which workflow is authoritative.

3. **`ci-cd-backend.yml` never runs on `dev`.** Its `pull_request` trigger is
   `branches: [main]` only, so the backend pytest it provides never fires on the
   `dev` PRs where all feature work lands. `pr-gate.yml`'s `backend-test` job
   already covers `dev` — making `ci-cd-backend.yml` redundant *and* narrower.

4. **CI never builds the production Docker images.** The frontend `build` job
   runs `ng build` + server `tsc`, but nothing builds the Express or Flask
   *Docker images*. The v0.3.4 release tag burned in production on an Express
   `Dockerfile` `NODE_OPTIONS`/`ENV` syntax bug (fixed in `4e5582c`,
   "repairs v0.3.4 deploy") — a class of failure no current CI job can catch,
   because image build only happens at deploy time in Cloud Build.

### Measured baseline (cookbook `dev` @ 2026-07-15)

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | ✅ pass |
| Format | `npm run format:check` | ✅ pass |
| Types | `npm run type-check` | ✅ pass |
| Test | `npm run test:ci` | ✅ pass (coverage thresholds met) |
| Build | `npm run build` | ✅ pass |
| Docker image build | *(none — not in CI)* | ⚠️ untested until deploy |
| Branch protection | `gh api .../protection` | ❌ 404 on `dev` and `main` |

The tree is green. **There is no rot to fix — the work is to make the working
gates required, stop running them three times, and add the one missing gate
(Docker build).**

## 2. Goals

- Exactly one authoritative **blocking** PR gate, required on `dev` and `main`.
- The Docker image build that prod actually runs is validated in CI, so a broken
  `Dockerfile`/`requirements.txt`/`package-lock.json` is caught before a release
  tag deploys it.
- Redundant CI is removed (one `npm ci` + lint + test per PR, not three).
- AI/agentic and deploy workflows stay advisory and never enter required checks
  (see SPEC-02).

### Non-goals

- The production deploy pipeline. Deploys are owned by Cloud Build via the
  GCP-side tag-push trigger (`^v[0-9]+\.[0-9]+\.[0-9]+$`) and `release.yml`; this
  spec adds *build validation*, not a deploy.
- Backend (`Backend/` submodule) internal CI — already refreshed in its own
  `docs/ci/refresh/`. Here we only run the backend's pytest as one gate job.
- Rewriting the gh-aw agentic workflows.

## 3. Current vs target

See the rendered Mermaid in
[diagram-current-state.md](diagram-current-state.md) and
[diagram-target-pipeline.md](diagram-target-pipeline.md), and the full
classification in [diagram-workflow-map.md](diagram-workflow-map.md).

## 4. Design

### 4.1 Consolidate to one blocking gate (`pr-gate.yml`)

`pr-gate.yml` is already the right shape: per-concern jobs feeding one aggregate
`gate` job (`needs: [...]`, `if: always()`, fails if any dependency is not
`success`/`skipped`). Branch protection then requires a **single** context —
`Gate — all checks passed` — and new jobs can be added under it without touching
protection settings. Keep it as the authoritative gate.

Then remove the duplication:

- **`ci-cd-backend.yml` → delete.** Redundant with pr-gate's `backend-test`, and
  it never runs on `dev` anyway.
- **`ci-cd.yml` → delete.** Its `install` + `lint`/`vitest` is a strict subset of
  pr-gate's frontend jobs.
- **`ci.yml` → trim or delete.** Its PR-time `build`/`lint`/`test`/`type-check`
  duplicate pr-gate. Its only non-duplicate value is the **push-time** Prettier
  auto-commit `format` job (`if: github.event_name == 'push'`). Options
  (see §7 Open decisions): keep a slimmed `ci.yml` with just that push-only
  format job, or drop it in favor of the existing `run-prettier-...-reviewdog.yml`
  advisory review and let `format:check` in the gate enforce formatting.

### 4.2 Add a Docker-build gate (the one genuinely new check)

Add a `docker-build` job to `pr-gate.yml` that builds the production Express
image (`docker build -f Dockerfile .`, no push, no credentials). This catches
Dockerfile / lockfile / build-arg breakage — exactly the v0.3.4 failure mode —
before a release tag hands it to Cloud Build. Optionally also build the Flask
image (`Backend/Dockerfile`) for full parity; start with Express (where v0.3.4
broke) and add Flask if the added runner time is acceptable.

The job is added under the `gate` aggregate, so it becomes required automatically
once `Gate — all checks passed` is required — no new protection context.

### 4.3 Branch protection (the actual gate) — **escalate first**

After §4.1/§4.2 land and the gate is green on `dev`, configure protection on
**`dev`** and **`main`** (Settings → Branches, or `gh api`). Required status
checks — exact context names as emitted:

- `Gate — all checks passed` (from `pr-gate.yml` — the aggregate)
- `Analyze (javascript-typescript)` (from `codeql-analysis.yml` — this is the
  **per-language matrix job name**, *not* the workflow name `CodeQL`; requiring
  `CodeQL` would block every PR forever on a context that never reports)
- `Dependency Review` (from `dependency-review.yml`) — optional; include if we
  want license/vuln review to be blocking

Do **not** add to required checks: `junie-review` (Code Review),
`run-prettier-...-reviewdog`, `gc-build-deploy` (Google Cloud Build Gate), or any
gh-aw workflow — they are advisory/deploy/agentic (SPEC-02).

Settings:

- Require a PR before merging: **on**.
- Require branches up to date before merging (`strict`): **off** initially
  (Dependabot volume makes strict painful; add a merge queue later if needed).
- `enforce_admins`: leave **off** so admins retain a break-glass path, but keep
  it audited (matches the release-flow note that `main` ruleset edits need
  `--admin`).

Dependabot auto-merge then only completes when required checks pass — restoring
the safety `dependabot-automerge.yml` currently only pretends to have.

### 4.4 Housekeeping (low priority, bundle or defer)

- **Pin Node once.** Every workflow hardcodes `node-version: '26'` and
  `package.json` has no `engines` field. Add `"engines": { "node": ">=26" }` and
  consider a repo-level `.nvmrc` / a reusable workflow so the version lives in one
  place. Drift risk only, not a live break.
- **Scope `gc-build-deploy.yml`.** It triggers on push to `**` *and* all PRs with
  `id-token: write` + `contents: write` + `issues: write`, then gates internally
  via a `detect-trigger` job. Verify it is not silently double-deploying alongside
  the Cloud Build tag trigger, and narrow its triggers if it is only meant to fire
  on specific tags/branches. Treat any change to its deploy behavior as an
  escalation (SPEC-02 §3).

## 5. Acceptance criteria

1. A trivial PR into `dev` shows the `Gate — all checks passed` context, and it
   depends on frontend lint/type/build/test, backend pytest, changelog, and the
   new `docker-build` job.
2. `npm run lint && npm run format:check && npm run type-check && npm run test:ci && npm run build`
   all exit 0 on `dev` (they already do — keep them green).
3. `docker build -f Dockerfile .` succeeds in CI on a normal PR, and fails a
   scratch PR with a deliberately broken `Dockerfile` (tested once, reverted).
4. `gh api .../branches/dev/protection --jq '.required_status_checks.contexts'`
   returns exactly the contexts in §4.3 — no more, no fewer. Same for `main`.
5. Only one workflow runs `npm ci` + lint + test on a PR (no triple-run).
6. A PR with a deliberately failing test cannot be merged (verified once,
   reverted). Dependabot PRs merge only after the gate passes.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Deleting `ci.yml`/`ci-cd.yml` drops a check something references by name | Grep for referenced check names in branch rules/README before deleting; the gate context name is stable |
| Docker-build job adds runner time on every PR | Express-only to start; use build cache / `docker/build-push-action` with `load: false`; skip on docs-only via in-job path filter |
| Requiring `strict` (up-to-date) stalls Dependabot | Keep `strict: off` initially |
| `gc-build-deploy.yml` is load-bearing and scoping it breaks deploys | Do not change its deploy behavior without escalation; §4.4 is verify-first |
| Required checks block an urgent hotfix | Admin break-glass (`enforce_admins: off`), audited |

## 7. Open decisions (Q/A — resolve before Phase 1)

These are the choices a human (or the grill step of the devex skill) should lock
before the harness runs. Recommended answer in **bold**.

1. **`ci.yml` fate:** (a) **trim to the push-only Prettier auto-commit job**,
   (b) delete entirely and rely on `format:check` in the gate +
   `run-prettier-...-reviewdog.yml`. → Recommend **(a)** to preserve the
   auto-format-on-push convenience; revisit if it races the reviewdog job.
2. **Docker gate scope:** **Express image only** to start, or Express + Flask
   parity. → Recommend **Express-only** (that is where v0.3.4 broke); add Flask
   if runner time allows.
3. **Is `Dependency Review` a required check** or advisory? → Recommend
   **required** (license + high-severity vuln gate is cheap and high-value).
4. **`gc-build-deploy.yml`:** keep as-is (advisory, self-gated) or narrow its
   `push: ['**']` trigger? → Recommend **verify first, then narrow** only if it
   is double-deploying; escalate any deploy-behavior change.
