/**
 * Route-classification manifest tests (KAN-160) — UNIT level.
 *
 * Verifies the classification functions in isolation:
 *   1. Known subresource patterns are correctly classified (page rate-limit skip)
 *   2. Static-asset file extensions are recognized (looksLikeStaticAsset)
 *   3. classifyRoute() maps paths to the manifest's route categories
 *   4. The manifest literals stay in sync with the patterns index.ts mounts
 *
 * Runtime enforcement is NOT tested here: routes.test.ts boots the real
 * Express app (with a stub dist/index.html) and asserts the SPA catch-all
 * never answers unknown asset-like paths with 200 text/html (RCP-77 AC4).
 */
import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import {
  absoluteRequestPath,
  classifyRequest,
  classifyRoute,
  isExemptFrom,
  isPageSubresource,
  looksLikeStaticAsset,
  SUBRESOURCE_PREFIXES,
  HASHED_BUNDLE_RE,
  ROUTE_MANIFEST,
} from './route-manifest.js';

// ── isPageSubresource ────────────────────────────────────────────────────

describe('isPageSubresource (route-manifest)', () => {
  const subresourcePaths = [
    '/static/css/tokens.css',
    '/static/js/public.js',
    '/static/images/logo.png',
    '/favicon.ico',
    '/favicon.svg',
    '/apple-touch-icon.png',
    '/apple-touch-icon-precomposed.png',
    '/main-GTOZZOJH.js',
    '/styles-VFQLW5EH.css',
    '/chunk-UORTPREJ.js',
    // Bundles requested relative to an SPA route:
    '/recipe/main-GTOZZOJH.js',
    '/kitchen/chunk-ABCD1234.css',
  ];

  it.each(subresourcePaths)('classifies %s as a subresource', (path) => {
    expect(isPageSubresource({ path } as Request)).toBe(true);
  });

  const nonSubresourcePaths = [
    '/',
    '/kitchen',
    '/recipe/abc-123',
    '/api/recipes',
    '/browse',
    '/r/my-recipe',
    '/privacy-policy',
    '/evil.js', // no content hash — must NOT match
    '/some-path.css', // no content hash
  ];

  it.each(nonSubresourcePaths)('does NOT classify %s as a subresource', (path) => {
    expect(isPageSubresource({ path } as Request)).toBe(false);
  });
});

// ── HASHED_BUNDLE_RE ─────────────────────────────────────────────────────

describe('HASHED_BUNDLE_RE', () => {
  it('matches Angular hashed bundles', () => {
    expect(HASHED_BUNDLE_RE.test('/main-GTOZZOJH.js')).toBe(true);
    expect(HASHED_BUNDLE_RE.test('/chunk-ABCD1234.css')).toBe(true);
    expect(HASHED_BUNDLE_RE.test('/polyfills-XXXXXXXX.js')).toBe(true);
  });

  it('does NOT match unhashed files', () => {
    expect(HASHED_BUNDLE_RE.test('/evil.js')).toBe(false);
    expect(HASHED_BUNDLE_RE.test('/styles.css')).toBe(false);
  });

  it('matches bundles under SPA route prefixes', () => {
    // Browsers request bundles relative to current URL
    expect(HASHED_BUNDLE_RE.test('/recipe/main-GTOZZOJH.js')).toBe(true);
  });
});

// ── SUBRESOURCE_PREFIXES ─────────────────────────────────────────────────

describe('SUBRESOURCE_PREFIXES', () => {
  it('includes /static/ for Flask SSR assets', () => {
    expect(SUBRESOURCE_PREFIXES).toContain('/static/');
  });

  it('includes /favicon. for browser icon probes', () => {
    expect(SUBRESOURCE_PREFIXES).toContain('/favicon.');
  });

  it('includes /apple-touch-icon for iOS probes', () => {
    expect(SUBRESOURCE_PREFIXES).toContain('/apple-touch-icon');
  });
});

// ── looksLikeStaticAsset ─────────────────────────────────────────────────

describe('looksLikeStaticAsset', () => {
  const assetPaths = [
    '/main-GTOZZOJH.js',
    '/styles.css',
    '/data.json',
    '/font.woff2',
    '/font.woff',
    '/image.png',
    '/photo.jpg',
    '/photo.jpeg',
    '/logo.svg',
    '/icon.ico',
    '/manifest.webmanifest',
    '/bundle.js.map',
    '/image.webp',
    '/image.gif',
    '/font.ttf',
    '/font.eot',
  ];

  it.each(assetPaths)('recognizes %s as a static asset', (path) => {
    expect(looksLikeStaticAsset(path)).toBe(true);
  });

  const nonAssetPaths = [
    '/',
    '/kitchen',
    '/recipe/abc-123',
    '/api/recipes',
    '/browse',
    '/r/my-recipe',
    '/privacy-policy',
  ];

  it.each(nonAssetPaths)('does NOT classify %s as a static asset', (path) => {
    expect(looksLikeStaticAsset(path)).toBe(false);
  });
});

// ── ROUTE_MANIFEST structure ─────────────────────────────────────────────

describe('ROUTE_MANIFEST', () => {
  it('declares API prefix', () => {
    expect(ROUTE_MANIFEST.api.prefix).toBe('/api');
  });

  it('declares SSR paths that match index.ts route mounting', () => {
    expect(ROUTE_MANIFEST.ssr.paths).toContain('/browse');
    expect(ROUTE_MANIFEST.ssr.paths).toContain('/sitemap.xml');
    expect(ROUTE_MANIFEST.ssr.prefixes).toContain('/r/');
  });

  it('declares SSR static prefix', () => {
    expect(ROUTE_MANIFEST.ssrStatic.prefixes).toContain('/static/');
  });

  it('declares standalone pages', () => {
    expect(ROUTE_MANIFEST.standalone.paths).toContain('/privacy-policy');
    expect(ROUTE_MANIFEST.standalone.paths).toContain('/favicon.ico');
  });

  it('declares SPA routes matching src/app.routes.ts', () => {
    // These must stay in sync with Angular route config
    expect(ROUTE_MANIFEST.spa.paths).toContain('/');
    expect(ROUTE_MANIFEST.spa.paths).toContain('/kitchen');
    expect(ROUTE_MANIFEST.spa.paths).toContain('/chunk-error');
    expect(ROUTE_MANIFEST.spa.prefixes).toContain('/recipe/');
  });
});

// ── Contract: unrecognized static-looking paths should never get HTML ─────

describe('route-classification contract', () => {
  it('static asset extensions are not classified as subresources (unless hashed)', () => {
    // A bare /styles.css (no hash) should NOT be exempt from rate limiting.
    // It should 404 if missing, not get the SPA shell.
    const bareAsset = { path: '/styles.css' } as Request;
    expect(isPageSubresource(bareAsset)).toBe(false);
    // But it IS a static asset by extension:
    expect(looksLikeStaticAsset('/styles.css')).toBe(true);
  });

  it('SPA route paths are not static assets', () => {
    for (const path of ROUTE_MANIFEST.spa.paths) {
      expect(looksLikeStaticAsset(path)).toBe(false);
    }
  });

  it('API prefix is not a static asset or subresource', () => {
    expect(looksLikeStaticAsset(ROUTE_MANIFEST.api.prefix)).toBe(false);
    expect(isPageSubresource({ path: ROUTE_MANIFEST.api.prefix } as Request)).toBe(false);
  });
});

// ── classifyRoute (runtime consumer of ROUTE_MANIFEST) ───────────────────

describe('classifyRoute', () => {
  const cases: Array<[string, string]> = [
    // Named surfaces
    ['/api', 'api'],
    ['/api/recipes', 'api'],
    ['/browse', 'ssr'],
    ['/sitemap.xml', 'ssr'],
    ['/r/vegan-cookies', 'ssr'],
    ['/static/css/tokens.css', 'ssrStatic'],
    ['/privacy-policy', 'standalone'],
    ['/favicon.ico', 'standalone'],
    // Asset-like paths — the SPA catch-all must 404 these (RCP-77 AC4)
    ['/evil.js', 'asset'],
    ['/nope/thing.css', 'asset'],
    ['/x/y.map', 'asset'],
    ['/main-GTOZZOJH.js', 'asset'],
    // Bundles requested relative to an SPA route are asset requests,
    // not recipe pages — asset wins over the /recipe/ prefix.
    ['/recipe/main-GTOZZOJH.js', 'asset'],
    // SPA pages
    ['/', 'spa'],
    ['/kitchen', 'spa'],
    ['/chunk-error', 'spa'],
    ['/recipe/abc-123', 'spa'],
    // Unrecognized non-asset paths fall through to the shell (Angular 404)
    ['/some/unknown/page', 'unknown'],
    ['/apiary', 'unknown'], // prefix check must not treat /apiary as /api
  ];

  it.each(cases)('classifies %s as %s', (path, expected) => {
    expect(classifyRoute(path)).toBe(expected);
  });

  it('only the asset class triggers the catch-all 404 guard', () => {
    // The runtime contract in index.ts: 404 iff classifyRoute() === 'asset'.
    expect(classifyRoute('/evil.js')).toBe('asset');
    expect(classifyRoute('/some/unknown/page')).not.toBe('asset');
    expect(classifyRoute('/kitchen')).not.toBe('asset');
  });
});

// ── Request classification (RCP-67) ──────────────────────────────────────

describe('absoluteRequestPath', () => {
  it('composes baseUrl + path for mount-style middleware', () => {
    expect(absoluteRequestPath({ baseUrl: '/api', path: '/health' })).toBe('/api/health');
  });

  it('passes through route-style middleware, where baseUrl is empty', () => {
    expect(absoluteRequestPath({ baseUrl: '', path: '/browse' })).toBe('/browse');
  });

  it('trims the trailing slash a bare mount hit produces', () => {
    // GET /api under `app.use('/api', …)` arrives as baseUrl='/api', path='/'.
    expect(absoluteRequestPath({ baseUrl: '/api', path: '/' })).toBe('/api');
  });

  it('keeps the root path intact', () => {
    expect(absoluteRequestPath({ baseUrl: '', path: '/' })).toBe('/');
  });
});

describe('classifyRequest', () => {
  const req = (over: Record<string, unknown>) =>
    ({ baseUrl: '', path: '/', headers: {}, ...over }) as unknown as Request;

  it('classifies the health endpoint', () => {
    expect(classifyRequest(req({ baseUrl: '/api', path: '/health' }))).toBe('health');
  });

  it('classifies recipe image serving', () => {
    expect(classifyRequest(req({ baseUrl: '/api', path: '/recipes/abc123/image' }))).toBe(
      'imageServing'
    );
  });

  it('classifies a page subresource', () => {
    expect(classifyRequest(req({ path: '/static/css/tokens.css' }))).toBe('subresource');
  });

  it('classifies a crawler on the HTML surface', () => {
    expect(
      classifyRequest(
        req({ path: '/browse', headers: { 'user-agent': 'compatible; Googlebot/2.1' } })
      )
    ).toBe('crawler');
  });

  it('classifies an ordinary navigation as metered', () => {
    expect(classifyRequest(req({ path: '/browse' }))).toBe('metered');
  });

  it('prefers the path-based class over the user-agent one', () => {
    // A crawler fetching an image is reported by what it fetched, not who it is.
    expect(
      classifyRequest(
        req({
          baseUrl: '/api',
          path: '/recipes/abc/image',
          headers: { 'user-agent': 'Googlebot/2.1' },
        })
      )
    ).toBe('imageServing');
  });
});

describe('isExemptFrom — the whole rate-limit exemption policy', () => {
  const req = (over: Record<string, unknown>) =>
    ({ baseUrl: '', path: '/', headers: {}, ...over }) as unknown as Request;

  it('the api limiter exempts health and image serving', () => {
    expect(isExemptFrom('api', req({ baseUrl: '/api', path: '/health' }))).toBe(true);
    expect(isExemptFrom('api', req({ baseUrl: '/api', path: '/recipes/x/image' }))).toBe(true);
  });

  // The load-bearing negative: the crawler exemption must never reach the
  // endpoints that bill Gemini/Imagen.
  it('the api limiter does NOT exempt crawlers', () => {
    const crawler = req({
      baseUrl: '/api',
      path: '/generate',
      headers: { 'user-agent': 'Googlebot/2.1' },
    });
    expect(isExemptFrom('api', crawler)).toBe(false);
  });

  it('the page limiter exempts subresources and crawlers', () => {
    expect(isExemptFrom('page', req({ path: '/static/css/tokens.css' }))).toBe(true);
    expect(
      isExemptFrom('page', req({ path: '/browse', headers: { 'user-agent': 'Bingbot/2.0' } }))
    ).toBe(true);
  });

  it('the page limiter still meters real navigations', () => {
    expect(isExemptFrom('page', req({ path: '/browse' }))).toBe(false);
    expect(isExemptFrom('page', req({ path: '/r/some-recipe' }))).toBe(false);
  });

  it('the expensive limiter exempts nothing', () => {
    expect(isExemptFrom('expensive', req({ baseUrl: '/api', path: '/health' }))).toBe(false);
  });
});
