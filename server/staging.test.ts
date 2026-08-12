/**
 * Integration tests for the staging non-indexability guards (KAN-182):
 *
 * - X-Robots-Tag: noindex, nofollow on every response when NODE_ENV=staging
 * - deny-all /robots.txt — which must ALSO carry the X-Robots-Tag header
 *   (regression guard for the ordering bug where the robots.txt route was
 *   registered before the header middleware)
 *
 * Follows the boot pattern of server/redirects.test.ts: set the env BEFORE
 * dynamically importing the real Express app (NODE_ENV is read at app-build
 * time), with VITEST set so no listener binds. Vitest isolates each test
 * file's module registry, so the staging-mode app never leaks into other
 * test files.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let expressServer: Server;
let baseUrl: string;

const originalVitestEnv = process.env.VITEST;
const originalNodeEnv = process.env.NODE_ENV;

beforeAll(async () => {
  process.env.VITEST = process.env.VITEST || 'true';
  process.env.NODE_ENV = 'staging';

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
