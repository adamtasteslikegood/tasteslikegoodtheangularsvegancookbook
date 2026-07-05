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
const STUB_HTML = '<!doctype html><html><body>ssr-browse</body></html>';

let flaskStub: http.Server;
let expressServer: http.Server;
let baseUrl: string;

beforeAll(async () => {
  // Stub Flask backend: serves the SSR stylesheet and browse page.
  flaskStub = http.createServer((req, res) => {
    if (req.url === '/static/css/tokens.css') {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      res.end(STUB_CSS);
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

  const { app, ready } = await import('./index.js');
  await ready;

  expressServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => expressServer.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(expressServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
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
