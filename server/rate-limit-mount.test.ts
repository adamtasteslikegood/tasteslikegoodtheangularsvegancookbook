/**
 * Rate-limit exemption tests at the MOUNT level (RCP-67) — INTEGRATION.
 *
 * Why this file exists, and why unit tests were not enough.
 *
 * The /api limiter is mounted with `app.use('/api', limiter)`, so Express hands
 * it a path RELATIVE to the mount: a request for /api/health arrives as
 * baseUrl='/api', path='/health'. The page limiter is attached per-route
 * (`app.get('/browse', limiter, …)`), where baseUrl is '' and path is absolute.
 * The same `req.path` therefore means two different things in the two limiters.
 *
 * RCP-67 moved the exemption policy into route-manifest.ts stated in ABSOLUTE
 * terms, which is the only form that can share a vocabulary with classifyRoute().
 * That refactor has exactly one way to fail silently: get the mount composition
 * wrong and the skip stops matching, so /api/recipes/<id>/image starts counting
 * against the budget again — the KAN-154 failure shape, reintroduced with every
 * unit test still green, because a unit test supplies the fixture it expects.
 *
 * These tests boot a real Express app and let Express itself produce the
 * request, so the composition is verified rather than assumed.
 */
import { describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiLimiter, createPageLimiter } from './security.js';

/** Boot an app on an ephemeral port and return its base URL + a closer. */
async function boot(configure: (app: express.Express) => void) {
  const app = express();
  configure(app);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Fire `n` sequential GETs and return the status codes in order. */
async function hit(baseUrl: string, path: string, n: number, headers: HeadersInit = {}) {
  const codes: number[] = [];
  for (let i = 0; i < n; i++) {
    const res = await fetch(`${baseUrl}${path}`, { headers });
    codes.push(res.status);
  }
  return codes;
}

describe('/api limiter exemptions survive the mount (RCP-67)', () => {
  // max=2 so exhaustion is cheap; the real budget is 300/15min.
  const configure = (app: express.Express) => {
    app.use('/api', createApiLimiter(null, 60_000, 2));
    app.use('/api', (_req, res) => res.status(200).json({ ok: true }));
  };

  it('meters an ordinary /api route — the limiter is actually wired up', async () => {
    const { baseUrl, close } = await boot(configure);
    try {
      // Without this the exemption assertions below would pass vacuously
      // against a limiter that never limits anything.
      expect(await hit(baseUrl, '/api/recipes', 4)).toEqual([200, 200, 429, 429]);
    } finally {
      await close();
    }
  });

  it('never meters /api/recipes/<id>/image (KAN-154 image serving)', async () => {
    const { baseUrl, close } = await boot(configure);
    try {
      const codes = await hit(
        baseUrl,
        '/api/recipes/550e8400-e29b-41d4-a716-446655440000/image',
        6
      );
      expect(codes).toEqual([200, 200, 200, 200, 200, 200]);
    } finally {
      await close();
    }
  });

  it('never meters /api/health', async () => {
    const { baseUrl, close } = await boot(configure);
    try {
      expect(await hit(baseUrl, '/api/health', 6)).toEqual([200, 200, 200, 200, 200, 200]);
    } finally {
      await close();
    }
  });

  it('still meters a crawler on /api/generate — the UA exemption must not reach it', async () => {
    const { baseUrl, close } = await boot(configure);
    try {
      const ua = { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' };
      expect(await hit(baseUrl, '/api/generate', 4, ua)).toEqual([200, 200, 429, 429]);
    } finally {
      await close();
    }
  });
});

describe('page limiter exemptions at route level (RCP-67)', () => {
  const configure = (app: express.Express) => {
    const limiter = createPageLimiter(null, 60_000, 2);
    app.get('/browse', limiter, (_req, res) => res.status(200).send('browse'));
    app.get('/static/css/tokens.css', limiter, (_req, res) => res.status(200).send('css'));
  };

  it('meters real navigations', async () => {
    const { baseUrl, close } = await boot(configure);
    try {
      expect(await hit(baseUrl, '/browse', 4)).toEqual([200, 200, 429, 429]);
    } finally {
      await close();
    }
  });

  it('never meters a static subresource', async () => {
    const { baseUrl, close } = await boot(configure);
    try {
      expect(await hit(baseUrl, '/static/css/tokens.css', 6)).toEqual([
        200, 200, 200, 200, 200, 200,
      ]);
    } finally {
      await close();
    }
  });

  it('never meters a known crawler on a page route (KAN-218)', async () => {
    const { baseUrl, close } = await boot(configure);
    try {
      const ua = { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' };
      expect(await hit(baseUrl, '/browse', 6, ua)).toEqual([200, 200, 200, 200, 200, 200]);
    } finally {
      await close();
    }
  });
});
