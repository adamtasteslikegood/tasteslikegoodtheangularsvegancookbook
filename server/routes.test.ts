/**
 * Route-mounting integration tests for server/index.ts.
 *
 * Production incident 2026-07-04 (v0.3.1): the Flask SSR templates link
 * their stylesheets at /static/css/*.css, but Express had no proxy rule for
 * /static — the requests fell through to the SPA catch-all and came back as
 * index.html (text/html). With Helmet's X-Content-Type-Options: nosniff the
 * browser refuses to apply a text/html stylesheet, so every public SSR page
 * rendered completely unstyled.
 *
 * These tests boot the real Express app against a stub Flask backend and a
 * stub Angular dist/ (a temp dir holding only index.html, wired in via the
 * SPA_DIST_DIR test override) so the SPA catch-all is actually exercisable.
 * They assert that /static/* is proxied to Flask (not swallowed by the SPA
 * fallback), that unknown asset-like paths are never answered 200 text/html
 * by the catch-all (RCP-77 AC4), that page routes still get the shell, and
 * that the shell's status and X-Robots-Tag keep SPA-only routes out of the
 * index (KAN-276).
 *
 * The app boots with NODE_ENV=production so security.ts registers its
 * `X-Robots-Tag: index, follow` middleware, exactly as in the deployed
 * service — the KAN-276 assertions are only meaningful if the catch-all is
 * shown to override that header, not merely to set one where none existed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const STUB_CSS = ':root { --tokens: loaded; }';
const STUB_JS = 'document.documentElement.dataset.publicScript = "loaded";';
const STUB_HTML = '<!doctype html><html><body>ssr-browse</body></html>';
const STUB_RECIPE_HTML = '<!doctype html><html><body>ssr-recipe</body></html>';
const STUB_SPA_SHELL =
  '<!doctype html><html><head><link rel="icon" href="/favicon.svg">' +
  '<meta name="tlg-home-head-start" content=""><title>Home</title>' +
  '<link rel="canonical" href="https://www.tasteslikegood.org/">' +
  '<script type="application/ld+json">{"@type":"FAQPage"}</script>' +
  '<script type="application/ld+json">{"@type":"WebApplication"}</script>' +
  '<meta name="tlg-home-head-end" content=""></head><body>' +
  '<app-root ng-version="22.1.0"><h1>home-landing</h1></app-root></body></html>';

// Mirrors the transformations `getRouteNeutralSpaShell()` applies in
// server/index.ts: the home-only head block between the sentinels is replaced
// with a generic non-indexable head, and the <app-root> children are stripped.
const STUB_ROUTE_NEUTRAL_SHELL =
  '<!doctype html><html><head><link rel="icon" href="/favicon.svg">' +
  '<title>TastesLikeGood</title><meta name="robots" content="noindex, follow" />' +
  '</head><body><app-root ng-version="22.1.0"></app-root></body></html>';

let flaskStub: http.Server;
let expressServer: http.Server;
let baseUrl: string;
let stubDistDir: string;

// Captured so the env overrides below can be restored for other test files.
const originalVitestEnv = process.env.VITEST;
const originalFlaskUrl = process.env.FLASK_BACKEND_URL;
const originalSpaDistDir = process.env.SPA_DIST_DIR;
const originalNodeEnv = process.env.NODE_ENV;

beforeAll(async () => {
  // Stub Flask backend: serves the SSR stylesheet and browse page.
  flaskStub = http.createServer((req, res) => {
    if (req.url === '/static/css/tokens.css') {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      res.end(STUB_CSS);
    } else if (req.url === '/static/js/public.js') {
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
      res.end(STUB_JS);
    } else if (req.url === '/browse') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(STUB_HTML);
    } else if (req.url === '/r/test-slug') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(STUB_RECIPE_HTML);
    } else {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error": "not found"}');
    }
  });
  await new Promise<void>((resolve) => flaskStub.listen(0, '127.0.0.1', resolve));
  const flaskPort = (flaskStub.address() as AddressInfo).port;

  // Stub Angular dist/: under Vitest index.ts runs from server/, so its
  // relative dist resolution lands outside the repo. Point SPA_DIST_DIR at a
  // temp dir holding only index.html so the catch-all has a shell to serve.
  stubDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-dist-stub-'));
  fs.writeFileSync(path.join(stubDistDir, 'index.html'), STUB_SPA_SHELL);
  process.env.SPA_DIST_DIR = stubDistDir;

  // Must be set before importing index.ts — proxy.ts reads it at import time.
  process.env.FLASK_BACKEND_URL = `http://127.0.0.1:${flaskPort}`;
  // Vitest sets this itself, but make the dependency explicit: index.ts must
  // see it (or NODE_ENV=test) to skip binding the real listener on import.
  process.env.VITEST = process.env.VITEST || 'true';
  // Production semantics: security.ts reads NODE_ENV inside
  // applySecurityMiddleware (called from `ready`), so setting it before the
  // import is sufficient. Only index.ts and security.ts read NODE_ENV.
  process.env.NODE_ENV = 'production';

  const { app, ready } = await import('./index.js');
  await ready;

  expressServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => expressServer.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(expressServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (originalVitestEnv === undefined) {
    delete process.env.VITEST;
  } else {
    process.env.VITEST = originalVitestEnv;
  }
  if (originalFlaskUrl === undefined) {
    delete process.env.FLASK_BACKEND_URL;
  } else {
    process.env.FLASK_BACKEND_URL = originalFlaskUrl;
  }
  if (originalSpaDistDir === undefined) {
    delete process.env.SPA_DIST_DIR;
  } else {
    process.env.SPA_DIST_DIR = originalSpaDistDir;
  }
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
  fs.rmSync(stubDistDir, { recursive: true, force: true });
  await new Promise<void>((resolve) => expressServer.close(() => resolve()));
  await new Promise<void>((resolve) => flaskStub.close(() => resolve()));
});

describe('home-only static fallback', () => {
  it('serves the rich fallback at / but not through the SPA catch-all', async () => {
    const home = await fetch(`${baseUrl}/`);
    expect(await home.text()).toBe(STUB_SPA_SHELL);

    const kitchen = await fetch(`${baseUrl}/kitchen`);
    const kitchenHtml = await kitchen.text();
    // <app-root> children are stripped but any attributes on the element
    // (e.g. Angular's build-time ng-version) are preserved by design.
    expect(kitchenHtml).toMatch(/<app-root(?:\s[^>]*)?><\/app-root>/);
    expect(kitchenHtml).toContain('<meta name="robots" content="noindex, follow" />');
    expect(kitchenHtml).not.toContain('home-landing');
    expect(kitchenHtml).not.toContain('FAQPage');
    expect(kitchenHtml).not.toContain('rel="canonical"');
  });
});

describe('SSR static asset proxying', () => {
  it('proxies /static/* to Flask so SSR stylesheets are served as CSS', async () => {
    const res = await fetch(`${baseUrl}/static/css/tokens.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
    expect(await res.text()).toBe(STUB_CSS);
  });

  it('does not serve the SPA index.html for /static/* requests', async () => {
    const res = await fetch(`${baseUrl}/static/css/tokens.css`);
    const body = await res.text();
    expect(res.headers.get('content-type')).not.toContain('text/html');
    expect(body).not.toContain('<!doctype html>');
  });

  it('proxies the public SSR script as same-origin JavaScript', async () => {
    const res = await fetch(`${baseUrl}/static/js/public.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/javascript');
    expect(await res.text()).toBe(STUB_JS);
  });

  it('proxies unknown /static/* paths to Flask (404 from Flask, not SPA 200)', async () => {
    const res = await fetch(`${baseUrl}/static/does-not-exist.css`);
    expect(res.status).toBe(404);
  });
});

describe('SSR page proxying (guard against regressions)', () => {
  it('proxies /browse to Flask', async () => {
    const res = await fetch(`${baseUrl}/browse`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(STUB_HTML);
  });
});

/**
 * KAN-154 (production incident 2026-07-25): iOS Safari requests both
 * apple-touch-icon paths on every page view without any <link> tag. The repo
 * ships no PNG icon, so they fell through to the SPA catch-all and returned
 * 13KB of index.html with max-age=0 — uncacheable, so iOS re-asked on the next
 * page. Those two paths accounted for 44 of the 84 HTTP 429s that locked two
 * users out of the public site during ordinary browsing.
 */
describe('apple-touch-icon requests do not leak the SPA shell', () => {
  for (const iconPath of ['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png']) {
    it(`answers ${iconPath} with a cacheable 204, not index.html`, async () => {
      const res = await fetch(`${baseUrl}${iconPath}`);
      expect(res.status).toBe(204);
      // A 204 carries no body, so no content-type at all — which is precisely
      // the fix: the old behaviour advertised text/html and shipped 13KB.
      expect(res.headers.get('content-type')).toBeNull();
      expect(res.headers.get('cache-control')).toContain('max-age=86400');
      expect(await res.text()).toBe('');
    });
  }

  // Guards the icon regex against over-matching: a normal SPA route must still
  // reach the catch-all and receive the shell (served from the stub dist/),
  // not an empty 204.
  it('does not swallow ordinary SPA routes', async () => {
    const res = await fetch(`${baseUrl}/kitchen`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(STUB_ROUTE_NEUTRAL_SHELL);
  });
});

/**
 * RCP-77 AC4 (KAN-160): unrecognized paths must never be answered 200
 * text/html by the SPA catch-all. An asset-like path that nothing earlier
 * served (express.static miss, no route) must 404 — index.html as a fake
 * .js/.css/.map is refused by browsers under X-Content-Type-Options: nosniff
 * and reads as soft-404 shell spam to crawlers. The catch-all consults
 * classifyRoute() from server/route-manifest.ts at runtime; these tests boot
 * the real app and verify that enforcement end to end. Unknown non-asset
 * paths get the shell, but at status 404 since KAN-276 (see below).
 */
describe('SPA catch-all never serves HTML for unknown asset-like paths (RCP-77 AC4)', () => {
  for (const assetPath of ['/evil.js', '/nope/thing.css', '/x/y.map', '/deep/unknown.woff2']) {
    it(`does not answer ${assetPath} with 200 text/html`, async () => {
      const res = await fetch(`${baseUrl}${assetPath}`);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).not.toContain('text/html');
      expect(await res.text()).not.toContain('spa-shell');
    });
  }

  it('still serves the SPA shell for known page routes', async () => {
    const res = await fetch(`${baseUrl}/kitchen`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toBe(STUB_ROUTE_NEUTRAL_SHELL);
  });

  it('serves the shell for unknown non-asset paths, but with status 404 (KAN-276)', async () => {
    const res = await fetch(`${baseUrl}/some/unknown/page`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toBe(STUB_ROUTE_NEUTRAL_SHELL);
  });
});

/**
 * KAN-276 (live evidence 2026-09-13): every SPA-only path — /kitchen,
 * /recipe/<uuid>, and any unknown HTML path — answered 200 with the shell,
 * `<meta name="robots" content="index, follow">`, a canonical pointing at
 * `/`, and `X-Robots-Tag: index, follow` from security.ts. /kitchen is a
 * private per-user surface, /recipe/<id> duplicates the public /r/<slug> SSR
 * page, and unknown paths were soft-404s.
 *
 * The catch-all now marks every shell response except `/` as
 * `noindex, follow` (overriding security.ts's production header, which runs
 * earlier in the chain) and answers paths the manifest does not know with
 * status 404.
 */
describe('SPA shell index control (KAN-276)', () => {
  it('marks /kitchen noindex, overriding the production index header', async () => {
    const res = await fetch(`${baseUrl}/kitchen`);
    expect(res.status).toBe(200);
    // security.ts set `index, follow` before the catch-all ran (NODE_ENV is
    // production in this file); seeing `noindex, follow` proves the override.
    expect(res.headers.get('x-robots-tag')).toBe('noindex, follow');
    expect(await res.text()).toBe(STUB_ROUTE_NEUTRAL_SHELL);
  });

  it('marks /kitchen/ (trailing slash) as the same SPA route', async () => {
    const res = await fetch(`${baseUrl}/kitchen/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('noindex, follow');
  });

  it('marks /recipe/<id> noindex — /r/<slug> is the indexable copy', async () => {
    const res = await fetch(`${baseUrl}/recipe/abc`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('noindex, follow');
    expect(await res.text()).toBe(STUB_ROUTE_NEUTRAL_SHELL);
  });

  it('answers an unknown HTML path 404 + noindex, still with the shell', async () => {
    const res = await fetch(`${baseUrl}/some-random-path`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, follow');
    expect(await res.text()).toBe(STUB_ROUTE_NEUTRAL_SHELL);
  });

  it('marks the asset-like 404 noindex too', async () => {
    const res = await fetch(`${baseUrl}/evil.js`);
    expect(res.status).toBe(404);
    expect(res.headers.get('x-robots-tag')).toBe('noindex, follow');
  });

  // Note: GET / is answered by express.static's directory index before the
  // catch-all is reached, so this pins that nothing downstream clobbers the
  // production header; the catch-all's own `/` exemption is a safety net.
  it('keeps the home page indexable', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('index, follow');
    expect(await res.text()).toBe(STUB_SPA_SHELL);
  });

  it('keeps the home page indexable with a query string (OAuth return)', async () => {
    const res = await fetch(`${baseUrl}/?auth=success`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('index, follow');
  });

  it('canonicalizes /index.html to the home page before express.static', async () => {
    const res = await fetch(`${baseUrl}/index.html?auth=success&save=weeknight-chili`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/?auth=success&save=weeknight-chili');
  });

  it('drops unsupported or unsafe query values from the /index.html redirect', async () => {
    const res = await fetch(
      `${baseUrl}/index.html?next=%2F%2Fevil.example&auth=failed&save=%2F%2Fevil.example`,
      { redirect: 'manual' }
    );
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/');
  });

  // The public SSR surface is proxied to Flask before the catch-all, so it
  // keeps the production `index, follow` header.
  it('leaves /r/<slug> indexable (proxied to Flask, not the catch-all)', async () => {
    const res = await fetch(`${baseUrl}/r/test-slug`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('index, follow');
    expect(await res.text()).toBe(STUB_RECIPE_HTML);
  });

  it('leaves /browse indexable (proxied to Flask, not the catch-all)', async () => {
    const res = await fetch(`${baseUrl}/browse`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('index, follow');
    expect(await res.text()).toBe(STUB_HTML);
  });
});
