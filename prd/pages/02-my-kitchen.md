# My Kitchen (Cookbook Manager)

> **Route:** `/#kitchen` (SPA view; `activeView = 'kitchen'`; deep-linkable via the `#kitchen` hash)
> **Module:** Cookbook & Recipe Management
> **Source:** `src/app.component.ts`, `src/app.component.html` (lines 762–1933), `src/services/persistence.service.ts`, `src/services/auth.service.ts`
> **Generated:** 2026-07-10

## Overview

My Kitchen is the user's personal cookbook: a grid of saved recipe cards organized into named cookbooks (collections), with manual recipe authoring, JSON import/export, and a recycle bin for soft-deleted recipes. It works identically for guests (localStorage + guest-scoped API) and signed-in users (API-backed, synced across devices).

Entering the kitchen always ensures a session exists (creating a guest session for first-time visitors), because every kitchen action needs somewhere to persist.

## Layout

```
┌──────────────┬─────────────────────────────────────────────┐
│ Sidebar      │ Main content                                │
│  [New        │  Header: cookbook name (or "All Recipes")   │
│   Cookbook]  │          + description | Export All /       │
│  [Write      │          Import JSON buttons                │
│   Recipe]    │  Recipe card grid (1–3 columns):            │
│  All Recipes │   photo, name, total time, servings;        │
│   (count)    │   hover: Add-to-Cookbook + Delete buttons   │
│  <cookbook>  │  Empty state: "No recipes yet" + CTA        │
│   (count, 🗑) │                                             │
│  ──────────  │  — or, when Recycle Bin is open —           │
│  Recycle Bin │  Bin header + "Empty Recycle Bin"; cards    │
│   (count)    │  with grayscale photo, deleted date,        │
│              │  Restore / Delete buttons                   │
└──────────────┴─────────────────────────────────────────────┘
```

## Fields

### Sidebar

| Element | Type | Notes |
|---------|------|-------|
| New Cookbook | Button | Opens Create Cookbook modal. |
| Write Recipe | Button | Opens the 3-step Manual Entry wizard. |
| All Recipes | Nav item | Default selection (`activeCookbookId = null`); badge shows total saved-recipe count. |
| Cookbook rows | Nav items | Name (truncated), recipe-count badge, hover-revealed delete (trash) button. Keyboard-accessible (Enter/Space). |
| Recycle Bin | Nav item | Only rendered when the bin is non-empty; red styling; count badge. Selecting it deselects any cookbook. |

### Recipe Card (grid)

| Element | Format | Notes |
|---------|--------|-------|
| Photo | 4:3-ish cover, hover zoom | `ai_image_url`; gray placeholder icon when absent. |
| Name | Bold, clamped to 2 lines | |
| Total time | `{prepTime + cookTime}m` | Clock icon. |
| Servings | Integer | People icon. |
| Add to Cookbook (+) | Hover overlay button | Opens Add to Cookbook modal for that card's recipe. |
| Delete (trash) | Hover overlay button | Opens Delete confirmation modal. |
| Card click | — | Opens the recipe in the Generator/detail view (browser Back returns here). |

### Create Cookbook Modal

| Field | Type | Required | Default | Validation | Notes |
|-------|------|----------|---------|------------|-------|
| Cookbook Name | Text input | Yes | empty | Non-blank (trimmed); Create button disabled otherwise | Placeholder "Cookbook Name (e.g. Desserts)" |
| Description | Text input | No | empty | — | Placeholder "Description (Optional)" |

### Manual Entry Wizard ("Write Recipe") — 3 steps

**Step 1 — Basics**

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| Recipe Name | Text | Yes (gates final Save) | empty | |
| Description | Textarea | No | empty | |
| Prep (min) | Number | No | 15 | |
| Cook (min) | Number | No | 30 | |
| Servings | Number | No | 4 | |
| Tags | Text | No | empty | Comma-separated; split and trimmed on save. |

**Step 2 — Ingredients** (add-row + list)

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| Type | Select | — | Dry | Options: Wet / Dry / Other — determines ingredient grouping. |
| Name | Text | Yes (row is ignored if blank) | empty | |
| Qty | Number | No | 1 | |
| Unit | Text | No | empty | Free text. |

Added rows list with a type badge and a remove (×) button.

**Step 3 — Instructions**

| Field | Type | Notes |
|-------|------|-------|
| Step description | Textarea + Add button | Appends a numbered step; rows have hover-remove buttons. |
| Chef's Notes | Textarea | Optional; saved on the recipe. |

Footer: Back (steps 2–3), Next (steps 1–2), Save Recipe (step 3; disabled until Name is set).

## Interactions

### Entering the kitchen

- **Triggers:** "My Kitchen" header tab, `#kitchen` hash on load (SSR deep-link), browser back/forward to a kitchen history entry, or the `?save=<slug>` flow.
- **Behavior:** ensures a session (restores an existing localStorage session or creates a fresh "Guest Chef"), then shows All Recipes. History state is pushed so Back returns to the Generator. Leaving the kitchen clears a lingering `#kitchen` hash so back/forward stays consistent.
- **Data:** the grid is a pure view over local state; a one-time-per-session API hydration (`GET /api/recipes` + `GET /api/collections`) merges server data into local state once the auth check settles (retried up to 2×). Local-only recipes and locally-known image URLs survive the merge.

### Selecting a cookbook

- **Trigger:** click a sidebar cookbook (or All Recipes).
- **Behavior:** grid filters to recipes whose IDs are in the cookbook's `recipeIds`; header shows the cookbook name and description. Closes the recycle-bin view if open.

### Create cookbook

- **Trigger:** New Cookbook button (sidebar) or "+ New" inside the Add to Cookbook modal (layered on top, z-60).
- **Behavior:** `POST /api/collections {id, name, description}` (client-generated UUID). On success the server's copy is merged into local state; **on API failure it silently falls back to a localStorage-only cookbook** so the UI keeps working. When launched from the Add-to-Cookbook flow, the new cookbook is auto-selected in that modal on return.

### Delete cookbook

- **Trigger:** hover trash button on a sidebar cookbook row.
- **Behavior:** native browser `confirm()`: "Are you sure you want to delete this cookbook? Recipes will remain in \"All Saved\"." On confirm: removed locally, `DELETE /api/collections/<id>`, and if it was the active cookbook the view falls back to All Recipes. Recipes themselves are never deleted by this action.

### Write recipe (manual entry)

- **Trigger:** Write Recipe button.
- **Behavior:** wizard resets to step 1 with defaults each time it opens. Moving from step 2 to 3, and final Save, auto-commit any typed-but-unadded ingredient/instruction row so no input is silently lost. Save assembles a `Recipe` (client UUID; ingredients grouped wet/dry/other; `image_keywords = [name, 'homemade']`), persists via localStorage + `POST /api/recipes`, and closes the wizard. No AI image is generated for manual recipes at save time.
- **Validation:** only Name is required; there is no numeric-range validation on times/servings/quantity `[TBC: negative or zero values are accepted client-side]`.

### Import JSON

- **Trigger:** Import JSON label-button (hidden file input, `.json` only).
- **Behavior:** parses a single recipe object or an array. Recipes must have `name`, `ingredients`, and `instructions` to count; invalid entries are skipped. Missing IDs get fresh UUIDs; duplicates (by ID) are not re-added. Inline base64 image data (`ai_image_data`) is stripped. If a cookbook is currently selected, imports are also added to it (and may set its cover image). Each valid recipe is synced via `POST /api/recipes`.
- **Post-import image backfill:** recipes with no usable image URL get AI images generated sequentially in the background; an alert reports "Imported N recipes! Generating images for M recipe(s)..." (or a plain success alert when none need images).
- **Failure:** parse errors alert "Failed to parse recipe file. Please ensure it is valid JSON."

### Export

- **Export All** (kitchen header): downloads every saved recipe as `my_vegan_cookbook.json`. Note: exports **all** saved recipes regardless of the selected cookbook `[TBC: possibly unintended — the button sits under the cookbook header]`.
- **Export single** (recipe detail view): downloads `<Recipe_Name>.json`.

### Delete recipe (soft delete)

- **Trigger:** hover trash on a card → Delete confirmation modal ("*<name>* will be moved to the Recycle Bin.").
- **Behavior:** locally the recipe moves to the recycle bin (remembering which cookbooks it was in) and is removed from all cookbooks; the server is asked to `DELETE /api/recipes/<id>` immediately — **the recycle bin is client-side only; the server hard-deletes**. If the deleted recipe was open in the detail view, that view is cleared.

### Recycle Bin

- **Trigger:** sidebar Recycle Bin entry (visible only when non-empty).
- **View:** grayscale cards with "Deleted {date}" timestamps.
- **Restore:** re-adds the recipe to saved recipes and its former cookbooks locally, and re-creates it server-side via `POST /api/recipes`.
- **Delete (single):** removes it from the bin permanently (no server call — it was already hard-deleted).
- **Empty Recycle Bin:** confirmation modal ("This will permanently delete N recipe(s). This cannot be undone.") then clears the bin locally.
- The bin lives in localStorage as part of the session record, so it does not sync across devices and is lost if browser storage is cleared.

### Add to Cookbook (from a card)

Same modal and rules as on the Generator page — see [Recipe Generator § Add to Cookbook](01-recipe-generator.md#add-to-cookbook-modal).

## API Dependencies

| API | Method | Path | Trigger | Notes |
|-----|--------|------|---------|-------|
| List recipes | GET | `/api/recipes` | Session hydration | Response `{recipes: [{id, data}]}`; client uses `data`. |
| List collections | GET | `/api/collections` | Session hydration | Mapped to Cookbook shape. |
| Save recipe | POST | `/api/recipes` | Manual save, import, restore, edits | Idempotent (409 ignored). |
| Delete recipe | DELETE | `/api/recipes/<id>` | Soft-delete confirm | Server-side hard delete. |
| Create collection | POST | `/api/collections` | Create Cookbook | Falls back to local-only on failure. |
| Delete collection | DELETE | `/api/collections/<id>` | Delete cookbook | |
| Add recipe to collection | POST | `/api/collections/<id>/recipes` | Add-to-Cookbook apply | Body `{recipe_id}`; recipe is re-saved first to guarantee it exists in the DB. |
| Remove recipe from collection | DELETE | `/api/collections/<id>/recipes/<rid>` | Add-to-Cookbook apply | |
| Generate image | POST | `/api/generate_image` | Import backfill | Sequential, background, per recipe missing an image. |

## Page Relationships

- **From Generator:** header tab; also auto-navigated here after the `?save=<slug>` SSR save flow completes.
- **To Generator/detail:** card click opens the recipe in the detail layout; "Go to Generator" CTA on the empty state; browser Back returns here (history state).
- **Data coupling:** saving/publishing/deleting in the detail view immediately updates kitchen counts and grids (shared signals). The header's My Kitchen badge mirrors the saved-recipe count.

## Business Rules

- **localStorage-first writes:** every mutation updates local state before the API call, so the UI never waits on the network; API failures are logged, not surfaced (except cookbook creation's silent local fallback).
- **Guest data merges on login:** a guest's locally saved recipes/cookbooks are carried into the authenticated session and pushed to the account via the normal save flow.
- **Recycle bin ≠ server state:** restore re-creates the recipe server-side; permanent delete is local-only bookkeeping.
- **Base64 images are never stored client-side:** stripped before localStorage writes (quota) and on import.
- **Cookbook cover image:** first recipe added with an image becomes the cover unless one is already set (currently not rendered anywhere in the UI `[TBC: coverImage is stored but unused visually]`).
