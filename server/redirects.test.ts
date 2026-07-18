/**
 * Integration tests for the issue #3164 routing fixes in server/index.ts:
 *
 * - apex → www canonical-host 301 (all paths, before any other route)
 * - /browse/ (trailing slash) → /browse 301
 * - /favicon.ico served as a real image (previously fell through to the SPA
 *   catch-all and came back as index.html / text/html)
 *
 * Follows the boot pattern of server/routes.test.ts: import the real Express
 * app with VITEST set so no listener binds, then talk to it over a local
 * port. No Flask stub is needed — every route under test resolves inside
 * Express before the proxy.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let expressServer: Server;
let baseUrl: string;

const originalVitestEnv = process.env.VITEST;

beforeAll(async () => {
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
  await new Promise<void>((resolve) => expressServer.close(() => resolve()));
});

describe('apex → www canonical-host redirect', () => {
  // 'trust proxy' is enabled, so req.hostname honors X-Forwarded-Host —
  // exactly how apex-host traffic arrives through the Cloud Run proxy.
  it.each(['/', '/browse', '/r/some-slug'])('301s %s to the www host', async (path) => {
    const res = await fetch(`${baseUrl}${path}`, {
      redirect: 'manual',
      headers: { 'X-Forwarded-Host': 'tasteslikegood.org' },
    });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`https://www.tasteslikegood.org${path}`);
  });

  it('preserves the query string', async () => {
    const res = await fetch(`${baseUrl}/browse?page=2`, {
      redirect: 'manual',
      headers: { 'X-Forwarded-Host': 'tasteslikegood.org' },
    });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://www.tasteslikegood.org/browse?page=2');
  });

  it('applies to /api paths too (all paths redirect)', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      redirect: 'manual',
      headers: { 'X-Forwarded-Host': 'tasteslikegood.org' },
    });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://www.tasteslikegood.org/api/health');
  });

  it('does not redirect the www host', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      redirect: 'manual',
      headers: { 'X-Forwarded-Host': 'www.tasteslikegood.org' },
    });
    expect(res.status).toBe(200);
  });

  it('does not redirect non-production hosts (localhost)', async () => {
    const res = await fetch(`${baseUrl}/api/health`, { redirect: 'manual' });
    expect(res.status).toBe(200);
  });
});

describe('/browse/ trailing-slash redirect', () => {
  it('301s /browse/ to /browse', async () => {
    const res = await fetch(`${baseUrl}/browse/`, { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/browse');
  });

  it('preserves the query string', async () => {
    const res = await fetch(`${baseUrl}/browse/?page=2`, { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/browse?page=2');
  });
});

describe('/favicon.ico', () => {
  it('returns 200 with an image/* content-type (not the SPA shell)', async () => {
    const res = await fetch(`${baseUrl}/favicon.ico`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^image\//);
    const body = await res.text();
    expect(body).toContain('<svg');
    expect(body).not.toContain('<!doctype html>');
  });
});
