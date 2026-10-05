# KAN-329 / KAN-330: publish gate hotfix plan

**Status:** plan approved in eng review 2026-10-05. Not yet implemented. Awaiting an
adversarial Codex review of this document before work starts (the outside review could
not run in the session that produced it).

**Tickets:** KAN-329 (Backend gate), KAN-330 (SPA import, export, toggle).
Follow-ups outside the hotfix: KAN-327, KAN-328.

**Release:** rides v0.5.8. The v0.5.8 bump (#3611) is already on `dev` and the release PR
#3612 (`dev` → `main`) is open. **#3612 must not merge until this hotfix is on `dev`**, and
the `## [0.5.8]` CHANGELOG section must be updated to describe it and to name the new
pinned Backend SHA (`train-verify` checks the section against the pointer).

**Code read at:** cookbook `3d1d8e0`, Backend `7cf3381` (Backend `dev`). Line numbers below
are from those commits; recheck them against the branch you implement on.

## How it was found

Adam exported 145 recipes from his production account to JSON and imported the file into
staging. Each recipe's `is_public: true` was honored as if it had been read from the
database.

## The actual hole

The import screen is one way to send the request. The server accepts it from anyone who is
signed in.

```
my_vegan_cookbook.json  (any hand-written file works; export is not required)
        |
        v
src/components/kitchen/kitchen.component.ts:383-387   spreads each object, deletes only ai_image_data
        |
        +--> src/services/auth.service.ts:488          pushed into local state as-is
        |        kitchen.component.ts:31  `if (recipe.is_public) return 'published'`   (badge shows at once)
        v
kitchen.component.ts:393  persistenceService.saveRecipe(r)  ->  POST /api/recipes (whole object)
        |
        v   Express: raw stream proxy, no body inspection
Backend/blueprints/recipes_api_bp.py:148-156   request.get_json() -> create_recipe(recipe_data, user_id, ...)
        |
        v
Backend/repositories/db_recipe_repository.py:1027   _gate_is_public(...)
        |     guest          -> is_public forced False        (:633-638)
        |     has sourceSlug -> 403 SavedCopyPublishError      (:640-649)
        |     otherwise      -> payload is_public honored      (:650)
        v
db_recipe_repository.py:1030   origin_value = _resolve_origin(None, recipe_data)
        |     :186-187  candidate = recipe_data.get("origin"); accepted if in the allowlist
        v
db_recipe_repository.py:1031   _gate_manual_publish(origin_value, ...)
        |     :199  refuses only when origin == "manual"; "generated" and missing both pass
        v
slug minted -> row public at /r/<slug>, in /browse and sitemap.xml
```

`origin` is the label that means "the AI wrote this, it may be published" (KAN-140). Today
the client writes it:

- `Backend/blueprints/generation_api_bp.py:96` creates the pending row as
  `{"id", "name": "Generating...", "user_id"}`. No origin.
- `src/components/generator/generator.component.ts:101` sets `origin: 'generated'` in the
  browser and POSTs it.
- The worker write (`update_recipe_for_worker`) does not touch origin.

Two tests assert the hole as correct behavior:
`Backend/tests/test_manual_origin_gate.py:98` (`test_generated_recipe_still_publishes`) and
`:109` (`test_legacy_null_origin_still_publishes`).

So a signed-in `POST /api/recipes` with
`{"name", "ingredients", "instructions", "is_public": true}` (origin omitted, or
`"generated"`) publishes arbitrary recipe-shaped content. Removing `is_public` from the
export file, or from the `data` column, changes none of that.

Limits of the finding: guests are already forced private, so the attacker needs a Google
account. The exploit was read from code and from the two tests; it was not run live. Whether
the staging import actually published rows was not verified (staging sitemap listed 35
`/r/` URLs, production 101, on 2026-10-05).

## Decisions

| ID  | Question                                                         | Answer                                  |
| --- | ---------------------------------------------------------------- | --------------------------------------- |
| D1  | Change the server's publish gate, or only the import and export? | Server gate plus import and export drop |
| D2  | Remove the `is_public`/`slug` copies from the `data` blob?       | Not in the hotfix. KAN-327              |
| D3  | Generate a recipe, overwrite its text through the API, publish   | Not in the hotfix. KAN-328              |
| —   | Release                                                          | Rides v0.5.8 (Adam, 2026-10-05)         |

Known consequence of D1: an imported recipe is private for good, in any account or
environment, including Adam's own recipes when moved between accounts.

Fact recorded for KAN-328 (from Adam, checked in code): the app has no recipe-edit feature.
It only ever changes `ai_image_url` (`src/components/shared/recipe-view.base.ts:203`) and
`is_public` (`:392`) on a saved recipe.

## The plan

```
BEFORE                                   AFTER
client payload --origin--> column        generate endpoint --origin='generated'--> column
client payload --is_public--> publish    client payload origin: 'manual' or 'saved' only
                                         publish allowed only when column origin == 'generated'
import file --all fields--> API          import file --content fields only--> API
```

### Backend (KAN-329, PR into Backend `dev`)

1. `create_recipe` gains a trusted `origin` argument. `generation_api_bp.py:99` passes
   `origin="generated"`. Nothing else does. The stamp must not travel in the payload dict:
   the generate endpoint calls the same `create_recipe` as the public API, so a value in
   `pending_data` would be dropped by step 2 along with every client claim.
2. `_resolve_origin` (`:177-187`) stops accepting `generated` from a payload. One change
   covers all three call sites (`:995` upsert, `:1030` create, `:1202` update). A payload
   may still claim `manual` or `saved`; saved copies are already refused at publish.
3. `_gate_manual_publish` (`:190-200`) refuses when the result is public and origin is not
   `generated`. Reword the error text: it now covers imported and hand-posted recipes, not
   only the manual-entry form.
4. Alembic migration:
   `UPDATE recipe SET origin = 'generated' WHERE origin IS NULL AND source_slug IS NULL AND source_recipe_id IS NULL`.
   KAN-140's migration (`d1e5a9c3f7b2`) labelled known manual rows and left the rest empty,
   so "empty means generated" is the assumption already in the data. `flask db heads` must
   stay one line.

### SPA (KAN-330, cookbook PR carrying the Backend pointer)

5. One function listing the server-owned fields (`is_public`, `slug`, `origin`,
   `is_canonical`, `first_published_at`, `slug_reserved`), next to `recipeFromRow` in
   `src/utils/recipe-row.ts`. Import (`kitchen.component.ts:383`) calls it before the local
   insert and before the POST. Export (`:357`) calls it too. `sourceSlug` is kept: it is
   saved-copy provenance and saved copies cannot publish.
6. `publishToggleKind` (`src/utils/public-link.ts:107`) and the guard at
   `src/components/shared/recipe-view.base.ts:356` treat any origin other than `generated`
   as unpublishable, with a reason that covers imported recipes. Without this an imported
   recipe shows a live toggle and gets a 400 with the wrong message.

### Release

Backend `dev` → `main` → back-sync → pin Backend `main`'s own SHA → cookbook `dev`, then the
already-open #3612 ships it. Follow `scripts/release/RUNBOOK.md`. Deploy order is already
right: the migrate job runs before the new Flask revision serves.

### After deploy (operator)

No query can tell a truly generated row from one that claimed `generated`, or was posted
with no origin, before the fix. That includes the 145 rows imported into staging. List
public rows by owner on production and staging and unpublish anything unexpected with
`Backend/scripts/unpublish_slugs.py`. Unpublish, do not delete: a deleted published slug is
retired for good (KAN-288).

## Tests

All of these are proof of the contract approved in D1.

```
CODE PATHS                                                      USER FLOWS
generation_api_bp.generate_recipe_json                          Generate, save, publish
  └── [GAP] pending row has origin 'generated'                    └── [GAP] POST /api/generate (Pub/Sub mocked) -> worker write
db_recipe_repository._resolve_origin                                      -> POST same id -> PUT is_public -> 200, public
  ├── [GAP] payload 'generated' dropped on create                         (REGRESSION, CRITICAL)
  ├── [GAP] payload 'generated' dropped on upsert of empty-origin row   Guest generates, logs in, publishes
  ├── [GAP] payload 'generated' dropped on PUT                      └── [GAP] origin survives the login merge
  ├── [TESTED] manual cannot be relabelled (manual_origin_gate:84)    Import a file
  └── [TESTED] unknown label dropped (:116)                         ├── [GAP] is_public:true in file -> row private, no 'published' badge
db_recipe_repository._gate_manual_publish                           ├── [GAP] re-import, same account -> is_public unchanged both ways
  ├── [TESTED] manual + public -> 400 (:54, :72)                    └── [GAP] imported recipe: toggle disabled with reason
  ├── [GAP] no origin + public -> 400   (today :109 asserts 201)  Export
  ├── [GAP] client 'generated' + public -> 400 (today :98 asserts 201)  └── [GAP] file carries none of the server-owned fields
  └── [GAP] server-stamped + public -> 201
migration backfill
  ├── [GAP] empty-origin non-copy row -> 'generated'
  ├── [GAP] saved copy and 'manual' rows untouched
  └── [GAP] backfilled public row still accepts a PUT
SPA field-drop function
  └── [GAP] drops the six fields, keeps content and sourceSlug
```

- `Backend/tests/test_manual_origin_gate.py`: rewrite `:98` and `:109` to assert 400; add
  the three "payload `generated` dropped" cases; add "server-stamped publishes".
- `Backend/tests/test_async_generation_api.py`: pending row carries `generated`; the full
  generate, save, publish flow through the Flask client. This is the one flow real users
  take, so it is the critical regression test. It also pins that the status payload carries
  the recipe id: `src/services/gemini.service.ts:58` mints a new id when it is missing, and
  a save under a new id would create a client row that can never be published.
- New migration test beside `Backend/tests/test_migration_kan221_provenance.py`.
- `Backend/tests/test_publish_gate.py` and 13 other files: 97 places create public rows with
  no server stamp. Each needs the trusted argument or a direct ORM fixture.
  `test_user_create_can_publish` (`:74`) changes meaning: a client create can no longer
  publish.
- Vitest: the field-drop function; kitchen import of a file with `is_public: true`; toggle
  kind for a recipe with no origin.

No test is removed.

## Failure modes

| Path                  | Realistic failure                                           | Caught by                     | User sees                   |
| --------------------- | ----------------------------------------------------------- | ----------------------------- | --------------------------- |
| Stamp on pending row  | argument dropped in a refactor; no new recipe can publish   | generate-save-publish test    | clear refusal               |
| Save after generation | SPA posts a new id                                          | status-payload id assertion   | toggle disabled with reason |
| Backfill              | a public row left with no origin; its next save is refused  | migration test                | refusal                     |
| Import drop           | a new server-owned field is added later and not listed      | field-drop test pins the list | nothing wrong (gate holds)  |
| Deploy window         | recipe generated between the migration and the new revision | none                          | cannot publish; regenerate  |

## Tasks

- [ ] **T1 (P1)** Backend repository: stop accepting `generated` from payloads and require
      it to publish. `Backend/repositories/db_recipe_repository.py`.
- [ ] **T2 (P1)** Backend generation: stamp `generated` through a trusted `create_recipe`
      argument. `Backend/blueprints/generation_api_bp.py`.
- [ ] **T3 (P1)** Backend migration: backfill empty-origin, non-copy rows.
- [ ] **T4 (P1)** Backend tests, as listed above. `cd Backend && uv run pytest`.
- [ ] **T5 (P1)** SPA: field drop on import and export; toggle mirrors the server rule.
      `npm test && npm run type-check && npm run lint`.
- [ ] **T6 (P1)** Release: update the `## [0.5.8]` CHANGELOG section and the Backend pin on
      `dev`; hold #3612 until then.
- [ ] **T7 (P2)** Operator audit of public rows after deploy.

T1–T4 and T5 touch disjoint modules and can run in parallel. T6 depends on both.

## Not in scope

- Removing the blob copies of `is_public`/`slug`: KAN-327.
- Refusing text changes on generated rows: KAN-328.
- `migrate_file_to_db` trusting `is_public` from a file
  (`db_recipe_repository.py:1597`): its only caller is the dev script
  `Backend/scripts/migrate_recipes_to_db.py`.
- Import cost: each imported recipe without an image starts an image generation
  (`kitchen.component.ts:394-404`), under the existing 20 per hour limit.
- Arbitrary `ai_image_url` values in imported files: confined to private rows by this fix.

## Open questions for the adversarial review

1. Is there any server path other than `generation_api_bp.py:99` that legitimately creates
   publishable content (canonical seeding, staging seed data, scripts) and would be broken
   by "publish requires `generated`"?
2. Is the backfill predicate right, or does it bless rows it should not?
3. Does the login merge (`Backend/blueprints/auth_api_bp.py`) preserve the origin column on
   every branch?
4. Does an old cached SPA bundle talking to the new Backend fail in any way worse than a
   refused publish?
