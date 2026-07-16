# PROMPT.md — Agent-Harness Goal: Cookbook CI/CD Refresh

Drop-in goal definition for an `agent-harness` / `agent-harness:cs-harness`
bounded-loop run (or a `/loop`-style driver). It compiles into verifiable tasks:
every task has a machine-run verify, a retry cap, and an escalation path. The loop
must not close until every task is verified green or explicitly waived by a human.

Domain recommendation for `cs:harness`: **`engineering`** (this is CI/CD/devex
work). If a custom skill folder is used, point it at the CI-refresh devex skill
staged in `docs/ci/refresh/skill/` (see that folder's README for install path).

---

## Goal

Restore and enforce CI/CD quality gates in
`adamtasteslikegood/tasteslikegoodtheangularsvegancookbook` (the cookbook repo)
per `docs/ci/refresh/SPEC-01-ci-quality-gates.md` and
`SPEC-02-ai-and-deploy-workflows.md`, executing the phases in
`docs/ci/refresh/TODO.md` in order.

## Operating constraints (hard rules)

1. Branch off `origin/dev`, PR into `dev`. **Never** commit to `dev` or `main`
   directly. Branch names: `chore/ci-<topic>` or `fix/<topic>`.
2. One concern per PR, matching the TODO's PR boundaries. No omnibus PRs.
3. Sync before creating each branch (Dependabot + other agents are active):
   `git fetch origin --prune && git submodule update --init Backend`; branch from
   `origin/dev`; scan in-flight work with `gh pr list --state open` and
   `git branch -r --sort=-committerdate | head`. If an open PR already covers a
   task, build on it instead of duplicating.
4. Never lower a bar to force green: no disabling ESLint rules wholesale, no
   `--max-warnings` bumps, no `it.skip`/`test.skip`, no lowering vitest coverage
   thresholds, no deleting tests. Narrow, justified suppressions only — each needs
   a code comment stating why.
5. AI/agentic/deploy workflow checks must **never** be added to required status
   checks (SPEC-02).
6. Branch-protection changes (Phase 3) and any change to `gc-build-deploy.yml`
   deploy behavior → **escalate, human approves** before applying.
7. Own every PR you open until it merges: monitor `gh pr checks <n>`,
   `gh pr view <n> --comments`, `gh api repos/{owner}/{repo}/pulls/<n>/comments`;
   for each piece of feedback, push a fix and reply, or reply with a concrete
   technical rebuttal. A PR with unaddressed feedback or failing checks is not done.

## Global verification suite (run after every task; all must pass at close)

```bash
npm ci
npm run lint
npm run format:check
npm run type-check
npm run test:ci
npm run build
docker build -f Dockerfile .                 # once the Phase-2 gate exists
actionlint .github/workflows/*.yml           # or: uvx --from actionlint-py actionlint
```

Baseline (2026-07-15) so the harness can detect regression vs progress:
lint ✅ · format ✅ · type-check ✅ · test:ci ✅ · build ✅ · Docker build ⚠️
not yet in CI · branch protection ❌ 404 on dev+main. **Green tree — do not
introduce regressions; the deliverable is enforcement, not code fixes.**

## Task plan

Execute strictly in order; each task = branch → change → local verify → PR → CI
verify → merge (or escalate). `verify:` lines are machine-checkable.

| # | Task | Verify (exit 0 / condition) | Retries |
|---|---|---|---|
| T0 | ✅ Decisions recorded in [DECISIONS.md](DECISIONS.md) (D1–D4) | DECISIONS.md present with all 4 | — |
| T1 | Delete `ci-cd-backend.yml` (redundant, dev-blind) | `git grep -n ci-cd-backend` no live refs; scratch PR into `dev` still runs backend pytest via pr-gate | 2 |
| T2 | Delete `ci-cd.yml` (redundant lint+vitest) | `actionlint` clean; scratch PR shows pr-gate frontend jobs only | 2 |
| T3 | `ci.yml`: trim to push-only Prettier `format` job (or delete per T0) | `actionlint` clean; a PR runs lint/test exactly once | 2 |
| T4 | Add `docker-build` job (Express image) to `pr-gate.yml`, wire into `gate` `needs:` | job green on PR; red on scratch broken-Dockerfile branch, then reverted | 3 |
| T5 | ~~Flask image build~~ — DEFERRED (D2: Express-only; Flask owned by Backend CI) | n/a | — |
| T6 | Branch protection on `dev` (**escalate first**) | `gh api .../branches/dev/protection --jq '.required_status_checks.contexts'` == `[Gate — all checks passed, Analyze (javascript-typescript), Dependency Review]` | 1 |
| T7 | Branch protection on `main` (**escalate first**) | same `gh api` on `main` | 1 |
| T8 | Negative test: deliberately failing test PR cannot merge | merge blocked by gate; revert | 1 |
| T9 | Confirm Dependabot auto-merge waits on the gate | next Dependabot PR merges only after `gate` green | 2 |
| T10 | Housekeeping: `engines.node` + single-source Node version | `npm ci` ok; `actionlint` clean | 1 |
| T11 | `gc-build-deploy.yml`: verified inert (D4) — no change; optional cosmetic narrowing deferred | DECISIONS.md D4 recorded; behavior unchanged | 1 |
| T12 | SPEC-02 safety confirm: no AI/agentic/deploy check is required; advisory jobs fail open | protection contexts contain none of SPEC-02 names; PR with failing Junie still mergeable | 1 |
| T13 | Docs close-out: update `CLAUDE.md` required-checks note | file updated | 1 |

## Loop protocol

See [diagram-harness-loop.md](diagram-harness-loop.md) for the flowchart.

- **Retry cap:** per-task caps above. A retry must change approach, not re-run the
  same failing attempt.
- **Escalate, don't improvise,** when: retries exhausted; anything touches branch
  protection (T6/T7 always escalate before applying) or `gc-build-deploy.yml`
  deploy behavior (T11); or an in-flight PR by someone else overlaps a task.
- **Budget:** if wall-clock or token budget exhausts mid-phase, stop at the last
  merged task, write `docs/ci/refresh/HARNESS-STATE.md` with per-task status
  (`verified / in-progress / blocked / waived + evidence`), and report.
- **Close condition:** every task verified or human-waived **and** the global
  verification suite passes on `dev` **and** no PR opened by this run has
  unaddressed review comments **and** `gh api .../protection` returns the exact
  required-check list on both `dev` and `main`. Emit a final report: per-task
  evidence (commands + exit codes), merged PR list, escalations and resolutions.
