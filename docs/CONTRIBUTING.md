# Contributing

Thanks for helping improve this project.

## Quick start

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env` (or `.env.local`) and set `GEMINI_API_KEY`.
3. Run the dev server:
   `npm run dev`

## Guidelines

- Keep changes small and production-friendly.
- Do not commit real API keys.
- Update `README.md` if the setup steps change.

## PR Size & Reviewability

### Keep PRs small and focused

Small, focused PRs are faster to review, easier to revert, and less likely to introduce bugs.

**Target:** fewer than 400 changed lines (excluding lock files, generated files, and vendored code).

**One concern per PR.** A PR should do exactly one of:

- Add a single feature or sub-feature
- Fix a single bug
- Refactor a specific module
- Update documentation

If a PR naturally spans multiple concerns, split it into separate PRs and open them in order (or mark the later ones as drafts until the earlier ones merge).

### Splitting a large PR

When a branch has grown large, use these strategies:

1. **Preparatory refactor first.** Extract a pure-refactor PR (no behaviour change) so the feature PR is smaller and easier to follow.
2. **Thin vertical slices.** Ship a minimal end-to-end slice (e.g. API endpoint + minimal UI) and add polish in follow-up PRs.
3. **Feature flags / dead code.** Merge incomplete work behind a flag or as unreachable code; activate it in a follow-up PR once reviewed.
4. **Separate test PRs.** If tests are large, consider a dedicated PR that only adds tests for existing behaviour.

### When a large PR is unavoidable

Some changes are genuinely atomic (e.g. a database schema migration paired with matching model and service changes). If you cannot split the PR:

1. **Explain why** in the PR description under "If this is a large PR, describe why it cannot reasonably be split".
2. **Break the review into layers.** Ask reviewers to look at one layer at a time (e.g. "start with `models/`, then `services/`, then `blueprints/`"). Use PR comments to guide reviewers.
3. **Add a walkthrough comment.** Post a top-level PR comment that maps the major change areas and explains the order to read them.
4. **Request multiple reviewers.** Assign different reviewers to different areas if possible.
5. **Allow extra review time.** Don't expect large PRs to be merged quickly.

### Automated size warnings

The `pr-size-check` workflow posts a comment on PRs that exceed 400 changed lines (excluding lock files and generated files). The comment explains the thresholds and links to this guide. The warning does **not** block merging — it is informational only.

## Before Submitting a PR

Run these checks locally:

```bash
npm run format      # Format your code
npm run lint        # Check for linting errors
npm run test        # Run tests
npm run build       # Verify build works
```

Or run all at once:

```bash
npm run format && npm run lint && npm run test:ci && npm run build
```

GitHub Actions will run these same checks automatically when you open a PR.

## CI/CD

This project uses GitHub Actions for continuous integration. All PRs must pass:

- ✅ Build check
- ✅ Linting (ESLint + Prettier)
- ✅ Tests (Vitest)
- ✅ Type checking (TypeScript)

See [`CI_QUICK_REFERENCE.md`](CI_QUICK_REFERENCE.md) for all available commands.
