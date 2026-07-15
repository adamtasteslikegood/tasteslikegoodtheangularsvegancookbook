# SPEC-03 — Independent Claude Review (advisory, cheaper model)

**Repository:** `adamtasteslikegoodtheangularsvegancookbook` (cookbook)
**Status:** Proposal → workflow authored (`.github/workflows/claude-review.yml`)
**Date:** 2026-07-15
**Companion:** [SPEC-02](SPEC-02-ai-and-deploy-workflows.md) · [diagram](diagram-claude-review.md) · [PLAN](PLAN.md)

---

## 1. Goal

Add a **second, independent** review of each PR that runs in its own CI session
on a **different, cheaper model** than the authoring session, reasons about the
diff to pick the right review skill + reasoning effort, applies fixes, and leaves
a comment per fix. This breaks the self-review monoculture (an author and a
same-model reviewer share blind spots — cf. `engineering-skills:adversarial-reviewer`)
while keeping cost low.

It is **advisory and fail-open** — never a required status check (SPEC-02 rule 1).

## 2. Why a different, cheaper model

The author works in **Opus 4.8** or **Fable 5**. A reviewer on a *different* model
sees what the author's model missed; picking a *cheaper* one (an **Opus 4.x < 4.8**)
also cuts cost. "Easiest lower-cost rule," per the request: always use Opus 4.x
below 4.8. The selection is deterministic (§4.1), not model-guesswork.

## 3. Design

`.github/workflows/claude-review.yml` (authored). Mechanics confirmed against the
current `anthropics/claude-code-action@v1`:

### 3.1 Deterministic model pick (the "programmatic" part)

A `pick` step outputs the model: `vars.CLAUDE_REVIEW_MODEL` if set, else the
default `claude-opus-4-7`. A guard rejects the authoring tier — if the variable is
ever set to `claude-opus-4-8*` or `claude-fable-5*` it falls back to
`claude-opus-4-7`, so the reviewer is *always* cheaper-and-different by
construction. The chosen id flows into `claude_args: --model <id>`.

> ⚠️ **Verify the model id.** `claude-opus-4-7` is a placeholder default — confirm
> the exact currently-available Opus 4.x<8 id at console.anthropic.com and set the
> `CLAUDE_REVIEW_MODEL` repo variable. The workflow reads the variable, so no code
> edit is needed to correct it.

### 3.2 The reviewer reasons about skill + effort (not hardcoded)

The `prompt` tells Claude to: inspect the diff → **choose** a reasoning effort
(`low`/`medium` for small/low-risk, `high`/`max` for large diffs or changes to
core logic, the Express security/proxy/validation layers, auth, Dockerfiles, CI,
or dependencies) → **choose** the skill (always `/code-review`; add
`/security-review` for security-sensitive diffs) → run
`/code-review <effort> --comment --fix`. `--fix` applies fixes to the working tree
(the action commits + pushes to the PR branch); `--comment` posts each finding as
an inline PR comment. It closes with one summary comment listing each fix, signed
with the model + effort used.

### 3.3 Guards, cost, and safety

- **Same-repo + non-bot + non-draft** `if:` guard — fork/Dependabot PRs have no
  secrets and skip cleanly (never fail).
- **Advisory:** `continue-on-error: true`; the job is **never** added to required
  status checks (SPEC-02). A missing `ANTHROPIC_API_KEY` or a flaky call cannot
  block a merge.
- **Cost bounded:** triggers on `opened` / `ready_for_review` (once per PR) + the
  `claude-review` label (on-demand re-review) + `workflow_dispatch` —
  **not** on every `synchronize` push. `concurrency` cancels superseded runs.
  Model is always the cheaper Opus 4.x tier. `--max-turns 15` caps the agent loop.
- **Pushes to the PR branch:** `--fix` commits fixes back. Because it only runs on
  same-repo PRs, it has write access; on forks it's skipped.

## 4. Prerequisites (one-time, maintainer)

1. **Secret** `ANTHROPIC_API_KEY` (Settings → Secrets → Actions). None exists today
   — the repo currently uses Junie/Gemini/Copilot for AI.
2. **Variable** `CLAUDE_REVIEW_MODEL` = the confirmed Opus 4.x<8 id (recommended;
   default placeholder otherwise).
3. **Label** `claude-review` (for on-demand review).

## 5. Acceptance criteria

1. Labeling a same-repo PR `claude-review` triggers the job; it runs on an Opus
   4.x<8 model (check the `::notice::Independent review model:` line).
2. The job posts at least one inline comment per finding and, when it applies
   fixes, pushes a commit to the PR branch with a summary comment enumerating each
   fix.
3. A fork / Dependabot PR does **not** run it (skips cleanly).
4. The job is **not** present in `required_status_checks.contexts` on `dev`/`main`.
5. A run that errors (e.g. key unset) leaves the PR mergeable (`continue-on-error`).

## 6. Open choices (defaults chosen; easy to flip)

| Choice | Default | Flip to |
|---|---|---|
| When it runs | once per PR + label + dispatch | add `synchronize` for every push |
| Fix behavior | applies fixes (`--fix`) + comments | comment-only (drop `--fix` from prompt) |
| Model | `claude-opus-4-7` (placeholder) | set `CLAUDE_REVIEW_MODEL` variable |
| Effort | reviewer reasons per-diff | pin an effort in the prompt |

## 7. Testing note

Per the action guide, `/code-review --comment --fix` running headless in
`claude-code-action@v1` is expected but should be **verified on a throwaway PR
first** before enabling broadly — confirm comments post and fixes push as
intended, then adjust `--max-turns` / effort guidance if needed.
