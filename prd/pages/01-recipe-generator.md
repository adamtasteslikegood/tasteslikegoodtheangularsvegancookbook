# Page PRD: Recipe Generator

- **Route:** `/`
- **Rendering:** Angular SPA
- **Users:** Guests and Google users
- **Source:** `src/components/generator/`, shared recipe-view code, generation/state/persistence services, Backend generation and worker blueprints

## Purpose

The product entry point converts a natural-language food request into a structured vegan recipe and generated image, then lets the visitor save, organize, download, scale, annotate, or publish the result. Generation works without sign-in.

## Entry modes

| Entry                   | Behavior                                                                       |
| ----------------------- | ------------------------------------------------------------------------------ |
| `/`                     | Show input and current service-held recipe/job state                           |
| `/?save=<slug>#kitchen` | Validate slug, fetch safe public payload, save owner copy, navigate `/kitchen` |
| `/?auth=success`        | Refresh auth/merged state, remove callback query, stay on `/`                  |
| `/#kitchen`             | Legacy normalization to `/kitchen`                                             |

Malformed public-save slugs are rejected. No recipe content or ownership identity is trusted from the URL.

## Layout and states

The shared Angular shell contains brand, Generator/My Kitchen tabs and count, guest Sign In or signed-in profile/count/logout, router outlet, global modals/toast, and Browse/Privacy footer links.

### Input

- Recipe idea textarea.
- Generate action.
- Guidance/examples may mention ingredients, dish, constraints, or style but always remain vegan.

### Generating

- Recipe-specific progress while text work is pending.
- Distinct image progress after recipe readiness.
- Repeat activation cannot enqueue accidental duplicate work.
- Navigation does not cancel valid backend jobs.

### Result

- Vegan Recipe badge; name, description, tags, prep/cook time, servings.
- Image, pending placeholder, or failure fallback.
- Scale `0.5×`, `1×`, `2×`.
- Wet/dry/other/custom ingredient groups and ordered method.
- Generated notes plus separately labeled private personal notes.
- Save/Saved, Add to Cookbook, Download JSON, regenerate image, publication, and View actions as eligible.

## Prompt contract

| Field    | Required    | Validation                                                        |
| -------- | ----------- | ----------------------------------------------------------------- |
| `prompt` | Yes         | Trimmed 10–500 characters; rejected before queueing otherwise     |
| `model`  | No/API-only | Optional runtime/developer override; no ordinary consumer control |

Default v0.4.12 text model: `gemini-3.7-flash`.

## Text generation sequence

1. Ensure a guest UUID exists if not signed in.
2. `POST /api/generate` persists a pending row and returns `202` plus recipe ID.
3. Pub/Sub delivers work to authenticated `/api/worker/recipe`.
4. Client polls `/api/recipes/:id/status` approximately every two seconds.
5. Worker claims a lease, calls Gemini, validates `recipe_schema.json`, and persists content.
6. Retryable failures retry within the default three-attempt/lease budget.
7. Success reaches `ready` and automatically queues image work; terminal text failure reaches `error` with safe feedback.

Duplicate Pub/Sub delivery is idempotent, and stale claims cannot overwrite current state.

## Image sequence

- Default v0.4.12 model is `gemini-3.1-flash-image` using `generate_content` and image response modalities.
- Shared `RecipeStateService` owns pending IDs, so progress survives route changes.
- Poll approximately every two seconds; end after five minutes.
- Validate model output bytes, store the current version in GCS, and serve through the authorized image API.
- Regeneration forces new work and applies cache busting only to the displayed URL; the canonical recipe field remains token-free.
- Safety block, empty response, unsupported bytes, timeout, or terminal worker error clears pending state and toasts; recipe content remains usable.

On terminal image failure the backend returns the recipe to top-level `ready` and records failure in image metadata. This preserves the usable cooking content while allowing the client to end image progress.

## Actions

| Action             | Rule/result                                                                   |
| ------------------ | ----------------------------------------------------------------------------- |
| Generate           | Valid prompt and no duplicate submit; starts async flow                       |
| Save               | Persist through detailed owner-aware contract; Saved only after valid outcome |
| Add to Cookbook    | Saved recipe; open multi-membership modal and allow new cookbook              |
| Download JSON      | Portable recipe only; exclude credentials/transient state/cache tokens        |
| Scale              | Presentation-only ingredient calculation                                      |
| Edit notes         | Writes only `personalNotes`; generated `notes` remains read-only              |
| Regenerate image   | Persisted owner recipe; forced async image request                            |
| Publish            | Authenticated owner, eligible synchronized recipe                             |
| Sign in to publish | Guest; opens auth modal                                                       |
| View               | Own `/r/<slug>` or source `/r/<sourceSlug>`                                   |

## Publication state

| Recipe state                                 | Control                                   |
| -------------------------------------------- | ----------------------------------------- |
| Eligible signed-in generated/legacy original | Enabled after initial sync                |
| Guest                                        | “Sign in to publish”                      |
| Initial server sync pending                  | Temporarily unavailable with explanation  |
| `origin=manual`                              | Grey explanatory manual lock              |
| `is_canonical=true`                          | Grey explanatory canonical lock           |
| Persisted source provenance                  | Grey source lock and linked original page |

Backend validation repeats every rule. A refused optimistic change is reverted.

## Save and error outcomes

| Outcome                         | UI requirement                                            |
| ------------------------------- | --------------------------------------------------------- |
| Success                         | Refresh owner state and show saved                        |
| `RECIPE_ALREADY_SAVED`          | “Good news — you already have this recipe.”; keep one row |
| `OWNERSHIP_OTHER_ACCOUNT`       | Final refusal, no local duplicate                         |
| `OWNERSHIP_OTHER_GUEST_SESSION` | Sign-in/recovery guidance, no overwrite                   |
| `OWNERSHIP_ORPHANED_GUEST_ROW`  | Explain mismatch, no silent claim                         |
| Publication/slug refusal        | Revert state and explain specific rule                    |
| Network/job failure             | Preserve usable input/content and provide retry guidance  |

## Accessibility and responsive behavior

- Icon-only actions have names or titles.
- Publish uses labeled `role="switch"` and `aria-checked`.
- Locked switches remain explainable/focusable and refuse clicks.
- Actions wrap on narrow screens and never overlap the image.
- Grouping/order are semantic and not color-only.
- Explicit assistive live-status treatment for all loading states is **[TBC where not present]**.

## APIs and relationships

Uses generation, image, status, recipe, auth, and collection APIs in [API Inventory](../appendix/api-inventory.md). Save/add connects to [My Kitchen](02-my-kitchen.md); opening a saved row uses [Recipe Detail](03-recipe-detail.md); publication creates [Public Recipe](04-public-recipe.md) and [Browse](05-public-browse.md) visibility.

## Acceptance

1. A guest valid prompt produces schema-valid content; invalid length queues nothing.
2. v0.4.12 defaults use Gemini 3.7 Flash text and Gemini 3.1 Flash Image.
3. Image state survives navigation and reaches success or controlled failure within five minutes.
4. Save, scale, download, notes, membership, and regeneration work without ownership drift.
5. Only eligible authenticated originals publish.
6. Saved copies remain private and link to the source.
7. Duplicate and ownership refusals do not create client/server divergence.
8. Public-save, auth-callback, and legacy-hash entries normalize to stable Angular routes.
9. Regenerate/navigation/save never persists or exports the display-only `?_t=` image token.
