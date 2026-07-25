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
 * These tests boot the real Express app against a stub Flask backend and
 * assert that /static/* is proxied to Flask (not swallowed by the SPA
 * fallback), alongside the pre-existing SSR routes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const STUB_CSS = ':root { --tokens: loaded; }';
const STUB_JS = 'document.documentElement.dataset.publicScript = "loaded";';
const STUB_HTML = '<!doctype html><html><body>ssr-browse</body></html>';

let flaskStub: http.Server;
let expressServer: http.Server;
let baseUrl: string;

// Captured so the env overrides below can be restored for other test files.
const originalVitestEnv = process.env.VITEST;
const originalFlaskUrl = process.env.FLASK_BACKEND_URL;

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
  // reach the catch-all rather than being answered with an empty 204. (It 404s
  // here only because this harness has no Angular build to serve index.html
  // from; the point is that it is not 204.)
  it('does not swallow ordinary SPA routes', async () => {
    const res = await fetch(`${baseUrl}/kitchen`);
    expect(res.status).not.toBe(204);
  });
});
