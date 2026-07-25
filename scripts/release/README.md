# Release train (KAN-138)

Automation for the two-repo release train. This is the **thin slice**: the
mechanical, no-judgment steps. Version choice, Backend promotion, and the
release PR itself stay human.

| Piece | Where it runs | What it does |
| --- | --- | --- |
| `train-verify.sh` | anywhere (local + CI) | read-only drift stations; exit 1 on blocking drift |
| `.github/workflows/release-train.yml` | GitHub Actions (dispatch + daily) | runs the verifier, publishes a job summary, fails on blocking drift |
| `train-backsync.sh` | **local only** | opens (and optionally merges) the `main → dev` back-sync PRs |

## Why the split

The train spans this repo and `adamtasteslikegood/tasteslikegood.com`
(the `Backend/` submodule). Two constraints force the write half to stay local:

1. **Cross-repo write.** Actions' `GITHUB_TOKEN` is scoped to this repository.
   Opening the Backend back-sync PR needs credentials for the other one.
2. **`required_linear_history` on `dev`.** Both repos carry it (ruleset
   `rule222`, targeting `~DEFAULT_BRANCH`, which is `dev`). A merge-commit merge
   into `dev` therefore only lands for an actor with ruleset bypass — today,
   repo admins on a PR merge. The back-sync **must** be a merge commit: squashing
   rewrites the commits, ancestry never converges, and the drift count never
   returns to zero.

Reading is unconstrained: both repos are public, so the workflow can inspect
Backend refs with the default token.

## Usage

```bash
# Is the train in a releasable state?
./scripts/release/train-verify.sh              # human table
./scripts/release/train-verify.sh --json       # machine-readable
./scripts/release/train-verify.sh --for-release  # strict: about to cut a release

# Pay down back-sync debt (dry run by default)
./scripts/release/train-backsync.sh
./scripts/release/train-backsync.sh --apply --merge
```

Exit codes are the contract: `0` clean, `1` blocking drift, `2` could not
determine. The third one matters — a checker that reports "fine" when it
could not actually check is how a broken gate ships green.

## Verified branch rules (2026-07-24)

Pulled from the live rulesets, not from memory:

| | cookbook | Backend |
| --- | --- | --- |
| default branch | `dev` | `dev` |
| `main` merge methods | `merge`, `rebase` (**squash blocked**) | `merge`, `rebase` (**squash blocked**) |
| `main` rules | deletion, non-fast-forward, PR required, code scanning, code quality | + required status checks |
| `dev` merge methods | `merge`, `squash`, `rebase` | same |
| `dev` extra rule | **`required_linear_history`** | **`required_linear_history`** |
| approvals required | 0 | 0 |
| bypass | repo admin (`RepositoryRole/5`) on PR merge, plus several GitHub Apps | same |

## The `action_required` gate — resolved

The v0.4.3 pilot recorded a finding that dev→main release runs sit at
`action_required` and that the automation must clear them via
`gh api repos/{o}/{r}/actions/runs/{id}/approve`. **That diagnosis was wrong,
and the automation does not need that step.**

Every run ever held in this state, on either repo, is the **Junie** workflow
triggered by **Copilot** on `pull_request_review*` events — a bot actor. The
cause is the repo policy:

```
GET /repos/{owner}/{repo}/actions/permissions/fork-pr-contributor-approval
→ {"approval_policy": "all_external_contributors"}
```

which is stricter than GitHub's default (`first_time_contributors`) and holds
runs whose triggering actor is not a repo collaborator. On the `dev` branch,
**zero** runs have ever been held; on `main`, the four in the record are all
Junie/Copilot. The release path's own gate jobs run as `adamtasteslikegood` and
are never held.

So the runs the pilot approved were review-bot runs, not release gates — and
Junie is not a required check (the required ones are `Gate — all checks passed`,
`Analyze (javascript-typescript)`, `Dependency Review`). Approving them was
unnecessary work.

Two options, neither blocking:

- **Leave it.** The stricter policy is a reasonable default for a public repo,
  and the held runs are a bot that is currently failing on its own anyway
  ("Junie output file path is not set").
- **Relax to `first_time_contributors`** if the pending-run noise is annoying:
  `gh api -X PUT repos/{o}/{r}/actions/permissions/fork-pr-contributor-approval -f approval_policy=first_time_contributors`

## The freeze window (spec — for when the driver lands)

Today's scripts verify and back-sync; they do not drive the train. When a driver
does exist it needs a freeze, because the train's payload is mutable underneath
it: **a `dev → main` PR merges the live tip of `dev`, not the tip as of when the
PR was opened.** Anything merged to `dev` between opening the release PR and
merging it ships silently, outside the CHANGELOG, under a version that never
described it.

### When it opens

The moment the version bump + CHANGELOG land on `dev`. That is when `dev`'s tip
*becomes* the release payload — earlier than the release PR, which is already
too late.

### When it closes — asymmetric, and this is the part worth getting right

| ref | unlocks at | why there |
| --- | --- | --- |
| `dev` (both repos) | **tag `vX.Y.Z` exists on origin** | The tag is the moment the version becomes immutable, which is precisely what makes "any new push means a patch bump" true. It also *has* to be here: step 8/9 back-sync writes to `dev`. |
| `main` (both repos) | **deploy verified live** | If Cloud Build fails, the only correct recovery is a patch bump through the normal train. Holding `main` through that window is what stops a panic hotfix pushed straight to it — the one move that would break `main === deployed`. |

Not a hypothetical: v0.3.0 died in the migrate job and v0.3.4 died parsing the
Express Dockerfile. Both recovered exactly this way, as v0.3.1 and v0.3.5.

### Mechanism — two layers

**1. Detection (build this first).** At freeze-open the driver snapshots the four
ref SHAs — `dev` and `main` on both repos — and re-checks them before every
mutating step. Any movement aborts and names the ref that moved. No GitHub
config is written, so a crashed run leaves nothing to clean up, and it catches
the real failure at the moment it would do damage.

**2. Enforcement (needs a decision + one experiment).** Note what does *not*
work: the `update` rule ("Restrict updates") governs direct pushes, and both
branches already block those by requiring a PR — so it adds nothing against the
actual threat, which is a **merge**. The primitive that blocks merges is a
**required status check that never reports**: a dedicated `release-freeze`
ruleset per repo, normally `enforcement: disabled`, holding one
`required_status_checks` rule for a context (`release-freeze`) that no workflow
ever publishes. Flip it to `active` to freeze; every PR merge then sits at
"expected — waiting for status", except for bypass actors. Bypass stays repo
admin in `pull_request` mode, so the train's own merges still land while other
agent sessions, Dependabot merges, and UI merges are held.

This layer is unverified here — it needs the ruleset created and one throwaway
PR to confirm the block actually lands. It also needs a standalone `--unfreeze`
escape hatch, and the freeze state written locally *before* the API call, or an
aborted train leaves both repos frozen with no record of why.

### Already enforced

The "spent version" half of the rule is live now, as a station:
`--for-release` refuses to proceed when `v<package.json version>` is already
tagged. `release.yml` checks `git ls-remote --tags` first and skips tag
creation, the GitHub Release, and therefore the Cloud Build trigger — so
re-merging a release PR on a spent version produces a green PR, a green
workflow, and no deploy, with nothing anywhere reporting a failure.

## Still manual

Deliberately, not from lack of time — these carry judgment or a credential the
automation should not hold:

- choosing the version number and writing the CHANGELOG section
- the Backend `dev → main` promotion
- the release PR `dev → main` and its merge (which fires the tag and the deploy)
- live verification after Cloud Build

The full ordered runbook lives on **KAN-138**.
