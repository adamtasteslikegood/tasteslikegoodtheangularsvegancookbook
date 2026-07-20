# KAN-119 Fix Loop — iOS: public-recipe View link hidden for guests/webview visitors

_2026-07-20 · Owner: Adam · Executor: agent (this loop) · Sprint-2 early-drive (C8), Adam-directed
ahead of charter lock. Vocabulary: **`fix/`** branch off `dev` (not "hotfix" — that means an
emergency branch off `main` here; this rides the normal dev → release train)._

## Defect (from KAN-119, code-confirmed)

The My Kitchen "View" link to `/r/<slug>` renders only under `@if (canPublish() && r.is_public)`
(`src/app.component.html:402`); `canPublish()` requires a signed-in **non-guest**
(`src/app.component.ts:968-971`). Guests — and iOS in-app-webview visitors who cannot sign in at
all — never get a path to an already-public recipe's page. Viewing needs no publish rights.

The auth-coupling also means _any_ iOS auth-state hiccup (slow restore, dropped session) hides the
link. The fix removes the auth dependency entirely, so it is robust to whichever variant Adam hit.

## Fix design (scope fence: this conditional only — no other UI changes)

1. New pure util `src/utils/public-link.ts`: `isPublicViewable(r): boolean` → `!!r.is_public && !!r.slug`
   (slug guard: never render `href="/r/undefined"`). Mirrors the `in-app-browser.ts` util+spec
   pattern #3186 established.
2. `app.component.ts`: thin delegate `isPublicViewable(r)` calling the util.
3. Template `:402`: `@if (canPublish() && r.is_public)` → `@if (isPublicViewable(r))`.
   The publish **toggle** (`:363`) stays behind `canPublish()` — unchanged.

## Tasks & machine gates (budgets: 3 attempts/task, 12 iterations)

| #   | Task                                                                                                                                                                              | Gate (must exit 0)                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Branch `fix/public-view-link-guest-visibility` off `origin/dev`                                                                                                                   | branch exists on the dev tip                                                                                                             |
| T2  | **Test first**: `src/utils/public-link.spec.ts` — public+slug → true; guest-irrelevance (no auth input at all); `is_public` false → false; missing slug → false. Red before impl. | `npx vitest run src/utils/public-link.spec.ts` fails pre-impl, passes post-impl                                                          |
| T3  | Implement util + component delegate + template swap                                                                                                                               | `git diff --stat` touches exactly 3 files + the spec                                                                                     |
| T4  | Local quality gates                                                                                                                                                               | `npm run lint` · `npm run type-check` · `npm test -- --run` · `npm run build` all exit 0; built `dist/` still contains the anchor markup |
| T5  | PR into `dev`, title `fix(ux): show public-recipe View link without publish rights (KAN-119)`, monitor to green                                                                   | required checks (Gate/Analyze/DepReview) SUCCESS                                                                                         |
| T6  | Merge (squash) + Jira KAN-119 → Done with evidence; note in ux-backlog #6                                                                                                         | PR MERGED · KAN-119 Done                                                                                                                 |

## Terminal states

merged-to-dev+Jira-Done (**"ready"** — ships to prod in the next release, e.g. v0.4.1/v0.5.0;
release itself is a separate Adam call) · escalate-with-finding (if any gate can't pass in 3
attempts).

## Post-release verification (deferred, lands with next release)

Signed-out iOS visit shows View on a published recipe — the KAN-119 proving gate; also closes
ux-backlog #6.
