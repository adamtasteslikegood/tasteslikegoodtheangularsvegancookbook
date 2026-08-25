# Page PRD: Recipe Detail

- **Route:** `/recipe/:id`
- **Rendering:** Lazy Angular SPA route
- **Users:** Current guest or user owner
- **Source:** `src/components/recipe-detail/`, shared recipe-view/state/persistence code, Backend recipe APIs

## Purpose

Recipe Detail is the durable private-kitchen address for one recipe. It supports full reading, ingredient scaling, JSON download, private-note editing, image regeneration/status, saving a cold-loaded recipe, and eligible publication. It is distinct from `/r/<slug>`.

## Entry and authorization

- `:id` is a private recipe identifier, not a public slug.
- Router state may provide an immediate warm recipe.
- Cold entry calls `GET /api/recipes/:id` with current user/guest identity and normalizes the database row envelope.
- A cold-fetched recipe not already in local kitchen keeps Save enabled.
- Missing/unauthorized/failed fetch shows generic unavailable feedback and returns to `/kitchen`, without revealing another owner.

## Layout

- Back to Kitchen.
- Initial loading state.
- Vegan Recipe badge; Download, publication, and View actions.
- Name, description, tags, prep/cook time, servings.
- Image/pending/fallback/regeneration.
- `0.5×`, `1×`, `2×` scale.
- Grouped ingredients and ordered method.
- Generated notes and separately labeled personal notes.
- Save button where the cold recipe is not in the current kitchen.

The action row wraps and must not overlap the image column.

## Scaling

- Presentation only; stored base values do not change.
- Numeric scalar/range amounts scale proportionally.
- Units, names, groups, and notes remain.
- Free-form/unscalable values remain readable and never become `NaN`.

## Personal notes

1. Generated `notes` renders as read-only recipe content.
2. Pencil opens “My notes (private — never published)” editor.
3. Cancel restores stored value.
4. Save writes only `personalNotes` through owner-scoped persistence.
5. Legacy manual notes may migrate once into `personalNotes` according to shared compatibility logic.

Empty generated notes must not contradict existing personal notes. `personalNotes` never appears in public JSON/HTML/metadata/JSON-LD.

## Publication

- Guest saved recipe shows Sign in to publish.
- Eligible signed-in generated/legacy original exposes labeled switch after initial sync.
- Manual, canonical, source-derived, and pending-sync cases remain unavailable with explanation.
- Server creates the slug; client collects no slug field.
- Original publication shows View to own `/r/<slug>`.
- Saved copy shows muted source View to `/r/<sourceSlug>` while its switch remains off.
- Server refusal restores the prior state.

## Image behavior

- Existing image loads from owner/public-authorized image endpoint.
- Shared service pending state survives navigation.
- Forced regeneration cache-busts display state after success without changing the canonical `ai_image_url` stored locally or server-side.
- Poll roughly every two seconds and stop after five minutes.
- Safety/no-image/network/worker failure clears loading while leaving recipe usable.

## Actions and errors

| Action/error       | Required behavior                                            |
| ------------------ | ------------------------------------------------------------ |
| Back               | Navigate `/kitchen`                                          |
| Download           | Portable private recipe JSON, no credentials/transient state |
| Save               | Detailed owner-aware save for cold unsaved recipe            |
| Duplicate          | Benign already-saved toast                                   |
| Ownership refusal  | Explain mapped account/session mismatch; no local duplicate  |
| Edit notes failure | Retain edited text for retry                                 |
| Publish refusal    | Revert and explain lock/ownership/slug rule                  |
| Image failure      | End spinner; retain content; allow eligible retry            |

## Accessibility

- Icon controls have accessible names.
- Publish is labeled `role="switch"` with `aria-checked`.
- Locked state remains explainable.
- Loading/error status is perceivable **[TBC where not explicit]**.
- Back and all actions are keyboard operable.

## APIs and relationships

Uses recipe get/save/update, status/image, image-generation, and auth APIs. Opened from [My Kitchen](02-my-kitchen.md), shares display rules with [Generator](01-recipe-generator.md), and can create/remove [Public Recipe](04-public-recipe.md) visibility.

## Acceptance

1. Warm and cold entries render the same authorized normalized recipe.
2. Unauthorized/missing IDs end safely in kitchen.
3. Scaling does not mutate storage.
4. Private-note editing persists without public leakage.
5. Image work survives navigation and terminates.
6. Publication eligibility/refusal matches generator/backend.
7. Saved public copy opens its source but cannot publish itself.
8. Regenerate, navigate/reload, then save/edit retains a canonical token-free image URL.
