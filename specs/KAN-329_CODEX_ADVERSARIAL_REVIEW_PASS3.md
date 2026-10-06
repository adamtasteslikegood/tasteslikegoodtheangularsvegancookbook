V3 still needs revision. Its ordinary POST/PUT lock closes the main overwrite paths, but its cutover can retain publishing authority on rejected content, and image provenance remains bypassable.

Reviewed SPA `e3b308c` and Backend `0506f0f`. `Plan` means `specs/KAN-329_PUBLISH_GATE_HOTFIX_PLAN.md`; `B/` means the sibling Flask checkout. No files changed or tests executed. V3 is unimplemented; deployed configuration, database contents, advisory state, and the future SQL script could not be verified.

Pass-2 dispositions:

| Pass-2 finding | Severity | Disposition and evidence |
|---|---|---|
| 1. Legacy forged-generated rows | P1 | **Partly closed.** Reset includes private/guest rows (`Plan:241–243`), but fingerprint-rejected keep rows retain their old origin. Fix below. |
| 2. Raw name/slug/provenance writes | P1 | **Closed by v3**, if filtering occurs before every downstream read as specified (`Plan:150–158`). That covers the actual assignments at `B/repositories/db_recipe_repository.py:981–1005,1166–1217`. Retain both POST/PUT regressions. |
| 3. Client image URL promotion | P1 | **Closed by v3 for that path**: URL writes and migration promotion are removed (`Plan:159–162`; `B/blueprints/generation_api_bp.py:627–638`). Other media paths remain below. |
| 4. Personal notes discarded | P2 | **Closed by v3**: `personalNotes` is allowed (`Plan:153`); public rendering uses `notes` (`B/templates/public/recipe.html:196–202`). Retain persistence/hydration coverage. |
| 5. Response reconciliation | P2 | **Partly closed.** Updated SPA mirrors origin/publication (`Plan:188–191`), but old bundles cannot acquire that new behavior. Fix below. |
| 6. Image status conflation | P2 | **Closed by v3’s transition-only policy** (`Plan:127–131,163–170`). Image completion/failure returns to `ready` (`B/blueprints/worker_api_bp.py:166–171,697–702`). Retain publish/unpublish tests during image work. |
| 7. Audit/deployment race | P1 | **Partly closed.** Fingerprints and pause are specified, but sequencing, writer draining, media coverage, and manifest eligibility remain incomplete (`Plan:221–256,329–340`). |
| 8. Administrative writers | P2 | **Partly closed.** Canonical API changes are redirected to administration, but synthetic seeds are explicitly stamped generated (`Plan:261–266`). Fix below. |
| 9. Google display-name bylines | P3 | **Still open, accepted follow-up** (`Plan:84,367–368`; `B/templates/public/recipe.html:117`). Keep the follow-up; no hotfix expansion requested. |
| Additional: data transition | P2 | **Closed in scope**, but SQL execution remains unverifiable: only the future script is described (`Plan:255–256,342`). Require its transaction and fixture results before release. |
| Additional: release coordination | P1 | **Partly closed.** Pin/order are specified, but predeployment pause, revision drain, worker targets, and rollback protection are missing (`Plan:333–339`; `cloudbuild.yaml:294–297`). |

Remaining findings:

1. **P1 — Changed approved rows can be republished immediately.**

   Reset excludes every ID in the approved list. A fingerprint mismatch then only unpublishes that row (`Plan:241–246`). An existing `origin='generated'` therefore survives rejection. If its status is `ready`, its signed-in owner can POST `is_public:true` and publish the changed text again.

   The existing POST path preserves origin and defaults nonactive status to `ready` (`B/repositories/db_recipe_repository.py:995–1014`). Public recipe, browse, and sitemap queries check publication alone (`B/blueprints/public_bp.py:952,1189,1438`).

   **Minimal fix:** construct the final approved set from *successful fingerprint and eligibility checks*. Clear column/blob origin on every rejected or mismatching row, including IDs originally marked keep. Test mismatch → republish refused, not merely mismatch → unpublished.

2. **P1 — The fingerprint permits attacker-controlled media to survive approval.**

   Images and slug are excluded, and the audit previews only the first few ingredients/steps (`Plan:220–227`). Before fixed code takes over, the owner can replace `ai_image_data`, `ai_image_gcs`, or `stock_image_url` without changing the text fingerprint. The changed media survives blessing.

   Public hero/OG/JSON-LD resolve stored bytes or stock URLs (`B/blueprints/public_bp.py:127–142,519`); browse uses them too (`:395–404`). Image delivery decodes stored base64 (`B/blueprints/generation_api_bp.py:304–315`). `image_keywords`, also outside the stated fingerprint, controls future image generation (`B/blueprints/worker_api_bp.py:633–644`). Changing slug changes public URLs and sitemap entries (`B/blueprints/public_bp.py:960,1496`).

   **Minimal fix:** review complete public text and media at the paused cutover. Bind approval to column name, slug, complete rendered content, image-generation inputs, and reviewed media identity. Alternatively clear uncertain media and regenerate it through the fixed image worker. Legitimate regeneration can be allowed through that trusted path; it does not justify accepting arbitrary pre-cutover media changes.

3. **P1 — Text-model output can supply public image bytes or an external image URL.**

   Replacement removes the placeholder blob, but accepts the model-produced dictionary wholesale (`Plan:143–146`; `B/blueprints/worker_api_bp.py:465–469,506–533`). Normalization preserves additional keys (`B/utils/normalization.py:120,159,212`). The schema accepts stock/AI URLs and does not prohibit additional top-level properties (`B/recipe_schema.json:11–19,233–269`).

   A prompt can ask the text model to return an attacker’s `stock_image_url`, or base64 `ai_image_data` plus `ai_image_url`. If the model complies, the row becomes generated/ready and those assets become public. Existing-image detection can skip the actual image worker (`B/blueprints/worker_api_bp.py:329–332`).

   This is a **conditional prompt-mediated path**, not a deterministic raw-body copy; model compliance was not tested. A model-emitted URL does not mediate the bytes subsequently served from that URL.

   **Minimal fix:** project text-worker output onto recipe-text fields plus `image_keywords`. Discard all image bytes, storage pointers, image URLs, publication, ownership, and provenance fields before stamping. Only the image worker should populate image assets.

4. **P1 — The release deploys before the pause exists.**

   Release step 5 deploys Backend before Express; cutover follows afterward (`Plan:337–339`). The pause ships in that new Express revision (`Plan:199–201`). Thus the first Backend deployment cannot already be protected by this switch.

   During overlap, old Flask requests can still create/overwrite public rows; new Flask can publish old forged-generated private rows before reset. An old worker finishing after cleanup can merge preexisting client fields into a row (`B/repositories/db_recipe_repository.py:806–826`). The Express switch does not stop worker writes.

   **Minimal fix:** deploy the pause-capable Express revision first, enable the pause on all serving traffic, drain client requests and old workers, then deploy fixed Backend and run cleanup. Verify traffic splits, revision-tag access, Pub/Sub destinations, and `PUBSUB_AUTH_OPTIONAL=0` before proceeding. Keep rollback behind the pause.

   SSR is GET-only (`server/index.ts:275–302`), so I found no ordinary SSR mutation bypass. Direct public Flask access is blocked by the checked-in IAM/ingress configuration (`cloudbuild.yaml:265–292`), but live configuration was not verified. Worker routes are proxied and rely on their separate OIDC guard (`server/index.ts:132`; `B/blueprints/worker_api_bp.py:359–395`).

5. **P1 — Manifest application lacks mandatory eligibility and atomicity checks.**

   The listing omits `source_recipe_id`; application requires only a matching text hash (`Plan:217–219,244–246`). It can bless an existing public saved copy, guest-owned row, or incomplete/error row. Transition-only enforcement will not remove such already-public rows.

   Saved-copy checks depend on both provenance columns (`B/repositories/db_recipe_repository.py:640–649`); public reads do not enforce them.

   Rows published between listing and pause also need an explicit default-deny disposition. “Unpublish rows” does not define that final anti-join (`Plan:247–248`). One SQL script is not necessarily one transaction (`Plan:255–256`).

   **Minimal fix:** use a transaction with locked rows and fingerprint comparisons inside it. Require signed-in ownership, both source columns NULL, and completed text status. Unpublish every current public row outside the final valid manifest, including newly encountered rows; clear its trust. Advance `updated_at` on affected rows so image queue/patch compare-and-swap writes cannot restore stale blobs (`B/repositories/db_recipe_repository.py:885,1368`).

6. **P2 — Old cached bundles still retain false publication state.**

   Returning a private row avoids a 400 ghost, but old JavaScript mirrors only slug/source identity/publication timestamp (`src/services/persistence.service.ts:165–202`). It retains optimistic `is_public:true` and locally forged generated origin. V3 cannot change already-loaded code merely by changing the response (`Plan:196–198`).

   **Minimal fix:** force old bundles to reload during cutover and test the actual old client’s resulting local state. Narrow the compatibility claim: successful private persistence is covered; authoritative old-client reconciliation is not.

7. **P2 — Saved-copy thumbnails disappear after hydration.**

   Saved-copy creation carries the source image through `ai_image_url` (`src/services/public-recipe.mapper.ts:24–32`). V3 removes client writes to that field (`Plan:159`). Backend also strips inherited stock URLs (`B/repositories/db_recipe_repository.py:1051–1059`). Its owned-list response returns stored data (`B/blueprints/recipes_api_bp.py:92`), while Kitchen renders only `ai_image_url` (`src/components/kitchen/kitchen.component.ts:83–84`; `src/services/recipe-state.service.ts:120–123`).

   The optimistic image can appear initially and vanish after reload.

   **Minimal fix:** derive saved-copy display media server-side from the persisted public source identity, or resolve it in the SPA from `sourceRecipeId`. Keep client image fields ignored.

8. **P2 — SQL cleanup leaves stale authoritative recipe responses.**

   Cleanup deletes only `vgc:img:<id>` (`Plan:250–251`). Actual image keys are versioned, and owned recipe GET responses have separate owner-scoped caches (`B/utils/cache_utils.py:115–116,131–157`). GET serves those cached responses before reading the database (`B/blueprints/recipes_api_bp.py:222–233`), for up to ten minutes (`B/utils/cache_utils.py:23`).

   **Minimal fix:** invalidate owner-scoped recipe caches for every modified row before lifting the pause. Image-cache hits cannot bypass current visibility checks (`B/blueprints/generation_api_bp.py:453–470`), so deleting only the obsolete unversioned key neither revokes HTTP-cached images nor repairs stale recipe state.

9. **P2 — The pause can report saved notes and persist dangling collection membership.**

   Saves write localStorage before receiving 503 (`src/services/persistence.service.ts:327–330`). Notes ignore the failed result and close the editor (`src/components/shared/recipe-view.base.ts:298–299`). Collection addition ignores recipe-save failure and still posts membership (`src/services/persistence.service.ts:555–558`); Backend accepts an ID without checking recipe existence (`B/blueprints/collections_api_bp.py:255–271`).

   Publish/unpublish does revert and show an error (`src/components/shared/recipe-view.base.ts:398–425`). Generation/image requests surface errors (`src/services/gemini.service.ts:22–24,81–83`).

   **Minimal fix:** recognize maintenance 503 explicitly, show unsynced notes, and stop collection membership writes when recipe save fails. Include membership mutations in the pause. No automatic retry queue was verified.

10. **P2 — Staging still publishes synthetic content without worker completion.**

    V3 explicitly stamps handwritten public fixtures generated through the ORM (`Plan:261–266`). Existing import mode also directly honors exported publication/origin (`scripts/staging/seed-data.py:249–251`), separately from fixture creation (`:408–418`).

    **Minimal fix:** make ordinary seed/import modes private; use a reviewed explicit manifest for public fixtures. Document canonical administrative updates as an approval exception. ORM access alone does not establish worker completion.

The remaining flow checks:

- **Blob replacement:** no required prompt/image-request data was found exclusively in the placeholder. It contains ID/name/user only (`B/blueprints/generation_api_bp.py:97`). Prompt/model arrive through Pub/Sub (`:118–124`); the worker rebuilds metadata and image enqueue state (`B/blueprints/worker_api_bp.py:509–525`). Preserve ownership from current columns.
- **Image merge/queue:** no direct raw-body content injection found. Queue writes server-built request metadata with a timestamp guard (`B/repositories/db_recipe_repository.py:1355–1380`); completion patches generated media/metadata (`B/blueprints/worker_api_bp.py:658–703`). Neither establishes text origin.
- **Payload filter:** handlers only validate presence/read JSON before repository calls; no subsequent raw-body content writer found (`B/blueprints/recipes_api_bp.py:148–165,259–275`). POST still requires a `name` key even for a publication-only upsert; the actual SPA full echo satisfies it.
- **Generate → poll → save → publish:** compatible if polling preserves its bare-recipe contract and mirrors column origin. Current polling resolves only `ready`, not `generating_image` (`src/services/gemini.service.ts:41–47`). If implementation starts text completion in `generating_image`, resolve completed text there too; otherwise an image stall also stalls recipe display.
- **Guests:** origin/publication exposure adds no cross-owner access path; status reads remain owner-scoped (`B/blueprints/generation_api_bp.py:254–261`). Generated guest origin means eligible after login, not currently public.
- **Legacy notes — P3:** v3’s rationale misreads the current migration: it runs only for manual recipes (`src/components/shared/recipe-view.base.ts:272–273`). Minimal fix: retain clearing for private manual rows; do not broaden adoption to generated notes.
- **Restore:** private-only is accepted. Reconcile NULL origin by clearing local generated origin, and explain private-only restoration; restore currently ignores save failure (`src/services/persistence.service.ts:444–455`).

For v0.5.8, add regressions for findings 1–9 and require staging evidence for the actual transactional script, writer drain, pinned Backend, cache reconciliation, and final public eligibility checks **before lifting the pause**. The current plan lifts it before its final listing (`Plan:252–253`).

Recommendation: revise v3 before release because rejected approved rows remain republishable, media can bypass the content boundary, and the cutover does not establish a drained, atomic trust reset.