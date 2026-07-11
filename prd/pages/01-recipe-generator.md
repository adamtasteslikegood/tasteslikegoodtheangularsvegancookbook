# Recipe Generator (Home)

> **Route:** `/` (SPA default view; `activeView = 'generator'`)
> **Module:** Recipe Generation
> **Source:** `src/app.component.ts`, `src/app.component.html` (lines 194–760), `src/services/gemini.service.ts`
> **Generated:** 2026-07-10

## Overview

The Generator is the landing experience of VeganGenius Chef. A visitor types what they're craving into a single prompt box, and the system generates a complete vegan recipe (name, description, timing, grouped ingredients, step-by-step method, chef's notes, tags) using Google Gemini, followed by an AI-generated food photo via Imagen. No account is required — a guest session is created automatically on first generation.

The generated-recipe display doubles as the **recipe detail view**: opening a saved recipe from My Kitchen renders it in this same layout.

## Layout

```
┌────────────────────────────────────────────────────────────┐
│ Header: logo/title (click → generator) | Generator/Kitchen │
│         tabs | Sign In button OR user profile chip         │
├────────────────────────────────────────────────────────────┤
│ Prompt input ........................... [Generate button] │
│ (error banner appears below on failure)                    │
├──────────────────────────┬─────────────────────────────────┤
│ Recipe header:           │ Image area (4:3):               │
│  "Vegan Recipe" badge    │  AI photo + "AI Generated" tag  │
│  Save / Add to Cookbook /│  or "Styling your dish..."      │
│  Download JSON buttons   │  spinner, or "Image not         │
│  Public toggle + slug    │  available" placeholder.        │
│  Title, description, tags│  Hover: Regenerate button       │
│  Prep/Cook/Servings grid │                                 │
│  Scale: 0.5x / 1x / 2x   │                                 │
├──────────────────────────┼─────────────────────────────────┤
│ Ingredients card         │ Method (numbered steps)         │
│ (sticky; Wet/Dry/Other   │ Chef's Notes card (yellow,      │
│  groups)                 │  hover-to-edit)                 │
└──────────────────────────┴─────────────────────────────────┘
│ Footer: © Tasteslikegood.org | Privacy Policy link         │
```

## Fields

### Prompt Area

| Field | Type | Required | Default | Validation | Notes |
|-------|------|----------|---------|------------|-------|
| Craving prompt | Text input | Yes | empty | Non-blank (trimmed) to enable Generate | Placeholder: "What are you craving? (e.g., 'spicy lentil tacos' or 'avocado chocolate mousse')". Enter key also submits. No Express-layer validation exists (see api-inventory appendix); Flask validates server-side. |

### Recipe Display (read-only fields)

| Field | Format | Notes |
|-------|--------|-------|
| Name | Large serif heading | `recipe.name` |
| Description | Italic paragraph | |
| Tags | `#tag` pills | Optional array |
| Prep Time / Cook Time | `{n} min` | Static — not affected by scaling |
| Servings | Integer | **Scaled**: `round(servings × multiplier)` |
| Ingredients | Grouped lists: Wet, Dry, Other | Each row: amount + units (bold green, right-aligned), name, optional `(notes)` in italic. A group is hidden when empty. |
| Ingredient amount | Fraction-friendly | Amounts 0.25/0.33/0.5/0.66/0.75 display as 1/4, 1/3, 1/2, 2/3, 3/4. Range amounts (`number[]`) display as `a - b`. |
| Instructions | Numbered steps | Accepts plain strings or `{step, description}` objects (renders `description`). |
| Chef's Notes | Yellow card, pre-wrap text | Shows "No notes added yet." when empty. |
| Image | 4:3 cover photo | From `ai_image_url`; "AI Generated" badge overlaid. |

The recipe article carries `itemscope itemtype="https://schema.org/Recipe"` microdata for SEO.

### Action Buttons (recipe header)

| Button | Visibility | Behavior |
|--------|-----------|----------|
| Save / Saved | Always (disabled once saved) | Persists recipe to cookbook (localStorage + API). Turns green "Saved" with checkmark. |
| Add to Cookbook | Always | Opens Add to Cookbook modal (see below). |
| Download (JSON) | Always | Client-side download of the single recipe as `<Recipe_Name>.json`. |
| Public toggle | Signed-in (non-guest) users only | Publishes/unpublishes the recipe (see Publishing). |
| "Sign in to publish" link | Guests, only after the recipe is saved | Opens the Auth modal. Gated on saved-state so a guest is never sent into the OAuth redirect with an unsaved in-memory recipe. |
| Slug input + open-in-new-tab link | Signed-in AND recipe is public | Edit the public URL slug; link opens `/r/<slug>`. |
| Regenerate image | On image hover, when not loading | Re-runs image generation with `force_regenerate: true`. |
| Scale 0.5x / 1x / 2x | Always | Multiplies all ingredient amounts and servings; amounts rounded to 2 decimals. Default 1x; resets to 1x on each new generation. |
| Edit notes (pencil) | On Chef's Notes hover | Inline textarea with Save/Cancel; Save persists the whole recipe. |

## Interactions

### Page Load

- App bootstraps zoneless Angular; startup auth check runs (`GET /api/auth/check`) — see [Auth & Sessions](../appendix/page-relationships.md).
- View resolves from URL: `#kitchen` hash → My Kitchen; otherwise Generator. A `?save=<slug>` query param triggers the save-from-SSR flow (see Page Relationships).
- No recipe is shown until one is generated or opened from My Kitchen.

### Generate a recipe

- **Trigger:** Click Generate or press Enter in the prompt (no-op if prompt is blank; button disabled while loading).
- **Behavior:**
  1. A guest session is ensured (created in localStorage if no session exists).
  2. UI resets: clears previous recipe/image/error, resets scale to 1x, shows "Cooking..." spinner on the button.
  3. `POST /api/generate {prompt}` — Flask generates via Gemini **and saves the recipe to the database** during generation.
  4. If the response is `status: "generating"` (async path), the client polls `GET /api/recipes/<id>/status` every 2 s until `status: "ready"` (resolve) or `"error"` (reject).
  5. On success the recipe renders, is marked Saved immediately (backend already persisted it), and is also written into local state via an idempotent save (a 409 duplicate from the API is treated as success).
  6. Image generation starts automatically (below).
- **Failure:** Red error banner under the prompt with the API's `error` message, or "Failed to generate recipe. Please try again."

### Image generation (automatic after recipe, or manual regenerate)

- **Trigger:** Automatic after a successful generation; manual via the hover Regenerate button (adds `force_regenerate: true`).
- **Behavior:** `POST /api/generate_image {recipe_id, force_regenerate}` shows "Styling your dish..." spinner. If the response is `status: "generating_image"` (async Pub/Sub path), polls `GET /api/recipes/<id>/status` every 2 s until `ai_image_url` appears (resolve) or `ai_metadata.image_generation.success === false` (reject).
- **Race guard:** the recipe ID is captured before the request; if the user has navigated to a different recipe by the time the image arrives, the UI is not updated (but localStorage still records the URL for the original recipe).
- **Persistence rule:** on completion only the `ai_image_url` field is patched into localStorage — a full recipe re-save is deliberately avoided because API responses strip the raw image data, and re-POSTing the recipe would erase the stored image server-side.
- **Failure:** logged to console only; the placeholder "Image not available" remains. No user-facing error.

### Save

- **Trigger:** Save button (disabled when already saved).
- **Behavior:** writes localStorage first (instant UI), then `POST /api/recipes` (409 ignored). Button flips to green "Saved".

### Add to Cookbook (modal)

- **Trigger:** "Add to Cookbook" button here, or the hover "+" button on kitchen cards.
- **Modal content:** list of the user's cookbooks as toggle buttons (green ring when selected), pre-checked with the recipe's current memberships; "+ New" opens the Create Cookbook modal layered on top (z-60), and a cookbook created that way is auto-selected on return. Empty state: "No cookbooks yet. Create one!"
- **Confirm:** computes adds and removes vs. current membership. If any cookbook would lose the recipe, an inline amber confirmation lists them ("This recipe will be removed from: …") with Go Back / Yes, Remove. Applying changes calls the collections API per add/remove and marks the recipe Saved if it's the one on screen.

### Publish / unpublish (signed-in only)

- **Trigger:** Public toggle switch.
- **Behavior:** flips `is_public` optimistically. When publishing a recipe with no slug, one is derived from the name (lowercase, spaces/underscores → hyphens, punctuation stripped). Saves via `POST /api/recipes`; on failure the toggle reverts. When public, the slug field and a link to the public page `/r/<slug>` appear.
- **Guest rule:** guests cannot publish — the server forces `is_public=false` for guest sessions, and the UI shows "Sign in to publish" instead of the toggle. See [Business Rules](#business-rules).

### Edit slug

- **Trigger:** blur of the slug input (visible only while public).
- **Behavior:** normalizes (lowercase, whitespace/underscores → hyphens, invalid chars stripped) and re-saves the recipe. Empty slug is ignored.

### Edit Chef's Notes

- **Trigger:** pencil icon (appears on card hover).
- **Behavior:** textarea prefilled with current notes; Save persists the full recipe with the new notes; Cancel discards.

### Sign in (Auth modal)

- **Trigger:** "Sign In" header button, "Sign in to publish", or any publish attempt while guest.
- **Modal content:** brand header, error banner (if the login start fails), a "Sign in with Google" button (spinner + "Connecting..." while the OAuth start request runs), and guest guidance: "No account needed to generate recipes! Close this dialog to continue as a guest. Your recipes will be stored locally in this browser."
- **Behavior:** `GET /api/auth/login` returns an `authorization_url`; the browser redirects to Google's consent screen. On return, the app detects `?auth=success`, confirms the session via `/api/auth/check`, merges guest localStorage data into the account, and hydrates recipes/cookbooks from the API.

### Header / profile

- Signed-in users see a profile chip (avatar or initial, first name). Clicking opens a dropdown card: avatar, name, masked email (`ad***@gmail.com`), Saved Recipes count, Cookbooks count, and Log Out.
- Log Out calls `POST /api/auth/logout`, clears local session, clears the on-screen recipe and prompt, and returns to the Generator. Local state is cleared even if the server is unreachable.
- The "My Kitchen" tab shows a green badge with the saved-recipe count when non-zero.
- While the startup auth check runs, the auth area shows a pulsing placeholder instead of the Sign In button.

## API Dependencies

| API | Method | Path | Trigger | Notes |
|-----|--------|------|---------|-------|
| Generate recipe | POST | `/api/generate` | Generate button | Body `{prompt}`. Rate-limited (AI tier). Saves to DB server-side. |
| Generate image | POST | `/api/generate_image` | Auto after generate; Regenerate | Body `{recipe_id, force_regenerate}`. |
| Recipe status | GET | `/api/recipes/<id>/status` | 2 s polling during async generation | Returns `{status, recipe}`. |
| Save recipe | POST | `/api/recipes` | Save, notes, slug, publish toggle | Idempotent; 409 treated as success. |
| Auth check | GET | `/api/auth/check` | App startup | `{authenticated, email, name, picture, user_id}`. |
| Start login | GET | `/api/auth/login` | Google sign-in button | Returns `{authorization_url}`. |
| Logout | POST | `/api/auth/logout` | Log Out | |
| Cookbook membership | POST/DELETE | `/api/collections/<id>/recipes[/<rid>]` | Add to Cookbook confirm | |
| List recipes/collections | GET | `/api/recipes`, `/api/collections` | Once per session after auth resolves | Hydrates local state; retried up to 2× at 1 s intervals. |

## Page Relationships

- **To My Kitchen:** header tab or logo; saved recipes appear there.
- **From My Kitchen:** clicking a recipe card opens it in this view (marked Saved, image loaded, history entry pushed so browser Back returns to the kitchen).
- **To public page:** `/r/<slug>` link next to the slug field (new tab).
- **From SSR public pages:** `?save=<slug>` deep-link saves the public recipe into the visitor's cookbook and lands on My Kitchen (see [Public Recipe Pages](03-public-recipe-pages.md)).

## Business Rules

- **Guest-first:** all generation and saving works without an account; data lives in browser localStorage and in the Flask DB scoped to a server-issued guest session.
- **Generation implies save:** a generated recipe is already persisted server-side; the Save button exists for local-state consistency and for manually-opened recipes.
- **Publishing requires identity:** only Google-authenticated users can make recipes public. The UI hides the toggle for guests and the server independently enforces it.
- **Scaling is display-only:** the 0.5x/2x multiplier never mutates the stored recipe.
- **Image data never round-trips through the client:** recipes carry a URL (`/api/recipes/<id>/image` or a GCS/stock URL); base64 payloads are stripped before localStorage writes (5 MB quota) and on export/import.
