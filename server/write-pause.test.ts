/**
 * KAN-330 — the recipe write pause.
 *
 * While the publish-state audit runs, every write to a recipe or a generation
 * request must stop at Express with a 503 the SPA can name, before anything
 * reaches Flask. Reads and everything outside the two prefixes keep flowing.
 *
 * Two layers: the middleware on its own (both states, every method/prefix
 * combination), then the real app booted against a stub Flask so the mount
 * position is pinned — a paused write must leave zero marks on the stub.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createWritePause, RECIPE_WRITE_PAUSE_CODE } from './write-pause.js';

async function withApp(
  paused: boolean,
  run: (baseUrl: string, hits: string[]) => Promise<void>
): Promise<void> {
  const hits: string[] = [];
  const app = express();
  app.use(
    '/api',
    createWritePause(() => paused)
  );
  app.all('/api/{*path}', (req, res) => {
    hits.push(`${req.method} ${req.path}`);
    res.status(200).json({ ok: true });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('createWritePause', () => {
  const WRITES = [
    ['POST', '/api/recipes'],
    ['PUT', '/api/recipes/r1'],
    ['DELETE', '/api/recipes/r1'],
    ['PATCH', '/api/recipes/r1'],
    ['POST', '/api/generate'],
    ['POST', '/api/generate_image'],
  ] as const;

  it('answers 503 with a named code for recipe and generation writes while paused', async () => {
    await withApp(true, async (baseUrl, hits) => {
      for (const [method, url] of WRITES) {
        const res = await fetch(`${baseUrl}${url}`, { method });
        expect(res.status, `${method} ${url}`).toBe(503);
        expect(res.headers.get('retry-after')).toMatch(/^\d+$/);
        const body = (await res.json()) as { error: string; code: string };
        expect(body.code).toBe(RECIPE_WRITE_PAUSE_CODE);
        expect(body.error).toMatch(/try again/i);
      }
      expect(hits).toEqual([]);
    });
  });

  it('stops percent-encoded spellings of the paused paths', async () => {
    // The proxy forwards originalUrl verbatim and Flask decodes it before
    // routing, so /api/%72ecipes IS /api/recipes by the time it is served.
    await withApp(true, async (baseUrl, hits) => {
      const encoded = [
        ['PUT', '/api/%72ecipes/r1'],
        ['POST', '/api/recipe%73'],
        ['POST', '/api/%67enerate'],
        ['POST', '/api/generate%5Fimage'],
        ['DELETE', '/api/recipes%2Fr1'],
        ['POST', '/api/%E0%A4%A'],
      ] as const;
      for (const [method, url] of encoded) {
        const res = await fetch(`${baseUrl}${url}`, { method });
        expect(res.status, `${method} ${url}`).toBe(503);
      }
      expect(hits).toEqual([]);
    });
  });

  it('lets reads and other API routes through while paused', async () => {
    await withApp(true, async (baseUrl, hits) => {
      const passThrough = [
        ['GET', '/api/recipes'],
        ['GET', '/api/recipes/r1'],
        ['GET', '/api/recipes/r1/status'],
        ['GET', '/api/recipes/r1/image'],
        ['POST', '/api/collections'],
        ['POST', '/api/collections/c1/recipes'],
        ['DELETE', '/api/collections/c1/recipes/r1'],
        ['GET', '/api/health'],
      ] as const;
      for (const [method, url] of passThrough) {
        const res = await fetch(`${baseUrl}${url}`, { method });
        expect(res.status, `${method} ${url}`).toBe(200);
      }
      expect(hits).toHaveLength(passThrough.length);
    });
  });

  it('is transparent when the pause is off', async () => {
    await withApp(false, async (baseUrl, hits) => {
      for (const [method, url] of WRITES) {
        const res = await fetch(`${baseUrl}${url}`, { method });
        expect(res.status, `${method} ${url}`).toBe(200);
      }
      expect(hits).toHaveLength(WRITES.length);
    });
  });
});

// The real app: RECIPE_WRITE_PAUSE=1 must stop a write before the Flask
// proxy, and must not touch a read or the health check.
describe('RECIPE_WRITE_PAUSE on the real app', () => {
  let flaskStub: http.Server;
  let expressServer: http.Server;
  let baseUrl: string;
  let stubDistDir: string;
  const flaskHits: string[] = [];

  const originalEnv = {
    VITEST: process.env.VITEST,
    FLASK_BACKEND_URL: process.env.FLASK_BACKEND_URL,
    SPA_DIST_DIR: process.env.SPA_DIST_DIR,
    RECIPE_WRITE_PAUSE: process.env.RECIPE_WRITE_PAUSE,
  };

  beforeAll(async () => {
    flaskStub = http.createServer((req, res) => {
      flaskHits.push(`${req.method} ${req.url}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok": true}');
    });
    await new Promise<void>((resolve) => flaskStub.listen(0, '127.0.0.1', resolve));
    process.env.FLASK_BACKEND_URL = `http://127.0.0.1:${(flaskStub.address() as AddressInfo).port}`;

    stubDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-dist-stub-pause-'));
    fs.writeFileSync(path.join(stubDistDir, 'index.html'), '<!doctype html><html></html>');
    process.env.SPA_DIST_DIR = stubDistDir;
    process.env.VITEST = process.env.VITEST || 'true';
    process.env.RECIPE_WRITE_PAUSE = '1';

    const { app, ready } = await import('./index.js');
    await ready;
    expressServer = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => expressServer.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(expressServer.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    process.env.RECIPE_WRITE_PAUSE = '1';
    flaskHits.length = 0;
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(stubDistDir, { recursive: true, force: true });
    await new Promise<void>((resolve) => expressServer.close(() => resolve()));
    await new Promise<void>((resolve) => flaskStub.close(() => resolve()));
  });

  it('stops a recipe save before Flask', async () => {
    const res = await fetch(`${baseUrl}/api/recipes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"id":"r1","name":"x"}',
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe(RECIPE_WRITE_PAUSE_CODE);
    expect(flaskHits).toEqual([]);
  });

  it('stops a generation request before Flask', async () => {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"prompt":"a hearty winter stew"}',
    });
    expect(res.status).toBe(503);
    expect(flaskHits).toEqual([]);
  });

  it('still proxies reads and the health check', async () => {
    expect((await fetch(`${baseUrl}/api/recipes`)).status).toBe(200);
    expect(flaskHits).toEqual(['GET /api/recipes']);
    expect((await fetch(`${baseUrl}/api/health`)).status).toBe(200);
  });

  it('is read per request, so unsetting the variable lifts the pause', async () => {
    delete process.env.RECIPE_WRITE_PAUSE;
    const res = await fetch(`${baseUrl}/api/recipes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"id":"r1","name":"x"}',
    });
    expect(res.status).toBe(200);
    expect(flaskHits).toEqual(['POST /api/recipes']);
  });
});
