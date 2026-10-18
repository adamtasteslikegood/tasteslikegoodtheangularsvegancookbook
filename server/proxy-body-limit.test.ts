/**
 * KAN-408: the Flask proxy refuses request bodies over 1 MB with 413.
 *
 * Runs real HTTP servers: a stand-in Flask that records how many body bytes
 * reach it, and Express with the real proxy in front. vi.resetModules() is
 * needed because proxy.ts reads FLASK_BACKEND_URL at import time; that is why
 * this lives in its own file (see proxy-auth.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';

vi.mock('./flask-auth.js', () => ({ getFlaskAuthHeader: async () => null }));

const servers: http.Server[] = [];
let flaskBytes: number[] = [];

function listen(server: http.Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

/** The stand-in Flask: reads the whole body, then answers with the byte count. */
const readAllThenAnswer: http.RequestListener = (req, res) => {
  let n = 0;
  req.on('data', (c: Buffer) => (n += c.length));
  req.on('end', () => {
    flaskBytes.push(n);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ bytes: n }));
  });
  req.on('error', () => {});
};

async function startProxy(
  flaskHandler: http.RequestListener = readAllThenAnswer
): Promise<{ port: number; limit: number }> {
  const flask = http.createServer(flaskHandler);
  const flaskPort = await listen(flask);
  process.env.FLASK_BACKEND_URL = `http://127.0.0.1:${flaskPort}`;
  vi.resetModules();
  const { createFlaskProxy, MAX_PROXY_BODY_BYTES } = await import('./proxy.js');
  const app = express();
  app.use('/api', createFlaskProxy('Test'));
  const port = await listen(http.createServer(app));
  return { port, limit: MAX_PROXY_BODY_BYTES };
}

/** POST a body; `chunked` sends it without a Content-Length. */
function post(
  port: number,
  body: Buffer,
  chunked: boolean,
  agent?: http.Agent,
  path = '/api/recipes'
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    let responded = false;
    const headers: http.OutgoingHttpHeaders = { 'content-type': 'application/json' };
    if (chunked) headers['transfer-encoding'] = 'chunked';
    else headers['content-length'] = String(body.length);
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'POST', headers, agent },
      (res) => {
        responded = true;
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () => {
          const text = Buffer.concat(parts).toString();
          resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : null });
        });
      }
    );
    // The proxy closes the connection after a 413, so the client may see its
    // own write fail once the response has arrived. That is expected.
    req.on('error', (err) => {
      if (!responded) reject(err);
    });
    if (chunked) {
      // Several writes, so the body really arrives in chunks.
      const step = 256 * 1024;
      for (let i = 0; i < body.length; i += step) req.write(body.subarray(i, i + step));
      req.end();
    } else {
      req.end(body);
    }
  });
}

const originalFlaskUrl = process.env.FLASK_BACKEND_URL;

beforeEach(() => {
  flaskBytes = [];
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((r) => {
          s.closeAllConnections();
          s.close(() => r());
        })
    )
  );
  vi.resetModules();
  if (originalFlaskUrl === undefined) delete process.env.FLASK_BACKEND_URL;
  else process.env.FLASK_BACKEND_URL = originalFlaskUrl;
});

describe('Flask proxy body limit (KAN-408)', () => {
  it('is 1 MB', async () => {
    const { limit } = await startProxy();
    expect(limit).toBe(1024 * 1024);
  });

  it('refuses a declared body over the limit with 413 and never contacts Flask', async () => {
    const { port, limit } = await startProxy();
    const res = await post(port, Buffer.alloc(limit + 1, 0x78), false);
    expect(res.status).toBe(413);
    expect(res.json).toEqual({ error: 'The request body is too large' });
    expect(flaskBytes).toEqual([]);
  });

  it('refuses a chunked body over the limit with 413', async () => {
    const { port, limit } = await startProxy();
    const res = await post(port, Buffer.alloc(limit * 2, 0x78), true);
    expect(res.status).toBe(413);
    expect(res.json).toEqual({ error: 'The request body is too large' });
    // The request to Flask is abandoned, so Flask never sees a complete body.
    expect(flaskBytes).toEqual([]);
  });

  it('forwards a declared body at the limit unchanged', async () => {
    const { port, limit } = await startProxy();
    const res = await post(port, Buffer.alloc(limit, 0x78), false);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ bytes: limit });
  });

  // KAN-428: a Flask route can answer before reading the body. The proxy holds
  // that answer until the body ends, so a body past the limit still gets 413.
  it('answers 413 when Flask answered early and the body goes past the limit', async () => {
    const { port, limit } = await startProxy((req, res) => {
      if (req.url === '/api/early') {
        req.once('data', () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{"early":true}');
        });
        req.on('error', () => {});
        res.on('error', () => {});
        return;
      }
      readAllThenAnswer(req, res);
    });
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const early = await post(port, Buffer.alloc(limit * 2, 0x78), true, agent, '/api/early');
      expect(early.status).toBe(413);
      expect(early.json).toEqual({ error: 'The request body is too large' });
      // The next request through the same agent must still be answered.
      const next = await Promise.race([
        post(port, Buffer.from('{}'), false, agent),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('next request got no answer')), 3000)
        ),
      ]);
      expect(next.status).toBe(200);
    } finally {
      agent.destroy();
    }
  });

  // The reviewer's repro on #3710: one chunk, Flask answers without reading,
  // and only then the rest of the body, past the limit. Flask either finishes
  // its answer or has only started it; the client gets 413 either way.
  it.each([
    ['finished', true],
    ['started', false],
  ])('answers 413 when the limit is crossed after Flask %s answering', async (_label, finish) => {
    let flaskAnswered!: () => void;
    const answered = new Promise<void>((resolve) => (flaskAnswered = resolve));
    const { port, limit } = await startProxy((req, res) => {
      req.once('data', () => {
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': '13' });
        if (finish) res.end('{"ok":"yes"}\n');
        else res.write('{');
        flaskAnswered();
      });
      req.on('error', () => {});
      res.on('error', () => {});
    });
    const status = await new Promise<number>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('no answer')), 3000);
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/recipes',
          method: 'POST',
          headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
        },
        (res) => {
          clearTimeout(deadline);
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      req.on('error', () => {});
      req.write(Buffer.alloc(64 * 1024, 0x78));
      void answered.then(() => req.end(Buffer.alloc(limit, 0x78)));
    });
    expect(status).toBe(413);
  });

  it('releases the request to Flask when the client leaves while an early answer is held', async () => {
    let flaskClosed!: () => void;
    const closed = new Promise<void>((resolve) => (flaskClosed = resolve));
    let flaskAnswered!: () => void;
    const answered = new Promise<void>((resolve) => (flaskAnswered = resolve));
    const { port } = await startProxy((req, res) => {
      req.once('data', () => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('held');
        flaskAnswered();
      });
      req.socket.on('close', () => flaskClosed());
      req.on('error', () => {});
      res.on('error', () => {});
    });
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/recipes',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
    });
    req.on('error', () => {});
    req.write(Buffer.alloc(64 * 1024, 0x78));
    await answered;
    req.destroy();
    await Promise.race([
      closed,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('the request to Flask stayed open')), 2000)
      ),
    ]);
  });

  it('keeps serving the connection when Flask answered early and the body was under the limit', async () => {
    const { port } = await startProxy((req, res) => {
      if (req.url === '/api/early') {
        req.once('data', () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{"early":true}');
        });
        req.on('error', () => {});
        res.on('error', () => {});
        return;
      }
      readAllThenAnswer(req, res);
    });
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const early = await post(port, Buffer.alloc(600 * 1024, 0x78), true, agent, '/api/early');
      expect(early.status).toBe(200);
      const next = await Promise.race([
        post(port, Buffer.from('{}'), false, agent),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('next request got no answer')), 3000)
        ),
      ]);
      expect(next.json).toEqual({ bytes: 2 });
    } finally {
      agent.destroy();
    }
  });

  it('forwards a chunked body under the limit unchanged', async () => {
    const { port } = await startProxy();
    const size = 600 * 1024;
    const res = await post(port, Buffer.alloc(size, 0x78), true);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ bytes: size });
  });
});
