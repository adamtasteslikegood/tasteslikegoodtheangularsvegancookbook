/**
 * Proxy-level auth-header assertions for KAN-170.
 *
 * Separate from server/flask-auth.test.ts on purpose: these tests need
 * vi.resetModules() because proxy.ts reads FLASK_BACKEND_URL at import time,
 * and calling resetModules anywhere in a file drops the module under test out
 * of the v8 coverage report. Keeping the two apart lets flask-auth.ts be
 * measured by the coverage gate while proxy.ts (already excluded from the
 * coverage denominator in vitest.config.ts) is exercised here.
 *
 * What these pin: once the invoker IAM check is enabled on flask-backend, every
 * proxied request must carry a Google-signed ID token, and it must travel in a
 * header that does not collide with the client's own Authorization — Flask
 * reads that one in require_admin (/api/admin/*) and require_pubsub_oidc.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';

// Placeholder host only — the real flask-backend hostname is kept out of
// tracked files because both repos are public (KAN-170 / KAN-171).
const RUN_APP_URL = 'https://flask-backend-xyz.a.run.app';

const { getIdTokenClient } = vi.hoisted(() => ({ getIdTokenClient: vi.fn() }));

vi.mock('google-auth-library', () => ({
  // Must be a regular function (not an arrow) to support `new GoogleAuth()`.
  GoogleAuth: vi.fn(function GoogleAuthImpl() {
    return { getIdTokenClient };
  }),
}));

function authSucceeds(token = 'test-id-token') {
  getIdTokenClient.mockResolvedValue({
    getRequestHeaders: vi.fn().mockResolvedValue(new Headers({ authorization: `Bearer ${token}` })),
  });
}

function authFails() {
  getIdTokenClient.mockRejectedValue(new Error('metadata server unreachable'));
}

const originalFlaskUrl = process.env.FLASK_BACKEND_URL;

afterEach(() => {
  getIdTokenClient.mockReset();
  vi.restoreAllMocks();
  vi.resetModules();
  if (originalFlaskUrl === undefined) delete process.env.FLASK_BACKEND_URL;
  else process.env.FLASK_BACKEND_URL = originalFlaskUrl;
});

/** Boot the proxy against a captured node:https and return the headers it sent. */
async function captureHeaders(reqHeaders: Record<string, string>): Promise<Record<string, string>> {
  const captured: { headers?: Record<string, string> } = {};
  vi.resetModules();
  vi.doMock('node:https', () => ({
    default: {
      request: (opts: { headers: Record<string, string> }) => {
        captured.headers = opts.headers;
        return { on: vi.fn(), end: vi.fn(), write: vi.fn() };
      },
    },
  }));

  const { createFlaskProxy } = await import('./proxy.js');
  const handler = createFlaskProxy('Test');

  const req = {
    headers: { host: 'www.tasteslikegood.org', ...reqHeaders },
    hostname: 'www.tasteslikegood.org',
    originalUrl: '/api/recipes',
    method: 'GET',
    protocol: 'https',
    on: vi.fn(),
    pipe: vi.fn(),
  } as unknown as Request;
  const res = {
    writeHead: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    headersSent: false,
  } as unknown as Response;

  handler(req, res);
  // The proxy awaits the ID token before dispatching, so the outgoing request
  // is issued on a later tick rather than synchronously.
  await new Promise((resolve) => setImmediate(resolve));
  vi.doUnmock('node:https');
  return captured.headers ?? {};
}

describe('createFlaskProxy auth headers', () => {
  it('sends the ID token in X-Serverless-Authorization', async () => {
    process.env.FLASK_BACKEND_URL = RUN_APP_URL;
    authSucceeds();
    const headers = await captureHeaders({});
    expect(headers['x-serverless-authorization']).toBe('Bearer test-id-token');
  });

  it("leaves the client's own Authorization header untouched", async () => {
    process.env.FLASK_BACKEND_URL = RUN_APP_URL;
    authSucceeds();
    // Flask's require_admin reads this header for /api/admin/*, which Express
    // proxies. Overwriting it with the ID token would break those routes.
    const headers = await captureHeaders({ authorization: 'Bearer admin-token' });
    expect(headers.authorization).toBe('Bearer admin-token');
    expect(headers['x-serverless-authorization']).toBe('Bearer test-id-token');
  });

  it('overwrites a client-supplied X-Serverless-Authorization', async () => {
    process.env.FLASK_BACKEND_URL = RUN_APP_URL;
    authSucceeds();
    const headers = await captureHeaders({ 'x-serverless-authorization': 'Bearer forged' });
    expect(headers['x-serverless-authorization']).toBe('Bearer test-id-token');
  });

  it('strips a client-supplied X-Serverless-Authorization when no token is available', async () => {
    process.env.FLASK_BACKEND_URL = RUN_APP_URL;
    authFails();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // With no token of our own to overwrite it, a forged header must still not
    // survive — otherwise a browser could hand Cloud Run its own credential.
    const headers = await captureHeaders({ 'x-serverless-authorization': 'Bearer forged' });
    expect(headers['x-serverless-authorization']).toBeUndefined();
  });

  it('still proxies normally in local dev, where no token can be minted', async () => {
    process.env.FLASK_BACKEND_URL = 'http://localhost:5000';
    const captured: { headers?: Record<string, string> } = {};
    vi.resetModules();
    vi.doMock('node:http', () => ({
      default: {
        request: (opts: { headers: Record<string, string> }) => {
          captured.headers = opts.headers;
          return { on: vi.fn(), end: vi.fn(), write: vi.fn() };
        },
      },
    }));
    const { createFlaskProxy } = await import('./proxy.js');
    const handler = createFlaskProxy('Test');
    const req = {
      headers: { host: 'localhost:3000' },
      hostname: 'localhost',
      originalUrl: '/api/recipes',
      method: 'GET',
      protocol: 'http',
      on: vi.fn(),
      pipe: vi.fn(),
    } as unknown as Request;
    const res = {
      writeHead: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      headersSent: false,
    } as unknown as Response;

    handler(req, res);
    await new Promise((resolve) => setImmediate(resolve));
    vi.doUnmock('node:http');

    // `npm run dev` must keep working: the request goes through, unauthenticated.
    expect(captured.headers?.host).toBe('localhost:5000');
    expect(captured.headers?.['x-serverless-authorization']).toBeUndefined();
    expect(getIdTokenClient).not.toHaveBeenCalled();
  });

  it('does not crash when the client disconnects while the ID token is being minted', async () => {
    process.env.FLASK_BACKEND_URL = RUN_APP_URL;
    // A promise that never resolves during this test, so forward() stays
    // suspended at `await getFlaskAuthHeader()` — the exact window in which
    // req must already have an 'error' listener attached.
    getIdTokenClient.mockReturnValue(new Promise(() => {}));

    vi.resetModules();
    vi.doMock('node:https', () => ({ default: { request: vi.fn() } }));
    const { createFlaskProxy } = await import('./proxy.js');
    const handler = createFlaskProxy('Test');

    // A real EventEmitter, not a vi.fn() stub: this test needs Node's actual
    // "unlistened 'error' throws" behavior to prove the fix, not a mock of it.
    const req = Object.assign(new EventEmitter(), {
      headers: { host: 'www.tasteslikegood.org' },
      hostname: 'www.tasteslikegood.org',
      originalUrl: '/api/recipes',
      method: 'GET',
      protocol: 'https',
      pipe: vi.fn(),
    }) as unknown as Request;
    const res = {
      writeHead: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      headersSent: false,
    } as unknown as Response;

    handler(req, res);
    // Let forward() run up to (and suspend at) the getFlaskAuthHeader await.
    await new Promise((resolve) => setImmediate(resolve));

    // Before the fix, req had no listeners here: req.pipe() — which attaches
    // one — only ran after this await. An unlistened 'error' on an
    // EventEmitter throws by default, and server/index.ts installs no
    // uncaughtException handler, so this would have crashed the process.
    expect(() => req.emit('error', new Error('ECONNRESET'))).not.toThrow();

    vi.doUnmock('node:https');
  });

  it('does not dispatch to Flask when the client disconnects during the token mint', async () => {
    process.env.FLASK_BACKEND_URL = RUN_APP_URL;
    // Deferred mint: keeps forward() suspended at `await getFlaskAuthHeader()`
    // so the test can flip res.destroyed inside that exact window, then release.
    let releaseMint!: (client: unknown) => void;
    getIdTokenClient.mockReturnValue(new Promise((resolve) => (releaseMint = resolve)));

    const request = vi.fn();
    vi.resetModules();
    vi.doMock('node:https', () => ({ default: { request } }));
    const { createFlaskProxy } = await import('./proxy.js');
    const handler = createFlaskProxy('Test');

    const req = {
      headers: { host: 'www.tasteslikegood.org' },
      hostname: 'www.tasteslikegood.org',
      originalUrl: '/api/recipes',
      method: 'GET',
      protocol: 'https',
      on: vi.fn(),
      pipe: vi.fn(),
    } as unknown as Request;
    const res = {
      writeHead: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      headersSent: false,
      destroyed: false,
    } as unknown as Response;

    handler(req, res);
    // Let forward() run up to (and suspend at) the getFlaskAuthHeader await.
    await new Promise((resolve) => setImmediate(resolve));

    // The client disconnects mid-mint, then the mint completes.
    res.destroyed = true;
    releaseMint({
      getRequestHeaders: vi
        .fn()
        .mockResolvedValue(new Headers({ authorization: 'Bearer test-id-token' })),
    });
    await new Promise((resolve) => setImmediate(resolve));

    // The `if (res.destroyed) return` guard must bail before dispatch: a
    // socket to Flask whose response has nowhere to go must never be opened.
    expect(request).not.toHaveBeenCalled();
    expect(req.pipe).not.toHaveBeenCalled();

    vi.doUnmock('node:https');
  });
});
