# Comparing the Argon refactor with `dev` (KAN-479)

The refactor in KAN-460..KAN-467 (Argon's 4-group plan,
`specs/harness/REFACTOR_HARNESS_PLAN.json`) lands on
`chore/refactor_argon_integration` in both repos. It reaches `dev` only through
one promotion. This document says how to prove, before that promotion, that the
branch differs from `dev` by the refactor and nothing else, and that the
refactor did not change behaviour except where a commit says it does.

## Where the histories split

| Repo     | Fork point (on `dev`)                                       | First refactor commit                                       |
| -------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| Cookbook | `933f757` fix(kitchen): rejoin a pending card image (#3761) | `8dd3721` Argon's harness plan and driver, 2026-10-22 05:00 |
| Backend  | `c516e4d` feat(recipes): report each row's status (#442)    | `49adaee` split db_recipe_repository (G1, KAN-460)          |

After the fork, `dev` gained only release and dependency commits: v0.7.4
(#3763, #3764), the main-to-dev back-sync (#3766, Backend #445) and Dependabot
updates. KAN-479 merged that `dev` into the integration branch (cookbook
`415c5ac`, Backend `3dfa82e` via Backend #454), so the two-dot diff
`origin/dev..<integration>` is now the refactor plus this comparison plan.

Re-derive the fork point at any time:

```bash
git merge-base origin/dev origin/chore/refactor_argon_integration
git -C Backend merge-base origin/dev origin/chore/refactor_argon_integration
```

## Check 1: scope, meaning only the planned files changed

```bash
git diff --stat origin/dev origin/chore/refactor_argon_integration -- . ':!Backend'
git -C Backend diff --stat origin/dev origin/chore/refactor_argon_integration
```

Every path must be either a source file named in
`scripts/harness/refactor_hard_gate.py` `TASK_SPECS` (or the component class
paired with a template named there), an extracted module named there, a test,
Argon's harness files (`scripts/harness/refactor_*`, `specs/harness/`), or this
comparison plan (`docs/refactor/COMPARE_WITH_DEV.md`). Anything else is drift.
Name it on KAN-479 before promoting.

Result on 2026-10-26, after the sync and with G4 still unmerged:

- **Cookbook:** 21 files. These are this comparison plan, 5 harness files,
  9 G3 sources (the 6 named in `TASK_SPECS` plus the `.component.ts` classes
  paired with the three templates) and 6 extracted modules
  (`persistence-outcomes.ts`, `user-library.store.ts`,
  `recipe-publish-state.ts`, `recipe-body.component.ts`,
  `recipe-image.component.ts`, `kitchen-cards.component.ts`). There was no
  drift. `package.json`, `package-lock.json` and `CHANGELOG.md` are identical
  to `dev`.
- **Backend:** 18 files. These are the 6 G1/G2 sources, 11 extracted modules
  and `tests/test_valkey_security_helpers.py`. There was no drift.

## Check 2: structure, meaning ceilings and facades hold

```bash
python3 scripts/harness/refactor_hard_gate.py --group G1   # ... G2, G3, G4
```

The gate checks each source file's line ceiling and that it still exports its
backwards-compatible facade symbols. On 2026-10-26, after the sync, G1, G2 and
G3 pass. Run G4 after #3776 merges, then run `--close`.

## Check 3: behaviour, meaning the same contract on both trees

A refactor that keeps facades can still change what callers observe. Compare
the two trees from the outside, `dev` against the integration branch, in two
worktrees:

1. **Test suites.** Run `npm test` and `cd Backend && uv run pytest` on both.
   Every test on `dev` must pass on the integration branch. The integration
   branch adds tests, never fewer. Baseline on the sync tip: 1020 Vitest tests
   and 1097 pytest tests passed.
2. **Route tables.** Dump Flask's `app.url_map`, sorted
   `(rule, methods, endpoint)`, from both Backend trees and diff the two. The
   Express route table (G4 splits `server/index.ts`) must match after G4, by
   listing `app._router.stack` paths in order. Order matters there, because the
   SSR routes must precede the SPA catch-all.
3. **Rendered output.** Start each tree against the same local database and
   diff the responses for `/`, `/browse`, `/sitemap.xml`, one
   `/r/<slug>` per recipe state (public, private, deleted (410), legacy slug
   (301)), `/api/public/newest-recipes`, and `/` with
   `Accept: text/markdown`. Strip asset hashes and CSP nonces before diffing.
   G1 and G2 moved the SEO/JSON-LD, image and hub code, so the JSON-LD blocks
   must match byte for byte.
4. **Auth and Valkey.** Exercise login, logout and the rate-limit window
   against a local Valkey on both trees.

### Expected differences

These are deliberate and must not be counted as regressions:

- `e2b9680` (in G2, Backend #446) **changes behaviour**. It makes Valkey token
  transitions atomic in `utils/valkey_sessions.py` and
  `utils/valkey_ratelimit.py`, and `8c3062e` adds a test for it.
  `tests/test_valkey_security_helpers.py` is that change's test. Review it as a
  fix carried inside a refactor PR, not as part of the move.
- `ebe3d68` (Backend #447) restores comments and docstrings that G1 dropped.
  It changes no code.

## Promotion

When checks 1-3 pass and G4 is merged:

1. Merge Backend `dev` into Backend `chore/refactor_argon_integration` again,
   if `dev` has moved, then promote it to Backend `dev` with a merge commit.
2. Do the same in the cookbook, repointing the gitlink at the Backend `dev`
   merge.
3. From there, follow the normal release train (`scripts/release/RUNBOOK.md`).

Before step 1, re-run checks 1 and 2. If `dev` moved after this document, a
new non-refactor path in check 1 means the sync was skipped.
