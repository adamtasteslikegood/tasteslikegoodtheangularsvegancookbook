# KAN-329 / KAN-330: publish gate hotfix plan (v2)

**Status:** v2, 2026-10-05. Rewritten after the Codex adversarial review rejected v1
(`specs/KAN-329_CODEX_ADVERSARIAL_REVIEW.md`). Not yet implemented.

**Tickets:** KAN-329 (Backend), KAN-330 (SPA), KAN-328 (content lock, now part of this
hotfix). Outside the hotfix: KAN-327.

**Where the work happens:** private advisory forks only. Both public repositories stay
untouched until the advisories are published.

- Backend: `tasteslikegood.com-ghsa-48gm-m2wj-96xh`, branch `advisory-fix-1`
- Cookbook: `tasteslikegoodtheangularsvegancookbook-ghsa-8744-3qm2-c4x8`, branch `advisory-fix-1`

**Release:** rides v0.5.8. The bump (#3611) is on `dev`; release PR #3612 (`dev` → `main`)
is open and **must not merge until this hotfix is on `dev`**. The `## [0.5.8]` CHANGELOG
section and the Backend pin need updating.

**Code read at:** cookbook `826069a`, Backend `0506f0f`.

## The hole

Found when Adam exported 145 recipes from production and imported the file into staging:
each recipe's `is_public: true` was honored.

The import screen is one way to send the request. The server accepts it from any signed-in
account:

- `Backend/repositories/db_recipe_repository.py:1027` honors the payload's `is_public` on
  create. Guests are forced private (`:633-638`).
- The only content gate refuses `origin == "manual"` (`:199`). `origin` is read from the
  request body (`:186-187`, `:1030`). A missing origin passes.
- The generate endpoint never writes origin (`blueprints/generation_api_bp.py:97`); the SPA
  does (`src/components/generator/generator.component.ts:101`).
- `tests/test_manual_origin_gate.py:98` and `:109` assert this as correct.

What v1 missed (Codex, verified): a server-written label on the row is not enough, because
the owner can overwrite the row's content afterwards.

- `POST /api/recipes` with an existing id is an upsert that merges every client field
  (`:972`); `PUT` does the same (`:1157`).
- `/api/generate` returns the placeholder's id before any AI output exists
  (`generation_api_bp.py:91-132`), so a v1 stamp on the placeholder could be taken over at
  once.
- A guest can do the same privately, then sign in; the login merge keeps origin
  (`blueprints/auth_api_bp.py:242-274`).
- Public pages check only `is_public` and slug (`blueprints/public_bp.py:943-952`,
  `:1186-1191`, `:1431-1440`), not status or origin.

## Decisions

| ID  | Question                                        | Answer (Adam, 2026-10-05)                                        |
| --- | ----------------------------------------------- | ---------------------------------------------------------------- |
| D1  | Change the server's publish gate?               | Yes                                                              |
| D2  | Remove `is_public`/`slug` copies from the blob? | Not in the hotfix. KAN-327                                       |
| D3  | Lock generated content against client rewrites? | **Yes, in the hotfix** (reverses the v1 answer; KAN-328)         |
| D4  | Existing rows with no trusted origin            | Audit, then bless approved public rows only. No blanket backfill |
| D5  | Recycle-bin restore of a generated recipe       | Restored recipes are private-only. KAN-331                       |
| D6  | Import feature                                  | **Removed** in the hotfix                                        |
| —   | Release                                         | Rides v0.5.8                                                     |

Fact behind D3: the app has no recipe-edit feature. On a saved recipe it only changes
`ai_image_url` (`src/components/shared/recipe-view.base.ts:203`) and `is_public` (`:392`).

Note on D6: removing import does not by itself close the hole (a direct POST does the same
thing); the Backend rules below do. It removes the path that was hit, the same-id rewrite
of a public recipe through a file, and the bulk image-generation cost, with nothing to
harden. Export stays.

## The rule after the fix

```
A recipe may be public only if:
  1. the worker finished generating it         (origin = 'generated', written by the worker)
  2. its content is still the worker's content  (clients cannot change it)
  3. the owner is signed in and it is not a saved copy   (unchanged)
```

```
POST /api/generate ──> placeholder row, origin NULL          (not publishable)
        │
        ▼
worker completes ──> update_recipe_for_worker writes content
                     and sets origin = 'generated', status = 'ready'
        │
        ▼
client POST/PUT on that row ──> only is_public and ai_image_url are taken from the payload;
                                every other field is ignored (the worker's content stays)
        │
        ▼
is_public: true ──> allowed (origin generated, status ready, signed in, not a copy)

client POST of a NEW row ──> origin may be 'manual' or 'saved' only; is_public forced False
client PUT is_public:true on a non-generated row ──> 400
```

## Backend (KAN-329 + KAN-328), Backend advisory fork

1. **Stamp at completion.** `update_recipe_for_worker` (`:784-835`) adds
   `"origin": "generated"` to its column update when it moves the row to its finished
   status. The placeholder created at `generation_api_bp.py:99` carries no origin.
2. **Clients cannot claim it.** `_resolve_origin` (`:177-187`) stops accepting `generated`
   from a payload; `manual` and `saved` remain. Covers `:995`, `:1030`, `:1202`.
3. **Content lock.** In the upsert branch (`:972`) and `update_recipe` (`:1157`), when the
   persisted row's origin is `generated`, build the merged blob from the persisted data
   plus only `is_public` and `ai_image_url` from the payload. Ignore the rest; do not
   refuse, because the SPA echoes the whole recipe on every save
   (`src/services/persistence.service.ts:645-650`). A placeholder that is still generating
   (origin NULL, active status) accepts no client content either.
4. **Publish rule.** Publishing requires origin `generated` and a finished status.
   - New row asking to be public: saved private (same treatment guests get), not refused.
     This keeps old cached app bundles from leaving a local "published" ghost.
   - Existing row, private → public, not generated: 400 with reworded text covering
     manual, imported and hand-posted recipes.
   - Unpublishing is always allowed for a non-canonical row.
5. **No blanket backfill.** See "Audit" below.
6. `migrate_file_to_db` (`:1597`) stops honoring `is_public` from a file.

Open point to settle while implementing: `ai_image_url` is client-written and then
re-confirmed by the worker (`src/utils/recipe-row.ts`, image-pipeline comment). Check
whether the server can own it outright so the allowlist shrinks to `is_public`. If not,
restrict it to the app's own `/api/recipes/<id>/image` form.

## SPA (KAN-330), cookbook advisory fork

7. **Remove import.** Delete `onImportFileSelected` and `generateMissingImages`
   (`src/components/kitchen/kitchen.component.ts:370-434`), the file input
   (`kitchen.component.html:294`), `importRecipes` (`src/services/auth.service.ts:477-522`)
   and their references.
8. **Export drops server-owned fields** (`is_public`, `slug`, `origin`, `is_canonical`,
   `first_published_at`, `slug_reserved`) through one function beside `recipeFromRow` in
   `src/utils/recipe-row.ts`. Two call sites: bulk export (`kitchen.component.ts:357`) and
   single export (`src/components/shared/recipe-view.base.ts:461`).
9. **Toggle.** `publishToggleKind` (`src/utils/public-link.ts:107`) and the guard at
   `recipe-view.base.ts:356` disable only the private → public transition for a recipe
   that is not `generated`. Unpublishing a public recipe stays available.
10. `generator.component.ts:101` stops sending `origin: 'generated'` (the server ignores it
    now); the SPA reads origin from the row the save returns.

## Audit (blocking, before the advisories are published)

No query can tell a truly generated row from one that claimed `generated` or was posted
with no origin. So every row that is public today is reviewed by a person.

1. List public rows on production and staging: id, slug, name, owner email, origin,
   created. Production is reached through Cloud SQL Studio.
2. Adam marks each row keep or unpublish.
3. Keep: set `origin = 'generated'` (it becomes content-locked). Unpublish: set
   `is_public = false` in the column and the blob, as `scripts/unpublish_slugs.py` does.
   Never delete: a deleted published slug is retired for good (KAN-288).
4. Save the reviewed list (ids and decision) with the advisory as the audit record.
5. Private rows are not touched. A private row with no worker-written origin can never be
   published, including older private recipes generated before this fix.

Repeat step 1 once after deploy to catch anything published in the minutes between the
advisory merge and the new revision serving.

## Tests

Backend, all in the Backend fork:

- Forged label: signed-in POST with `is_public: true` and origin missing, `"generated"` or
  `"manual"` → row saved private. Rewrites `test_manual_origin_gate.py:98`, `:109` and
  `test_publish_gate.py:74`.
- Stamp: worker completion sets origin `generated`; a placeholder has none; a row whose
  generation failed has none and cannot publish.
- Placeholder takeover: generate, then POST own content to the returned id before the
  worker runs → content ignored; publish refused.
- Content lock: PUT and same-id POST with changed `name`, `ingredients`, `instructions` on
  a generated row → stored content unchanged; `/r/<slug>` serves the worker's text.
- Guest laundering: guest generates, tries to overwrite, signs in, publishes → the public
  page shows the worker's text.
- Normal flow (critical regression): generate → worker → SPA-shaped full echo POST → PUT
  `is_public: true` → 200 and public.
- Unpublish and re-publish of a generated recipe still work. Unpublish works on a public
  row with no origin.
- Old-bundle shapes: POST carrying `origin: "generated"` on a finished generated row is
  harmless; a new-row POST with `is_public: true` returns 201 with `is_public: false`.
- About 97 places in 14 test files create public rows through the client path. Each needs
  a fixture that goes through the worker write or the ORM directly.

SPA, Vitest:

- Export function drops the six fields; both export call sites use it.
- Toggle kind: not-generated private recipe → disabled with reason; not-generated public
  recipe → can unpublish.
- No import control renders in the kitchen.

GitHub Actions do not run on advisory forks. Run everything locally before merge:
`cd Backend && uv run black --check . && uv run flake8 && uv run mypy . && uv run pytest`
and `npm run lint && npm run format:check && npm run type-check && npm test`.

## Known consequences

- Import is gone. Moving recipes between accounts or environments is no longer possible in
  the app.
- A generated recipe deleted and restored from the recycle bin comes back private-only: the
  server hard-deletes, and restore re-creates the row from the browser's copy
  (`persistence.service.ts:444-455`).
- Older private recipes that were never published cannot be published after the fix.
- Rows from `scripts/staging/seed-data.py` are public with no origin. They keep serving but
  refuse a publish transition; re-seed or bless them in the staging audit.

## Release sequence

1. Implement and test in both advisory forks.
2. Audit production and staging; apply keep and unpublish decisions.
3. Publish the Backend advisory (merges to Backend `dev`), promote Backend `dev` → `main`,
   back-sync.
4. In the cookbook advisory, pin Backend `main`'s SHA and update the `## [0.5.8]`
   CHANGELOG section; publish the advisory (merges to cookbook `dev`).
5. Merge #3612; the tag deploys. Follow `scripts/release/RUNBOOK.md`.
6. Re-run the public-row listing; verify by content on production.

There is no migration in this hotfix, so the migrate job has nothing to run and there is no
migration-before-code window.

## Tasks

- [ ] **T1 (P1)** Backend: stamp origin at worker completion; stop accepting `generated`
      from payloads.
- [ ] **T2 (P1)** Backend: content lock on generated rows and on placeholders.
- [ ] **T3 (P1)** Backend: publish rule (new row → private; transition → 400; unpublish
      always allowed); `migrate_file_to_db`.
- [ ] **T4 (P1)** Backend tests as listed.
- [ ] **T5 (P1)** SPA: remove import; export field drop at both call sites; toggle; stop
      sending origin.
- [ ] **T6 (P1)** Audit of public rows on production and staging, with a saved record.
- [ ] **T7 (P1)** Release: CHANGELOG, pin, advisories published in order, #3612 held.

T1–T4 and T5 are independent. T6 needs only database access and can start now.

## Not in scope

- Removing the blob copies of `is_public`/`slug`: KAN-327.
- A server-side recycle bin so restore keeps trusted provenance: KAN-331.
- Bringing import back as a designed feature.
- Codex's larger redesign: a dedicated publish endpoint, public pages rendered from an
  attested snapshot, and a database constraint on `is_public`. The content lock gives the
  same guarantee for the request paths that exist today.
- Public queries filtering on status or origin. After the audit every public row is
  generated and locked; the publish rule keeps it that way.
