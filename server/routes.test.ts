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
 * by the catch-all (RCP-77 AC4), and that page routes still get the shell.
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
const STUB_SPA_SHELL = '<!doctype html><html><body>spa-shell</body></html>';

let flaskStub: http.Server;
let expressServer: http.Server;
let baseUrl: string;
let stubDistDir: string;

// Captured so the env overrides below can be restored for other test files.
const originalVitestEnv = process.env.VITEST;
const originalFlaskUrl = process.env.FLASK_BACKEND_URL;
const originalSpaDistDir = process.env.SPA_DIST_DIR;

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
  fs.rmSync(stubDistDir, { recursive: true, force: true });
  await new Promise<void>((resolve) => expressServer.close(() => resolve()));
  await new Promise<void>((resolve) => flaskStub.close(() => resolve()));
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
    expect(await res.text()).toBe(STUB_SPA_SHELL);
  });
});

/**
 * RCP-77 AC4 (KAN-160): unrecognized paths must never be answered 200
 * text/html by the SPA catch-all. An asset-like path that nothing earlier
 * served (express.static miss, no route) must 404 — index.html as a fake
 * .js/.css/.map is refused by browsers under X-Content-Type-Options: nosniff
 * and reads as soft-404 shell spam to crawlers. The catch-all consults
 * classifyRoute() from server/route-manifest.ts at runtime; these tests boot
 * the real app and verify that enforcement end to end.
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
    expect(await res.text()).toBe(STUB_SPA_SHELL);
  });

  it('still serves the shell for unknown non-asset paths (Angular owns its own 404)', async () => {
    const res = await fetch(`${baseUrl}/some/unknown/page`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toBe(STUB_SPA_SHELL);
  });
});
