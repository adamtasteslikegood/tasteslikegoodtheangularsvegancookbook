# Changelog

All notable changes to Vegangenius Chef are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.4.10] - 2026-08-10

Backend submodule pointer: `f1219e8` → **`a94fac2`** — Backend `main`'s own tip, the
merge commit of
[#275](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/275).

**Sprint 6 close-out.** The headline is a data-correctness fix: duplicate recipe
saves are now refused by the database itself, not just by a client-side check that
a user could route around.

### Fixed

- **Duplicate recipe saves are refused at the database layer** — a partial unique
  index on `(owner, COALESCE(source_slug, slug))` rejects a second save of the same
  source recipe instead of relying solely on the SPA's client-side check — KAN-213,
  Backend [#273](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/273),
  [#276](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/276)
- **Migration dedup now runs to a fixed point, and the guest-merge collision it
  could hit is bound** — a single dedup pass could leave a fresh collision behind
  it; the migration now re-passes until none remain — KAN-223, Backend
  [#277](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/277)
- **gbrain maintenance cron no longer reports healthy runs that silently failed** —
  `run.sh` swallowed dream/extract/embed exit codes; failures in any core phase now
  propagate to the script's own exit code — KAN-97,
  [#3384](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3384)

### Added

- **Jira issues auto-transition to Done when their PR merges** — extracts KAN-###
  keys from the PR title and transitions To Do / In Progress / In Review issues;
  RCP epic keys are deliberately never auto-closed by a single contributing PR —
  KAN-97,
  [#3380](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3380)
- **Known search-engine and social-media crawlers are exempt from the page rate
  limiter** (Googlebot, Bingbot, Applebot, DuckDuckBot, YandexBot, Slurp,
  facebookexternalhit, Twitterbot, LinkedInBot, Pinterestbot, AdsBot-Google) — the
  AI endpoints keep their own limiter on `/api`; metering crawlers on the public
  SSR/HTML surface costs SEO while protecting nothing — KAN-218,
  [#3380](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3380)

### Changed

- gbrain maintenance cron upgraded v0.42.56.0 → v0.43.0.0: dreams all active
  federated sources instead of one hardcoded source, adds `embed --stale` and
  `doctor --fast` phases with health-score logging —
  [#3380](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3380)

## [0.4.9] - 2026-08-07

Backend submodule pointer: `7b6347e` → **`f1219e8`** — Backend `main`'s own tip, the
merge commit of
[#271](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/271).

**The headline is a data-correctness fix that had never reached production.** The
guest→login merge was carrying rows across without running the duplicate-recipe
check, so signing in after saving as a guest silently created duplicates. The fix
merged to Backend `dev` during Sprint 5 but sat there — `dev` is not what deploys —
and this release is the first to actually carry it to users.

### Fixed

- **Guest→login merge now runs the duplicate-recipe check (INV-1) instead of
  silently carrying rows over** — KAN-186, Backend
  [#267](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/267) +
  [#3344](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3344).
  Per-row dedup on identity keys, cookbook `recipe_ids` remapped, public guest rows
  guarded.
- **A first-time save from a public recipe page no longer creates a duplicate
  recipe** — KAN-198,
  [#3358](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3358).
  `ssrEntryGuard` invokes `handleSave` fire-and-forget, so a guard running twice for
  one `?save=<slug>` entry started two overlapping saves; both passed the dedup check
  while the cookbook was still empty and **both persisted**, and the straggler then
  re-read the row the first had just written and reported "you already have this
  recipe" after a save that had just succeeded. Repeat invocations now join the
  in-flight save.

  This was filed as KAN-156 and triaged _cosmetic, no data impact_. Writing the
  regression test owed for it is what showed the duplicate **row**; the stray toast
  was only its visible symptom.

- **`Dependency Review` no longer blocks every `vite` upgrade** — KAN-208,
  [#3357](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3357).
  `lightningcss` and its eleven platform binaries declare MPL-2.0 and were never
  license-gated, because the action only checks _added_ packages and the copy already
  in the lockfile predated the policy. Exempted per-package, mirroring `protobufjs`.
- **The `gcp-monitor` image can no longer be broken by an unpinned transitive
  resolve** — KAN-207,
  [#3356](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3356).

### Changed

- **Every commit pushed to an open PR is now reviewed** — KAN-183,
  [#3334](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3334).
  The AI review workflows excluded `synchronize`, so anything pushed after the first
  review went unreviewed, silently, on both repos.
- **A PR that orphans a `sprint-N` row now fails CI** — KAN-200,
  [#3336](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3336).
  `check_sprint_lane.sh` runs as a `pr-gate` job in `gate.needs` rather than as a
  script someone remembers to run.
- **Release-train driver: the checklist is now truthful** — KAN-138,
  [#3359](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3359) +
  [#3361](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3361).
  It declared ten steps and only ever marked four, so six read `[ ]` forever even
  once done. Marks are now derived from observable state, authoritative in both
  directions. Adds RUNBOOK step 10 and a `--bump X.Y.Z` assist that writes
  `package.json`, **both** `package-lock.json` self-references, and a CHANGELOG
  section naming the pinned SHA — refusing outright if the pointer does not yet pin
  Backend `main`.
- **`ioredis` 6 is pinned to RESP2** — KAN-209,
  [#3353](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3353).
  Not for reply shapes (`replyMode: "legacy"` keeps those identical) but for the
  handshake: under RESP3 ioredis authenticates via `HELLO` and injects a `default`
  username, which Memorystore IAM auth does not use, and a rejected AUTH is not a
  protocol-negotiation error so the automatic RESP2 fallback would not catch it.
- **Release-train driver: state checks read the local gitlink; `verify_prod` hardened**
  — KAN-211,
  [#3365](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3365) +
  [#3367](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3367).
  The driver decided the pointer via `git rev-parse origin/dev:Backend`, but a re-pin is
  staged locally and does not reach `origin/dev` until the release PR merges — so it
  could call a correctly-pinned tree wrong. Fixed at the walk-mode step-4 check (#3365)
  and in `changelog_state()` (#3367), which had reported step 5 as `section-only` on a
  CHANGELOG that named the right SHA. Both now read `:Backend` from the index, matching
  `do_bump()` in #3361. `verify_prod` switches `grep -c` → `grep -Fc` so a marker
  containing regex metacharacters matches literally, and cleans its scratch file on an
  `EXIT` trap rather than only on success.

  Three read sites still resolve the pointer from `origin/dev` — the `--status`
  display, the step-1 checklist mark, and the release-PR body. They are stale in the
  same window and are held for the next release, where the fix belongs at the single
  point that computes it rather than a fourth patch at the call site.

- Dependency upgrades — 23 bumps, including Angular 22.1.0, `vite` 8.2.0,
  `google-auth-library` 11, `ioredis` 6, and `dd-trace` 6.8.0. `@angular/build` and
  `@angular/cli` had been pinned to 22.1.2 while the rest of the family sat at 22.1.0
  — a version never published for `@angular/core` — and were aligned down to 22.1.0
  (KAN-211); `@typescript-eslint/parser` was synced to 8.66.0 to match the plugin it
  is released in lockstep with.

### Documentation

- Sprint 4 and Sprint 5 close-outs and the Sprint 5 charter (KAN-155, RCP-65).
  Sprint 5 delivered 4 of 8 with the per-day rate falling 0.67 → 0.50, recorded as a
  sizing verdict rather than smoothed over.

## [0.4.8] - 2026-07-31

Backend submodule pointer: `0de1e2b` → **`7b6347e`** — Backend `main`'s own tip,
the merge commit of
[#261](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/261), rather
than the dev-side SHA it promoted. Both have identical trees, so this pins the
same code; pinning main's own SHA is what keeps "which Backend commit is in
production?" answerable from a single ref. Carries the KAN-155 ownership-refusal
work from Backend
[#256](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/256),
[#259](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/259) and
[#261](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/261).
Single Alembic head (`e4a7b2d9c5f1`) and no new migrations in the range, so
`flask-backend-migrate` runs as a no-op.

### Fixed

- **A refused publish is no longer reported as a success** (KAN-155,
  [#3316](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3316)
  - Backend #256/#259). Publishing a recipe whose row belongs to another
    account or another guest session was refused by the server and shown to the
    user as _published_: the toggle stayed on over a row that was never written.
    The refusal now propagates as a structured outcome instead of collapsing
    into a bare `false`, the optimistic UI state reverts, and the toast says
    which refusal fired rather than blaming the network for a permission
    decision. The message also tracks the toggle direction — an unpublish that
    was refused used to report that the recipe "can't be **published**".

  Three server-side cases are distinguished, each with its own remedy: a
  different real account owns it (final); another guest session owns it (log
  in and retry — the RCP-61 stale-tab case, where retrying genuinely works);
  and an unclaimed guest row with the caller authenticated (no repair exists
  yet, so the copy does not promise that retrying helps). An unrecognised or
  missing code degrades to a generic refusal, never to success.

- **Sprint plans now reach Confluence** (KAN-187,
  [#3315](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3315)).
  The PM sync watched a hardcoded 7-file list that named a 182-byte
  `SPRINT_0_PLAN.md` stub and omitted `SPRINT_1..4_PLAN.md` — roughly 91 KB of
  real planning that had never been published, across four sprints, while
  `sync_pm_documents` reported "Sync successful" every time. Sprint plans are
  now matched by glob so future sprints need no code change, the file set is
  defined once in `scripts/pm/_canonical_pm_files.py` and imported by both the
  daemon and the SessionStart briefing hook, and the sync names how many files
  it considered so an omission is visible instead of indistinguishable from
  success.

### Security

- **`flask-backend` is no longer publicly invokable** (KAN-170/KAN-171/KAN-173,
  [#3303](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3303),
  [#3305](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3305),
  [#3307](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3307)).
  `--invoker-iam-check` is persisted in `cloudbuild.yaml` so the setting
  survives redeploys, and posture-drift detection runs on a dedicated
  read-only Workload Identity Federation identity. The detection workflow was
  previously unrunnable — no WIF provider existed — so it passed while
  detecting nothing; it is now proven to fail for the reason it exists
  (KAN-176).

### Changed

- Sprint 4 re-cut to a single lane on KAN-155, with the borrowed Monte Carlo
  forecast formally withdrawn: it was computed over KAN throughput and
  presented as a forecast for an RCP board that has run zero sprints.
- `gh-aw` bumped to v0.83.4; the MCP-gateway firewall-denial root cause is
  documented (KAN-134).

## [0.4.7] - 2026-07-27

Backend submodule pointer: `38736da` → **`0de1e2b`** (Backend `main` tip,
promoted zero-diff in Backend
[#254](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/254)).
No content delta and no new Alembic migrations, so the
`flask-backend-migrate` Cloud Run Job is a no-op this release.

**This release changes no production behaviour.** Express begins sending a
Google-signed ID token to Flask; Flask continues to accept anonymous callers
until the invoker IAM check is enabled in the separately-run KAN-170 cutover
(`docs/security/KAN-170_PUBLIC_EGRESS_REMEDIATION.md`).

### Security

- **Express now authenticates to the Flask backend with a Google-signed ID
  token** (KAN-170). `flask-backend` was anonymously invokable from the public
  internet, so `POST /api/generate` completed and billed Gemini/Imagen for
  unauthenticated callers, bypassing every Express limiter and validator. The
  deploy config could not have revealed it: `--no-allow-unauthenticated` edits
  the IAM policy, while the `run.googleapis.com/invoker-iam-disabled=true`
  annotation switches the invoker IAM check off wholesale — so the flag was
  inert and both the build config and the IAM policy read as secure.

  New `server/flask-auth.ts` mints the token (audience = the backend origin,
  cached and refreshed by `google-auth-library`) and `server/proxy.ts` sends it
  in `X-Serverless-Authorization` — deliberately not `Authorization`, which
  Cloud Run forwards unmodified and which Flask reads for `require_admin` and
  `require_pubsub_oidc`. Local development is unaffected: no token is minted
  for a non-`run.app` target, so `npm run dev` still works.

  Ships with `scripts/gcloud/kan170_{verify,path_a,path_b}.sh` (dry-run by
  default) and a runbook at
  `docs/security/KAN-170_PUBLIC_EGRESS_REMEDIATION.md`. Enabling the invoker
  check in production is a separate, staged operator step.

- **Security-scanner and posture exports are no longer committed** (KAN-171,
  [#3299](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3299)).
  A committed Security Command Center findings export published internal
  project identifiers and a list of unremediated findings in a public repo —
  a map of known-unfixed weaknesses, and one of the breadcrumbs that made the
  KAN-170 surface trivially discoverable. Removed, with an ignore rule so
  future exports stay out of git.

## [0.4.6] - 2026-07-25

Backend submodule pointer: `ff92120` → **`38736da`** (Backend `main`, promoted in
Backend [#252](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/252)).
**One new Alembic migration** (`e4a7b2d9c5f1`, chaining onto `d1e5a9c3f7b2`) —
unlike v0.4.5, the `flask-backend-migrate` Cloud Run Job does real work this
release. Head count after it applies: exactly 1.

Two production defects reported during walkthrough round 2, both of which made
ordinary browsing fail rather than any exotic path.

### Fixed

- **Reloading a recipe deep link no longer renders a blank page with a dead
  router** (KAN-159,
  [#3282](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3282)).
  `index.html` shipped no `<base>` element, and the Angular builder injects its
  bundles as bare filenames (`main-<hash>.js`). Browsers resolve those against
  the document's current _directory_, so route depth decided whether the app
  booted at all: `/` and `/kitchen` resolved `/main-<hash>.js` and worked, while
  `/recipe/<id>` asked for `/recipe/main-<hash>.js`, matched no build artifact,
  fell through to the Express SPA catch-all, and got 13KB of `index.html` back
  labelled `text/html`. Adding `<base href="/">` anchors bundle resolution at the
  site root regardless of route depth. A new `src/app-shell.test.ts` guards the
  shell by tokenizing it left-to-right, so markup merely _mentioned_ inside a
  comment can't satisfy the check.

- **Ordinary mobile browsing no longer exhausts the per-IP rate limit**
  (KAN-154,
  [#3281](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3281)).
  Two users sharing one home connection both hit
  `{"error": "Too many requests, please try again later."}` on `/browse` and on
  individual `/r/<slug>` pages — 84 × HTTP 429 on `express-frontend` after the
  v0.4.5 deploy, against 0 in the preceding 24 hours. Every subresource the
  browser fetched on its own was metered as a navigation against the same
  300 req / 15 min bucket, putting one page view at roughly 8 counted requests
  (≈37 page views per 15 minutes before lockout). Three causes, all fixed:
  static subresources are now exempt from the page limiter; `/apple-touch-icon`
  and `/apple-touch-icon-precomposed.png` are served explicitly instead of
  falling through to the catch-all as 13KB of HTML labelled `image/png` (that
  path alone was 44 of the 429s); and the page limiter now owns an `rl:page:`
  Valkey keyspace instead of sharing `rl:api:`, so browsing can no longer drain
  the `/api` budget.

### Added

- **Eighth canonical recipe: orange-chicken-style seitan** (KAN-158,
  [#3283](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3283)
  - Backend [#251](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/251)).
    The set's first Asian/takeout-style entry, already ranking top for a
    partial-slug query with its hero image intact. `is_canonical = true` makes the
    public page durable: `_guard_canonical` refuses unpublish, re-slug, and delete,
    so an indexed `/r/` page can't later turn into a 404. Schema `maxItems` and the
    SEO gate's count bound both move 7 → 8 together, so they can't disagree about
    what is valid.

- **The single-Alembic-head check is now a required merge gate** (KAN-138,
  [#3285](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3285)).
  The check already existed and was already correct — station 4 of
  `scripts/release/train-verify.sh` — but nothing ran it before a merge:
  `release-train.yml` fires only on manual dispatch and a daily cron, and
  `pr-gate.yml` had no Alembic check at all. A pointer bump onto a branched-head
  Backend therefore merged clean and surfaced on the next cron, or at deploy,
  where two heads make `flask db upgrade` refuse, fail the migrate Job, and abort
  the release with the previous Flask revision left serving. The logic moved to
  `scripts/release/alembic-heads.sh` (one implementation, shared by both callers)
  and `pr-gate.yml` gained `Backend — single Alembic head` in `gate.needs`.

## [0.4.5] - 2026-07-25

Backend submodule pointer: `50cdbbb` → **`ff92120`** (Backend `main`, promoted in
Backend [#249](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/249)).
**No new Alembic migrations** — single head unchanged, so the
`flask-backend-migrate` Cloud Run Job runs as a no-op.

### Fixed

- **Valkey IAM token refresh no longer leaves a 30-minute dead window**
  (KAN-16, Backend [#247](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/247)).
  `_refresh_loop()` caught refresh failures and then slept the full 45-minute
  interval, so a failure at t=45min let the token expire at t=60 with no further
  attempt until t=90 — every Valkey cache write failing in between (258
  `AuthenticationError`s over five days). It now retries with exponential
  backoff (30s → 60s → 120s, capped at the normal interval, reset on success).
  The client also forces RESP2, since redis-py 8.x defaults to RESP3 and rewrites
  password-only credentials to `AUTH default <token>`; that is hardening rather
  than the root cause, which remains unidentified — the underlying reason
  refreshes fail is still open.

- **SPA publish-state fix cluster** (KAN-149,
  [#3262](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/3262),
  [#3263](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/3263),
  [#3264](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/3264)),
  from Adam's post-v0.4.4 zucchini-poppers field test:
  - The View link no longer renders a client-predicted slug that could 404
    or point at another recipe on a name collision — the client stops
    deriving slugs on publish entirely and adopts the server-minted slug
    (collision → `-N` suffix) once the sync resolves. Root cause was
    zoneless change detection: the publish flow mutated the recipe object
    in place, so neither the server's corrected slug nor the failure revert
    ever re-rendered; the flip now goes through the signal immutably.
  - Refreshing `/recipe/:id` no longer renders a blank page: the cold
    deep-link fetch treated the `GET /api/recipes/:id` row shape
    (`{…columns, data: {…blob}}`) as the recipe blob, leaving
    ingredients/instructions undefined. The KAN-139 column-over-blob merge
    is extracted into a shared `recipeFromRow` util (per #3209) used by both
    the persistence sync and the deep-link fetch.
  - Toggling publish ON no longer pushes the freshly-mounted View link
    behind the recipe image: the action rows were non-wrapping flex rows
    inside a `minmax(0, 1fr)` grid column, so the extra link overflowed
    under the adjacent `position: relative` image block; the rows now wrap.

- **An unavailable publish toggle now says why** (KAN-143,
  [#3255](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/3255)).
  The reason was hidden in a `title` on a `disabled` button — unreachable by
  keyboard and unreliable on hover — so the toggle just sat there doing nothing.
  It now uses `aria-disabled` and raises a toast explaining the reason.

- **Manual-entry notes stopped being overwritten** (KAN-144,
  [#3256](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/3256)).
  Manual recipes wrote user notes into the shared `notes` field, which the
  generated-recipe path also owns; they now use `personalNotes`, with existing
  entries migrated on first edit.

### Changed

- **Shared recipe logic extracted into `RecipeViewBase`** (KAN-126,
  [#3209](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/3209)) —
  Generator and RecipeDetail had drifted copies of the same publish, save, and
  notes handlers.

- **Release-train verification is now a script, not a memory exercise**
  (KAN-138). `scripts/release/train-verify.sh` checks back-sync debt, promotion
  debt, the submodule pointer against Backend `main`, Alembic head count, the
  CHANGELOG section, and whether the version is already tagged — the last of
  which catches a silent failure where `release.yml` skips the tag, the Release,
  and the Cloud Build trigger while reporting success. `train-backsync.sh` opens
  the `main → dev` back-sync PRs, and a scheduled workflow runs the verifier
  daily.

### Documentation

- **Agent-instruction files single-sourced on `CLAUDE.md`** (KAN-153). The five
  tracked files had drifted into contradicting each other and, in two cases,
  into instructions that fail if followed: `GEMINI.md` told readers to
  `pip install -r requirements.txt` (deleted 2026-07-18), and
  `.github/copilot-instructions.md` directed agents to add `VITE_`-prefixed
  variables for the client bundle, which an Angular CLI build never reads.
  `AGENTS.md` is now a stub carrying only the non-Claude delta.

- Architecture docs corrected to describe Valkey's real role and the actual
  frontend/backend request flows (KAN-150).

## [0.4.4] - 2026-07-24

### Fixed

- **Publish failures are no longer silent** (KAN-104,
  [#3146](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/3146)):
  titles with no ASCII letters/numbers (all-emoji, pure-CJK/Cyrillic) are
  pre-checked client-side with an explanatory toast instead of hitting the
  server's 400 silently, and a publish/unpublish that fails to sync now
  reverts _and_ tells the user (previously it only reverted).

### Security

- **Manually entered recipes can no longer be published** (KAN-140): the
  manual-entry form is unmediated free text, and the notes-abuse walkthrough
  (live-verified) showed post-publish edits reach the public page instantly.
  New Backend `origin` column ('manual' | 'generated' | 'saved', backfilled
  from the manual-entry blob signature, immutable once set) with a publish
  gate returning 400; SPA disables the toggle for manual recipes and stamps
  provenance at creation. **Notes are split into two fields**: generated
  notes are now read-only (they render on the public page) and the editor
  writes a new private `personalNotes` field that the public payload
  allowlist never exposes — closing the edit-notes-after-publish loop
  (live-verified on /r/vegan-zucchini-poppers). Requires Backend
  [tasteslikegood.com#240](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/240).

### Added

- **Scheduled image repair** (KAN-141): new deploy-only Cloud Run Job
  `flask-backend-image-repair` — detects recipes with no image bytes
  (canonical first, then published, then oldest; the blank-hero
  URL-without-bytes rows count as imageless) and enqueues regeneration
  through the existing Pub/Sub worker path, capped per run
  (`IMAGE_REPAIR_LIMIT=10`). Runs daily via a one-time Cloud Scheduler
  trigger created after the first deploy. Backend script:
  [tasteslikegood.com#241](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/241).
- **Publish state resolves to one DB row** (KAN-139,
  [#3217](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/3217)):
  Backend migration adds `is_canonical` (locks the 7 curated canonical
  recipes — unpublish/re-slug/delete return 400; content edits still allowed)
  and `source_slug` (server-side mirror of the blob's `sourceSlug`,
  backfilled). SPA renders the publish toggle greyed while the initial server
  sync is pending and for copies saved from a public recipe (tooltip names
  the source page), disables it outright for canonical recipes, and disables
  delete for canonical recipes in the Kitchen. The SSR CTA's repeat-save
  dedup now waits for the server recipe list, so copies that exist only
  server-side (or with stale local blobs) are caught instead of re-saved.
  Requires the Backend pointer bump to
  [tasteslikegood.com#239](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/239).

---

## [0.4.3] - 2026-07-24

Sprint 3 saved-copy state-machine fixes: the publish toggle and the View link
can no longer disagree, and publishing a saved copy is an informed choice.
No schema migration, no Backend changes (submodule pointer unchanged).

### Fixed

- **Saved-copy view/publish state cluster** (KAN-137): the View link now
  distinguishes a recipe's own published page from the public page it was
  saved from (`publicLinkKind` — 'source' links render muted/italic with an
  explanatory tooltip, WCAG AA contrast); first publish of a saved copy asks
  for confirmation before creating a separate public page; recipes fetched
  via cold deep link no longer misreport as saved (closes
  [#3210](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/3210));
  guests viewing a saved recipe get the generator's "Sign in to publish"
  affordance (closes
  [#3211](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/3211))
  ([#3244](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3244)).
- **Issue Arborist workflow**: allow the safeoutputs CLI in the bash allowlist
  so the agentic workflow can report results (KAN-133,
  [#3239](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3239)).

---

## [0.4.2] - 2026-07-24

SPA architecture upgrade and Sprint 2 close-out: canonical recipe curation with
CI-gated schema, non-blocking SSR save flow, and Angular Router decomposition.
No schema migration.

### Added

- **Canonical recipes Phase 0/1**: tracked `canonical_recipes.json` schema file
  with 7 approved slugs, CI validator gate (`check_canonical_recipes.sh`), and
  `<noscript>` anchors in the home shell serving the approved set
  ([#3216](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3216),
  KAN-116).

### Changed

- **Angular Router + component decomposition**: `AppComponent` reduced from
  1095 to 75 lines. Standalone components with lazy loading (`/kitchen`,
  `/recipe/:id`), `PreloadAllModules`, flat route config in `app.routes.ts`,
  and signal-based service facades (`ToastService`, `ModalService`,
  `RecipeStateService`). Three production chunks instead of one monolith
  ([#3207](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3207),
  KAN-118).

### Fixed

- **Non-blocking SSR save guard**: `/?save=<slug>` no longer blocks initial
  navigation with async I/O — the kitchen page paints instantly while the save
  resolves in the background. Network failures show a retriable error instead of
  a false "not found" message
  ([#3214](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3214),
  KAN-118).

### Dependencies

- Angular group bumped (9 packages)
  ([#3222](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3222))
- `dd-trace` 6.4.0 → 6.6.0
  ([#3224](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3224))
- `rate-limit-redis` 5.0.0 → 6.0.0
  ([#3225](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3225))
- Linting group bumped (3 packages)
  ([#3223](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3223))
- `google-auth-library` 10.9.0 → 10.9.1
  ([#3228](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3228))
- `@google-cloud/secret-manager` 6.2.0 → 6.3.0
  ([#3227](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3227))
- GitHub Actions group bumped (8 actions)
  ([#3226](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3226))
- `body-parser` 2.2.2 → 2.3.0 (upstream CVE fix) and `brace-expansion` bumped
  ([#3212](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3212))
- Backend submodule pointer bumped `18a303a` → `cb218ab` (Backend dev→main
  promotion #236), picking up Backend docs + security/cleanup PRs (Backend
  #229, #230, #232, #233)
  ([#3230](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3230))

---

## [0.4.1] - 2026-07-20

Follow-up fix release: makes a published recipe's public page reachable from
My Kitchen for everyone, not just its publisher. No schema migration.

### Fixed

- **Public-recipe "View" link no longer requires publish rights**: the My
  Kitchen link to `/r/<slug>` was gated on being a signed-in non-guest, hiding
  it from guests and in-app-webview visitors (who cannot sign in at all).
  Visibility is now a pure function of recipe data; the publish toggle stays
  auth-gated
  ([#3195](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3195),
  KAN-119).
- **View link also resolves for copies saved from a public page**: guest-saved
  copies carry only `sourceSlug`, so the link now falls back to it (own
  published slug wins when both exist) — without this the fix above never
  fired for the guest case it targeted
  ([#3197](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3197),
  KAN-119).

---

## [0.4.0] - 2026-07-20

Discoverability and conversion release closing out Sprint 1 (KAN-110). Ends the
home-page crawl dead-end with server-rendered anchors and unblocks Google
sign-in for visitors arriving inside in-app browsers. No schema migration.

### Added

- **Server-rendered crawlable links on the home shell**: the Angular home shell
  previously served only `<app-root>` — a crawler or no-JS client hitting `/`
  found zero anchors, making the public SSR pages (`/browse`, `/r/<slug>`) a
  crawl dead-end. A `<noscript>` nav now ships in the server HTML with
  `<a href="/browse">` plus two published recipe links, without changing the
  JS-rendered UI
  ([#3185](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3185),
  TAS-2896, KAN-114).

### Fixed

- **Google sign-in no longer dead-ends inside in-app browsers**: visitors who
  arrive from Pinterest (and Instagram/Facebook/etc.) view the site inside that
  app's embedded webview, where Google blocks OAuth with
  `Error 403: disallowed_useragent`. The sign-in dialog now detects the in-app
  browser and, instead of firing a doomed consent redirect, shows an "open this
  page in Safari/Chrome to sign in" fallback with a copy-link button. Guest
  saving already works in-webview, so first-time saves are no longer blocked at
  the conversion moment
  ([#3186](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3186),
  TAS-2899, KAN-113).

---

## [0.3.9] - 2026-07-19

Stability and infrastructure release. Restores the Flask backend's shared
Valkey response cache (it had silently fallen back to a per-worker in-memory
cache), gives the backend OOM headroom, dedups the "Save to cookbook" action,
and unclips the public recipe hero on mobile. No schema migration.

### Fixed

- **Flask backend uses the shared Valkey response cache again**: the IAM Valkey
  client never trusted the Memorystore CA, so every TLS handshake failed with
  `CERTIFICATE_VERIFY_FAILED` and the backend silently fell back to a per-worker
  in-memory `SimpleCache` — no cache sharing across workers or replicas, and
  extra heap per worker. The IAM client now trusts the Memorystore CA cert and
  the Cloud Run deploy mounts the `VALKEY_CA_CERT` secret
  ([#3176](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3176),
  Backend [#222](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/222)).
- **"Save to cookbook" no longer double-fires**: a fast double-click could send
  two save requests; the action now guards against in-flight requests and the
  success toast reports what actually happened. The public-page "View" link is
  decluttered and carries `rel="noreferrer"`
  ([#3169](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3169)).
- **Public recipe hero no longer clips on mobile**: the eyebrow/title of the
  `/r/<slug>` hero was cut off on narrow viewports (Backend
  [#221](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/221),
  RCP-45).

### Changed

- **flask-backend memory headroom**: Cloud Run memory raised to **1Gi**
  ([#3173](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3173)),
  the Datadog continuous profiler disabled, and gunicorn workers now recycle on
  a max-request cap (Backend
  [#220](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/220)) —
  headroom over the flat ~84% memory baseline that risked an OOM at the 99% edge.
  Gunicorn's `--graceful-timeout` is raised to **540s** to match
  `GENAI_HTTP_TIMEOUT_MS` so a worker restart lets an in-flight Gemini/Imagen
  call finish instead of the 30s default force-killing it (Backend
  [#224](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/224)).
- **Agent / PM tooling**: new `harness-qa-loop` QA-gated harness skill plus an
  `.env.example` credentials callout
  ([#3177](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3177));
  Confluence sync hardened — md2cf storage format, 409 retry, stable page titles
  ([#3175](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3175));
  the `receiving-code-review` skill is now enforced on PR feedback
  ([#3170](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3170)).
- **Cleanup**: the dead `.continue/` config was removed after Continue was
  decommissioned
  ([#3172](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3172));
  the residual Continue Atlassian connectivity check now targets the
  streamable-HTTP MCP endpoint
  ([#3171](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3171)).

### Deploy notes

- Backend submodule pointer **`4857369` → `18a303a`**. **No new Alembic
  migration** — single head unchanged, so `flask-backend-migrate` is a no-op
  this release.
- The flask-backend Cloud Run deploy now mounts the **`VALKEY_CA_CERT`** secret
  and sets **`--memory=1Gi`**. After deploy, verify in Datadog: Valkey
  connection healthy (no `CERTIFICATE_VERIFY_FAILED`) and a per-worker heap drop
  as the response cache moves off `SimpleCache`.

## [0.3.8] - 2026-07-18

Public-site audit release. Fixes the navigation, dead-link, and SEO defects
from the tiered UX audit ([#3164](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/3164)),
closes the duplicate-cookbook double-click race, and ships the consolidated
CI gate plus Backend dependency refreshes.

### Fixed

- **Apex domain now redirects to the canonical www host**: `tasteslikegood.org`
  served identical 200s to `www.tasteslikegood.org`, splitting indexing signals
  across two hosts even though every canonical URL, sitemap entry, and
  robots.txt line declares www. Express now 301s all apex paths to www (308 for
  non-GET/HEAD so method and body survive), with the redirect target re-parsed
  against the fixed canonical origin so a crafted path can never turn it into
  an open redirect ([#3165](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3165)).
- **Recipe images are no longer blocked from image crawlers**: `robots.txt`'s
  `Disallow: /api/` also swallowed every recipe hero/og:image URL; a
  longest-match `Allow: /api/recipes/*/image` line restores crawler access
  ([#3165](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3165)).
- **`/favicon.ico` serves a real image**: the path fell through to the SPA
  catch-all and returned `index.html` as `text/html`. It now serves the SVG
  favicon bytes with an `image/*` content-type and a one-day cache so repeat
  fetches stop burning the shared per-IP rate-limit budget
  ([#3165](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3165)).
- **`/browse/` (trailing slash) 301s to `/browse`** instead of falling through
  to the empty SPA shell, preserving any query string
  ([#3165](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3165)).
- **Public recipe image responses declare the content-type of their actual
  bytes** (sniffed from magic bytes instead of trusting a stored label — the
  live crawl found 8 URLs declaring `image/png` over JPEG bytes), stop
  emitting cookies/CORS headers, and carry `Cache-Control: public,
max-age=86400`. Recipe pages whose image rows have no stored bytes no longer
  render a hero/og:image that 404s (Backend
  [#217](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/217)).
- **Double-clicking "Create" no longer produces duplicate cookbooks**: the
  create button now guards against in-flight requests and sends an
  `Idempotency-Key` ([#3163](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3163));
  the server enforces a per-owner unique cookbook name with partial unique
  indexes, deduplicates existing rows by rename in migration `b7e2a9c4d1f8`,
  answers replays idempotently, and retries the guest→user login merge on
  `IntegrityError` (Backend [#216](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/216)).
- **CodeQL error-severity backlog drained**: 90 of 142 open Backend alerts
  fixed (Backend [#213](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/213)).

### Added

- **SPA → public-site navigation**: the app footer now links to
  "Browse Public Recipes" — the compiled bundle previously contained zero
  references to `/browse`
  ([#3165](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3165)).
- **`scripts/audit/crawl-links.sh`**: read-only public-site link & image crawl
  gate (sitemap + `/` + `/browse` pagination + every `/r/<slug>`; fails on any
  final status ≥ 400 or an image content-type that doesn't match the
  downloaded bytes) ([#3165](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3165)).
- **`Backend/scripts/unpublish_slugs.py`**: idempotent operator script to
  unpublish junk public slugs, syncing both the `is_public` column and the
  recipe data blob (Backend [#217](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/217)).

### Changed

- **CI consolidated to a single blocking gate** (`pr-gate`), now including an
  Express Docker image build — root-Dockerfile syntax errors surface on the PR
  instead of at release time, closing the gap that burned the v0.3.4 tag
  ([#3157](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3157),
  [#3158](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3158)).
  `dev` and `main` carry required status checks enforced by branch protection
  ([#3162](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3162)).
- **Backend image modernized**: base bumped to `python:3.13-slim` (Backend
  [#206](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/206));
  dependencies now export from `uv.lock` at build time and the tracked
  `requirements.txt` is gone (Backend
  [#215](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/215),
  [#214](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/214));
  `websockets` 16.1.1 (Backend [#209](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/209)),
  `ddtrace` 4.11.1 (Backend [#208](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/208)).
- **Docs**: Copilot instructions rewritten for the current app in both repos,
  Gemini credential-flow corrections, model-ID notes; unused `@google/genai`
  dependency removed
  ([#3154](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3154),
  [#3155](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3155),
  [#3156](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3156),
  Backend [#210](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/210),
  [#212](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/212)).

### Deploy notes

- `flask-backend-migrate` applies **`b7e2a9c4d1f8`** (per-owner unique
  cookbook-name indexes + dedup-by-rename of existing duplicate rows). Single
  Alembic head verified at the pinned Backend SHA `4857369`.
- Post-deploy operator steps (issue [#3164](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/3164)):
  run `Backend/scripts/unpublish_slugs.py` in prod against the item-8 junk-slug
  list, then re-run `scripts/audit/crawl-links.sh` — expected exit 0.

## [0.3.7] - 2026-07-17

Public-URL hardening release. The recipe publish flow no longer accepts a
user-typed `/r/<slug>` address.

### Fixed

- **Removed the free-form public-slug input in My Kitchen**: the publish row
  let any text be saved verbatim as the recipe's public `/r/<slug>` address —
  an abuse vector for a stable, indexed, shareable URL (junk URLs, collisions,
  client/server slug drift). The slug is now always derived from the recipe
  title (client mirror of the server's `normalize_slug`, byte-identical and
  pinned by a 15-case parity test) and shown read-only; the server remains
  authoritative and its collision-resolved slug is reconciled back into local
  state from the save response ([#3138](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3138)).
  Follow-ups tracked in [#3146](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/3146)
  and [#3147](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/3147).
- **Pinterest "Save to Pinterest" button no longer creates broken pins**: the
  button on a public recipe page now renders only when the recipe has a
  genuinely fetchable image, so a recipe whose image is missing (a row with an
  `ai_image_url` but no stored bytes) no longer offers a pin whose media 404s.
  A run of broken pins to a fresh domain can trigger Pinterest's new-account spam
  heuristics. Also adds an inert `p:domain_verify` placeholder in the public
  `<head>` for domain claiming (unlocks Rich Pins). Ships via the Backend
  submodule pointer bump to `c3e4687` (Backend [#200](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/200)).
- **Pinterest pin media now matches the gated image source**: with a stale
  `ai_image_url` (bytes never stored) next to a valid stock image, the
  Pinterest button passed its render gate via the stock image but still
  shipped the dead AI URL as the pin's `media`. The share URL is now built
  from the same signal that passes the gate — the canonical image endpoint
  when stored bytes exist, else the stock image URL (Backend
  [#203](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/203),
  flagged by Copilot review on the Backend promotion PR
  [#202](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/202)).
- **Publish/unpublish now reverts cleanly when the server sync fails**: a
  failed publish toggle kept the optimistic `is_public` state in the UI and
  in localStorage even though the server never saved it. Sync failures now
  surface to `togglePublic()`, which reverts the toggle and re-persists the
  reverted state (on [#3150](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3150),
  flagged by Copilot review).

## [0.3.6] - 2026-07-15

Login fix release. Restores Google OAuth sign-in, which regressed under the
Content Security Policy shipped in v0.3.4.

### Fixed

- **Google OAuth login no longer blanks on the callback**: the OAuth callback
  returned an inline-script HTML page to perform its post-login redirect, which
  Helmet's `script-src 'self'` CSP (added in v0.3.4) blocked — leaving users on
  a blank callback page instead of signed in. The callback now issues a
  server-side 302 redirect instead of relying on client-side script. Ships via
  the Backend submodule pointer bump to `1077e42` (Backend #195, cookbook #3130).

### Changed

- **CI (internal, no runtime impact)**: added an advisory, cost-optimized
  independent Claude review workflow that reviews each PR on a cheaper, different
  model than the authoring session (#3128, #3129), plus a CI/CD refresh plan and
  specs (#3125).
- **Tooling (internal)**: automated session-start/end PM rituals via hooks
  (#3126).

## [0.3.5] - 2026-07-15

Deploy repair release. Identical in content to v0.3.4, which never reached
production: its tag-triggered Cloud Build failed while parsing the Express
Dockerfile, before any image was pushed or deployed.

### Fixed

- **Express Dockerfile parses again**: the unquoted space in
  `ENV NODE_OPTIONS=--require dd-trace/init` made Docker's parser reject the
  Dockerfile (`can't find = in "dd-trace/init"`), aborting the v0.3.4 deploy at
  the image-build step. The value is now quoted. The v0.3.4 tag is superseded
  by this release.

## [0.3.4] - 2026-07-15

Security, observability, and operations release. Adds Express-layer request
validation, enables a scoped Content Security Policy, ships Datadog telemetry
across both services, hardens the Atlassian/Confluence automation, and promotes
the Backend async-generation release line with additional release safeguards.

### Added

- **Express validates AI requests before proxying them to Flask** ([#3110](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3110)): generation and image payloads are size-limited and validated while preserving the raw request bytes for the streaming proxy, with dedicated route and validation coverage.
- **Datadog observability for the production stack** ([#3112](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3112)): the Express and Flask services run through Datadog serverless-init, emit release metadata, and receive the Datadog API key from Secret Manager. The one-shot migration job overrides that entrypoint and remains uninstrumented with no unnecessary access to the telemetry secret.
- **Reliable session logging and PM-daemon controls** ([#3105](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3105), [#3113](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3113)): adds `/wrap`, automatic pre-compaction transcript digests, a direct MCP driver, and a singleton watcher lock so concurrent agent sessions do not race to update Confluence.

### Fixed

- **Helmet now enforces a scoped Content Security Policy** ([#3109](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3109)): scripts, styles, fonts, images, connections, frames, and objects are restricted to the origins the application uses. Public SSR interactions now load from a same-origin static script so the policy does not disable modal and save controls.
- **Logs cannot be split or forged with control characters** ([#3108](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3108)): request, proxy, and error logging share one sanitizer for untrusted path and message values.
- **Backend release blockers are removed** (Backend [#193](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/193)): stops tracking a local SQLite database, preserves server-side sessions during migration, verifies Pub/Sub OIDC audiences against the exact worker URL, makes worker delivery idempotent across retries and guest-to-user ownership changes, prevents cached private images from bypassing ownership checks, binds Gemini execution to an immutable trusted plan, pins CI actions, sanitizes untrusted log values, and hardens partial SSR rendering and keyboard interaction.

### Changed

- **Atlassian automation is constrained to the canonical workspace** ([#3102](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3102)): PM scripts reject the retired service site and restrict recipe-app writes to Jira KAN/RCP, with synchronized routing documentation and an audit trail.
- **Backend submodule promoted to the v0.3.4 release candidate** (Backend [#193](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/193)): includes public SSR and image delivery, Pub/Sub recipe/image workers with retries and status polling, authenticated publishing, route-safe slugs, Datadog/Gunicorn production startup, refreshed CI, and expanded worker/API regression coverage.
- Angular 22.0.6 and related Angular tooling, Helmet 8.3.0, ESLint/TypeScript lint tooling, and GitHub Actions received their scheduled updates ([#3115](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3115), [#3116](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3116), [#3117](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3117), [#3118](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3118)).

## [0.3.3] - 2026-07-11

Stability and automation release. Fixes cookbook editing regressions, makes authenticated publishing explicit, hardens the hosted GCP monitoring connector, repairs the repository's agentic workflows, and adds active-work reflection for Jira/KAN.

### Fixed

- **Recipe editing no longer loses ingredient data** ([#3057](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3057)): the wizard preserves ingredient groups while editing, cookbook creation rejects blank names, and modal controls now have accessible labels.
- **Abandoned manual-entry rows no longer leak into later recipes** ([#3098](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3098)): closing or reopening manual recipe entry clears pending ingredient and instruction drafts before the next save.
- **Publishing is limited to signed-in users** ([#3066](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3066), Backend [#142](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/142)): guests see a clear "Sign in to publish" action instead of a control that cannot complete, while the backend rejects guest publishing and migrates previously guest-published rows safely.
- **Hosted gcp-monitor connector reliability** ([#3058](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3058), [#3060](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3060), [#3078](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3078)): secret-path routing now works with connector registration, reverse-proxy host validation no longer rejects Cloud Run traffic, and `metric_pb2` is imported consistently.
- **PM session-log configuration matches the documented environment variables** ([#3065](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3065), [#3079](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3079)): session logs target the Agent Session Logs index and receive the expected label.
- **Agentic workflows compile and run again** ([#3077](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3077), [#3091](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3091), [#3093](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3093)): Daily Repo Status uses the current gh-aw runtime, and Issue Arborist now uses the built-in GitHub token with a regenerated lock file whose frontmatter hash matches its source.
- **Backend operational endpoints are safer and accurate** (Backend [#147](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/147)): `/api/migrate` requires an admin token and `/api/status` performs a working database health probe.

### Added

- **Issue Arborist automation** ([#3089](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3089), [#3093](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3093)): periodically groups strongly related GitHub issues into parent/sub-issue relationships, with compiler-generated maintenance for expiring safe outputs.
- **Jira/KAN work reflection** ([#3080](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3080)): `npm run pm:reflect` compares the active branch, changed files, recent commits, and referenced issues with KAN/RCP, then writes board-alignment recommendations under `.agent-work/pm/`.
- **Reverse-engineered product reference** ([#3082](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3082)): documents current pages, API inventory, data model, enums, and platform behavior under `prd/`.

### Changed

- Angular 22.0.5 -> 22.0.6, `@google/genai` 2.10 -> 2.11, Vite 8.0.16 -> 8.1.4, Node types 25 -> 26, plus testing and linting patch updates ([#3000](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3000), [#3071](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3071), [#3073](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3073), [#3074](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3074), [#3075](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3075), [#3076](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3076)).
- Backend submodule `ef594bf` -> `3883f00`, adding authenticated publishing enforcement and the operational endpoint fixes above. Alembic remains on one head (`e91b47a2c5d3`).
- Repository and agent-tooling pointers were refreshed, runtime artifacts were explicitly parked/ignored, and session-start synchronization guidance was tightened ([#3068](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3068), [#3085](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3085)).

## [0.3.2] - 2026-07-05

Regression-fix release for v0.3.1: restores styling on the server-rendered public pages, makes async recipe generation retry transient model failures, and un-shadows the dynamic sitemap. Also brings the GCP monitoring MCP server to Cloud Run as an authenticated Claude connector and gates PRs targeting `dev` with the full CI suite.

### Fixed

- **Public SSR pages render styled again** ([#3047](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3047), [#3048](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3048)): Express proxied `/r/*`, `/browse`, and `/sitemap.xml` to Flask but not `/static/*`, so the SSR templates' stylesheet requests fell through to the SPA catch-all and came back as `index.html` (`text/html`) — Helmet's `X-Content-Type-Options: nosniff` then made browsers refuse to apply them, leaving every public page unstyled. `GET /static/*` is now proxied to Flask (mounted after `express.static`, so Angular build assets still win on collision). `server/index.ts` exports `app` and a `ready` promise with the listener skipped under `VITEST`/`NODE_ENV=test`, backed by new route-mounting integration tests (`server/routes.test.ts`).
- **Async recipe generation survives flaky model responses** (Backend [#141](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/141) via [#3049](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3049)): `gemini-3.1-pro-preview` intermittently returns truncated JSON, and the Pub/Sub worker was single-shot with only "Unknown error" logging — users saw "generation failed during async processing". The worker now retries transient generation failures up to `GENERATION_MAX_ATTEMPTS` (default 3) and failure records carry the real error message (validation failures wrapped as `ValidationError`). Backend submodule `b359743` → `ef594bf`.
- **Dynamic sitemap unshadowed** ([#3041](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3041)): a stale static `public/sitemap.xml` was served by `express.static` ahead of the Flask proxy route, hiding the dynamic sitemap of public recipes shipped in v0.3.1. Deleted.

### Added

- **GCP monitoring served over HTTP for Claude connectors** ([#3051](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3051), [#3052](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3052)): the gcp-monitor MCP server can now run as an authenticated Streamable-HTTP service on Cloud Run — keyless (runs as a `roles/monitoring.viewer` service account via ADC), bearer-token auth from Secret Manager, token also accepted via `?key=` query param for connector UIs without header support — with a Dockerfile and `deploy_mcp_cloud_run.sh`. Cloud routines get the monitoring tools first-class instead of shelling out to scripts.
- **gcp-monitor cloud-session resilience** ([#3043](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3043), [#3044](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3044), [#3046](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3046)): prebuilt-venv fast path so the stdio server survives cloud-routine cold starts, retries around transient PyPI timeouts in the setup script, and project MCP servers pre-approved in `.claude/settings.json` for cloud sessions.

### Changed

- **CI: pull requests targeting `dev` now run the lint/test/build gate** ([#3050](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3050)) — previously the gate only ran on pushes, so a broken PR could merge green.
- Docs: GBrain config + search guidance in `CLAUDE.md` refreshed ([#3042](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3042), [#3045](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3045)); `docs/MCP_GCP_MONITORING.md` expanded with the Cloud Run connector setup (§ 4.5).

## [0.3.1] - 2026-07-04

Deploy hotfix. The v0.3.0 tag was cut but its Cloud Build died in the `flask-backend-migrate` job (`ModuleNotFoundError: flask_cors`) before either service deployed — production kept serving v0.2.5 throughout. v0.3.1 is v0.3.0 plus the dependency fix; it is the release that actually ships the v0.3.0 feature set.

### Fixed

- **Backend image lost 14 runtime dependencies** (Backend [#140](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/140)): a Dependabot uv-group bump (Backend #133) regenerated `requirements.txt` — which the Dockerfile installs from — dropping flask-cors, flask-migrate, flask-sqlalchemy, alembic, psycopg2-binary, google-cloud-storage, google-cloud-pubsub, redis and more. `google-cloud-storage`/`google-cloud-pubsub`/`redis` are now declared in `pyproject.toml` (they were imported by services but never listed there), `requirements.txt` is regenerated from `uv.lock`, and a new Backend CI step fails on any future drift between the two. Backend submodule pin: `2baccf2` → `b359743`.

## [0.3.0] - 2026-07-04

Feature release: server-rendered public recipe/browse pages with a styled shell and Save-to-Cookbook flow, the Angular 22 + TypeScript 6 upgrade, GCP monitoring tooling, a production Valkey TLS fix, Atlassian/PM tooling, a repository cleanup, and a batch of dependency updates.

### Added

- **SSR recipe & browse pages with a "Save to Cookbook" CTA.** Public recipes render server-side. The CTA is a server-rendered link to `/?save=<slug>#kitchen`; `AppComponent.handleSaveFromSSR()` fetches the recipe from the new `GET /api/recipes/public/<slug>` JSON endpoint (Backend [#139](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/139)) and saves it to the guest/user cookbook through the session-aware flow (fresh id, image fields preserved), then cleans the URL. A `#kitchen` hash deep-links straight into the cookbook view (`syncViewFromLocation`).
- **Styled public shell + SEO** (Backend [#132](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/132)): `base_public.html` layout with design tokens (`tokens.css`, `recipe-site.css`), canonical/Open Graph/JSON-LD metadata, Pinterest share, and a dynamic `/sitemap.xml` of public routes.
- **Public recipe save flow** wired into the kitchen.
- **GCP monitoring MCP server + "Run System Health Check" routine** (#3008, #3020): read-only Cloud Monitoring tools covering Cloud Run, Cloud SQL, Valkey, and Pub/Sub, with an SRE health-report skill.
- **Atlassian / PM tooling.** `.pi/` Atlassian AOTA extension, session-log skill + schemas, background pm-daemon controls, and session-log publishing scripts. New `docs/PM_TOOLING.md` and `.github/CODEOWNERS`.

### Fixed

- **Production Valkey TLS trust** (#3027): Memorystore server certs chain to a Google-managed private CA, so every Express instance failed TLS verification and silently fell back to in-memory rate limiting. The new `VALKEY_CA_CERT` secret (full CA bundle, created by `scripts/gcloud/setup_valkey_ca.sh`) is passed as `tls.ca`, keeping verification enabled. Closes #163.
- **SSR save flow hardened** (#3031, Backend #139): saves from public pages no longer race the startup auth check (a stale cached authenticated session could swallow the save), keep their `ai_image_url`/`stock_image_url`, and always get a fresh id so they sync server-side. The old inline localStorage CTA (which bypassed all of this) is replaced by the server-backed flow above.

### Changed

- **Angular 21 → 22 and TypeScript → 6.0.3** (#3009), with `@angular-eslint/*` 22.x moved in lockstep.
- **Repository cleanup.** Reorganized docs, moved scripts under `scripts/git` and `scripts/pm`, removed clutter (a stray email file, Confluence JSON dumps, a GitHub-skyline STL, `scripts/output.md`, etc.), and rewrote the README.
- `.gitignore` now ignores Python virtualenvs (`scripts/pm/.venv`).
- **Backend submodule** bumped to `2baccf2`, the Backend `dev` integration tip. It carries the public recipe SSR routes + data model (`ade81bc`), the `is_public`/`slug` column sync (`3987d9a`), the Alembic status+slug head merge (`534898c`, single migration head `c60f6530f4ff`), the styled public shell + SEO (#132), the public recipe JSON endpoint + SPA-routed Save CTA (#139), removal of the failing Gemini Dispatch CI pipeline (#138), and the latest dependency bumps. Verified resolvable against `origin/dev`.

### Dependencies

- helmet 8.1→8.2, ioredis 5.10→5.11.1, google-auth-library 10.6→10.9, @google-cloud/secret-manager 6.1.1→6.2.0, globals 17.5→17.7, @types/node 25.6.0→25.6.2, vite 8.0.10→8.0.16, hono override →4.12.26 (clears two high-severity advisories), eslint 10.6, prettier 3.9.4, @typescript-eslint/eslint-plugin 8.62.
- **Major bumps:** `@google/genai` 1.50→2.x (not imported in TypeScript — version-only), `rate-limit-redis` 4.3→5.0 (API-compatible with the existing `RedisStore` usage in `server/security.ts`), `express-rate-limit` →8.5.2.
- Docker base image `node:25-alpine` → `node:26-alpine`, with CI `node-version` pinned to 26 to match; GitHub Actions group bumps.

## [0.2.5] - 2026-05-06

Hotfix on top of v0.2.4 — Google OAuth login was returning HTTP 500 for some returning users.

### Fixed

- **OAuth callback tolerates Google's scope bundling for returning users.** Backend [#128](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/128). Users who had previously consented to `cloud-platform` (from an earlier deploy that requested it before commit `d85e3dd` removed the scope) were getting `{"error":"Authentication failed"}` on every login attempt — Google was bundling the previously-granted scope back into the token response, and `oauthlib`'s strict `validate_token_parameters` was raising on the scope-set mismatch (`Scope has changed from "openid userinfo.email userinfo.profile" to "openid userinfo.profile cloud-platform userinfo.email"`). Two-part fix: (1) drop `include_granted_scopes="true"` from the `/api/auth/login` authorization URL since the cookbook already requests its full scope set up front, and (2) set `OAUTHLIB_RELAX_TOKEN_SCOPE=1` at module import as defense-in-depth for accounts still carrying stale grants. Backend submodule bumped to `397ba90`.

## [0.2.4] - 2026-05-04

Bug-fix release on top of v0.2.3, plus PM tooling and docs reorganization. Corrects two UX regressions (browser back button, AI image persistence), ships the new Jira/Confluence/PR sync script that PR #2903 introduced, moves planning docs into `specs/`, and bumps the Backend submodule onto the green `dev` tip after the test-fixture fix lands.

### Fixed

- **Browser back button now restores the correct view.** `src/app.component.ts`'s `popstate` handler had its mappings inverted: returning to a `{view: 'kitchen'}` history entry switched the user to the generator (and vice versa). Pressing back from a recipe detail dropped users on the generator instead of the kitchen, and pressing back from the kitchen was effectively a no-op. The handler now mirrors the `pushState` calls in `switchView`/`viewRecipe` so back navigation matches user intent.
- **AI-generated recipe images survive a refresh.** `src/services/auth.service.ts`'s `hydrate()` now merges `ai_image_url` from localStorage into API recipe data when the backend hasn't persisted the image URL yet (Pub/Sub write hasn't landed). The merge uses a `Map` keyed by recipe id so the cost is O(n+m) instead of O(n·m).
- **Public recipes show up at `/browse`.** Backend `create_recipe()` now syncs the `is_public` and `slug` columns from the recipe payload on create, update, and migration paths, so saving a recipe as public actually flips the DB column the listing query filters on.
- **Backend test fixtures reliably bind to `:memory:`** — Backend issue [#118](https://github.com/adamtasteslikegood/tasteslikegood.com/issues/118). `tests/test_migration_backfill_slug.py` had been failing on every CI run since the SSR/data-model PR landed (`table recipe has no column named status`) because the fixture updated `SQLALCHEMY_DATABASE_URI` _after_ `create_app()` had already let Flask-SQLAlchemy latch onto the file-based dev DB. `create_app()` now accepts config kwargs that are applied before `db.init_app()`, and both the `test_migration_backfill_slug.py` and `test_public_ssr.py` fixtures use the new signature. Backend pytest is fully green again on the PR-gate workflow.
- **PM sync scripts follow the docs into `specs/`.** `sync_docs_to_confluence.py` and `scripts/pm/atlassian_pm_link.py` had their planning-doc paths still pointing at repo root; both now read from `specs/` so the Confluence sync and PM briefing pick up the canonical locations again.

### Added

- **`scripts/pm/sync_jira_confluence_status.py`** — one-shot sync that prints production-site health, open GitHub PR check status, open + recently-updated Jira issues for the `KAN` project, and Confluence pages mentioning the current release. The release version is read from `package.json` (override with `RELEASE_VERSION`); `ATLASSIAN_CONFLUENCE_PARENT_PAGE_ID` and `ATLASSIAN_CONFLUENCE_KEY_PAGES` env vars let callers retarget the workspace without editing the script.
- `scripts/pm/requirements.txt` declares the runtime deps (`requests`, `python-dotenv`).

### Changed

- **Planning docs moved from repo root to `specs/`.** `plan.md`, `roadmap.md`, `planning_notes.md`, `design-plan.md`, `SCRUM_BOOTSTRAP_AND_BOARD_PLAN.md`, `SPRINT_0_PLAN.md`, `ATLASSIAN_PM_LINK.md`. `CLAUDE.md`'s pm-daemon paths reference the new locations; the watcher in `alirez-claude-skills/pm-daemon/pm_daemon.py` matches by basename so it picked up the move automatically.
- **`AGENTS.md` rewritten for OpenCode.** Removed the gstack-specific routing block, added a `Backend submodule` "CRITICAL" section, and added pointers to the PM tooling.
- **`.gitignore`** now ignores `.claude/scheduled_tasks.lock` and `.omg/state/` (agent runtime state, not version-controlled).
- Backend submodule pointer bumped to the post-#127 `dev` tip so the cookbook ships with the test-fixture fix in place. No runtime behavior changes.

## [0.2.3] - 2026-04-30

Hotfix on top of v0.2.2 — the migrate Job couldn't reach Cloud SQL.

### Fixed

- `cloudbuild.yaml`: add `--set-cloudsql-instances=comdottasteslikegood:us-central1:vegangenius-db` to the `flask-backend-migrate` Cloud Run Job. The `DATABASE_URL` secret is configured for a Cloud SQL Unix-socket connection (`postgresql://...?host=/cloudsql/<instance>`) — without this flag the socket path doesn't exist in the Job container and SQLAlchemy falls back to localhost, failing with `OperationalError: Is the server running locally and accepting connections on that socket?`. The v0.2.2 build aborted at "Execute Migrate Job" because of this; the new Flask revision was correctly _not_ deployed (the gate worked), but no migration ran. v0.2.3 rebuilds with the corrected Job spec.

## [0.2.2] - 2026-04-30

Production hotfix: restore recipe generation and auth on tasteslikegood.org.

### Fixed

- **Database migrations now run automatically before each Flask deploy.** A new Cloud Run **Job** (`flask-backend-migrate`) wired into `cloudbuild.yaml` runs `flask db upgrade` against Cloud SQL before the Flask service is redeployed. A failing migration aborts the build so the old Flask revision keeps serving traffic. This closes the gap that caused the v0.2.0/v0.2.1 production outage: schema-changing migrations (`recipe.status`, `recipe.slug`, `recipe.is_public`) shipped without ever being applied to prod.
- **Backend submodule pointer bumped to `dev` tip (`15ba254`)**, which now contains an Alembic merge migration unifying the previously branched heads (`03da1e46c9a5` for `recipe.status` and `fc014cd27ab4` for `recipe.slug`/`recipe.is_public`). Without this merge, `flask db upgrade` would have refused to run on prod regardless of when it was called.
- `.gitmodules`: Backend submodule branch tracker fixed from `dev/backend_sub222` (deleted upstream) → `dev`. `git submodule update --remote Backend` now resolves correctly again.

### Changed

- `CLAUDE.md` and `AGENTS.md`: explicit **Branching strategy (FINAL)** section codifies `main` = release, `dev` = integration, feature branches off `dev`. New **Database migrations** section documents the Cloud Run Job and the multi-PR head-conflict policy (`flask db merge`). Release flow updated to include the migrate step. Backend submodule non-obvious pattern rewritten with the current `dev` branch and `flask db heads` check.

## [0.2.1] - 2026-04-29

Post-v0.2.0 polish: repo hygiene, Cloud Run image trimming, agent-tooling wiring. No user-facing app changes.

### Added

- `.mcp.json` registers the `pm-daemon` MCP server (from `alirez-claude-skills/pm-daemon` via `scripts/pm/run_pm_daemon.sh`) so Claude Code, Codex, and other agents auto-spawn the daemon on session start. The daemon watches plan files (`plan.md`, `roadmap.md`, `planning_notes.md`, `design-plan.md`, `SCRUM_BOOTSTRAP_AND_BOARD_PLAN.md`, `SPRINT_0_PLAN.md`, `ATLASSIAN_PM_LINK.md`) and syncs them to Confluence in the background. Deletes orphaned `auto_pm_mcp.json` (wrong filename — Claude Code reads `.mcp.json`).
- PM daemon (`alirez-claude-skills/pm-daemon`) gains recursive plan-file matching (uses `rglob`) and a `--watch-only` mode for running the watcher without MCP transport
- "Always check the `Backend/` submodule repo for PRs and changes" guidance in CLAUDE.md and AGENTS.md, with `gh pr list -R adamtasteslikegood/tasteslikegood.com` and `git -C Backend log` commands. Backend/ is roughly half the project; missed PRs there have caused integration drift on past releases.
- Cloud Build trigger regex documentation in CLAUDE.md — production deploys fire only on tags matching `^v[0-9]+\.[0-9]+\.[0-9]+$`, so pre-release tags like `v0.2.1-rc.1` or build-metadata tags like `v0.2.1+sha.abc` cannot accidentally trigger a production push.

### Changed

- Expand `.dockerignore` and `.gcloudignore` to keep planning, PM, AI/agent tooling (`.codex/`, `.gemini/`, `.junie/`, `.clawhub/`, `claude-code-tresor/`, `skills/`), Python venvs, and non-runtime submodules (`alirez-claude-skills/`, `gemstack/`) out of the Cloud Run build context. Smaller image, faster build, less surface area.
- Clean up `.gitignore`: resolve unresolved `<<<<<<<` / `>>>>>>>` merge conflict markers that had silently been there (likely a missed conflict during a previous merge from `origin/main`), dedupe entries, add Python bytecode patterns, and stop ignoring `AGENTS.md` so the agent-facing guidance is actually tracked in git.

### Fixed

- Bump `alirez-claude-skills` submodule pointer to pick up recursive plan-file watching and `--watch-only` mode in `pm_daemon.py` (was silently uncommitted in the parent for ~3 days)

## [0.2.0] - 2026-04-29

The "Anti-Recipe Site" release. Public recipes can now be shared via clean URLs that crawlers and JS-flaky in-app browsers (Facebook, Instagram) render correctly. Recipe and image generation moved off the request thread onto Pub/Sub workers, so the UI returns instantly instead of holding the connection open for 30+ seconds.

### Added

- Public recipes: toggle "Make Public" on a saved recipe and share `/r/<slug>` — server-rendered HTML with photo, ingredients, instructions, and a working CTA. Indexed by Googlebot. ([TAS-2718](https://linear.app/tasteslikegood/issue/TAS-2718))
- `/browse` index page lists every public recipe with author byline and pagination
- `slug` and `is_public` columns on recipes plus a backfill script for existing entries
- Async AI generation via Pub/Sub: `POST /api/generate` and `POST /api/generate_image` now return 202 instantly; recipes complete in the background and the UI polls for status
- `/api/worker/recipe` and `/api/worker/image` HTTP push endpoints with OIDC verification — Pub/Sub signs each push with a JWT that the endpoints validate against `PUBSUB_INVOKER_SA` before processing
- `scripts/gcloud/setup_pubsub.sh` and `scripts/gcloud/update_push_endpoints.sh` for one-time GCP infrastructure setup (topics, subscriptions, IAM, dead-letter queue)
- Branching guidance in CLAUDE.md, COPILOT.md, and GEMINI.md: always branch off `dev`, never commit directly to `dev` or `main`

### Changed

- SSR proxy routes (`/r`, `/browse`, `/sitemap.xml`) moved from `app.use()` to `app.get()` with rate limiting via `staticPageLimiter` — non-GET methods 404 cleanly, no bot POST spam reaches Flask
- "Make Public" toggle replaced with proper `<button role="switch">` + `aria-labelledby` for screen reader support and to satisfy `@angular-eslint/template/label-has-associated-control`
- `Recipe` model gains a `status` column (`pending`, `ready`, `error`) so the frontend can poll while async generation completes

### Fixed

- OAuth scope reduction: removed broad `cloud-platform` scope from user auth so the consent screen no longer triggers a Google security warning that was scaring away recipe-share recipients
- `Backend/blueprints/worker_api_bp.py` import was missing from `app.py` — the container would have crashed on startup with `NameError`
- Catch `shutdownValkey()` failures inside `createValkeyClient()` so a broken `quit()` cannot prevent reinitialization or fallback to in-memory rate limiting ([TAS-48](https://linear.app/tasteslikegood/issue/TAS-48/catch-quit-failures-before-reinitializing-valkey-client))
- On startup, clear the cached authenticated user when the Flask session is gone instead of downgrading it to guest — prevents the header showing "Sign In" while Kitchen still lists the previously authenticated user's recipes ([TAS-2725](https://linear.app/tasteslikegood/issue/TAS-2725/bug-ui-shows-logged-out-state-login-button-while-still-displaying))
- `.gitmodules` now points `gemstack` at the correct upstream (`adamtasteslikegood/gemstack`) so CI can fetch the recorded SHA

### Removed

- 38MB of stray ImageMagick PostScript dumps committed to repo root with cryptic names (`base64`, `json`, `logging`, `markdown`, `os`, `requests`, `sys`)
- Broken `dependency-submission.yml` workflow — GitHub natively detects npm dependencies from `package-lock.json` ([TAS-2713](https://linear.app/tasteslikegood/issue/TAS-2713/snapshot-github-action-failing-still))
- Standalone pull-based Pub/Sub worker scripts (`Backend/workers/recipe_worker.py`, `image_worker.py`, `run_workers.py`) — replaced by HTTP push endpoints
- Duplicate `gemstack` entry in `.gitmodules`

### Infrastructure

- Cloud Run flask-backend env vars now include `GCP_PROJECT_ID` and `PUBSUB_INVOKER_SA` so the worker endpoints know which OIDC issuer to trust
- New GCP service account `pubsub-pusher@comdottasteslikegood.iam.gserviceaccount.com` with `roles/run.invoker` on flask-backend; flask service account gains `roles/pubsub.publisher`
- Push subscriptions configured with 600s ack-deadline (Imagen takes 30-90s), exponential retry backoff, and dead-letter routing to `generation-dlq` after 5 failed deliveries

### Internal

- Mark all `inject()` service references as `readonly` across Angular components and services ([TAS-2707](https://linear.app/tasteslikegood/issue/TAS-2707/find-a-small-improvement-copy))
- Use `Number.parseInt()` instead of global `parseInt()` in `server/valkey.ts` for consistency with the rest of the codebase
- Add descriptive context to bare `console.error()` in recipe import error handler

## [0.1.0] - 2026-04-13

### Added

- Angular 21 SPA with Signals API — recipe generation, AI food photos, personal cookbook
- Google OAuth 2.0 authentication with guest-session fallback (localStorage)
- Express reverse proxy with Helmet, rate limiting (Valkey / in-memory fallback), request logging
- Flask API with modular blueprint architecture: auth, generation, recipes, collections
- AI recipe generation via Google Gemini; AI food photography via Imagen
- Cloud SQL (PostgreSQL) persistence with Alembic migrations; SQLite for local dev
- Dual-auth pattern: user OAuth credentials → server `GOOGLE_API_KEY` fallback
- Guest-to-authenticated session merge on OAuth login
- Privacy policy page at `/privacy-policy` (KAN-5)
- Valkey IAM auth with periodic token refresh and 3-second graceful shutdown timeout (KAN-16)
- `generation_api_bp` blueprint registered in Flask app (KAN-23)
- `OAUTHLIB_INSECURE_TRANSPORT` guarded behind non-production env check (KAN-29)
- `FLASK_SECRET_KEY` fail-fast on startup in production (KAN-29)
- `client_secret` removed from session cookie; injected at runtime from Secret Manager (KAN-24)
- HTTP 500 error messages sanitized — no internal details exposed to clients (KAN-24)
- Two Cloud Run services: `express-frontend` (public) and `flask-backend` (private VPC) in us-central1
- Cloud Build pipeline with SemVer image tagging (`$SHORT_SHA` + `$_VERSION`) (KAN-32)
- Deploy ordering: Flask backend deploys before Express frontend to prevent version skew (KAN-30)
- Automated CI: PR gate (`pr-gate.yml`) with lint, type-check, build, test, and CHANGELOG checks
- Automated release pipeline (`release.yml`): git tag + GitHub Release + Cloud Build on merge to main
- Branch strategy: `main` (production), `dev` (integration), `fix/KAN-XX` / `feat/KAN-XX` feature branches

### Security

- KAN-23: `generation_api_bp` blueprint registration fix (AI endpoints were unreachable)
- KAN-24: Sanitized all Flask 500 responses; removed `client_secret` from session storage
- KAN-16: Valkey shutdown timeout prevents Cloud Run SIGTERM window exhaustion
- KAN-29: `FLASK_ENV=production` activates production-only guards in Cloud Run

---
