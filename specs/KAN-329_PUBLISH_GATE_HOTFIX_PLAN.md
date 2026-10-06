# KAN-329 / KAN-330: publish gate hotfix plan (v3)

**Status:** v3, 2026-10-05. Revised after the second Codex adversarial pass on v2
(`specs/KAN-329_CODEX_ADVERSARIAL_REVIEW_PASS2.md`; first pass on v1 in
`specs/KAN-329_CODEX_ADVERSARIAL_REVIEW.md`). Not yet implemented.

**Tickets:** KAN-329 (Backend), KAN-330 (SPA), KAN-328 (content lock, part of this
hotfix). Outside the hotfix: KAN-327, KAN-331, and the two follow-ups at the end.

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

What v1 missed (Codex pass 1, verified): a server-written label on the row is not enough,
because the owner can overwrite the row's content afterwards.

- `POST /api/recipes` with an existing id is an upsert that merges every client field
  (`:972`); `PUT` does the same (`:1157`).
- `/api/generate` returns the placeholder's id before any AI output exists
  (`generation_api_bp.py:91-132`), so a v1 stamp on the placeholder could be taken over at
  once.
- A guest can do the same privately, then sign in; the login merge keeps origin
  (`blueprints/auth_api_bp.py:242-274`).
- Public pages check only `is_public` and slug (`blueprints/public_bp.py:943-952`,
  `:1186-1191`, `:1431-1440`), not status or origin.

What v2 missed (Codex pass 2, verified):

- Rows already in the database carry a client-written `origin: "generated"`. After the
  fix they would pass the gate unchanged, so the old label has to be reset, not trusted.
- The content lock left `name` writable: both write paths take the name column from the
  payload (`:1001`, `:1210`). The payload's `slug` and `sourceSlug` also still had effects
  (`:981-982`, `:988-993`).
- `ai_image_url` was left client-writable. Public pages ignore it (`public_bp.py:133-143`
  derives the image from stored bytes), but the admin image migration promotes a
  `data:image/...` value from that field into GCS as the recipe's real image
  (`generation_api_bp.py:627-638`).
- The SPA does write one field on a saved recipe: `personalNotes`
  (`src/components/shared/recipe-view.base.ts:290-298`). The public page renders `notes`,
  never `personalNotes`.
- After a save the SPA mirrors only slug, source id and first-published time
  (`src/services/persistence.service.ts:165-203`), so without an `origin` mirror a freshly
  generated recipe would look unpublishable in the app.
- Image generation moves a public row `ready` → `generating_image` without unpublishing
  (`db_recipe_repository.py:1373-1380`), so the status check must apply to the publish
  transition only.

## Decisions

| ID  | Question                                        | Answer (Adam, 2026-10-05)                                               |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| D1  | Change the server's publish gate?               | Yes                                                                     |
| D2  | Remove `is_public`/`slug` copies from the blob? | Not in the hotfix. KAN-327                                              |
| D3  | Lock generated content against client rewrites? | Yes, in the hotfix (KAN-328)                                            |
| D4  | Existing rows with no trusted origin            | Audit public rows; bless approved ones. No blanket backfill             |
| D5  | Recycle-bin restore of a generated recipe       | Restored recipes are private-only. KAN-331                              |
| D6  | Import feature                                  | Removed in the hotfix                                                   |
| D7  | Old client-written `generated` labels           | **Reset on every row not approved in the audit, private and guest too** |
| D8  | Cutover                                         | **Short write pause** while the reset and the approved list are applied |
| D9  | Google display name on public bylines           | Follow-up ticket, not the hotfix                                        |
| —   | Release                                         | Rides v0.5.8                                                            |

D7 is cheap now: the site has no user base yet (the friends-and-family campaign has not
started), so making every unapproved existing recipe unpublishable costs nothing.

Fact behind D3: the app has no recipe-edit feature. On a saved recipe it changes
`personalNotes` (`recipe-view.base.ts:290-298`), `ai_image_url` (`:203`) and `is_public`
(`:392`), nothing else.

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
worker writes the text ──> update_recipe_for_worker writes name + data,
                           sets origin = 'generated', status 'ready' or 'generating_image'
        │
        ▼
client POST/PUT on that row ──> only is_public and personalNotes are taken from the payload;
                                every other field is ignored (the worker's content stays)
        │
        ▼
is_public: true ──> allowed when origin is generated, status is not generating/processing/error,
                    the owner is signed in and the row is not a saved copy

client POST of a NEW row ──> origin may be 'manual' or 'saved' only; is_public forced False
client PUT is_public:true on a non-generated row ──> 400
```

"Finished" is defined by the worker's text write, which lands with status `ready`, or
`generating_image` when an image was requested (`blueprints/worker_api_bp.py:104`,
`:170`, `:532`). A later image step moves `ready` → `generating_image` → `ready`; a public
row stays public through it. `error` rows are never publishable. The status check runs on
the private → public transition only; it never unpublishes.

## Backend (KAN-329 + KAN-328), Backend advisory fork

1. **Stamp at the worker's text write.** `update_recipe_for_worker` (`:784-835`) adds
   `"origin": "generated"` to its column update and blob. The placeholder created at
   `generation_api_bp.py:99` carries no origin. Only this function ever writes
   `generated`. It has one caller, the text completion (`worker_api_bp.py:528`); the
   image-completion writes go through `patch_recipe_for_worker` (`:166`, `:697`), which
   never touches origin, so requesting an image for a manual row cannot relabel it. The
   text worker claims only `generating` rows (`:441`) and treats `error` as terminal
   (`:229`), so a client-filled error row is never re-generated over.
   Hardening in the same change: the text write **replaces** the blob instead of merging
   over `recipe.data` (`:806`), keeping only `id`, `user_id`, `guest_session_id`,
   `is_public` and `slug` from the row. Nothing a client managed to write before the
   stamp survives into a `generated` row. Image writes keep their merge.
2. **Clients cannot claim it.** `_resolve_origin` (`:177-187`) stops accepting `generated`
   from a payload; `manual` and `saved` remain. Covers `:995`, `:1030`, `:1202`. A payload
   cannot change the origin of a row that already has one.
3. **Content lock.** In the upsert branch (`:972`) and `update_recipe` (`:1157`), when the
   persisted row's origin is `generated`, or the row is a placeholder still generating
   (origin NULL, status in `_ACTIVE_RECIPE_STATUSES`), filter the payload to
   `{is_public, personalNotes}` before anything reads it. Everything downstream (the merge,
   the name column at `:1001`/`:1210`, the slug logic at `:988-993`, the
   `sourceSlug` strip at `:981` and `:1166`, `_pin_source_slug_to_column`) sees the
   filtered payload, so a client cannot rename, re-slug, add or clear a source slug, or
   touch the image fields. Ignore, do not refuse: the SPA echoes the whole recipe on every
   save (`persistence.service.ts:645-650`).
4. **Image URL is server-owned.** `ai_image_url` leaves the client allowlist. The worker
   and the image endpoint already write it. Remove the `data:image/...` promotion branch
   from the admin image migration (`generation_api_bp.py:627-645`); case 1 (stored
   `ai_image_data` bytes) and case 3 (URL repair) stay.
5. **Publish rule.** Private → public requires origin `generated`, status not in
   `{generating, processing, error}`, signed in, not a saved copy.
   - New row asking to be public: saved private (same treatment guests get), not refused.
     This keeps old cached app bundles from leaving a local "published" ghost.
   - Existing row, private → public, not eligible: 400 with reworded text covering
     manual, imported, hand-posted and still-generating recipes.
   - Unpublishing is always allowed for a non-canonical row, whatever its origin or
     status.
6. **Response shape.** Every recipe response carries `origin` and `is_public` from the
   columns (`/api/recipes` POST/PUT/GET and the status endpoint the SPA polls), so the
   app can mirror them.
7. `migrate_file_to_db` (`:1597`) stops honoring `is_public` from a file.
8. **Legacy trust reset** is a data step, not a migration: see "Audit and cutover".

## SPA (KAN-330), cookbook advisory fork

9. **Remove import.** Delete `onImportFileSelected` and `generateMissingImages`
   (`src/components/kitchen/kitchen.component.ts:370-434`), the file input and the
   "Import JSON" control (`kitchen.component.html:289-296`), the empty-state copy that
   mentions importing (`:371`), `importRecipes` (`src/services/auth.service.ts:477-522`)
   and their references.
10. **Export drops server-owned fields** (`is_public`, `slug`, `origin`, `is_canonical`,
    `first_published_at`, `slug_reserved`) through one function beside `recipeFromRow` in
    `src/utils/recipe-row.ts`. Two call sites: bulk export (`kitchen.component.ts:357`)
    and single export (`recipe-view.base.ts:461`).
11. **Mirror server state.** `recipeWithServerIdentity` (`persistence.service.ts:165`)
    also copies `origin` and `is_public` from the response. The generation poll applies
    `origin` when the row reaches its finished status. Without this a new recipe has no
    origin locally and its toggle is disabled.
12. **Toggle.** `publishToggleKind` (`src/utils/public-link.ts:107`) and the guard at
    `recipe-view.base.ts:356` disable only the private → public transition for a recipe
    that is not `generated` or is still generating. Unpublishing stays available.
13. `generator.component.ts:101` stops sending `origin: 'generated'`.
14. Old bundles keep working: they still POST the full recipe (ignored fields), still send
    `origin` (ignored), and a new-row `is_public: true` comes back as a private row rather
    than an error.
15. **Write-pause switch** in Express (`server/`): when `RECIPE_WRITE_PAUSE=1`, mutating
    requests to `/api/recipes*` and `/api/generate*` get a 503 JSON response before the
    proxy; everything else is untouched. Vitest covers both states.
16. **Legacy notes.** `saveNotes` (`recipe-view.base.ts:295`) clears `notes` when it
    adopts legacy notes into `personalNotes`. On a generated row the lock ignores that
    clear (`notes` is public content), so the app would render the same text twice for
    the approved rows that still have legacy notes. Stop clearing `notes`; hide the
    read-only copy client-side when it equals `personalNotes`.

## Audit and cutover (blocking, before the advisories are published)

No query can tell a truly generated row from one that claimed `generated` or was posted
with no origin. So every public row is reviewed by a person, and every other row loses the
old label (D7).

**Listing** (production through Cloud SQL Studio; staging the same way). One row per public
recipe, with enough to judge it without opening the site:

- id, slug, name, owner email, origin column, origin in the blob, `is_public` in the
  column and in the blob (flag any disagreement), status, `source_slug`, created and
  updated timestamps, whether it has stored image bytes;
- a content preview (description and the first few ingredients and steps);
- a content fingerprint: a hash over the publicly rendered text only, the fields
  `public_bp.py` and the public templates read (`name`, description, ingredients,
  instructions, `notes`, times, servings, tags). Image fields, `ai_metadata`,
  `personalNotes`, `is_public`, `slug` and timestamps are excluded, so an allowed notes
  edit or an image regeneration between audit and cutover does not unpublish an approved
  row. This is the "approved as of" marker; it has nothing to do with image content
  credentials.

Production shows 101 `/r/` URLs in the sitemap, staging 35.

**Decision.** Adam marks each row keep or unpublish and the list is saved with the
advisory as the audit record (ids, decision, fingerprint).

**Cutover**, during the short write pause (D8). The pause is an Express switch that ships
in the cookbook advisory (item 15): with `RECIPE_WRITE_PAUSE=1` set on the
`express-frontend` service, `POST`/`PUT`/`DELETE` on `/api/recipes*` and `/api/generate*`
return 503 with a short JSON message; reads keep serving. Flipping the env var is a Cloud
Run revision each way. Order:

1. Deploy the new Backend revision (the code already refuses to trust client labels).
2. Reset: `UPDATE recipe SET origin = NULL` on every row whose origin is `generated` and
   whose id is not in the approved list, and remove `origin` from those rows' blobs. This
   includes private rows, guest rows and `error` rows.
3. Apply the approved list: for each keep row, recompute the fingerprint; if it matches,
   set `origin = 'generated'` in the column and the blob. If it does not match, the row
   is unpublished instead and listed for a second look.
4. Unpublish rows: `is_public = false` in the column and the blob, as
   `scripts/unpublish_slugs.py` does. Never delete: a deleted published slug is retired
   for good (KAN-288).
5. Delete the image cache keys of unpublished rows (`vgc:img:<id>`). Public pages are not
   response-cached; the Flask cache holds image bytes only.
6. Lift the pause, re-run the listing, confirm every public row has origin `generated`
   and a matching fingerprint.

Steps 2 to 4 are one SQL script committed with the advisory and run from Cloud SQL
Studio, with the approved manifest inlined. Staging first, production second.

After cutover a private row with no worker-written origin can never be published,
including every private recipe generated before this fix.

**Staging seed and canonical rows.** `scripts/staging/seed-data.py` writes public rows
directly (`:94-110`). After this fix those rows refuse a publish transition unless blessed
in the staging audit; the seed script sets `origin = 'generated'` itself for the public
fixtures, which is fine because it writes through the ORM, not the client path. Canonical
recipe text can no longer be updated through the client API once locked; it goes through
the same ORM-level admin path. Document both in the script headers.

## Tests

Backend, all in the Backend fork:

- Forged label: signed-in POST with `is_public: true` and origin missing, `"generated"` or
  `"manual"` → row saved private. Rewrites `test_manual_origin_gate.py:98`, `:109` and
  `test_publish_gate.py:74`.
- Stamp: the worker's text write sets origin `generated` (both `ready` and
  `generating_image` paths); a placeholder has none; a row whose generation failed has
  none and cannot publish. The text write replaces the blob: a field planted in the
  placeholder blob is gone after completion. Image completion on a `manual` row leaves
  origin `manual` and publish → 400.
- Placeholder takeover: generate, then POST own content to the returned id before the
  worker runs → content ignored; publish refused.
- Content lock: PUT and same-id POST with changed `name`, `ingredients`, `instructions`,
  `slug`, `sourceSlug`, `ai_image_url`, `ai_image_data`, `stock_image_url` on a generated
  row → name column, slug, source slug and blob unchanged except `personalNotes`;
  `/r/<slug>` serves the worker's text.
- Image URL: a `data:image/...` value in `ai_image_url` is never stored and never
  promoted by the admin migration.
- Guest laundering: guest generates, tries to overwrite, signs in, publishes → the public
  page shows the worker's text.
- Normal flow (critical regression): generate → worker → SPA-shaped full echo POST → POST
  with `is_public: true` (the SPA publishes with POST, not PUT) → 200, public, response
  carries `origin: "generated"` and `is_public: true`.
- Image generation on a public generated row keeps it public through `generating_image`.
- Unpublish and re-publish of a generated recipe still work. Unpublish works on a public
  row with no origin and on an `error` row.
- Old-bundle shapes: POST carrying `origin: "generated"` on a finished generated row is
  harmless; a new-row POST with `is_public: true` returns 201 with `is_public: false`.
- Cutover script: a fixture with forged-private, forged-public-approved,
  forged-public-rejected and approved-but-changed rows → only the approved unchanged row
  keeps `generated`; the changed one is unpublished.
- About 97 places in 14 test files create public rows through the client path. Each needs
  a fixture that goes through the worker write or the ORM directly.

SPA, Vitest:

- Export function drops the six fields; both export call sites use it.
- `recipeWithServerIdentity` mirrors `origin` and `is_public`.
- Toggle kind: not-generated private recipe → disabled with reason; still-generating →
  disabled; not-generated public recipe → can unpublish.
- No import control or import copy renders in the kitchen.

GitHub Actions do not run on advisory forks. Run everything locally before merge:
`cd Backend && uv run black --check . && uv run flake8 && uv run mypy . && uv run pytest`
and `npm run lint && npm run format:check && npm run type-check && npm test`.

## Known consequences

- Import is gone. Moving recipes between accounts or environments is no longer possible in
  the app.
- Every existing recipe not approved in the audit becomes unpublishable, including private
  ones generated before the fix. Regenerating produces a publishable copy.
- A generated recipe deleted and restored from the recycle bin comes back private-only: the
  server hard-deletes, and restore re-creates the row from the browser's copy
  (`persistence.service.ts:444-455`).
- A few minutes of write pause at cutover.
- Rows from `scripts/staging/seed-data.py` need the seed script change above or a staging
  audit bless.

## Release sequence

1. Implement and test in both advisory forks.
2. Run the listing on staging and production; Adam decides; save the audit record.
3. Publish the Backend advisory (merges to Backend `dev`), promote Backend `dev` → `main`,
   back-sync.
4. In the cookbook advisory, pin Backend `main`'s SHA and update the `## [0.5.8]`
   CHANGELOG section; publish the advisory (merges to cookbook `dev`).
5. Merge #3612; the tag deploys. The Backend revision goes live before the Express one,
   so old bundles must work against the new API (item 14).
6. Cutover on staging, then production, as above.
7. Verify by content on production; re-run the listing.

There is no schema migration in this hotfix. The data change is the cutover script.

## Tasks

- [ ] **T1 (P1)** Backend: stamp origin at the worker's text write; stop accepting
      `generated` from payloads.
- [ ] **T2 (P1)** Backend: content lock on generated rows and placeholders, filtering the
      payload to `{is_public, personalNotes}` before any downstream read; image URL
      server-owned; data-URL promotion removed.
- [ ] **T3 (P1)** Backend: publish rule (transition-only status check; new row → private;
      ineligible transition → 400; unpublish always allowed); `origin` + `is_public` in
      every response; `migrate_file_to_db`.
- [ ] **T4 (P1)** Backend tests as listed.
- [ ] **T5 (P1)** SPA: remove import and its copy; export field drop at both call sites;
      mirror origin/is_public; toggle; stop sending origin; legacy-notes dedupe; Express
      write-pause switch with tests.
- [ ] **T6 (P1)** Audit listing query, cutover SQL script with manifest, staging seed
      change; run the audit with Adam; saved record.
- [ ] **T7 (P1)** Release: CHANGELOG, pin, advisories published in order, #3612 held,
      write pause and cutover on staging then production.

T1–T4 and T5 are independent. T6's listing query can be written now.

## Follow-ups (new tickets, not the hotfix)

- **Display name on bylines.** The Google display name is client-authored text rendered on
  public bylines and in JSON-LD (D9).
- **Image provenance through content credentials.** Gemini and Nano Banana images carry
  C2PA content credentials and a SynthID watermark. Verifying them on the image path
  (Gemini's SynthID detection, or C2PA manifest validation where metadata survives) would
  give public pages a proof that image bytes came from the model, the one property the
  content lock cannot establish for images. Not in the hotfix: it needs the detection
  API, and metadata does not survive every re-encode.

## Not in scope

- Removing the blob copies of `is_public`/`slug`: KAN-327.
- A server-side recycle bin so restore keeps trusted provenance: KAN-331.
- Bringing import back as a designed feature.
- Codex's larger redesign: a dedicated publish endpoint, public pages rendered from an
  attested snapshot, and a database constraint on `is_public`. The content lock gives the
  same guarantee for the request paths that exist today.
- Public queries filtering on status or origin. After the cutover every public row is
  generated and locked; the publish rule keeps it that way.
