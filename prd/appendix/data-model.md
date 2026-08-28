# Appendix: Data Model

- **Target:** v0.4.12
- **Authoritative product persistence:** PostgreSQL (Cloud SQL in production; Railway PostgreSQL in the checked-in staging deployment)
- **Client cache and continuity:** Browser local storage
- **Local development fallback:** SQLite

## 1. Entity relationships

```text
User (Google account)
  | 1
  |----< Recipe.user_id                         current holder
  |----< Recipe.user_id_author                  original author
  |----< Recipe.user_id_saved_to                saver of public copy
  |----< Cookbook.user_id

Guest session UUID
  |----< Recipe.guest_session_id
  |----< Cookbook.guest_session_id

Recipe.source_recipe_id ----> Recipe.id         stable source identity
Cookbook.recipe_ids    -----> Recipe.id[]        owner-scoped memberships

Recipe data/metadata --------> GCS object        generated image bytes
Recipe job state <------------ Pub/Sub workers
```

Exactly one current-holder scope is expected for ordinary rows: `user_id` or `guest_session_id`.

## 2. Recipe table

| Column               | Type or shape             | Required      | Meaning and rules                                                            |
| -------------------- | ------------------------- | ------------- | ---------------------------------------------------------------------------- |
| `id`                 | UUID string, 36 chars     | Yes           | Primary key; generated or preserved by server rules                          |
| `user_id`            | User foreign key          | Conditional   | Current signed-in holder                                                     |
| `guest_session_id`   | String, 64 chars, indexed | Conditional   | Current guest holder                                                         |
| `name`               | String, 200 chars         | Yes           | Display name mirrored from recipe JSON                                       |
| `status`             | String, 20 chars          | Yes           | Job and readiness state; default `ready`                                     |
| `worker_claim_token` | UUID string               | No            | Lease/idempotency token; never public or client-writable                     |
| `slug`               | String, 255 chars, unique | No            | Own public URL slug; server generated                                        |
| `is_public`          | Boolean                   | Yes           | Own publication state; default false                                         |
| `is_canonical`       | Boolean                   | Yes           | Server-owned curated-row lock; default false                                 |
| `source_slug`        | String, 255 chars         | No            | Link-compatible slug of source public recipe; retained after source deletion |
| `source_recipe_id`   | Self foreign key          | No            | Stable source identity, server-resolved, `ON DELETE SET NULL`                |
| `origin`             | String, 20 chars          | No for legacy | `manual`, `generated`, or `saved`; settable while null, immutable thereafter |
| `user_id_author`     | User foreign key          | No            | Immutable original author when known                                         |
| `user_id_saved_to`   | User foreign key          | No            | Account that saved a public copy; null for originals                         |
| `data`               | Mutable JSON object       | Yes           | Complete portable recipe content and compatible metadata                     |
| `created_at`         | Timestamp                 | Yes           | Creation time                                                                |
| `updated_at`         | Timestamp                 | Yes           | Last mutation time                                                           |

Database columns win over stale duplicated JSON values for slug, publication, canonical state, source slug, and origin. Every SPA API consumer normalizes the row envelope before display.

### 2.1 Owner-scoped recipe identity

Two partial unique indexes enforce one identity per owner:

```text
user:  unique(user_id, coalesce(source_recipe_id, source_slug, id))
guest: unique(guest_session_id, coalesce(source_recipe_id, source_slug, id))
```

Consequences:

- Resolved copies of the same public source collide on immutable source ID.
- Unresolved legacy copies fall back to source slug.
- Original and private recipes key on their own IDs, so identical names are allowed.
- A public source row and its saved copy in one owner scope can reconcile by stable identity.
- Database enforcement closes concurrent-tab races.

### 2.2 Publication invariants

- `is_canonical=true`: content may be corrected, but publication state, slug, and row deletion are locked.
- `origin=manual`: cannot transition from private to public.
- `source_recipe_id` or meaningful `source_slug`: saved copy; cannot publish.
- A public row requires a usable unique slug.
- `source_recipe_id` is never trusted from an untrusted save body; server resolves it from the known public source.
- Owner, origin, author, saver, and source provenance are immutable or server-controlled according to repository rules.

## 3. Recipe JSON object

The `data` object and Angular `Recipe` type contain cooking content.

| Property          | Type            | Schema required                      | Notes                                                                               |
| ----------------- | --------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| `id`              | String          | Angular type yes                     | Matches row ID after normalization                                                  |
| `name`            | String          | Yes                                  | Recipe title                                                                        |
| `description`     | String          | No in JSON schema; client expects it | Short summary                                                                       |
| `prepTime`        | Integer minutes | Yes                                  | Nonnegative product expectation                                                     |
| `cookTime`        | Integer minutes | Yes                                  | Nonnegative product expectation                                                     |
| `servings`        | Integer         | Yes                                  | Positive product expectation                                                        |
| `ingredients`     | Group map       | Yes                                  | Requires `wet` and `dry`; supports `other` and additional groups                    |
| `instructions`    | Array           | Yes                                  | Strings or `{step, description}` objects                                            |
| `notes`           | String          | No                                   | Generated editorial notes; public-safe when recipe is public                        |
| `personalNotes`   | String          | No                                   | Owner-only editable notes; never public                                             |
| `tags`            | String array    | No                                   | Display and discovery keywords                                                      |
| `image_keywords`  | String array    | No                                   | One to five generation/search hints when present                                    |
| `stock_image_url` | URI or null     | No                                   | Optional stock image                                                                |
| `ai_image_url`    | URI or null     | No                                   | Canonical generated image endpoint/reference; excludes display cache tokens         |
| `image`           | URI or null     | No                                   | Compatibility/general image reference                                               |
| `is_public`       | Boolean         | No                                   | Blob compatibility copy; database column wins                                       |
| `slug`            | String          | No                                   | Blob compatibility copy; database column wins                                       |
| `sourceSlug`      | String          | No                                   | SPA form of `source_slug`                                                           |
| `is_canonical`    | Boolean         | No                                   | Server-projected and read-only                                                      |
| `origin`          | Enum            | No                                   | Manual, generated, or saved provenance                                              |
| `ai_metadata`     | Object          | No                                   | Text/image model, prompt, timestamps, success, queue, object path, and failure data |

### 3.1 Ingredient

| Property | Type                   | Required | Notes                                  |
| -------- | ---------------------- | -------- | -------------------------------------- |
| `name`   | String                 | Yes      | Ingredient name                        |
| `amount` | Number or number array | Yes      | Scalar or range; UI scales numerically |
| `units`  | String                 | Yes      | Measurement unit                       |
| `notes`  | String                 | No       | Preparation or qualifier text          |

### 3.2 Instruction

An instruction is either a plain string or an object with required `description` and optional or expected `step >= 1`. Rendering normalizes both shapes into an ordered method.

### 3.3 AI metadata

Recipe-generation metadata may record model, actor identifier, original prompt, timestamp, and success. Image metadata records model, prompt, timestamp, success, error, current request/enqueue state, and GCS path. v0.4.12 model defaults are:

- Recipe text: `gemini-3.7-flash`.
- Recipe image: `gemini-3.1-flash-image`.

The schema's historical image-generation description still mentions Imagen. Normative v0.4.12 runtime uses Gemini `generate_content`; schema wording should be updated in a follow-on patch **[TBC]**.

The SPA may derive a display URL by adding `?_t=<epoch>` after regeneration. That token is transient UI state, not recipe data. Current merged code writes the derived URL into local session state, from which a later save can POST it. Conforming v0.4.12 patch behavior strips the token at every persistence/export boundary and stores only the canonical image endpoint.

## 4. User table and client projection

### 4.1 Server row

| Column       | Type                | Rules                              |
| ------------ | ------------------- | ---------------------------------- |
| `id`         | Integer primary key | Internal account identifier        |
| `email`      | String, 120 chars   | Required and globally unique       |
| `name`       | String, 100 chars   | Optional Google display name       |
| `google_id`  | String, 100 chars   | Optional and unique Google subject |
| `created_at` | Timestamp           | Required                           |

### 4.2 SPA projection

The client user contains `id`, optional email, name, optional picture, `isGuest`, auth provider (`google` or `guest`), saved recipes, cookbooks, and optional local deleted recipes. Email display is masked in profile UI. OAuth tokens are never part of this projection.

## 5. Cookbook table

| Column             | Type              | Required    | Meaning                               |
| ------------------ | ----------------- | ----------- | ------------------------------------- |
| `id`               | UUID string       | Yes         | Primary key                           |
| `user_id`          | User foreign key  | Conditional | Signed-in owner                       |
| `guest_session_id` | String, 64 chars  | Conditional | Guest owner                           |
| `name`             | String, 200 chars | Yes         | Trimmed owner-visible name            |
| `description`      | String, 500 chars | No          | Defaults to empty                     |
| `cover_image`      | String, 500 chars | No          | Optional cover reference              |
| `recipe_ids`       | JSON string array | Yes         | Membership identifiers; default empty |
| `created_at`       | Timestamp         | Yes         | Creation time                         |
| `updated_at`       | Timestamp         | Yes         | Last mutation time                    |

Partial unique indexes enforce `(user_id, name)` or `(guest_session_id, name)` uniqueness. A recipe may be in multiple cookbooks. Deleting a cookbook deletes membership, not recipes.

## 6. Local-only deleted recipe

The SPA `DeletedRecipe` contains a full private recipe snapshot, `deletedAt` ISO timestamp, and optional prior cookbook IDs. It is retained in browser local storage only after server hard deletion. Restore re-posts the snapshot and then re-establishes eligible membership. It is not durable Cloud SQL trash.

## 7. Public recipe projection

The public JSON and SSR mapper allowlists data sufficient to render and copy:

- Public recipe ID and slug.
- Name, description, timing, servings.
- Ingredients and instructions.
- Generated notes, tags, and safe image references.
- Safe public author or display metadata when available.

It excludes:

- `personalNotes`.
- `guest_session_id`.
- Private current-holder identifiers not required for byline.
- Worker claim token and queue internals.
- Session, OAuth, database, admin, and service credentials.

The SPA mapper creates a new `origin=saved` copy, sets `sourceSlug`, and receives no edit authority over the source row.

## 8. Job and image state

Top-level recipe status:

- `generating`: recipe job queued or claimed.
- `processing`: model output being processed and validated.
- `ready`: recipe content is usable; image may exist, be pending by metadata, or have terminal failure metadata.
- `generating_image`: current image request queued or claimed.
- `error`: terminal recipe-text generation failure.

Terminal image failure deliberately restores top-level `ready`, records failure under `ai_metadata.image_generation` and request or enqueue metadata, and leaves the recipe content usable. The SPA combines status, metadata, and its five-minute timeout to end progress.

Generated images are stored as versioned GCS objects. The recipe points to the current object; successful replacement cleans eligible stale objects and invalidates cached bytes. Worker claims and expected-state updates prevent stale completion from winning.

## 9. Guest-to-user merge

On successful OAuth callback:

1. Guest recipes are processed one row at a time.
2. True duplicates use persisted source recipe ID, fallback source slug, and a public row's own slug where needed to preserve a live page.
3. A non-public duplicate guest copy may reconcile to the account copy.
4. A public duplicate is reassigned or preserved rather than deleted if deletion removes a live page.
5. Distinct private generated recipes with the same name remain distinct.
6. Guest cookbooks transfer to user scope, resolving name collisions under unique indexes.
7. Membership IDs are rewritten and deduplicated to surviving recipes.
8. Author and saver provenance remains semantically correct.

## 10. Cache keys and invalidation

- Owner keys distinguish `u:<user-id>` from `g:<guest-session-id>`.
- Recipe and collection mutations invalidate affected object, list, and stats keys.
- Image keys are global by recipe ID because bytes are identical, but authorization happens before response.
- Cache failures degrade to authoritative storage without changing correctness.

## 11. Data lifecycle constraints

- Recipe and cookbook deletion is hard deletion unless the SPA retains a local recycle snapshot.
- Deleting a source recipe sets saved copies' `source_recipe_id` null, while retained `source_slug` continues to mark them source-derived and unpublishable.
- Unpublishing preserves owner access but removes anonymous public access and discovery.
- Guest rows rely on browser session identity for later access and merge; retention and deletion policy is **[TBC]** and must align with Privacy Policy.
