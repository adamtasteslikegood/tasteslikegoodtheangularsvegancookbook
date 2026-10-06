# KAN-329 / KAN-330: publish gate hotfix plan (v4)

**Status:** v4, 2026-10-05. Revised after the third Codex adversarial pass on v3
(`specs/KAN-329_CODEX_ADVERSARIAL_REVIEW_PASS3.md`; pass 2 on v2 in
`..._PASS2.md`, pass 1 on v1 in `KAN-329_CODEX_ADVERSARIAL_REVIEW.md`). T1 and T2 are
implemented in the Backend fork (`638d250`); the rest is not.

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
| D10 | Media on approved public rows at cutover        | **Human re-review per row** (content-credentials icon), not regenerate  |
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
   The model's output is projected with a **denylist** (`_WORKER_TEXT_DROP_FIELDS`:
   image URL, bytes and GCS pointer, stock image URL, `is_public`, `slug`, `origin`,
   `sourceSlug`, `sourceRecipeId`, `is_canonical`, `first_published_at`,
   `slug_reserved`, `personalNotes`) rather than Codex's allowlist of text fields: the
   public templates render a fixed field set, the recipe schema validates the rest, and
   a denylist cannot silently drop a legitimate model field the allowlist forgot.
   `ai_metadata.recipe_generation.prompt` is the one piece of client text that lands on
   a generated row; no public template or `public_bp.py` path renders `ai_metadata`
   (checked 2026-10-05).
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
16. **Maintenance 503.** The SPA writes localStorage first and the notes editor closes
    before the save result is read (`recipe-view.base.ts:298-299`); collection
    membership is posted even when the recipe save failed
    (`persistence.service.ts:555-558`). Recognise the pause response explicitly: show
    "not saved yet" for notes, and skip the membership write when the recipe save
    failed. Publish/unpublish already reverts with an error.
17. (v3 item on legacy notes dropped: that migration runs only for manual recipes,
    `recipe-view.base.ts:272-273`, which the lock does not touch.)

## Audit and cutover (blocking, before the advisories are published)

No query can tell a truly generated row from one that claimed `generated` or was posted
with no origin. So every public row is reviewed by a person, and every other row loses the
old label (D7).

**Listing** (production through Cloud SQL Studio; staging the same way). One row per public
recipe, with enough to judge it without opening the site:

- id, slug, name column, owner email, origin column, origin in the blob, `is_public` in
  the column and in the blob (flag any disagreement), status, `source_slug`,
  `source_recipe_id`, created and updated timestamps;
- media identity: `ai_image_gcs`, a hash of `ai_image_data` when present,
  `stock_image_url`, `image_keywords`;
- the full public text (description, every ingredient and step, `notes`), not a preview;
- a fingerprint over all of the above except the timestamps and the owner: name column,
  slug, the public text, and the media identity. `ai_metadata`, `personalNotes`,
  `is_public` and timestamps are excluded, so a notes edit between audit and cutover
  does not fail an approved row. An image swap does, by design (D10).

The listing is grouped by owner. Rows owned by Adam's and Allison's accounts (two each,
four in all) get a quick pass; every other owner's rows get the full read.

Production shows 101 `/r/` URLs in the sitemap, staging 35.

**Media review (D10).** Every image on the site carries Gemini's content credentials, and
Adam's browser extension marks them with an icon. Adam walks the public pages once with
it (5–15 minutes); a row whose image has no credential, or whose stock image is not the
one he expects, is marked unpublish. The fingerprint then binds that reviewed media to
the approval. (Automated credential verification is the follow-up below.)

**Decision.** Adam marks each row keep or unpublish and the list is saved with the
advisory as the audit record (ids, decision, fingerprint).

**Cutover**, during the short write pause (D8). The pause is an Express switch that ships
in the cookbook advisory (item 15): with `RECIPE_WRITE_PAUSE=1` set on the
`express-frontend` service, `POST`/`PUT`/`DELETE` on `/api/recipes*` and `/api/generate*`
return 503 with a short JSON message; reads keep serving. Flipping the env var is a Cloud
Run revision each way. Order:

1. Deploy the Express revision that carries the pause switch, with the pause **on**, to
   100% of traffic. Wait for in-flight text and image workers to finish (no row in
   `processing` or `generating_image` with a claim token), since the switch does not
   stop Pub/Sub deliveries and an old worker would still merge over the blob.
2. Deploy the new Backend revision behind the pause.
3. One transaction, rows locked, from Cloud SQL Studio:
   a. Reset: `origin = NULL` in the column and the blob on every row whose origin is
   `generated`, approved or not, private, guest and `error` rows included.
   b. For each row in the approved manifest: recompute the fingerprint inside the
   transaction and check eligibility — signed-in owner, `source_slug` and
   `source_recipe_id` both NULL, status `ready`. Only a row that passes both gets
   `origin = 'generated'` back in the column and the blob. A row that fails stays
   origin-less and is unpublished; it goes on the second-look list.
   c. Default deny: unpublish every row that is public and not in the set that passed
   b, including rows published after the listing was taken. `is_public = false` in the
   column and the blob, as `scripts/unpublish_slugs.py` does. Never delete: a deleted
   published slug is retired for good (KAN-288).
   d. Set `updated_at = now()` on every row touched, so an image queue or patch write
   holding an older timestamp cannot restore a stale blob (`:885`, `:1368`).
4. Invalidate the owner-scoped recipe caches for every row touched and the image cache
   keys of unpublished rows (`utils/cache_utils.py`); owned GET responses are cached for
   up to ten minutes and would otherwise show the old state.
5. Re-run the listing **before lifting the pause**: every public row has origin
   `generated`, a matching fingerprint, and passes the eligibility check. Fix anything
   that does not, still under the pause.
6. Lift the pause (new Express revision with the switch off). The app has no version
   check and no service worker, so a tab left open keeps the old bundle, with a stale
   local `is_public`/`origin`, until its next full page load. That is accepted: an old
   bundle can only create private rows and cannot change locked content; what it cannot
   do is reconcile its own local flags. Compatibility is claimed for persistence, not for
   old-client state.

The transaction in step 3 is one committed SQL script with the approved manifest inlined,
tested against a fixture (approved and unchanged, approved but changed, forged private,
forged public, published after listing, saved copy, guest-owned, error row). Staging
first, production second; the staging run is the evidence that the script works.

After cutover a private row with no worker-written origin can never be published,
including every private recipe generated before this fix.

**Staging seed and canonical rows.** `scripts/staging/seed-data.py` writes public rows
directly (`:94-110`) and its import mode honours `is_public`/`origin` from an export
(`:249-251`). After this fix both modes write private rows with no origin by default; a
public staging fixture is blessed through the same reviewed manifest step as production,
never stamped by the script. Canonical recipe text can no longer be updated through the
client API once locked; it goes through an ORM-level admin path documented in the script
header as the one approved exception.

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
5. Merge #3612; the tag deploys both services. `cloudbuild.yaml` deploys Backend before
   Express, so the pause must already be on **before this merge**: deploy the
   pause-capable Express revision first (cutover step 1) from the cookbook advisory,
   then merge. Old bundles must still work against the new API (item 14).
6. Cutover steps 2–6 on staging, then production.
7. Verify by content on production; re-run the listing.

There is no schema migration in this hotfix. The data change is the cutover script.

## Tasks

- [x] **T1 (P1)** Backend: stamp origin at the worker's text write; stop accepting
      `generated` from payloads; text write replaces the blob and drops media,
      publication and provenance keys from the model's output. (`638d250`)
- [x] **T2 (P1)** Backend: content lock on generated rows and on placeholders whose text
      generation is in flight, filtering the payload to `{is_public, personalNotes}`
      before any downstream read; data-URL promotion removed. Origin-less rows having
      only an image regenerated stay editable. (`638d250`, 18 tests in
      `tests/test_generated_content_lock.py`)
- [x] **T3 (P1)** Backend: publish rule (transition-only status check; new row → private;
      ineligible transition → 400; unpublish always allowed); `origin` + `is_public` in
      every response (already in `to_dict` and the status blob, now tested);
      `migrate_file_to_db`. Backend fork commit after `638d250`.
- [x] **T4 (P1)** Backend tests: 32 in `tests/test_generated_content_lock.py`, including
      the guest-laundering flow through the login merge (the merge reassigns `user_id`
      through the ORM, so origin carries over); the four
      files that published on create or through a client label now create private,
      stamp through the ORM (`mark_generated` in `conftest.py`) and publish through the
      ordinary save. Full suite 751 passed. One finding from the rework: a private row
      still stores a raw payload slug, and the publish transition only repairs empty or
      path-shaped slugs. Unreachable for generated rows (placeholder has no slug, the
      worker drops it, the client cannot set it), noted here so the cutover listing
      flags any blessed legacy row whose slug is not already sanitized.
- [ ] **T5 (P1)** SPA: remove import and its copy; export field drop at both call sites;
      mirror origin/is_public; toggle; stop sending origin; maintenance-503 handling;
      Express write-pause switch with tests.
- [ ] **T6 (P1)** Audit listing query (grouped by owner, media identity, full text,
      fingerprint); transactional cutover script with manifest, eligibility and default
      deny, tested on the fixture; cache invalidation; staging seed private by default;
      run the audit and media review with Adam; saved record.
- [ ] **T7 (P1)** Release: CHANGELOG, pin, advisories published in order, #3612 held,
      pause-capable Express deployed and on before the release merge, drain, cutover on
      staging then production.

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
