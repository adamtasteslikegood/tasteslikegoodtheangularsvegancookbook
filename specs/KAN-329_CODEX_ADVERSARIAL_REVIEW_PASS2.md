V2 still permits publication of pre-existing attacker-authored recipes. It also misses an indirect image write path and breaks personal-note persistence.

Reviewed SPA `a3345f4` and Backend `0506f0f`. `B/` below means the sibling Flask checkout; `Plan` means `specs/KAN-329_PUBLISH_GATE_HOTFIX_PLAN.md`. No files changed, tests executed, or deployed state verified.

First-pass disposition:

| # | Severity | Disposition | Evidence and remaining action |
|---|---|---|---|
| 1 | P1 | **Partly closed** | Completion stamping and blob locking address new-row takeover (`Plan:99–109`). Existing client-stamped rows remain trusted; column writes also need explicit locking. See findings 1–2 below. |
| 2 | P1 | **Partly closed** | New publication requires finished status (`Plan:110`). Audit does not inspect status, and public image regeneration changes status while retaining publication (`B/repositories/db_recipe_repository.py:1375–1379`). Define the exact status policy. |
| 3 | P1 | **Closed by v2** | Import is removed, and generated-row blob rewrites are ignored (`Plan:104–109,126–129`). Retain a direct same-ID POST regression test. |
| 4 | P1 | **Partly closed** | Blanket backfill is removed, but private forged-generated rows are untouched; rejected public generated rows retain their publishing capability (`Plan:148–153`). Reset unapproved trust. |
| 5 | P1 | **Partly closed** | New guest takeover is blocked. Legacy guest rows already carrying forged `generated` survive ownership merge unchanged (`B/blueprints/auth_api_bp.py:242–274`). Include those rows in the trust reset. |
| 6 | P2 | **Still open, deliberately accepted** | Restore re-POSTs the browser copy (`src/services/persistence.service.ts:444–455`); v2 makes it private-only (`Plan:197–199`). Explain that consequence in restore UI and reconcile returned provenance. |
| 7 | P1 | **Partly closed** | No migration-first window, but audit-before-deployment leaves approved content mutable under old code (`Plan:206–213`; `B/repositories/db_recipe_repository.py:972,1157`). Audit after draining old writers. |
| 8 | P2 | **Partly closed** | File migration becomes private (`Plan:117`), but staging’s ORM writers still honor publication and supplied origin (`scripts/staging/seed-data.py:241–251,408–418`). Make ordinary seeds/imports private. |
| 9 | P2 | **Partly closed** | Saving new rows privately avoids the missing-server-row failure. The SPA does not mirror returned `is_public` or origin (`src/services/persistence.service.ts:165–202`). Local published ghosts remain. |
| 10 | P2 | **Closed by v2** | Both export call sites explicitly use the projection (`Plan:130–133`). Retain both-call-site verification. |
| 11 | P2 | **Closed by v2** | Both backend and SPA explicitly preserve noncanonical unpublishing (`Plan:115,134–136`). |
| 12 | P2 | **Partly closed** | Added takeover, guest, normal-flow and old-request tests (`Plan:162–178`). Missing legacy forged rows, image migration, notes, status skew and complete response reconciliation. Add those cases. |

The remaining findings:

1. **P1 — Old private `generated` rows bypass the new trust boundary.**  
   Before the fix, any client can POST arbitrary text, image bytes, stock URL and slug with `origin:"generated"`. Origin persists immutably (`B/repositories/db_recipe_repository.py:177–187,1030–1079`). V2 audits only public rows and leaves private rows untouched (`Plan:145,152–153`). After deployment, that private row is already `generated`, normally already `ready`, and can publish its attacker-authored content.

   This reaches recipe text, notes, tags, metadata, URLs and images: `B/templates/public/recipe.html:87–117,139–211`; `B/blueprints/public_bp.py:494–542,1433–1496`. Legacy guest rows can acquire signed-in ownership through login merge without losing origin (`B/blueprints/auth_api_bp.py:242–274`).

   A rejected public row is another bypass: merely setting `is_public=false` leaves `origin='generated'`, so its owner republishes it.

   **Minimal fix:** at a controlled cutover, clear column **and blob** generated origin on every pre-cutover row outside the approved allowlist, including private and guest rows. Clear trust on rejected rows, too. Do this after old writers drain.

2. **P1 — Changing the two blob merges alone does not lock every public field.**  
   The mechanical change specified at `Plan:104–106` leaves these independent raw-payload writes:

   - Upsert derives the column name from `recipe_data`, then assigns it: `B/repositories/db_recipe_repository.py:1001–1005`.
   - PUT assigns the column name directly from `recipe_data`: `:1210`.

   SSR uses `Recipe.name`, including headings, metadata, browse cards and JSON-LD (`B/templates/public/recipe.html:19,87`; `B/templates/public/browse.html:97`; `B/blueprints/public_bp.py:515`). A protected blob with an attacker-written column name still publishes attacker text.

   Raw `sourceSlug` also triggers stock-image removal independently of the allowlisted merge (`B/repositories/db_recipe_repository.py:981–982,1166–1167`).

   **Minimal fix:** explicitly freeze column `name`, slug and provenance on generated/active rows; use the filtered payload for downstream decisions. The broader “every other field ignored” promise requires these changes—editing only the named merges is insufficient.

3. **P1 — `ai_image_url` has an indirect route into public image bytes.**  
   **Direct arbitrary-URL SSR substitution is closed by existing code:** public rendering ignores `ai_image_url`, derives its own image endpoint from stored bytes, and otherwise uses `stock_image_url` (`B/blueprints/public_bp.py:133–142,395–404`). Hero, OG, Twitter and JSON-LD receive that derived image.

   However, the admin migration consumes `data:image/...` from `ai_image_url`, uploads those client-authored bytes, and writes `ai_image_gcs` (`B/blueprints/generation_api_bp.py:627–638,653`). A subsequent legitimate migration makes the attacker’s image public. The endpoint requires admin authorization (`:572–574`), so this is a conditional laundering path, not a client-callable migration.

   **Minimal fix:** settle `Plan:119–122` now: ignore client image URLs, or accept only the exact own-row `/api/recipes/<id>/image` value. Remove data-URL promotion for locked generated rows.

4. **P2 — The content lock silently discards legitimate personal notes.**  
   The SPA writes `personalNotes` on generated recipes and saves the full recipe (`src/components/shared/recipe-view.base.ts:276–299`). V2’s two-field allowlist ignores it. The request succeeds, the editor closes, and the note disappears after server hydration.

   **Minimal fix:** allow `personalNotes` as a private field. Public rendering reads generated `notes`, not `personalNotes` (`B/templates/public/recipe.html:196–202`).

5. **P2 — The planned origin/response handling does not match the actual SPA flow.**  
   Actual sequence:

   - POST `/api/generate` sends `{prompt}`.
   - Polling resolves the **bare recipe blob** when status is `ready` (`src/services/gemini.service.ts:15–44`).
   - Generator saves that worker ID and full blob (`src/components/generator/generator.component.ts:97–110`).
   - Publishing sends another full **POST**, changing `is_public`; it does not use PUT (`src/components/shared/recipe-view.base.ts:392–398`; `src/services/persistence.service.ts:647–650`).
   - POST returns the row envelope (`B/blueprints/recipes_api_bp.py:165`), but reconciliation mirrors only slug, source ID and publication timestamp (`src/services/persistence.service.ts:165–202,667–669`).

   V2 stamps only the origin column and removes the generator’s local label. Without additional reconciliation, a newly generated recipe can remain locally originless and have its publish toggle disabled. Old cached bundles also retain local `is_public:true` when a new-row save returns private.

   **Minimal fix:** explicitly mirror returned origin and `is_public`; expose worker origin consistently in polling. Test the actual POST→POST sequence and an old bundle’s local state, not just response status.

6. **P2 — “Finished status” conflates recipe completion with image activity.**  
   Exact recipe statuses are **`generating`, `processing`, `ready`, `generating_image`, `error`**. There is no `finished` or `complete` recipe status. Recipe completion writes `ready` (`B/blueprints/worker_api_bp.py:528–533`).

   Image generation/regeneration changes a ready row to `generating_image` without unpublishing it (`B/repositories/db_recipe_repository.py:1312,1375–1379`). Success and recorded image failure return it to `ready` (`B/blueprints/worker_api_bp.py:166–171,697–702`).

   Consequently, requiring `ready` blocks publishing or republishing while the image runs. Applying that gate to every resulting public save can also reject ordinary full echoes of an already-public recipe.

   **Minimal fix:** specify transition-only enforcement and distinguish completed recipe text from image activity. A worker-stamped generated row in `generating_image` has finished recipe generation. Test unpublish during image work and publish/republish around it.

7. **P1 — The audit neither proves provenance nor closes the deployment race.**  
   The proposed listing lacks the content needed to judge 101 rows (`Plan:145–151`). Include:

   - Full recipe JSON and rendered preview.
   - Column and blob name/origin/publication discrepancies.
   - Status, claim token, owner ID/email and guest ownership.
   - `source_slug`, `source_recipe_id`, canonical flag.
   - Created/updated/publication timestamps.
   - Slug, stock URL, image-storage identity and image preview.
   - Decision plus a content fingerprint and pre-change values.

   A name/email listing cannot reveal malicious notes, instructions or image bytes. A human review establishes an explicit approval exception; it cannot establish that the worker originally authored a plausible-looking recipe.

   Approved rows remain editable by old Flask code until deployment. A post-deploy listing does not identify edits to already-approved IDs, and it misses forged private rows entirely (`Plan:155–156,206–213`).

   **Minimal fix:** briefly stop recipe writes, drain old revisions and workers, reset legacy trust, then apply the approved manifest against unchanged fingerprints. Recheck complete content afterward and invalidate affected API caches.

8. **P2 — Direct administrative writers remain outside the stated guarantee.**  
   Staging fixtures/imports directly set public state, supplied origin and synthetic content (`scripts/staging/seed-data.py:240–255,408–423`). Re-seeding after the audit reintroduces unaudited public rows; “re-seed or bless” does not fix that (`Plan:201–202`).

   Canonical marking does not establish provenance (`B/migrations/versions/c8d2f6a1e9b3_add_is_canonical_and_source_slug.py:65–69`). Current generic POST/PUT permits canonical content updates while locking publication/slug (`B/repositories/db_recipe_repository.py:203–216`). After blessing and locking, those updates become silently ignored.

   **Minimal fix:** ordinary seed/file imports stay private. Use an explicit reviewed administrative update procedure for canonical content and document that generic client saves cannot update it. No larger publication redesign is required.

9. **P3 — Account display names remain client-authored public text.**  
   OAuth refresh copies Google’s display name into `User.name` (`B/blueprints/auth_api_bp.py:449–474`). Public bylines and JSON-LD render it (`B/templates/public/recipe.html:117`; `B/blueprints/public_bp.py:508–523`). Changing a Google profile name therefore changes public text without recipe-model mediation.

   **Minimal fix:** explicitly permit account identity as an exception to “worker content,” or use a fixed organization byline. This is not a recipe-body overwrite.

Additional verification:

- **Worker endpoints:** both require verified Pub/Sub OIDC; optional authentication bypass exists only when configured (`B/blueprints/worker_api_bp.py:359–395,400–401,573–574`). I could not verify deployed environment values.
- **Prompt copying:** the worker copies the raw prompt into `ai_metadata.recipe_generation.prompt` (`B/blueprints/worker_api_bp.py:509–518`). Public templates/JSON-LD do not render that metadata. Recipe name, notes and image keywords pass through model generation (`B/blueprints/generation_bp.py:118–163`); I found no deterministic raw-prompt copy into those rendered fields.
- **Regeneration:** `/generate` allocates a fresh UUID (`B/blueprints/generation_api_bp.py:91–103`). `/generate_image` accepts an existing owned ID and `force_regenerate`, but supplies no client image prompt (`:167–190`). Image generation patches image fields; it does not stamp recipe origin. Claims and terminal-state handling prevent ordinary clients from rerunning recipe generation on ready/error rows (`B/blueprints/worker_api_bp.py:210–235,439–444`).
- **Saved copies:** fresh-ID mapping with `sourceSlug`/`origin:'saved'` remains compatible (`src/services/public-recipe.mapper.ts:12–32`). Persisted source provenance cannot be cleared (`B/repositories/db_recipe_repository.py:434–471,640–649`). Under a correctly applied lock, generated-row payloads cannot add or clear `sourceSlug`.
- **Collections:** mutate cookbook membership only, not recipe content (`B/blueprints/collections_api_bp.py:246–271`).
- **Error/originless rows:** v2 makes them unpublishable. Upsert can reset a nonactive error row to its default `ready`, but that alone does not acquire generated origin (`B/repositories/db_recipe_repository.py:907,1002`). Finding 1 covers legacy forged origins.
- **Import removal — P3:** remove the enclosing “Import JSON” control and stale empty-state copy, not only the input (`src/components/kitchen/kitchen.component.html:289–296,371`). No remaining runtime caller outside the named import methods was found; stale comments remain in persistence and recipe-state services.

**P2 — “No migration” is correct for schema, incorrect if interpreted as no data transition.** Existing origin/status/provenance columns suffice (`B/models/recipe.py:85–113`). Finding 1 requires a controlled data cleanup. The deployment still executes `flask db upgrade`; no new revision does not mean the job has nothing pending (`cloudbuild.yaml:101–105,160–170`). Deployed Alembic state was not verified.

**P1 — Release coordination needs explicit cutover checks.** Backend deploys before Express (`cloudbuild.yaml:294–297`), so cached SPA compatibility is mandatory. Old Flask revisions and in-flight workers can still write untrusted content or complete recipes without the new stamp during overlap. Verify all traffic and worker deliveries use the fixed revision before final cleanup.

**Minimal fix:** hold the release until both advisory fixes are integrated; verify the cookbook gitlink resolves to the promoted **public Backend main** commit (`.gitmodules:3`; `.github/workflows/release.yml:37–40`). Run combined tests with that pinned backend. Use a short write pause/drain for cleanup, and prevent rollback to the vulnerable backend. I could not verify advisory targets, PR state, live traffic splits, Pub/Sub targets, staging rollout or database contents.

Recommendation: revise v2 before release because legacy client-stamped private rows remain publishable and the allowed image URL can still be promoted into public attacker-authored bytes.