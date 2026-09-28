/**
 * Integration tests for the staging non-indexability guards (KAN-182):
 *
 * - X-Robots-Tag: noindex, nofollow on every response when NODE_ENV=staging
 * - deny-all /robots.txt — which must ALSO carry the X-Robots-Tag header
 *   (regression guard for the ordering bug where the robots.txt route was
 *   registered before the header middleware)
 * - the SPA catch-all's KAN-276 `noindex, follow` must not weaken staging's
 *   `noindex, nofollow` on shell responses
 *
 * Follows the boot pattern of server/redirects.test.ts: set the env BEFORE
 * dynamically importing the real Express app (NODE_ENV is read at app-build
 * time), with VITEST set so no listener binds. Vitest isolates each test
 * file's module registry, so the staging-mode app never leaks into other
 * test files.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let expressServer: Server;
let baseUrl: string;
let stubDistDir: string;

const originalVitestEnv = process.env.VITEST;
const originalNodeEnv = process.env.NODE_ENV;
const originalSpaDistDir = process.env.SPA_DIST_DIR;

beforeAll(async () => {
  process.env.VITEST = process.env.VITEST || 'true';
  process.env.NODE_ENV = 'staging';
  // Stub Angular dist/ so the SPA catch-all has a shell to serve (same
  // pattern as server/routes.test.ts).
  stubDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-dist-stub-staging-'));
  fs.writeFileSync(
    path.join(stubDistDir, 'index.html'),
    '<!doctype html><html><head>' +
      '<meta name="tlg-home-head-start" content=""><title>Home</title>' +
      '<link rel="canonical" href="https://www.tasteslikegood.org/">' +
      '<meta name="tlg-home-head-end" content=""></head>' +
      '<body><app-root><h1>home-landing</h1></app-root></body></html>'
  );
  process.env.SPA_DIST_DIR = stubDistDir;

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
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
  if (originalSpaDistDir === undefined) {
    delete process.env.SPA_DIST_DIR;
  } else {
    process.env.SPA_DIST_DIR = originalSpaDistDir;
  }
  fs.rmSync(stubDistDir, { recursive: true, force: true });
  await new Promise<void>((resolve) => expressServer.close(() => resolve()));
});

describe('staging robots.txt', () => {
  it('serves a deny-all robots.txt', async () => {
    const res = await fetch(`${baseUrl}/robots.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Disallow: /');
  });

  it('sets X-Robots-Tag on the robots.txt response itself', async () => {
    const res = await fetch(`${baseUrl}/robots.txt`);
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
});

describe('staging X-Robots-Tag header', () => {
  it('sets the header on API responses', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('reports the staging environment on /api/health', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const body = (await res.json()) as { environment: string };
    expect(body.environment).toBe('staging');
  });
});

describe('staging SPA catch-all keeps nofollow (KAN-276)', () => {
  it('keeps noindex, nofollow in the header and neutral shell', async () => {
    const res = await fetch(`${baseUrl}/kitchen`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    const body = await res.text();
    expect(body).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(body).not.toContain('home-landing');
    expect(body).not.toContain('rel="canonical"');
  });

  it('keeps noindex, nofollow on an unknown path (still 404)', async () => {
    const res = await fetch(`${baseUrl}/some-random-path`);
    expect(res.status).toBe(404);
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
});
