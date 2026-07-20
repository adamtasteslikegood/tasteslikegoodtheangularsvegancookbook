# Findings: Duplicate Cookbook Creation (Race Condition)

**Project:** VeganGenius Chef (tasteslikegood.org)
**Investigated via:** live browser + runtime network probing + JS bundle analysis
**Focus:** Why the app allowed duplicate cookbooks when the "Create" button was clicked faster than the network round-trip completed.
**Note:** The duplicate _naming_ / public-slug matter was intentional test data and is already fixed. This document is only about the **duplicate-creation race condition**.

---

## TL;DR — Root Cause

There is **no de-duplication or concurrency guard at either layer**:

1. **Client:** The "Create" button is not disabled while its request is in flight, and the submit handler has no in-flight guard (no `isCreating`/`isSubmitting`/`isPending` flag on the cookbook-create path) and no debounce/throttle. Clicking N times fires N independent `POST /api/collections` requests.
2. **Server:** There is no unique constraint on `(user_id, name)` and no idempotency handling. Each POST creates a distinct row, so every duplicated click yields another cookbook.

Result: clicking Create faster than the network can respond produces one extra cookbook per extra click.

---

## Evidence

### Runtime reproduction (definitive)

- Fired **two concurrent** `POST /api/collections` requests with an identical `name`.
- **Both returned `201 Created`** with different server-generated `id` values and distinct `created_at` timestamps.
- `GET /api/collections` then listed both rows — same `name`, different `id` — confirming the server persists duplicates with no conflict/dedup.
- The pre-existing "Dooypkiitts" cookbooks show the same signature: identical name, unique `id`, distinct `created_at` — consistent with rapid repeat clicks.

### Client-side (bundle: `main-YJJAP4FM.js`, single ~765KB bundle, no React/Next/Vue global)

- No creating/submitting/pending state flag guards the cookbook-create submit path. The only loading/pending flags found belong to the **recipe** feature, not cookbook creation.
- No debounce or throttle around the create handler.
- The Create button is **not** set to a disabled/busy state while its request is pending.

### Server-side

- Cookbooks are modeled as **collections**; create endpoint is `POST /api/collections`.
- Collection object shape: `coverImage`, `created_at`, `description`, `guest_session_id`, `id`, `name`, `recipeIds`, `updated_at`, `user_id`.
- No unique constraint on `(user_id, name)` (or `(guest_session_id, name)` for guests); no idempotency key handling.

---

## Recommended Fixes

### 1. Client — in-flight guard (fast, prevents the common case)

- Add an `isCreating` state. On submit: if `isCreating` is already true, short-circuit and return.
- Set `isCreating = true` before the request; disable the Create button (and show a spinner) while pending.
- Reset `isCreating = false` in both resolve and reject paths (use `finally`).
- Optional secondary guard: debounce the click handler (~300–500ms).

### 2. Server — uniqueness constraint (primary defense)

- Add a DB unique constraint on `(user_id, name)` for authenticated users and `(guest_session_id, name)` for guests.
- On violation, return `409 Conflict` (and have the client surface a friendly "You already have a cookbook with that name" message).
- This is the authoritative fix — it holds even if a malicious/buggy client bypasses the button state.

### 3. Idempotency (optional, hardens retries)

- Have the client generate an idempotency key (e.g. `crypto.randomUUID()`) per create action and send it with the POST.
- Server upserts / no-ops on a repeated key so network retries are safe.

---

## Cleanup TODO

- Delete leftover test collections created during this investigation: `zzz-racetest-alpha`, and two `zzz-racetest-dupe`.
- Delete the original duplicate `Dooypkiitts` cookbooks (keep at most one).
