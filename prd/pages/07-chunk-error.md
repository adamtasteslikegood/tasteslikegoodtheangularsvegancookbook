# Page PRD: Chunk Error Recovery

- **Route:** `/chunk-error`
- **Rendering:** Angular SPA
- **Users:** Visitors whose requested SPA page failed to load
- **Source:** `src/components/shared/chunk-error.component.ts`, route manifest

## Purpose

Provides a stable recovery page when a connection issue or deploy makes a lazy-loaded JavaScript chunk unavailable.

## Layout and behavior

- Centered: “Failed to load page. Check your connection and try again.”
- Prominent native Retry button.
- Retry calls `window.location.assign('/')`, forcing current document/assets instead of reusing failed route state.
- Direct route is in the SPA manifest and receives Angular shell.
- Unsaved component-local state is not reconstructed.

If offline, browser/network may fail again. If the root bundle is unavailable this component cannot render; deploy/static health is a separate gate. Missing chunk/asset paths must return `404`, not `index.html`, so browsers do not parse HTML as JavaScript.

## Accessibility

Plain-text error, focusable contrast-compliant button. Programmatic route entry should announce status **[TBC; no explicit live region inspected]**.

## Acceptance

1. Direct route renders through SPA shell.
2. Readable error and Retry exist.
3. Retry performs full navigation to `/`.
4. Missing asset-like paths `404` rather than rendering this/SPA shell.
