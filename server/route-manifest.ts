/**
 * Route-classification manifest — single source of truth for URL routing.
 *
 * KAN-160: replaces the hand-maintained isPageSubresource() allowlist in
 * security.ts. Every URL pattern the Express server recognizes is declared
 * here. The manifest is consumed by:
 *
 *   - security.ts  — determines which requests skip page rate limiting
 *   - index.ts     — (future) could drive route mounting programmatically
 *   - CI tests     — assert that unrecognized paths are NOT served as HTML
 *                    from the SPA catch-all
 *
 * When adding a new route to Express, add its pattern here first.
 */

import type { Request } from 'express';

// ── Route patterns ──────────────────────────────────────────────────────

/**
 * Patterns for subresources that should be exempt from page rate limiting.
 *
 * These are assets the browser fetches automatically on every page view
 * (Flask SSR stylesheets, icons, Angular bundles). Metering them as
 * navigations exhausts the per-IP budget during normal browsing (KAN-154).
 */
export const SUBRESOURCE_PREFIXES = ['/static/', '/favicon.', '/apple-touch-icon'] as const;

/**
 * Angular's content-hashed build output (main-GTOZZOJH.js, styles-VFQLW5EH.css,
 * chunk-UORTPREJ.js). Anchored on the hash so an arbitrary /evil.js is not
 * exempt. Bundles also arrive under a route prefix (/recipe/main-X.js) because
 * the SPA requests them relative to the current URL, so this matches on the
 * basename rather than the whole path.
 */
export const HASHED_BUNDLE_RE = /(?:^|\/)[\w.-]+-[A-Z0-9]{8}\.(?:js|css)$/;

/**
 * Route categories recognized by Express. This is documentation and a
 * classification aid — the actual route mounting still lives in index.ts.
 *
 * Categories:
 *   api         — proxied to Flask (/api/*)
 *   ssr         — Flask-rendered HTML pages (/r/*, /browse, /sitemap.xml)
 *   ssrStatic   — Flask SSR static assets (/static/*)
 *   standalone  — Express-served static pages (/privacy-policy, /favicon.ico)
 *   spa         — Angular client-side routes (/, /kitchen, /recipe/:id, etc.)
 */
export const ROUTE_MANIFEST = {
  /** Proxied to Flask */
  api: { prefix: '/api' },
  /** Flask-rendered SSR pages */
  ssr: { paths: ['/browse', '/sitemap.xml'], prefixes: ['/r/'] },
  /** Flask SSR static assets */
  ssrStatic: { prefixes: ['/static/'] },
  /** Express-served standalone pages */
  standalone: { paths: ['/privacy-policy', '/favicon.ico'] },
  /** Angular SPA routes — catch-all serves index.html */
  spa: { paths: ['/', '/kitchen', '/chunk-error'], prefixes: ['/recipe/'] },
} as const;

// ── Classification functions ─────────────────────────────────────────────

/**
 * Returns true for static subresources that must not count against the page
 * rate limit.
 *
 * KAN-154: these were metered like real navigations, so a single SSR page view
 * cost ~8 requests out of a 300 req / 15 min per-IP budget — roughly 37 page
 * views per quarter hour, shared by every device behind one NAT'd address.
 * Two people browsing recipes exhausted it and both got 429s. Rate limiting
 * here exists to protect Flask and the AI endpoints; metering CSS bought
 * nothing and cost the public surface.
 *
 * Exported for unit testing (security.ts and route-manifest.test.ts).
 */
export function isPageSubresource(req: Request): boolean {
  const p = req.path;
  for (const prefix of SUBRESOURCE_PREFIXES) {
    if (p.startsWith(prefix)) return true;
  }
  return HASHED_BUNDLE_RE.test(p);
}

/**
 * Returns true if the path matches a known file-extension pattern that should
 * never be served the SPA shell (index.html). Used by CI tests to verify the
 * catch-all does not leak HTML for missing static assets.
 *
 * This covers common asset extensions that browsers/crawlers request. If the
 * file does not exist in the Angular build output (dist/), Express should 404
 * rather than returning index.html with text/html — the latter breaks the
 * asset (e.g. a CSS file containing <!doctype html>) and wastes bandwidth.
 */
export const STATIC_ASSET_RE =
  /\.(?:js|css|map|json|woff2?|ttf|eot|svg|png|jpe?g|gif|webp|ico|webmanifest)$/i;

export function looksLikeStaticAsset(path: string): boolean {
  return STATIC_ASSET_RE.test(path);
}
