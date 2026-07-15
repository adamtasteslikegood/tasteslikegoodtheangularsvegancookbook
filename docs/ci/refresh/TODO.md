# Cookbook CI Refresh — TODO

Execution checklist for [SPEC-01](SPEC-01-ci-quality-gates.md) and
[SPEC-02](SPEC-02-ai-and-deploy-workflows.md). Each item names its **verify**
command — an item is done only when its verify passes. One PR per checkbox group
unless noted. All branches off `origin/dev`, PRs into `dev` (see repo `CLAUDE.md`
branching rules). Sync before each branch (`git fetch origin --prune`;
`gh pr list --state open`).

Baseline measured 2026-07-15 on `dev`: lint ✅ · format ✅ · type-check ✅ ·
test:ci ✅ · build ✅ · Docker image build ⚠️ not in CI · branch protection ❌
404 on `dev` and `main`. **The tree is green; the work is enforcement +
consolidation + a Docker gate, not fixing rot.**

## Phase 0 — Resolve open decisions (no code)

- [ ] Answer SPEC-01 §7 Open decisions (ci.yml fate, Docker scope, Dependency
      Review required?, gc-build-deploy scoping). Record answers in the PR
      description / a short ADR.
      — verify: each of the 4 decisions has a recorded answer

## Phase 1 — Consolidate to one blocking gate (one PR)

- [ ] Delete `ci-cd-backend.yml` (redundant with pr-gate `backend-test`; never
      runs on `dev`)
      — verify: `git grep -n ci-cd-backend` returns no live references; pr-gate
      still runs backend pytest on a scratch PR into `dev`
- [ ] Delete `ci-cd.yml` (redundant lint + vitest)
      — verify: scratch PR into `dev` shows pr-gate frontend jobs still running
- [ ] `ci.yml`: per decision, either trim to the push-only Prettier auto-commit
      `format` job (drop `build`/`lint`/`test`/`type-check`) or delete
      — verify: `actionlint .github/workflows/*.yml` clean; a PR runs lint/test
      exactly once (only pr-gate)
- [ ] Confirm `pr-gate.yml` remains the authoritative gate (aggregate `gate` job
      unchanged)
      — verify: scratch PR shows `Gate — all checks passed`

## Phase 2 — Add the Docker-build gate (one PR)

- [ ] Add a `docker-build` job to `pr-gate.yml`: `docker build -f Dockerfile .`
      (Express image, no push, no creds); wire it into the `gate` aggregate's
      `needs:`
      — verify: job green on a normal PR; then red on a scratch branch with a
      deliberately broken `Dockerfile` (test once, revert)
- [ ] (Optional, per decision) add Flask image build (`Backend/Dockerfile`)
      — verify: job green; skips cleanly if submodule checkout unavailable

## Phase 3 — Branch protection (**escalate before applying**)

- [ ] ESCALATE: get human approval for the required-check list and settings
      (SPEC-01 §4.3)
- [ ] Configure required status checks on `dev` (exact context names):
      `Gate — all checks passed`, `Analyze (javascript-typescript)`,
      and (if decided) `Dependency Review`. `strict: off`,
      `enforce_admins: off`, require-PR: on
      — verify: `gh api repos/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/branches/dev/protection --jq '.required_status_checks.contexts'`
      returns exactly that list
- [ ] Same for `main`
      — verify: same `gh api` on `main`
- [ ] Negative test: PR with a deliberately failing test cannot merge; revert
- [ ] Confirm `dependabot-automerge.yml` now waits on the gate
      — verify: next Dependabot PR only auto-merges after `gate` passes

## Phase 4 — Housekeeping (one PR, low priority)

- [ ] Add `"engines": { "node": ">=26" }` to `package.json`; optionally `.nvmrc`
      or a reusable setup workflow so the Node version lives in one place
      — verify: `npm ci` still succeeds; `actionlint` clean
- [ ] Verify `gc-build-deploy.yml` is not double-deploying (read `detect-trigger`
      logic); narrow `push: ['**']` only if it is, and only with escalation
      — verify: documented finding; deploy behavior unchanged or human-approved

## Phase 5 — SPEC-02 safety confirmation (no code unless a leak found)

- [ ] Confirm no AI/agentic/deploy workflow is in `required_status_checks`
      — verify: `gh api .../branches/{dev,main}/protection` contexts contain none
      of the SPEC-02 names
- [ ] Confirm advisory jobs fail open (Junie `continue-on-error`; secret-guarded
      jobs skip on forks/Dependabot)
      — verify: a PR with a failing/absent Junie run is still mergeable

## Phase 6 — Docs & close-out

- [ ] Update this repo's `CLAUDE.md` "Pull request lifecycle" / branching notes
      to state the now-enforced required checks
- [ ] Two-week health check: no failing scheduled runs, gate green on PRs,
      Dependabot merging only through the gate
