/**
 * Route-classification manifest tests (KAN-160).
 *
 * Verifies that:
 *   1. Known subresource patterns are correctly classified (page rate-limit skip)
 *   2. Known non-SPA paths (API, SSR, static assets) are NOT treated as SPA pages
 *   3. Static-asset file extensions are recognized (looksLikeStaticAsset)
 *   4. The manifest patterns agree with the actual route mounting in index.ts
 */
import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import {
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
