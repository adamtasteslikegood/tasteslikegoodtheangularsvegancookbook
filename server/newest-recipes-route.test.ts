/**
 * The home page's newest-recipes row, through the real Express app (KAN-348).
 *
 * server/routes.test.ts boots the app against a Flask stub with no newest list,
 * so it covers the fallback: "/" is the shell exactly as built. This file boots
 * it against a stub that has one, in its own module instance (Vitest isolates
 * modules per file), to cover the row being written in.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const SHELL =
  '<!doctype html><html><head>' +
  '<meta name="tlg-home-head-start" content=""><title>Home</title>' +
  '<link rel="canonical" href="https://www.tasteslikegood.org/">' +
  '<meta name="tlg-home-head-end" content=""></head><body>' +
  '<app-root><h1>home-landing</h1><div id="tlg-newest-recipes"></div></app-root></body></html>';

const NEWEST = {
  recipes: [
    {
      slug: 'smoky-bean-chili',
      name: 'Smoky Bean Chili',
      first_published_at: '2026-10-10T00:00:00',
    },
    { slug: 'mac-and-cheeze', name: 'Mac & Cheeze', first_published_at: '2026-10-09T00:00:00' },
  ],
};

const ENV_KEYS = ['VITEST', 'FLASK_BACKEND_URL', 'SPA_DIST_DIR', 'NODE_ENV'] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

let flaskStub: http.Server;
let expressServer: http.Server;
let baseUrl: string;
let stubDistDir: string;
let newestRequests = 0;

beforeAll(async () => {
  flaskStub = http.createServer((req, res) => {
    if (req.url === '/api/public/newest-recipes?limit=8') {
      newestRequests += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(NEWEST));
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => flaskStub.listen(0, '127.0.0.1', resolve));

  stubDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-dist-newest-'));
  fs.writeFileSync(path.join(stubDistDir, 'index.html'), SHELL);
  process.env.SPA_DIST_DIR = stubDistDir;
  process.env.FLASK_BACKEND_URL = `http://127.0.0.1:${(flaskStub.address() as AddressInfo).port}`;
  process.env.VITEST = process.env.VITEST || 'true';
  process.env.NODE_ENV = 'production';

  const { app, ready } = await import('./index.js');
  await ready;
  expressServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => expressServer.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(expressServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  fs.rmSync(stubDistDir, { recursive: true, force: true });
  await new Promise<void>((resolve) => expressServer.close(() => resolve()));
  await new Promise<void>((resolve) => flaskStub.close(() => resolve()));
});

describe('home page newest-recipes row (KAN-348)', () => {
  it("writes Flask's newest recipes into the first HTML response for /", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();

    expect(body).toContain('<h1>home-landing</h1><nav aria-labelledby="landing-newest-title">');
    expect(body).toContain('Newest vegan recipes</h2>');
    expect(body).toContain('<a href="/r/smoky-bean-chili"');
    expect(body).toContain('>Mac &amp; Cheeze</a>');
    expect(body.indexOf('/r/smoky-bean-chili')).toBeLessThan(body.indexOf('/r/mac-and-cheeze'));
    expect(body).not.toContain('tlg-newest-recipes');
  });

  it('keeps the home page indexable and revalidating, as the built file is', async () => {
    const res = await fetch(`${baseUrl}/?source=oauth`);
    expect(res.headers.get('x-robots-tag')).toBe('index, follow');
    expect(res.headers.get('cache-control')).toBe('public, max-age=0');
    const etag = res.headers.get('etag');
    expect(etag).toMatch(/^W\//);
    expect(await res.text()).toContain('/r/smoky-bean-chili');

    const revalidatedStatus = await new Promise<number>((resolve, reject) => {
      const request = http.get(`${baseUrl}/?source=oauth`, { headers: { 'if-none-match': etag! } });
      request.once('response', (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.once('error', reject);
    });
    expect(revalidatedStatus).toBe(304);
  });

  it('asks Flask once for many home requests', async () => {
    await Promise.all(Array.from({ length: 5 }, () => fetch(`${baseUrl}/`).then((r) => r.text())));
    expect(newestRequests).toBe(1);
  });

  it('never puts the row in the route-neutral shell other SPA routes get', async () => {
    const body = await (await fetch(`${baseUrl}/kitchen`)).text();
    expect(body).not.toContain('landing-newest-title');
    expect(body).not.toContain('/r/smoky-bean-chili');
  });
});
