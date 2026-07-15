# SPEC-02 — AI, Agentic & Deploy Workflows (keep them out of the gate)

**Repository:** `adamtasteslikegoodtheangularsvegancookbook` (cookbook)
**Status:** Proposal
**Date:** 2026-07-15
**Companion:** [SPEC-01](SPEC-01-ci-quality-gates.md) · [TODO](TODO.md) · [PROMPT.md](PROMPT.md)

---

## 1. Why a second spec

SPEC-01 makes exactly one PR gate blocking. This repo also runs a large fleet of
**non-blocking** workflows: AI code review (Junie), agentic maintenance (gh-aw
Copilot/Claude workflows), advisory formatting (reviewdog), and a self-gated
Cloud Build deploy path. The single most common way to break a CI refresh is to
accidentally sweep one of these into the required-check list — an advisory AI
job that fails open, or a scheduled agentic run that has no PR context, becomes a
permanent merge blocker. This spec enumerates them and the rule: **they run, they
comment, they never block.**

## 2. Inventory & classification

| Workflow | Trigger | Kind | Required? |
|---|---|---|---|
| `junie-review.yml` (Code Review) | PR `[main]`, `continue-on-error` | AI review | **Never** |
| `junie-tag.yml` (Junie) | `@junie-agent` comments/issues | AI agent | **Never** |
| `run-prettier-formatting-with-reviewdog.yml` | PR `[main,dev]`, same-repo only | Advisory format | **Never** (gate's `format:check` is the real enforcement) |
| `gc-build-deploy.yml` (Google Cloud Build Gate) | push `**` + PR all, self-gated by `detect-trigger` | Deploy path | **Never** |
| `daily-repo-status` (gh-aw) | schedule daily | Agentic report | **Never** |
| `issue-arborist` (gh-aw) | schedule every 3h | Agentic triage | **Never** |
| `agentics-maintenance` (gh-aw, generated) | schedule | Agentic cleanup | **Never** |
| `relevance-summary` (gh-aw, Copilot) | `workflow_dispatch` | Agentic report | **Never** |
| `security-alert-issues.yml` | schedule + dispatch | Security→issues | **Never** (not a PR check) |
| `release.yml` | push `main` | Release/tag | **Never** (post-merge) |

## 3. Rules

1. **None of the above may appear in `required_status_checks.contexts`** on `dev`
   or `main`. When configuring protection (SPEC-01 §4.3), the required list is
   *only* `Gate — all checks passed`, `Analyze (javascript-typescript)`, and
   (optionally) `Dependency Review`. Anything else that shows up as a check on a
   PR is informational.

2. **AI/agentic jobs fail open, never closed.** `junie-review` already uses
   `continue-on-error: true`; keep it. Never add an AI/agentic job to the `gate`
   aggregate's `needs:` list — a flaky model call or an expired `JUNIE_API_KEY`
   must not block a merge.

3. **Fork / Dependabot PRs get no secrets.** Jobs that need secrets
   (`JUNIE_API_KEY`, GCP auth) must guard on
   `github.event.pull_request.head.repo.full_name == github.repository` (as
   `run-prettier-...-reviewdog.yml` and `gc-build-deploy.yml` already do) and skip
   cleanly rather than fail when secrets are absent.

4. **`gc-build-deploy.yml` — verified inert (2026-07-15, DECISIONS.md D4).** Code
   review of its `detect-trigger` job confirms it acts only when target branch ==
   default (`main`) AND the actor is in `AUTHORIZED_DEPLOYERS`/owner AND a magic
   token (`gcbuild`/`gcdeploy`/`gcbuildanddeploy`) appears in the commit/PR. It is
   **not** double-deploying against the Cloud Build tag-push trigger
   (`^v[0-9]+\.[0-9]+\.[0-9]+$`) or `release.yml`; the broad `push: ['**']`
   trigger only spins a no-op detector. **No change.** Any *future* edit to its
   deploy behavior still → escalate (it can touch production).

5. **gh-aw workflows are generated — don't hand-edit the `.lock.yml`.**
   `agentics-maintenance.yml`, `daily-repo-status.lock.yml`, and
   `issue-arborist.lock.yml` are compiled by `gh aw compile` from their `.md`
   sources. Edit the `.md`, recompile; never edit the lock file (the repo has a
   history of recompile fixes — commits `598bdb5`, `9913b59`).

## 4. Acceptance criteria

1. `gh api .../branches/dev/protection --jq '.required_status_checks.contexts'`
   contains none of the SPEC-02 workflow names/contexts.
2. A PR whose Junie review errors (or whose `JUNIE_API_KEY` is unset) still shows
   the `gate` context green and is mergeable.
3. A Dependabot PR does not fail on any secret-requiring advisory job (they skip).
4. `gc-build-deploy.yml`'s deploy behavior is documented (verified, §3.4) and
   unchanged unless a human approved a scoped change.
