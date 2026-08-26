# VeganGenius Chef Product Requirements Document

- **Product:** tasteslikegood.org / VeganGenius Chef
- **Target release:** v0.4.12
- **Reference baseline:** production v0.4.11 plus the staged v0.4.12 fixes below
- **Evidence date:** 2026-08-24
- **Method:** reconstructed from the Angular/Express repository, `Backend/` Flask submodule, staged Backend commits, and observed production/staging behavior

## 1. Product summary

VeganGenius Chef is a guest-first web application for creating, saving, organizing, and publishing vegan recipes. A visitor describes a dish in natural language and receives a structured recipe plus generated food image. Guests can keep a kitchen without creating an account; Google sign-in upgrades that kitchen to server-backed cross-device use. Signed-in owners can publish eligible AI-generated recipes. Everyone can discover published recipes at `/browse`, read canonical pages at `/r/<slug>`, and save a public recipe into a private kitchen.

The product has two presentation systems:

- An Angular 22 single-page application (SPA) for generation, account state, recipe detail, cookbooks, import/export, and manual recipes.
- Flask server-rendered HTML (SSR) for public browse and recipe pages, optimized for fast anonymous reading, search, structured data, and sharing.

Express is the only public application service. It serves the Angular build and static policy assets, applies edge security and rate limits, and proxies API/SSR requests to a private Flask Cloud Run service.

## 2. Version contract

### 2.1 v0.4.11 production baseline

The production revisions observed on the evidence date used the v0.4.11 release commit. This establishes:

- Dedicated, non-indexable staging infrastructure and verifier.
- Server-owned recipe provenance and an unpublishable saved-copy rule.
- Source-page links for copies saved from public recipes.
- Database-enforced duplicate public-save identity.
- Google-authenticated Express-to-private-Flask proxying.
- Correct SPA fallback: real client routes receive `index.html`; unknown asset-like paths return `404`.
- Cloud Run health, migration, Valkey, and production-content verification gates.

### 2.2 v0.4.12 normative release assumption

This is a post-release product contract, not a claim that every supporting Git ref was merged on the evidence date. Per the product owner's explicit scenario, this PRD treats the following staged changes as successfully shipped behavior:

- Text generation defaults to `gemini-3.7-flash` unless `GEMINI_DEFAULT_MODEL` overrides it.
- Image generation defaults to `gemini-3.1-flash-image` unless `GEMINI_IMAGE_MODEL` overrides it.
- Gemini `generate_content` with image response modalities replaces Imagen `generate_images`.
- Safety-blocked or empty image responses end in controlled failure instead of a null error or endless spinner.
- Image pending state is service-owned and survives SPA navigation.
- Client image polling ends after five minutes with a toast on timeout/failure.
- Guest-to-account merge deduplicates by persisted source identity, not normalized recipe name; distinct same-name private recipes survive.

The `gemini-3.7-flash` default is taken from current Backend PR #298 (head `d723c6c`, implementation commit `1742dbe`). The same-name merge correction is taken from the separately staged `auth_api_bp.py` and `test_guest_merge_dedup.py` working change inspected on the evidence date. Both are intentionally normative here even though the release branch's pinned Backend commit predates them. “Must” describes required v0.4.12 behavior and the next one or two patch releases, not a speculative redesign.

### 2.3 Known v0.4.12 conformance gaps

Three places where code observed on the evidence date deviates from what this PRD asserts. Each entry records the fact; the disposition is **[TBC]**.

**Image cache token persists as canonical data.** Merged image-navigation work correctly keeps pending state alive, but current regeneration code appends a presentation-only `?_t=<epoch>` cache token and writes that display URL into the locally persisted recipe. A later recipe save can send the token back as `ai_image_url`. This violates the canonical-data and no-transient-state requirements below. The immediate patch contract is to keep the cache token in display state only and strip it during hydration, local persistence, export, and API writes; regression coverage must include regenerate, navigate/reload, then save or edit.

**Response cache covers image bytes only.** `utils/cache_utils.py` defines owner-scoped key builders (`recipe_key`, `recipe_stats_key`, `collections_list_key`, `collection_key`) and the `TTL_SHORT` and `TTL_MEDIUM` constants, but no blueprint imports them, so those keys are never written. The only live population path is recipe image bytes (`vgc:img:<id>`, 24 hours) in `generation_api_bp.py`; `recipes_api_bp.py` and `collections_api_bp.py` perform no cache reads or writes. Invalidation is only partly wired: `worker_api_bp.py` calls `invalidate_recipe` and `invalidate_recipe_image`, while `invalidate_collection` is never called. Of the module's symbols only `safe_get`, `safe_set`, `recipe_image_key`, `TTL_IMAGE`, `invalidate_recipe`, and `invalidate_recipe_image` are imported anywhere. Section 10 of the API inventory now describes the wired behavior. Whether to wire the remaining caches or delete the unused helpers is **[TBC]**.

**Client-supplied recipe payloads bypass schema validation.** AI-generated content is schema-checked: the worker reaches `recipe_schema.json` through `attempt_recipe_generation`, which raises on a validation error. Recipes written directly by the client — manual entry, JSON import, and saved copies — pass from `request.get_json()` into `create_recipe` and `update_recipe` with no `validate_recipe_data` call, so `/api/recipes` `POST` and `PUT` persist unvalidated blobs. Ownership, provenance, publication, and duplicate-identity checks do run on those paths; only JSON-Schema conformance is absent.

## 3. Goals

1. Turn a short food idea into a complete usable vegan recipe without requiring sign-in.
2. Preserve a user's recipes and organization across navigation and, after sign-in, devices.
3. Make ownership, duplicate-save, and publication behavior safe and understandable.
4. Give published originals durable shareable URLs with complete metadata and no private notes.
5. Keep AI work asynchronous, retryable, idempotent, and independent of the visible SPA route.
6. Operate the browser edge, private application service, data, queue, images, and caches securely on GCP.

The repository contains no approved product KPI targets. Baselines, owners, and thresholds for generation completion, image completion, save-through, publication, and returning-kitchen use are **[TBC]**.

## 4. Non-goals

- Native mobile applications.
- Non-vegan generation.
- Collaborative kitchens, comments, ratings, follows, or a social feed.
- Commerce, subscriptions, payments, or advertising.
- Publishing manually entered recipes.
- Republishing a copy saved from another public recipe.
- Consumer-facing model selection.
- Full recipe editing beyond manual creation and private notes.
- Durable cross-device recycle bin.

## 5. Users and permissions

| Actor                 | Capabilities                                                                     | Restrictions                                                                |
| --------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Guest cook            | Generate, save, import/export, create cookbooks, organize, browse public recipes | Cannot publish; access depends on current guest-session identity            |
| Google user           | Guest capabilities plus cross-device persistence and eligible publication        | Cannot publish manual/canonical/source-derived rows or mutate another owner |
| Public visitor        | Browse/read public recipes and start save-to-kitchen                             | Cannot read private recipes/notes or edit the source row                    |
| Search/social crawler | Read production SSR, metadata, sitemap, public images                            | Staging is noindex; all public-only boundaries still apply                  |
| Pub/Sub worker        | Process queued recipe/image work                                                 | Requires verified configured OIDC service account                           |
| Administrator         | Image audit/migration actions                                                    | Requires server-side bearer authorization                                   |

## 6. Primary journeys

### 6.1 Generate and keep

1. Enter a trimmed 10–500 character idea on `/`.
2. Receive a persisted pending recipe ID from the asynchronous API.
3. Poll until Gemini returns schema-valid content or a terminal failure.
4. Start image work automatically; it may finish after navigation.
5. Save, scale, download, add to cookbooks, edit private notes, or sign in.

### 6.2 Sign in and merge

1. Open Google OAuth with Authorization Code plus PKCE in a supported browser.
2. Return through the callback and create/find the account.
3. Merge guest recipes and cookbooks.
4. Collapse true source duplicates, preserve unrelated same-name recipes, and rewrite memberships.
5. Hydrate the SPA from authoritative user data.

### 6.3 Publish an original

1. A signed-in owner opens an eligible synchronized generated recipe.
2. The server verifies owner, origin, canonical state, and provenance.
3. It derives a normalized collision-safe slug and sets `is_public`.
4. `/r/<slug>` becomes available and the recipe joins `/browse` and the sitemap.
5. Unpublishing removes anonymous access while preserving the owner's recipe.

### 6.4 Save a public recipe

1. A visitor opens `/r/<slug>` from browse, a share, or search.
2. “Save to My Cookbook” enters `/?save=<slug>#kitchen`.
3. The SPA fetches an allowlisted public payload and posts a new owner-scoped copy.
4. The server resolves `source_recipe_id` and stores `source_slug`.
5. A repeat save yields one copy and “Good news — you already have this recipe.”
6. The copy stays private; View returns to the source page.

### 6.5 Organize a kitchen

1. Open `/kitchen`, All Recipes, a cookbook, or Recycle Bin.
2. Create/delete cookbooks, change memberships, import/export JSON, or write a manual recipe.
3. Deleting a cookbook preserves its recipes.
4. Deleting an ordinary recipe hard-deletes it server-side but retains a browser-local restorable snapshot.

## 7. Functional requirements

### 7.1 Generation and images

- `POST /api/generate` must return accepted work without waiting for the model.
- Workers must claim leases, tolerate duplicate delivery, retry transient text failures (default three attempts), validate `recipe_schema.json`, and persist safe terminal state.
- v0.4.12 defaults are Gemini 3.7 Flash for text and Gemini 3.1 Flash Image for images.
- Generated image bytes must be validated and stored in GCS when configured.
- Regeneration must not let an older worker overwrite newer state.
- Cache-busting query parameters are presentation-only and must never become canonical `ai_image_url` data in local storage, exports, or API writes.
- The SPA must keep image state across routes and stop after five minutes with user-visible failure.

### 7.2 Persistence and ownership

- Every private recipe/cookbook request is scoped to the current user or guest UUID.
- Server PostgreSQL is authoritative for ownership, publication, provenance, and duplicates; production uses Cloud SQL.
- Browser storage enables fast/guest continuity but may not convert an explicit server refusal into local success.
- Another account or guest session cannot modify, claim, delete, or publish a row.
- Guest merge preserves cookbooks and distinct recipes.

### 7.3 Publication

- Only authenticated owners publish.
- Private manual (`origin=manual`), canonical, and source-derived rows remain unpublishable.
- The client never asks users to type a slug; the server generates and deconflicts it.
- A name that cannot yield a usable slug gets a controlled refusal.
- Public output uses an allowlist and excludes `personalNotes`, session IDs, and private worker/owner data.

### 7.4 Cookbooks and portability

- Cookbook names are required, trimmed, and unique per owner scope.
- Repeated/concurrent creation reconciles to one cookbook.
- Cookbook deletion preserves recipes.
- Export All exports the entire active library, not only the selected cookbook.
- Import accepts an object or array, validates required structure, strips embedded AI image data, persists valid entries independently, and reports partial failure.
- Missing imported images may be generated sequentially.

### 7.5 Public discovery

- `/browse` contains public slug-addressable recipes only, newest first, 20 per page.
- Invalid/out-of-range page queries normalize to an available page.
- `/r/<slug>` returns `404` for private or missing recipes.
- SSR works without Angular and includes canonical, social, and Recipe JSON-LD metadata.
- The sitemap contains home, browse, and current public recipe URLs.

## 8. Page inventory

| Page             | Route             | Rendering             | Detailed requirements                      |
| ---------------- | ----------------- | --------------------- | ------------------------------------------ |
| Recipe Generator | `/`               | Angular SPA           | [Generator](pages/01-recipe-generator.md)  |
| My Kitchen       | `/kitchen`        | Angular SPA, lazy     | [Kitchen](pages/02-my-kitchen.md)          |
| Recipe Detail    | `/recipe/:id`     | Angular SPA, lazy     | [Recipe Detail](pages/03-recipe-detail.md) |
| Public Recipe    | `/r/<slug>`       | Flask SSR via Express | [Public Recipe](pages/04-public-recipe.md) |
| Public Browse    | `/browse`         | Flask SSR via Express | [Browse](pages/05-public-browse.md)        |
| Privacy Policy   | `/privacy-policy` | Express static HTML   | [Privacy](pages/06-privacy-policy.md)      |
| Chunk Error      | `/chunk-error`    | Angular SPA           | [Recovery](pages/07-chunk-error.md)        |

Express additionally serves `/api/health`, `/robots.txt`, `/sitemap.xml`, assets, and the proxied API. Unknown non-asset browser routes reach the Angular shell; unknown asset-like paths return `404`.

## 9. Shared experience

- Responsive Angular header with Generator/My Kitchen navigation, kitchen count, guest sign-in, or signed-in profile/count/logout.
- Angular and SSR footers link Browse and Privacy.
- One toast at a time, normally six seconds, with optional in-app/public action.
- Keyboard-reachable labeled modals and controls.
- Embedded social-app browsers show why Google OAuth is blocked plus copy/open-in-browser guidance.
- Generated `notes` remain recipe content; editable `personalNotes` are explicitly private.
- Async loading belongs to job state, not component focus.

## 10. Architecture

```text
Browser / crawler
        |
        v
Public Express Cloud Run
  Angular assets + SPA fallback
  static pages + security + rate limits
  API/SSR proxy with Google ID token
        |
        v
Private Flask Cloud Run
  OAuth, recipe/cookbook/public APIs, SSR, workers
    |             |              |
    v             v              v
Cloud SQL      Pub/Sub          GCS
PostgreSQL     push jobs        image objects
    ^
    |
Valkey / Memorystore
Flask cache + Express distributed rate-limit counters
```

See [Platform Behavior](appendix/platform-behavior.md), [API Inventory](appendix/api-inventory.md), and [Data Model](appendix/data-model.md).

## 11. Environment and release requirements

- Production and staging use separate GCP project resources and data stores.
- Production canonicalizes apex traffic to `https://www.tasteslikegood.org` and is indexable.
- Staging returns `X-Robots-Tag: noindex, nofollow`, disallows robots, and keeps Flask private.
- Production migrations run as a Cloud Run Job before the Flask revision; failure aborts promotion.
- Flask deploys before Express to avoid a new client targeting an old API.
- Artifact Registry images are immutable/revision traceable; secrets come from runtime or Secret Manager.
- `/api/health` reports liveness and distributed rate-limit-store status.
- Verification covers home, SPA routes, browse, a public recipe and public JSON, sitemap, asset `404`, security, indexing, and production content.

## 12. Security and privacy

- HTTPS, Helmet, scoped CSP, sanitized logs, generic client errors, request validation, and owner/public authorization are mandatory.
- General API and public-page limits each default to 300 requests per 15 minutes per IP in separate keyspaces; generation defaults to 20 per hour per IP.
- Public and private projections remain separate.
- OAuth requests only `openid`, `userinfo.email`, and `userinfo.profile`.
- Google account attributes and credentials must not enter Gemini prompts, exports, or logs.
- Express and Pub/Sub authenticate independently to private Flask.

The current privacy page says guest recipes/cookbooks remain only in `localStorage` and never leave the device until sign-in. Runtime sends guest-scoped operations to Flask/Cloud SQL for generation, ownership, and merge. This material disclosure mismatch must be resolved before the policy is considered an accurate v0.4.12 description. The policy also promises direct in-app account deletion, but no matching UI/API was found. Copy, runtime, retention, analytics, and deletion disposition require owner/legal review **[TBC]**.

## 13. v0.4.12 acceptance

1. Production and staging public-route/health verification passes; staging remains non-indexable and Flask is not anonymously invokable.
2. Default recipe generation uses Gemini 3.7 Flash and persists schema-valid ready content.
3. Default image generation uses Gemini 3.1 Flash Image and reaches success or controlled failure within the client timeout.
4. Image progress survives SPA navigation.
5. An authenticated owner can publish an original generated recipe with safe complete SSR metadata.
6. Manual, canonical, and saved-copy publication fails consistently in generator, detail, and direct API paths.
7. Repeating a public save leaves one copy and shows the benign existing outcome.
8. Same-name private recipes survive guest merge; true source duplicates reconcile.
9. Cross-owner mutations fail without local duplication.
10. Cookbook race/idempotency, delete-preserves-recipes, import, export, and recycle behavior match this PRD.
11. SPA routes load while missing asset-like paths return `404`.
12. `personalNotes` is absent from public JSON, SSR, metadata, and structured data.
13. CI, migration checks, build, and post-deploy verification pass.
14. Privacy/data-flow contradictions have an explicit disposition **[TBC]**.
15. Regeneration refreshes the displayed image without persisting or exporting the `?_t=` cache token.

## 14. Open decisions

| Topic                      | Decision needed                                                                                                                                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product metrics            | Define approved KPIs, owners, baselines, and thresholds **[TBC]**                                                                                                                                                                                                                                          |
| Guest disclosure/retention | Align actual guest backend persistence with policy **[TBC]**                                                                                                                                                                                                                                               |
| Account deletion           | Add promised product/API path or revise policy **[TBC]**                                                                                                                                                                                                                                                   |
| Analytics language         | Verify deployed collection and opt-out claims **[TBC]**                                                                                                                                                                                                                                                    |
| Recycle bin                | Decide whether durable/cross-device trash is required **[TBC]**                                                                                                                                                                                                                                            |
| Legacy Flask/file APIs     | Define access and retirement boundary. `create_app()` still registers `auth_bp` (`/auth`), `recipes_bp` (`/` and `/recipe/*`), and `generation_bp` (`/generate_recipe`); they are unreachable in production only because Express proxies a narrow path allowlist, not because Flask refuses them **[TBC]** |

## 15. Traceability

This artifact is grounded in executable routes, components, services, and tests under `src/`, `server/`, `scripts/`, `cloudbuild.yaml`, and `Backend/`; Backend PR #298 at `d723c6c`; the staged guest-merge working change; and observed 2026-08-24 production/staging behavior. Executable code and migrations win over stale prose until this PRD is refreshed; unknowable product intent is marked **[TBC]**.

- [API Inventory](appendix/api-inventory.md)
- [Data Model](appendix/data-model.md)
- [Enum Dictionary](appendix/enum-dictionary.md)
- [Page Relationships](appendix/page-relationships.md)
- [Platform Behavior](appendix/platform-behavior.md)
