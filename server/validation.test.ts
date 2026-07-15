/**
 * Integration tests for the Express-layer AI endpoint validation
 * (server/validation.ts) and the proxy's buffer-and-replay path
 * (server/proxy.ts).
 *
 * Boots the real Express app against a stub Flask backend that echoes back
 * exactly what it received, so the tests can assert both that invalid
 * requests never reach Flask and that valid requests arrive as exactly the
 * bytes that were validated (issue #3083).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

interface EchoedRequest {
  method: string | undefined;
  url: string | undefined;
  contentLength: string | undefined;
  contentEncoding: string | undefined;
  body: string;
}

let flaskStub: http.Server;
let expressServer: http.Server;
let baseUrl: string;
let flaskRequests: EchoedRequest[];

// Captured so the env overrides below can be restored for other test files.
const originalVitestEnv = process.env.VITEST;
const originalFlaskUrl = process.env.FLASK_BACKEND_URL;

beforeAll(async () => {
  flaskRequests = [];
  // Stub Flask backend: records every request it receives and echoes the body.
  flaskStub = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      flaskRequests.push({
        method: req.method,
        url: req.url,
        contentLength: req.headers['content-length'],
        contentEncoding: req.headers['content-encoding'],
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end('{"status": "generating"}');
    });
  });
  await new Promise<void>((resolve) => flaskStub.listen(0, '127.0.0.1', resolve));
  const flaskPort = (flaskStub.address() as AddressInfo).port;

  // Must be set before importing index.ts — proxy.ts reads it at import time.
  process.env.FLASK_BACKEND_URL = `http://127.0.0.1:${flaskPort}`;
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

beforeEach(() => {
  flaskRequests.length = 0;
});

const postJson = (path: string, body: string) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

describe('POST /api/generate validation', () => {
  it('replays a valid request to Flask byte-for-byte', async () => {
    const payload = JSON.stringify({ prompt: 'A hearty winter stew with lentils' });
    const res = await postJson('/api/generate', payload);
    expect(res.status).toBe(202);
    expect(flaskRequests).toHaveLength(1);
    expect(flaskRequests[0].url).toBe('/api/generate');
    expect(flaskRequests[0].body).toBe(payload);
    expect(flaskRequests[0].contentLength).toBe(String(Buffer.byteLength(payload)));
  });

  it('replays a gzip-encoded request as identity-encoded decompressed bytes', async () => {
    // body-parser inflates encoded bodies before the verify hook captures
    // them, so the buffered replay holds DECOMPRESSED bytes. The proxy must
    // therefore strip content-encoding and describe the decompressed length,
    // or Flask would try to gunzip plain JSON.
    const payload = JSON.stringify({ prompt: 'A hearty winter stew with lentils' });
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      body: gzipSync(payload),
    });
    expect(res.status).toBe(202);
    expect(flaskRequests).toHaveLength(1);
    expect(flaskRequests[0].body).toBe(payload);
    expect(flaskRequests[0].contentEncoding).toBeUndefined();
    expect(flaskRequests[0].contentLength).toBe(String(Buffer.byteLength(payload)));
  });

  it('accepts a valid optional model name', async () => {
    const payload = JSON.stringify({
      prompt: 'A hearty winter stew with lentils',
      model: 'models/gemini-3.1-pro-preview',
    });
    const res = await postJson('/api/generate', payload);
    expect(res.status).toBe(202);
    expect(flaskRequests).toHaveLength(1);
  });

  it('rejects a missing prompt with 400 without contacting Flask', async () => {
    const res = await postJson('/api/generate', JSON.stringify({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('A prompt describing the desired recipe is required.');
    expect(flaskRequests).toHaveLength(0);
  });

  it('rejects a too-short prompt with 400', async () => {
    const res = await postJson('/api/generate', JSON.stringify({ prompt: 'stew' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Prompt must be at least 10 characters.');
    expect(flaskRequests).toHaveLength(0);
  });

  it('rejects a too-long prompt with 400', async () => {
    const res = await postJson('/api/generate', JSON.stringify({ prompt: 'x'.repeat(501) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Prompt must be no more than 500 characters.');
    expect(flaskRequests).toHaveLength(0);
  });

  it('rejects a non-string prompt with 400', async () => {
    const res = await postJson('/api/generate', JSON.stringify({ prompt: { $ne: null } }));
    expect(res.status).toBe(400);
    expect(flaskRequests).toHaveLength(0);
  });

  it('rejects an invalid model name with 400', async () => {
    const res = await postJson(
      '/api/generate',
      JSON.stringify({ prompt: 'A hearty winter stew', model: 'gemini <script>' })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Model name contains invalid characters.');
    expect(flaskRequests).toHaveLength(0);
  });

  it('rejects a path-like model name with 400', async () => {
    const res = await postJson(
      '/api/generate',
      JSON.stringify({ prompt: 'A hearty winter stew', model: 'models/../v1beta' })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Model name contains invalid characters.');
    expect(flaskRequests).toHaveLength(0);
  });

  it('length-checks the prompt untrimmed, exactly as Flask does', async () => {
    // Flask's validate_generation_input checks len() on the raw string, and
    // the proxy replays the raw bytes — so a whitespace-padded short prompt
    // must be forwarded (Flask accepts it), not rejected on a trimmed value.
    const res = await postJson('/api/generate', JSON.stringify({ prompt: '   stew   ' }));
    expect(res.status).toBe(202);
    expect(flaskRequests).toHaveLength(1);
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await postJson('/api/generate', '{"prompt": "A hearty winter stew"');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Request body must be valid JSON.');
    expect(flaskRequests).toHaveLength(0);
  });

  it('rejects oversized bodies with 413', async () => {
    const res = await postJson(
      '/api/generate',
      JSON.stringify({ prompt: 'A hearty stew', padding: 'x'.repeat(11 * 1024) })
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('Request body too large.');
    expect(flaskRequests).toHaveLength(0);
  });
});

describe('POST /api/generate_image validation', () => {
  it('proxies a valid request', async () => {
    const payload = JSON.stringify({
      recipe_id: '8f2b6f5e-2a1c-4b3d-9e8f-1a2b3c4d5e6f',
      force_regenerate: true,
    });
    const res = await postJson('/api/generate_image', payload);
    expect(res.status).toBe(202);
    expect(flaskRequests).toHaveLength(1);
    expect(flaskRequests[0].body).toBe(payload);
  });

  it('rejects a non-UUID recipe_id with 400', async () => {
    const res = await postJson(
      '/api/generate_image',
      JSON.stringify({ recipe_id: '../../etc/passwd' })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('recipe_id must be a valid UUID.');
    expect(flaskRequests).toHaveLength(0);
  });

  it('rejects a missing recipe_id with 400', async () => {
    const res = await postJson('/api/generate_image', JSON.stringify({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('recipe_id is required');
    expect(flaskRequests).toHaveLength(0);
  });

  it('rejects a non-boolean force_regenerate with 400', async () => {
    const res = await postJson(
      '/api/generate_image',
      JSON.stringify({
        recipe_id: '8f2b6f5e-2a1c-4b3d-9e8f-1a2b3c4d5e6f',
        force_regenerate: 'yes',
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('force_regenerate must be a boolean.');
    expect(flaskRequests).toHaveLength(0);
  });
});

describe('other /api routes are untouched by AI validation', () => {
  it('streams non-AI POST bodies to Flask without parsing', async () => {
    // Deliberately NOT valid JSON — the raw-streaming path must forward it
    // as-is because Flask owns body parsing for everything but AI endpoints.
    const rawBody = 'not-json&also=not-validated';
    const res = await fetch(`${baseUrl}/api/recipes`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: rawBody,
    });
    expect(res.status).toBe(202); // stub always answers 202
    expect(flaskRequests).toHaveLength(1);
    expect(flaskRequests[0].body).toBe(rawBody);
  });

  it('proxies GET /api/generate through to Flask (method not intercepted)', async () => {
    const res = await fetch(`${baseUrl}/api/generate`);
    expect(res.status).toBe(202);
    expect(flaskRequests).toHaveLength(1);
  });
});
