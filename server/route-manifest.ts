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
  // absoluteRequestPath (below) rather than req.path, so this reads the same
  // way from a mount-style limiter as from a route-style one. For the page
  // limiter the two are identical (baseUrl is ''), so this is behaviour-
  // preserving here and correct if the predicate is ever reused under a mount.
  const p = absoluteRequestPath(req);
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

// ── Request classification (RCP-67) ──────────────────────────────────────
//
// Route classification above answers "what surface is this PATH?". This half
// answers "how should this REQUEST be metered?" — and until RCP-67 it was not
// a contract at all, just predicates accreted in security.ts one incident at a
// time: shouldSkipRateLimiting (/health + image serving), isPageSubresource
// (KAN-154), isKnownCrawler (KAN-218). Each was correct; together they were
// three unrelated shapes with no shared vocabulary, so "which requests are
// exempt from which limiter" could only be answered by reading all of them.
//
// Expressed once here: classify the request into exactly one class, then let
// each limiter declare which classes it exempts.

/**
 * Absolute request path, independent of where the middleware is mounted.
 *
 * THE landmine this exists to remove. Express gives mount-style middleware a
 * path relative to its mount point: under `app.use('/api', limiter)` a request
 * for /api/health arrives as `baseUrl='/api'`, `path='/health'`, while
 * route-style middleware (`app.get('/browse', limiter, …)`) gets `baseUrl=''`
 * and the full path. So `req.path` alone means different things in the two
 * limiters, and the old /health and /recipes/<id>/image patterns were written
 * in the relative form — correct where they sat, but impossible to state in
 * the same manifest as classifyRoute(), which is absolute.
 *
 * Composing baseUrl + path yields the absolute path under both mount styles
 * (verified against Express directly, not assumed). The trailing slash is
 * trimmed because a bare mount hit (`GET /api`) composes to '/api/'.
 */
export function absoluteRequestPath(req: Pick<Request, 'baseUrl' | 'path'>): string {
  const composed = `${req.baseUrl || ''}${req.path || ''}`;
  if (composed.length > 1 && composed.endsWith('/')) return composed.slice(0, -1);
  return composed || '/';
}

/**
 * Patterns for requests that must not be metered, in ABSOLUTE terms.
 *
 * health       — the Express-local health endpoint. Monitoring must not be
 *                able to exhaust a budget, and must not be refused when it has.
 * imageServing — recipe image bytes, read-through cached from GCS. Cheap, and
 *                a recipe page fires one per card.
 */
export const RATE_LIMIT_EXEMPT = {
  health: { paths: ['/api/health'] as readonly string[] },
  imageServing: { pattern: /^\/api\/recipes\/[^/]+\/image$/ },
} as const;

/**
 * Known search-engine and social-media crawlers (KAN-218).
 *
 * User-agent detection is sufficient here — this exempts rate limiting, not
 * authentication. Crawlers self-throttle via robots.txt; metering them costs
 * SEO while protecting nothing, because the expensive endpoints live behind
 * the /api limiter, which never exempts this class (see LIMITER_EXEMPTIONS).
 */
export const CRAWLER_UA_RE =
  /\b(Googlebot|Bingbot|Applebot|DuckDuckBot|YandexBot|Slurp|facebookexternalhit|Twitterbot|LinkedInBot|Pinterestbot|AdsBot-Google)\b/i;

/** How a request is metered. Exactly one class per request. */
export type RequestClass = 'health' | 'imageServing' | 'subresource' | 'crawler' | 'metered';

/**
 * Which request classes each limiter exempts. This is the whole policy.
 *
 * Note what `api` does NOT exempt: 'crawler' and 'subresource'. A crawler
 * hitting /api/generate is still metered — the UA exemption buys SEO on the
 * HTML surface and must never reach the endpoints that bill Gemini/Imagen.
 */
export const LIMITER_EXEMPTIONS = {
  api: ['health', 'imageServing'],
  page: ['subresource', 'crawler'],
  expensive: [],
} as const satisfies Record<string, readonly RequestClass[]>;

export type LimiterName = keyof typeof LIMITER_EXEMPTIONS;

/**
 * Classify a request into exactly one metering class.
 *
 * Order is deliberate: the path-based classes are decided before the
 * user-agent one, so a crawler fetching an image is reported as 'imageServing'
 * rather than 'crawler'. Both are exempt from the limiter that meters them, so
 * the ordering is not load-bearing for behaviour — only for legibility.
 */
export function classifyRequest(req: Request): RequestClass {
  const path = absoluteRequestPath(req);
  if (RATE_LIMIT_EXEMPT.health.paths.includes(path)) return 'health';
  if (RATE_LIMIT_EXEMPT.imageServing.pattern.test(path)) return 'imageServing';
  if (isPageSubresource(req)) return 'subresource';
  const ua = req.headers?.['user-agent'];
  if (typeof ua === 'string' && CRAWLER_UA_RE.test(ua)) return 'crawler';
  return 'metered';
}

/**
 * Does `limiter` exempt this request? The single question every limiter's
 * `skip` asks, replacing three bespoke predicates.
 */
export function isExemptFrom(limiter: LimiterName, req: Request): boolean {
  const exempt = LIMITER_EXEMPTIONS[limiter] as readonly RequestClass[];
  return exempt.includes(classifyRequest(req));
}
