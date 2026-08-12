/**
 * Route-classification manifest — single source of truth for URL routing.
 *
 * KAN-160: replaces the hand-maintained isPageSubresource() allowlist in
 * security.ts. Every URL pattern the Express server recognizes is declared
 * here. The manifest is consumed at runtime by:
 *
 *   - security.ts  — determines which requests skip page rate limiting
 *                    (isPageSubresource)
 *   - index.ts     — the SPA catch-all consults classifyRoute() to 404
 *                    asset-like unrecognized paths instead of serving
 *                    index.html as text/html (RCP-77 AC4)
 *
 * and by tests: route-manifest.test.ts unit-tests the classification;
 * routes.test.ts boots the real Express app and asserts unknown asset-like
 * paths are not answered 200 text/html by the catch-all.
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
 * Route categories recognized by Express. Route mounting still lives in
 * index.ts; this manifest is the classification contract behind
 * classifyRoute(), which the SPA catch-all consults at runtime (RCP-77 AC4).
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
 * never be served the SPA shell (index.html). Consumed at runtime by
 * classifyRoute() below (the SPA catch-all's 404 guard) and by CI tests.
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

// ── Runtime route classification (RCP-77 AC4) ────────────────────────────

/** Classification of a request path against ROUTE_MANIFEST. */
export type RouteClass = 'api' | 'ssr' | 'ssrStatic' | 'standalone' | 'asset' | 'spa' | 'unknown';

/**
 * Classify a request path against the route manifest.
 *
 * Consumed at runtime by the SPA catch-all in index.ts: any path classified
 * 'asset' that reaches the catch-all was not found by express.static or any
 * earlier route, and must 404 rather than receive index.html as text/html —
 * a text/html "asset" is refused by browsers under X-Content-Type-Options:
 * nosniff and leaks the shell to crawlers (RCP-77 AC4).
 *
 * Order matters: named surfaces (api/ssr/standalone) win over the asset
 * extension check (/sitemap.xml is ssr, /favicon.ico is standalone), and the
 * asset check wins over SPA prefixes (/recipe/main-XXXXXXXX.js is a bundle
 * request, not a recipe page).
 */
export function classifyRoute(path: string): RouteClass {
  const { api, ssr, ssrStatic, standalone, spa } = ROUTE_MANIFEST;
  if (path === api.prefix || path.startsWith(`${api.prefix}/`)) return 'api';
  if ((ssr.paths as readonly string[]).includes(path)) return 'ssr';
  if (ssr.prefixes.some((prefix) => path.startsWith(prefix))) return 'ssr';
  if (ssrStatic.prefixes.some((prefix) => path.startsWith(prefix))) return 'ssrStatic';
  if ((standalone.paths as readonly string[]).includes(path)) return 'standalone';
  if (looksLikeStaticAsset(path)) return 'asset';
  if ((spa.paths as readonly string[]).includes(path)) return 'spa';
  if (spa.prefixes.some((prefix) => path.startsWith(prefix))) return 'spa';
  return 'unknown';
}
