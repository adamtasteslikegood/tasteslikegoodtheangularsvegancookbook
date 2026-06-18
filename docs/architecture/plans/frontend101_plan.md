# Frontend UI Improvements Plan

## Problem Statement

Several UX issues and missing features in the cookbook/recipe management flow:

1. "New Cookbook" modal renders behind "Add to Cookbook" modal (z-index conflict)
2. "Add to Cookbook" immediately closes after clicking a cookbook (no multi-select)
3. No way to remove a recipe from a cookbook via the modal
4. No Confirm/Cancel button pattern — actions are instant with no review
5. No recipe deletion from kitchen view
6. No Recycle Bin for deleted recipes
7. User profile area is minimal (no expandable profile card)

## Approach — Small Deployable Steps

### Step 1: Fix z-index + Rework "Add to Cookbook" Modal (HIGH PRIORITY)

- Bump "New Cookbook" modal to z-60 so it layers above "Add to Cookbook"
- Convert cookbook list from instant-action buttons to toggle checkboxes
- Track pending changes in a signal (`pendingCookbookChanges`)
- Add Confirm/Cancel buttons at the bottom
- After creating a new cookbook, return to "Add to Cookbook" modal (not main page)
- On Confirm: apply adds/removes, show confirmation if removing from any cookbook

### Step 2: Recipe Deletion + Recycle Bin

- Add delete button to kitchen recipe cards
- Add "Recycle Bin" virtual cookbook that holds deleted recipes
- Confirmation dialog before deletion
- Deleted recipes stored in a `deletedRecipes` array on User
- "Restore" and "Permanently Delete" actions in Recycle Bin
- Backend: soft-delete support (or just keep in localStorage/signal until permanent)

### Step 3: User Profile Mini-Card

- Click user avatar/name to toggle a dropdown profile card
- Shows: display name, email, avatar, member since (or just auth provider)
- Logout button moves into the card

### Deferred to Next Round

- Image mini-gallery (up to 5 AI images)
- Multi-select recipes
- Sort and filter recipes/cookbooks

## Current State

- All modals use `z-50` — so "New Cookbook" and "Add to Cookbook" are at the same layer
- `addToCookbook(cookbookId)` immediately calls API + closes modal
- No toggle/checkbox state management for the modal
- `deleteRecipe` exists in AuthService but no UI for it in kitchen view
- No Recycle Bin concept exists yet
