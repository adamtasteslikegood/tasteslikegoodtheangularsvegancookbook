# DECISIONS — Cookbook CI Refresh (resolved 2026-07-15)

The ADR the plan's Phase 0 / PROMPT T0 asks for. All four SPEC-01 §7 open
decisions are locked. Decided by Adam via the devex Q/A gate; recommendations
came from the audit. Completeness score = confidence given the evidence at
decision time.

| # | Decision | Choice | Completeness |
|---|---|---|---|
| D1 | `ci.yml` fate | **Trim to push-only Prettier auto-commit** | 9/10 |
| D2 | Docker-build gate scope | **Express image only** | 10/10 |
| D3 | `Dependency Review` required? | **Required on dev + main** | 8/10 |
| D4 | `gc-build-deploy.yml` scoping | **Leave as-is (verified inert)** | 9/10 |

## D1 — `ci.yml`: trim to the push-only Prettier auto-commit

**Situation.** Three workflows overlap on every PR. `ci-cd.yml` is a strict
subset (lint + vitest) of both `ci.yml` and `pr-gate.yml` → deleted regardless.
`ci.yml`'s only non-duplicate job is the **push-only** Prettier auto-commit
(documented in `CLAUDE.md`). Per-check overlap on a PR into `dev`:

| Check | ci.yml | ci-cd.yml | pr-gate.yml | ×|
|---|:-:|:-:|:-:|:-:|
| eslint (`npm run lint`) | ✅ | ✅ | ✅ | 3 |
| vitest (`npm run test:ci`) | ✅ | ✅ | ✅ | 3 |
| `format:check` | ✅(PR) | — | ✅ | 2 |
| tsc type-check | ✅ | — | ✅ | 2 |
| `npm run build` | ✅ | — | ✅ | 2 |
| push-only auto-format-commit | ✅ | — | — | unique |

**Decision.** Delete `ci.yml`'s `build`/`lint`/`test`/`type-check` (all covered
by `pr-gate`); keep only the push-only `format` auto-commit. Delete `ci-cd.yml`.
**Note:** once branch protection lands (Phase 3), direct pushes to `dev`/`main`
are blocked and `format:check` gates every PR, so the retained job becomes a
near-no-op safety net — harmless; revisit for removal later if desired.

## D2 — Docker-build gate: Express image only

**Situation.** The root `Dockerfile` (Express, `node:26-alpine` multi-stage +
`datadog/serverless-init:1-alpine`) is exactly the file that burned the v0.3.4
release tag. It builds with no secrets. The Flask image lives in the `Backend/`
submodule, which just got its own CI refresh that owns image concerns.

**Decision.** Add `docker build -f Dockerfile .` (Express, no push) to the
`pr-gate` `gate` aggregate. Flask image build is **out of scope** for the
cookbook gate (owned by Backend CI). Directly covers the v0.3.4 failure mode; no
submodule checkout or secrets needed; keeps the gate fast.

## D3 — `Dependency Review`: required

**Situation.** `dependency-review.yml` already runs on PR `[main, dev]`, fails on
high/critical vulns, enforces a license allowlist, and carries a real exemption
(`protobufjs`, #3010) — proving it runs and blocks live things.

**Decision.** Add `Dependency Review` to the required status checks on `dev` +
`main`. It is the one gate that stops a vulnerable/copyleft dependency merging —
closing the Dependabot-auto-merge blind spot. **Precondition (Phase 3):** confirm
it is green on recent PRs before flipping to required (don't require a silently
erroring check). Completeness 8/10 = that 30-second confirm is still pending.

## D4 — `gc-build-deploy.yml`: leave as-is (verified inert) — CORRECTION

**Situation.** SPEC-02's first draft flagged this workflow as a possible
double-deploy needing escalation. **Reading its `detect-trigger` code corrected
that.** It fires on `push: ['**']` + all PRs but is inert unless **all three**
hold: (1) target branch == default (`main`), (2) actor ∈
`AUTHORIZED_DEPLOYERS`/owner, (3) a magic token (`gcbuild` / `gcdeploy` /
`gcbuildanddeploy`) is in the commit message or PR title/body.
`deployment_enabled = shouldRun && isPush`. It is an opt-in, token-gated,
main-only, authorized-actor-only manual deploy path — **not** racing the Cloud
Build tag-push trigger (`^v[0-9]+\.[0-9]+\.[0-9]+$`) or `release.yml`.

**Decision.** Leave as-is; **reclassified from escalate-first to no-change**. The
broad trigger only spins a no-op `detect-trigger` job per push. Optional cosmetic
narrowing (drop that no-op job) is low-priority and still touches a deploy
workflow → defer. Residual: confirm `vars.AUTHORIZED_DEPLOYERS` is populated as
intended (governance, not correctness).

## Net effect on the plan

- The **only** remaining escalate-first item is branch protection itself
  (Phase 3). D4 is downgraded to no-change across SPEC-02 / TODO Phase 4 /
  PROMPT T11.
- Required contexts on `dev` + `main`: `Gate — all checks passed`,
  `Analyze (javascript-typescript)`, `Dependency Review`.
