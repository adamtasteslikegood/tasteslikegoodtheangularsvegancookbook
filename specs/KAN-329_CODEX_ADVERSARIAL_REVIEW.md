The vulnerability is real, but the plan does not close it. It converts `origin` from a client-controlled label into a server-controlled label without binding that label to AI-produced content.

Reviewed cookbook `826069ad` and Backend `0506f0fd`; both differ from the commits named in the plan. No files were changed and no project code or tests were executed.

## Findings

1. **P1 — A trusted row can still publish arbitrary client content.**

   The proposed stamp is attached to the pending row before any AI output exists. `/api/generate` creates that row and returns its ID before queue processing ([generation_api_bp.py:91-132](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/blueprints/generation_api_bp.py:91)). Same-owner POST is an upsert and merges every client field into that row ([db_recipe_repository.py:924-1015](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/repositories/db_recipe_repository.py:924)); PUT does the same ([db_recipe_repository.py:1153-1221](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/repositories/db_recipe_repository.py:1153)). Therefore a signed-in client can:

   - call `/api/generate`;
   - take the returned stamped ID;
   - overwrite its text through POST or PUT;
   - set `is_public:true`.

   It can also overwrite any older generated/backfilled row and publish it later. Canonical rows explicitly permit content edits ([db_recipe_repository.py:203-216](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/repositories/db_recipe_repository.py:203)).

   **Fix:** stamp only after successful worker completion, store a server-generated hash or immutable revision of the generated public fields, and require `status='ready'` plus a matching hash to publish. Any client change to public content must clear the attestation or be rejected.

2. **P1 — Pending, failed, and processing rows can be public.**

   The plan stamps before Pub/Sub publication; queue failure merely changes status to `error` and leaves the row ([generation_api_bp.py:133-141](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/blueprints/generation_api_bp.py:133)). Same-owner upserts preserve active statuses ([db_recipe_repository.py:32-32](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/repositories/db_recipe_repository.py:32), [db_recipe_repository.py:1001-1015](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/repositories/db_recipe_repository.py:1001)). `/r`, `/browse`, and the sitemap check only `is_public` and slug, not status or origin ([public_bp.py:943-952](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/blueprints/public_bp.py:943), [public_bp.py:1186-1191](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/blueprints/public_bp.py:1186), [public_bp.py:1431-1440](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/blueprints/public_bp.py:1431)).

   During a worker race, the worker preserves `is_public` ([db_recipe_repository.py:784-830](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/repositories/db_recipe_repository.py:784)). A failed worker leaves attacker content public; a successful worker may replace it only after a period of public exposure.

   **Fix:** publishing must require a completed, worker-attested revision. Public queries should defensively require that state as well.

3. **P1 — The planned SPA import remains an ID-reuse/public-overwrite path.**

   The proposed stripped-field list omits `id` ([plan:127-131](/home/allisone/Projects/tasteslikegoodtheangularsvegancookbook-ghsa-8744-3qm2-c4x8/specs/KAN-329_PUBLISH_GATE_HOTFIX_PLAN.md:127)). Import preserves supplied IDs and generates one only when absent ([auth.service.ts:477-490](/home/allisone/Projects/tasteslikegoodtheangularsvegancookbook-ghsa-8744-3qm2-c4x8/src/services/auth.service.ts:477)). POST then upserts an existing same-owner row. When `is_public` is stripped, the repository deliberately preserves the existing public state ([db_recipe_repository.py:972-1007](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/repositories/db_recipe_repository.py:972)).

   A hand-written import using the ID of one of the account’s public generated rows replaces its content while leaving it public. No later toggle is needed.

   **Fix:** assign a fresh ID to every import, or use a dedicated import endpoint that cannot update existing rows. Make generic POST create-only; use constrained PATCH operations for existing rows.

4. **P1 — The backfill blesses precisely the untrusted data under investigation.**

   The old migration defines NULL as “legacy/unknown,” not “generated,” and left it publishable only for compatibility ([d1e5a9c3f7b2_add_origin_to_recipe.py:1-14](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/migrations/versions/d1e5a9c3f7b2_add_origin_to_recipe.py:1)). The proposed predicate blesses:

   - old hand-posted content;
   - imports with omitted or forged origin;
   - manual rows that missed the narrow `image_keywords` signature;
   - private attacker-created rows that can be published later;
   - `generating` and `error` placeholders;
   - staging’s handwritten fixtures, which mostly have no origin ([seed-data.py:93-154](/home/allisone/Projects/tasteslikegoodtheangularsvegancookbook-ghsa-8744-3qm2-c4x8/scripts/staging/seed-data.py:93)).

   It misses already-public rows carrying `source_slug` or `source_recipe_id`; those remain publicly served because SSR ignores origin. It also destroys the useful fact that those rows were previously “unknown.”

   **Fix:** no blanket NULL-to-generated update. Snapshot the affected IDs, audit them first, then backfill only an explicit reviewed allowlist or rows supported by non-client-controlled generation evidence. Keep an audit manifest for rollback.

5. **P1 — Guest generation still provides a laundering route.**

   Guests cannot publish directly; that part is correct ([db_recipe_repository.py:609-650](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/repositories/db_recipe_repository.py:609)). But a guest can generate a stamped row, overwrite its content privately, then sign in. Login merge changes ownership and provenance metadata but never origin ([auth_api_bp.py:242-274](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/blueprints/auth_api_bp.py:242)). The resulting signed-in row is publishable.

   Cross-account claiming by guessing an ID is blocked by the ownership check ([db_recipe_repository.py:924-968](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/repositories/db_recipe_repository.py:924)); same-session claiming is the bypass.

   **Fix:** content-bound worker attestation, not an origin label on the placeholder.

6. **P1 — Generated-recipe restore is broken.**

   “Soft delete” is local only; the Backend row is hard-deleted, and restore re-POSTs the cached recipe ([persistence.service.ts:424-455](/home/allisone/Projects/tasteslikegoodtheangularsvegancookbook-ghsa-8744-3qm2-c4x8/src/services/persistence.service.ts:424)). Under the plan, that new-row POST may no longer restore `origin:'generated'`, so the restored generated recipe becomes permanently unpublishable.

   **Fix:** retain server tombstones containing trusted provenance, add a server restore endpoint, or issue a server-signed restore token. Do not reconstruct trusted provenance from a client cache.

7. **P1 — The migration-first deployment creates an exploitable old-code window.**

   The plan runs the migration before the new revision serves ([plan:137-141](/home/allisone/Projects/tasteslikegoodtheangularsvegancookbook-ghsa-8744-3qm2-c4x8/specs/KAN-329_PUBLISH_GATE_HOTFIX_PLAN.md:137)). During that interval, the old revision still accepts client `origin:'generated'` or NULL and publishes it ([db_recipe_repository.py:177-200](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/repositories/db_recipe_repository.py:177)). Once the new revision starts, those rows remain public because public reads do not enforce origin.

   The failure-mode claim that a recipe generated in this window “cannot publish” ([plan:203](/home/allisone/Projects/tasteslikegoodtheangularsvegancookbook-ghsa-8744-3qm2-c4x8/specs/KAN-329_PUBLISH_GATE_HOTFIX_PLAN.md:203)) is false: the old SPA POSTs `origin:'generated'` after polling ([generator.component.ts:97-110](/home/allisone/Projects/tasteslikegoodtheangularsvegancookbook-ghsa-8744-3qm2-c4x8/src/components/generator/generator.component.ts:97)).

   **Fix:** use a two-stage rollout or drain old revisions. First deploy code that stops trusting clients while tolerating legacy rows, then audit/backfill, then enable strict enforcement.

8. **P2 — Direct writers remain outside the supposed invariant.**

   `migrate_file_to_db` directly honors `slug` and `is_public` ([db_recipe_repository.py:1562-1602](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/repositories/db_recipe_repository.py:1562)). Staging import and fixtures directly set `is_public`, `is_canonical`, and origin ([seed-data.py:240-255](/home/allisone/Projects/tasteslikegoodtheangularsvegancookbook-ghsa-8744-3qm2-c4x8/scripts/staging/seed-data.py:240), [seed-data.py:408-423](/home/allisone/Projects/tasteslikegoodtheangularsvegancookbook-ghsa-8744-3qm2-c4x8/scripts/staging/seed-data.py:408)). Canonical migrations only mark existing rows by slug; they do not establish generation provenance ([c8d2f6a1e9b3_add_is_canonical_and_source_slug.py:42-70](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/migrations/versions/c8d2f6a1e9b3_add_is_canonical_and_source_slug.py:42)).

   These paths are not client-callable, but they disprove the invariant and can create public NULL-origin rows after the backfill has run.

   **Fix:** update every direct writer and add a database constraint such as `NOT is_public OR publication_attestation IS NOT NULL`. Scripts requiring an exception should use an explicit audited administrative path.

9. **P2 — An old cached SPA fails worse than “publish refused.”**

   It inserts the imported recipe into local state before saving and ignores the save result ([kitchen.component.ts:383-404](/home/allisone/Projects/tasteslikegoodtheangularsvegancookbook-ghsa-8744-3qm2-c4x8/src/components/kitchen/kitchen.component.ts:383)). A new-row public import gets 400; 400 is treated as a generic sync failure ([persistence.service.ts:84-96](/home/allisone/Projects/tasteslikegoodtheangularsvegancookbook-ghsa-8744-3qm2-c4x8/src/services/persistence.service.ts:84)), and only duplicate 409 ghosts are removed ([persistence.service.ts:316-359](/home/allisone/Projects/tasteslikegoodtheangularsvegancookbook-ghsa-8744-3qm2-c4x8/src/services/persistence.service.ts:316)). The user gets a local “published” ghost, an import-success alert, no server row, and subsequent image generation returns 404.

   **Fix:** design a backward-compatible server response that persists the row privately, mirror the authoritative full row, and force cache/version invalidation. Test an actual old-bundle request shape.

10. **P2 — One export path is omitted.**

    The plan updates Kitchen bulk export, but single-recipe export independently serializes the entire recipe ([recipe-view.base.ts:461-469](/home/allisone/Projects/tasteslikegoodtheangularsvegancookbook-ghsa-8744-3qm2-c4x8/src/components/shared/recipe-view.base.ts:461)).

    **Fix:** route both export call sites through the same projection function and test both.

11. **P2 — Literal implementation of the toggle plan can block unpublishing.**

    Current logic deliberately disables manual recipes only while they are private, allowing a legacy public row to be unpublished ([public-link.ts:79-110](/home/allisone/Projects/tasteslikegoodtheangularsvegancookbook-ghsa-8744-3qm2-c4x8/src/utils/public-link.ts:79)); the action guard also checks only an attempted transition to public ([recipe-view.base.ts:344-356](/home/allisone/Projects/tasteslikegoodtheangularsvegancookbook-ghsa-8744-3qm2-c4x8/src/components/shared/recipe-view.base.ts:344)). “Any origin other than generated is unpublishable” is ambiguous and could disable the whole toggle.

    **Fix:** explicitly preserve unpublishing for every public noncanonical row; only disable transitions from private to public.

12. **P2 — The proposed tests prove label handling, not the security property.**

    They omit same-ID import over a public row, same-owner pending-row takeover, worker failure after takeover, guest-overwrite-login-publish, restore, old-bundle behavior, and public-query status enforcement.

    **Fix:** add those adversarial integration cases. A test that merely passes `origin="generated"` directly to the repository does not prove a browser cannot acquire or alter such a row.

## Legitimate-flow impact

- **Normal SPA generate → save → publish:** should continue working because polling returns the worker-written ID and the later POST hits the existing stamped row ([gemini.service.ts:27-58](/home/allisone/Projects/tasteslikegoodtheangularsvegancookbook-ghsa-8744-3qm2-c4x8/src/services/gemini.service.ts:27)). This is also what makes the same-ID bypass possible.
- **Guest generate → login → publish:** origin survives every surviving merge branch. Duplicate private rows may instead be deleted in favor of the owned row ([auth_api_bp.py:136-148](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/blueprints/auth_api_bp.py:136)).
- **Saved copies:** ordinary private creation remains valid; persisted `source_slug`/`source_recipe_id` cannot be cleared through PUT ([db_recipe_repository.py:406-471](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/repositories/db_recipe_repository.py:406)).
- **Image generation:** worker image writes preserve public state and do not change origin ([db_recipe_repository.py:837-899](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/repositories/db_recipe_repository.py:837)). They continue working, including on rows whose ordinary API saves would now be refused.
- **Generated unpublish/republish:** works if origin was stamped/backfilled.
- **Generated restore:** breaks, as above.
- **Legacy/canonical public rows with source provenance:** continue serving, but ordinary content saves will be refused. I could not verify whether any current production canonical row has that shape.
- **Staging seeds:** continue creating public rows by bypassing the gate, but those rows have NULL origin and later ordinary saves can fail.
- **Collections:** no recipe content write was found; collection endpoints only mutate their `recipe_ids` list ([collections_api_bp.py:246-271](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/blueprints/collections_api_bp.py:246)).
- **Legacy Flask generation:** writes files, not recipe-table rows ([generation_bp.py:196-253](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/blueprints/generation_bp.py:196)).

## Open questions

1. **P2 — Other legitimate creators:** no additional runtime server path creates a publishable recipe-table row. Canonical migrations only promote existing rows. The staging seed and file migration scripts do directly create public rows and bypass the proposed gate.

2. **P1 — Backfill correctness:** no. It turns “unknown” into “trusted generated,” blesses private arbitrary content, and misses public saved/provenance rows.

3. **P3 — Login merge:** yes, origin is preserved on every surviving row because no branch assigns it. Some duplicate private guest rows are deleted, and one legacy public collision branch can remain guest-owned; those are not preservation failures.

4. **P2 — Old cached SPA:** yes. A fresh public import becomes a misleading local ghost with failed image generation, while an import reusing an existing trusted ID can overwrite public content successfully.

## Migration head

**P3 — Static checkout has one head:** `c4d8e2a6f1b3`, descending from `b7e2f0c4d9a1` ([c4d8e2a6f1b3_index_retired_slug_recipe_id.py:19-20](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/migrations/versions/c4d8e2a6f1b3_index_retired_slug_recipe_id.py:19)). The earlier status/slug branches are already merged by `c60f6530f4ff` ([c60f6530f4ff_merge_status_and_slug_heads.py:13-14](/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh/migrations/versions/c60f6530f4ff_merge_status_and_slug_heads.py:13)). Attach the new revision to `c4d8e2a6f1b3`.

I verified this statically only; I did not run Flask/Alembic or verify remote branches or deployed database state.

## Stronger design

Use a dedicated publication capability:

- Worker completion creates an immutable generated revision or a hash of the public fields.
- Generic POST is create-only and strips all publication fields.
- Generic client updates can change only private fields.
- `/api/recipes/<id>/publish` checks ownership, `status='ready'`, no saved-copy provenance, and a matching worker attestation.
- Public pages render the attested snapshot, not the mutable client blob.
- A database constraint prevents direct scripts from setting `is_public` without an attestation.

For the release, audit and snapshot uncertain rows before backfill, make the audit a blocking P1 task, deploy in two stages to eliminate the old-revision window, update every direct writer, and test rollout skew with the old SPA request shape.

Recommendation: reject the plan as written because a client can overwrite any server-stamped or backfilled row—including a pending row or a public row reused by import—and publish arbitrary content.