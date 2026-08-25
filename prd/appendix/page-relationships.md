# Appendix: Page Relationships and User Flows

**Target:** v0.4.12

## 1. Route map

```text
                                      +----------------------+
                                      | /privacy-policy      |
                                      | Express static HTML  |
                                      +----------------------+
                                                 ^
                                                 | footer

+----------------------+     nav/save     +----------------------+
| /                    | <--------------> | /kitchen             |
| Angular Generator    |                  | Angular My Kitchen   |
+----------------------+                  +----------------------+
       |       ^                                  |       ^
       |       | publish/view                     |       | back
       |       |                                  v       |
       |       +--------------------------- /recipe/:id --+
       |                                      Angular detail
       |
       | publish original
       v
+----------------------+      listed by     +----------------------+
| /r/<slug>            | <----------------- | /browse              |
| Flask SSR recipe     |                    | Flask SSR discovery  |
+----------------------+                    +----------------------+
       |
       | Save to My Cookbook
       v
/?save=<slug>#kitchen -> Angular entry guard -> public JSON -> owner copy -> /kitchen

/chunk-error -> Retry and full navigation -> /
```

## 2. Shell boundaries

| Surface family        | Routes                                          | Shell and state                                                                             |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Angular SPA           | `/`, `/kitchen`, `/recipe/:id`, `/chunk-error`  | Shared header/footer, auth/profile, modals, toast, persistence, recipe state                |
| Flask SSR public      | `/browse`, `/r/<slug>`                          | Shared public base, Browse nav, My Kitchen modal, Privacy footer; no Angular state required |
| Express standalone    | `/privacy-policy`                               | Independent static document                                                                 |
| Machine and discovery | `/api/*`, `/sitemap.xml`, `/robots.txt`, assets | No interactive page shell                                                                   |

SSR and SPA intentionally meet through URLs and APIs, not shared in-memory state.

## 3. Global Angular navigation

| From          | Action                 | To                           | State behavior                           |
| ------------- | ---------------------- | ---------------------------- | ---------------------------------------- |
| Any SPA page  | Generator tab or brand | `/`                          | Shared recipe and image state may remain |
| Any SPA page  | My Kitchen             | `/kitchen`                   | Background jobs continue                 |
| Any SPA page  | Sign In                | Auth modal then Google OAuth | Guest state merges after callback        |
| Any SPA page  | Footer Browse          | `/browse`                    | Full SSR navigation allowed              |
| Any SPA page  | Footer Privacy         | `/privacy-policy`            | Standalone page navigation               |
| Recipe detail | Back                   | `/kitchen`                   | Persisted content remains                |
| Chunk error   | Retry                  | `/`                          | Full document reload                     |

## 4. Generate-to-publish flow

```text
Prompt on /
  -> POST /api/generate
  -> pending Recipe row
  -> recipe Pub/Sub worker
  -> Gemini 3.7 Flash
  -> schema-valid ready recipe
  -> image Pub/Sub worker
  -> Gemini 3.1 Flash Image
  -> GCS image
  -> Save and cookbook organization
  -> Google sign-in if needed
  -> publish eligible original
  -> /r/<slug>
  -> /browse and /sitemap.xml membership
```

Unpublishing removes anonymous page access, browse membership, and sitemap membership while preserving owner access in the SPA.

## 5. Public discovery-to-private-copy flow

```text
/browse
  -> select public card
  -> /r/<source-slug>
  -> Save to My Cookbook
  -> /?save=<source-slug>#kitchen
  -> GET /api/recipes/public/<source-slug>
  -> map safe payload to origin=saved copy
  -> POST /api/recipes
  -> server resolves source_recipe_id and source_slug
  -> /kitchen
  -> /recipe/<copy-id>
```

The destination stays private. View returns to `/r/<source-slug>` and publication is locked. Repeating the flow returns the existing owner copy.

## 6. Guest-to-Google transition

```text
Guest SPA state and guest Cloud SQL rows
  -> auth modal
  -> /api/auth/login
  -> Google OAuth plus PKCE
  -> /api/auth/callback
  -> create or find User
  -> merge guest recipes and cookbooks
  -> redirect /?auth=success
  -> auth refresh and server hydration
```

Merge invariants:

- Current holder changes from guest UUID to user ID.
- Source provenance and author or saver meaning remain stable.
- Cookbook names and memberships reconcile.
- True source duplicates collapse or reassign safely.
- Same-name private originals remain distinct.

## 7. Kitchen organization

| Starting context | Action          | Destination or result                                |
| ---------------- | --------------- | ---------------------------------------------------- |
| All Recipes      | Select cookbook | Same route filtered; no recipe mutation              |
| Active list      | Select card     | `/recipe/:id`                                        |
| Active list      | Add to cookbook | Membership modal; remain `/kitchen`                  |
| Active list      | New Cookbook    | Create modal; new filter available                   |
| Active list      | Write Recipe    | Three-step modal; new private manual recipe          |
| Active list      | Import          | Valid recipes added and optionally imaged            |
| Active list      | Export All      | Download all active recipes                          |
| Recipe card      | Delete          | Server hard delete plus local trash item             |
| Recycle Bin      | Restore         | Re-post recipe and eligible memberships              |
| Cookbook         | Delete          | Remove collection, return valid filter, keep recipes |

## 8. Image job independence

```text
Generator or Detail starts image work
  -> RecipeStateService marks recipe ID pending
  -> user navigates to /kitchen or another /recipe/:id
  -> job and polling state continues outside initiating component
  -> success refreshes image and cache token
     OR timeout or terminal metadata clears pending and toasts
```

No route change is itself a cancellation request.

## 9. Publication eligibility

```text
Recipe selected
  |
  +-- canonical? --------------------> locked
  |
  +-- private manual origin? --------> manual lock
  |
  +-- persisted source provenance? --> source lock plus source View
  |
  +-- guest? ------------------------> Sign in to publish
  |
  +-- initial sync pending? ---------> temporarily unavailable
  |
  +-- owned generated or legacy -----> normal switch
```

All client branches converge on backend validation. Omitting or changing a request field cannot bypass a lock.

## 10. Failure and recovery

| Failure                        | Surface                            | Recovery                                             |
| ------------------------------ | ---------------------------------- | ---------------------------------------------------- |
| Lazy chunk unavailable         | `/chunk-error`                     | Full reload to `/`                                   |
| Recipe detail unavailable      | `/recipe/:id`                      | Toast then `/kitchen`                                |
| Public slug unavailable        | `/r/<slug>`                        | SSR `404`; no SPA fallback                           |
| Text generation terminal error | Generator or job-aware state       | Stop polling, show retry guidance                    |
| Image timeout or failure       | Any SPA route with shared state    | Keep recipe usable, allow retry                      |
| OAuth blocked in webview       | Auth modal                         | Copy link and open Safari or Chrome                  |
| Duplicate save                 | Generator, public handoff, kitchen | Keep existing copy and benign toast                  |
| Ownership refusal              | Any save or publish mutation       | No local duplicate, mapped guidance                  |
| Valkey unavailable             | API or page                        | Memory/store fallback; health reports degraded state |

## 11. Canonical and indexing relationships

- Production home canonicalizes to `https://www.tasteslikegood.org`.
- `/browse` and public `/r/<slug>` are indexable production SSR pages.
- `/sitemap.xml` connects discovery to every current public recipe.
- Staging returns noindex headers and disallows robots independent of templates.
- Private Angular IDs and kitchen routes are not public discovery surfaces.
