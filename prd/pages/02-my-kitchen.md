# Page PRD: My Kitchen

- **Route:** `/kitchen`
- **Rendering:** Lazy Angular SPA route
- **Users:** Guests and Google users
- **Source:** `src/components/kitchen/`, manual-entry/create-cookbook/add-to-cookbook modals, `src/services/persistence.service.ts`, Backend recipe, collection, and auth blueprints

## Purpose

My Kitchen is the owner-scoped recipe library. It provides cookbook filters, membership, manual entry, JSON portability, deletion/recovery, and guest-to-account continuity.

## Entry and hydration

- Local data can render immediately for fast startup.
- Auth check and API hydration reconcile server-known recipes and cookbooks.
- Explicit unauthenticated state may clear cached auth; transient auth-check failure must not.
- Public save handoff lands here only after its save reaches a visible success, duplicate, or error outcome.

## Layout

### Sidebar and filter rail

- New Cookbook and Write Recipe.
- All Recipes with count.
- Each cookbook with count, selection, and delete affordance.
- Recycle Bin with browser-local count.

### Main area

- Selected title and count.
- Export All and Import JSON.
- Responsive recipe-card grid or contextual empty state.
- Cards show image/fallback, name, timing, servings, open detail, cookbook membership, and eligible delete.

Export All always means every active recipe, regardless of the selected filter.

### Recycle bin

- Server deletion happens before an item is placed in local trash.
- Restore re-posts the saved snapshot and eligible memberships; local trash clears only after a valid outcome.
- Delete forever removes the local snapshot.
- Empty Bin confirms and clears browser-local snapshots.
- This is not Cloud SQL soft deletion and is not cross-device durable.

## Cookbook rules

### Create

| Field       | Required | Rules                                              |
| ----------- | -------- | -------------------------------------------------- |
| Name        | Yes      | Trimmed, non-empty, unique per user or guest scope |
| Description | No       | Up to the backend field limit; empty allowed       |

UI repeat-submit guards and partial unique indexes work together. A duplicate conflict reconciles the existing cookbook and never creates a second local object. Local fallback is permitted for network or 5xx failure, not explicit validation or conflict refusal.

### Membership

- Modal lists all cookbooks and current membership.
- A recipe may belong to multiple cookbooks.
- New cookbook creation is available without losing recipe context.
- Confirm applies additions and removals; removal asks for confirmation.
- The recipe always remains in All Recipes.

### Delete

Confirm, delete the collection and memberships only, keep recipes, and return to a valid filter.

## Manual recipe wizard

### Step 1: Basics

| Field        | Default                     | Required |
| ------------ | --------------------------- | -------- |
| Name         | Empty                       | Yes      |
| Description  | Empty                       | No       |
| Prep minutes | 15                          | No       |
| Cook minutes | 30                          | No       |
| Servings     | 4                           | No       |
| Tags         | Empty comma-separated input | No       |

### Step 2: Ingredients

Add and remove rows with group (`wet`, `dry`, or `other`; default dry), required name, amount default 1, and unit. The stored recipe uses grouped ingredient arrays.

### Step 3: Method and notes

Add and remove ordered instruction strings and optional private notes. Save creates `origin=manual`; it appears in the kitchen and is permanently unpublishable.

## Import

1. Accept `.json` containing one recipe object or an array.
2. Normalize shape and validate each candidate independently (at least name, ingredients, and instructions).
3. Strip embedded `ai_image_data` and data-URI payloads.
4. Save valid candidates to the current owner.
5. Add successes to the selected cookbook when applicable.
6. Request missing images sequentially to avoid an uncontrolled expensive-operation burst.
7. Report success and per-item failures without rolling back prior valid imports.

## Export

- Serialize the complete active recipe library.
- Exclude auth/session credentials, worker claims, and transient UI state.
- Private notes may be included because this is the owner's private archive.
- Avoid embedding large binary or data-URI image content.

## Recipe deletion

| Type               | Behavior                                           |
| ------------------ | -------------------------------------------------- |
| Ordinary recipe    | Confirm, server delete, local recycle snapshot     |
| Published original | Same; public page disappears with the row          |
| Canonical recipe   | UI delete absent/locked; server refuses            |
| Saved public copy  | Delete only the owner's copy; source is unaffected |

A failed server delete is not presented as successful trash movement.

## Synchronization and login merge

- Local storage is a client cache and continuity layer; Cloud SQL is authoritative for server data.
- Guest calls use `X-Guest-Session-ID`; signed-in calls use the secure session.
- Login transfers guest recipes and cookbooks to the account.
- Dedup uses `source_recipe_id`, fallback `source_slug`, and a public own slug when required—not normalized name.
- Same-name private generated recipes remain separate.
- A live public duplicate is preserved or reassigned rather than deleted if deletion would remove its page.
- Cookbook memberships are rewritten and deduplicated to surviving IDs.

## Empty and error states

- Empty All Recipes invites generation, manual entry, or import.
- Empty cookbook explains how to add recipes.
- Empty trash explains local deletion behavior.
- Network failure retains safe local state and provides retry.
- Duplicate recipe is benign; ownership refusal creates no local row.
- Duplicate cookbook selects or reconciles the existing cookbook.
- Missing image uses fallback and eligible regeneration.

## Accessibility

- Selection is not color-only.
- Nested card actions are keyboard operable without accidental route opening.
- Confirmations name the recipe, cookbook, or bin target.
- The wizard exposes step, labels, validation, and logical focus.
- Import and image async results need perceivable status **[TBC where not explicit]**.

## APIs and relationships

Uses owner recipe CRUD, stats, image, collection CRUD/membership, and auth APIs in [API Inventory](../appendix/api-inventory.md). AI recipes originate in [Generator](01-recipe-generator.md); card selection opens [Recipe Detail](03-recipe-detail.md); public copies originate at [Public Recipe](04-public-recipe.md).

## Acceptance

1. Correct guest or user scope hydrates without wiping valid cached auth on transient failure.
2. Cookbook creation is race-safe and deletion preserves recipes.
3. Manual recipes save and cannot publish.
4. Import supports object/array, partial failure, image stripping, selected membership, and sequential image work.
5. Export All ignores the current filter.
6. Ordinary deletion is locally restorable; canonical deletion is blocked.
7. Duplicate and ownership refusals never create extra local recipes.
8. Login merge preserves distinct same-name private recipes and reconciles true source duplicates.
