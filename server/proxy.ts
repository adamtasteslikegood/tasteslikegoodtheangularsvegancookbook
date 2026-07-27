/**
 * Lightweight reverse proxy for forwarding requests to the Flask backend.
 *
 * Uses Node's built-in `http` module — no extra dependencies.
 *
 * Why this exists:
 *   In the production-like local setup, the browser only talks to Express (:8080).
 *   Express serves the Angular SPA and handles AI endpoints directly, but auth,
 *   recipe persistence, and collections live in Flask (:5000). This proxy bridges
 *   the two so session cookies, OAuth redirects, and url_for(_external=True) all
 *   resolve to the same origin the browser is on.
 */

import http from 'node:http';
import https from 'node:https';
import type { Request, Response } from 'express';
import type { RawBodyRequest } from './validation.js';
import { sanitizeForLog } from './security.js';
import { getFlaskAuthHeader } from './flask-auth.js';

const FLASK_BACKEND_URL = process.env.FLASK_BACKEND_URL || 'http://localhost:5000';

/**
 * Returns Express middleware that proxies every matched request to the
 * Flask backend, preserving the original Host header so Flask's
 * url_for(_external=True) generates URLs that point back to Express.
 *
 * @param label - Used in error log messages (e.g. "Auth", "Recipes")
 */
export function createFlaskProxy(label = 'Flask') {
  const target = new URL(FLASK_BACKEND_URL);
  const transport = target.protocol === 'https:' ? https : http;

  return (req: Request, res: Response) => {
    // Express does not await handlers. Minting the ID token is async (a cache
    // hit in steady state), so the real work runs in an async closure. The
    // request body stream is safe across the await: this proxy is the terminal
    // handler, nothing upstream attaches a 'data' listener, and an
    // IncomingMessage stays paused until .pipe() resumes it. AI endpoints are
    // unaffected either way — validation.ts already buffered them into rawBody.
    //
    // The catch is not decorative: an unhandled rejection here would terminate
    // the process under Node's default policy, turning one malformed request
    // into a dropped container.
    forward(req, res).catch((err: unknown) => {
      console.error(
        `[${label} Proxy] ${sanitizeForLog(req.method)} ${sanitizeForLog(req.originalUrl)} dispatch failed: ${sanitizeForLog((err as Error).message)}`
      );
      if (!res.headersSent) {
        res.status(502).json({ error: 'Backend service unavailable' });
      }
    });
  };

  async function forward(req: Request, res: Response): Promise<void> {
    const originalHost = req.headers.host || req.hostname;
    // Validation middleware (server/validation.ts) buffers the body of AI
    // endpoint requests before this proxy runs; when present, replay those
    // bytes instead of piping the (already consumed) request stream.
    const rawBody = (req as RawBodyRequest).rawBody;
    // Before the await below, req has no listeners yet in the streaming path
    // (req.pipe() — which attaches one — now runs AFTER the await, not in the
    // same tick as before). A no-op keeps req from ever being listener-less:
    // an unlistened 'error' on an IncomingMessage is an uncaught exception
    // under Node's default policy, and server/index.ts installs no
    // uncaughtException handler, so a client disconnecting mid-mint would
    // crash the whole process, not just this request. AI-endpoint requests
    // are already ended/destroyed by validation.ts by this point, so this is
    // a no-op for them and only matters for the streamed path below.
    req.on('error', () => {});
    // KAN-170: proves Express's identity to Cloud Run's invoker IAM check.
    // Null while the token can't be minted (local dev, or a metadata failure) —
    // the request still goes through, because before the check is enabled Flask
    // accepts it anyway, and after it is enabled a 403 is the honest answer.
    const authHeader = await getFlaskAuthHeader();
    // The await above is a window the synchronous version did not have: a
    // client can disconnect during it. Dispatching anyway would open a socket
    // to Flask whose response has nowhere to go.
    //
    // Test only `res`. req.destroyed is ALSO true for every AI-endpoint request
    // here — validation.ts fully consumes that body stream to buffer rawBody,
    // which ends and destroys the IncomingMessage — so including it drops
    // exactly the requests this proxy is most careful about replaying.
    if (res.destroyed) return;
    const headers: http.OutgoingHttpHeaders = {
      ...req.headers,
      // Host must match the target so Cloud Run's frontend load balancer
      // routes the request to the Flask service. Flask sees the browser's
      // original host via X-Forwarded-Host (honored by ProxyFix, x_host=1).
      host: target.host,
      'x-forwarded-host': originalHost,
      'x-forwarded-proto': (req.headers['x-forwarded-proto'] as string) || req.protocol,
    };
    // Assigned AFTER the spread above, so a client-supplied value can never
    // win. Deleted first so a browser cannot inject its own token when auth is
    // disabled and nothing overwrites the key.
    //
    // X-Serverless-Authorization, NOT Authorization: Cloud Run consumes this
    // header for the invoker check and strips it before the container sees it,
    // which leaves the client's own Authorization header intact end to end.
    // Flask reads that header in two live code paths — require_admin
    // (Backend/utils/admin_auth.py, guarding the /api/admin/* routes Express
    // proxies) and require_pubsub_oidc — so overwriting it would break both.
    delete headers['x-serverless-authorization'];
    if (authHeader) {
      headers['x-serverless-authorization'] = authHeader;
    }
    if (rawBody !== undefined) {
      // body-parser inflates encoded bodies (gzip/deflate/br) BEFORE its
      // verify hook captures them, so rawBody is always identity-encoded.
      // Drop the client's content-encoding and recompute content-length so
      // the forwarded headers describe the bytes actually sent to Flask.
      headers['content-length'] = String(Buffer.byteLength(rawBody));
      delete headers['content-encoding'];
      delete headers['transfer-encoding'];
    }
    const options: http.RequestOptions = {
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: req.originalUrl, // includes query string
      method: req.method,
      headers,
      // Use the target's hostname for TLS SNI verification without
      // changing the HTTP Host header seen by Flask.
      ...(target.protocol === 'https:' ? { servername: target.hostname } : {}),
    };

    const proxyReq = transport.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
      // err.message is also sanitized: CodeQL models the client-request error
      // callback parameter as a remote flow source (the error text can echo
      // attacker-influenced request data), so it must not reach the log raw.
      console.error(
        `[${label} Proxy] ${sanitizeForLog(req.method)} ${sanitizeForLog(req.originalUrl)} → ${FLASK_BACKEND_URL} failed: ${sanitizeForLog(err.message)}`
      );
      if (!res.headersSent) {
        res.status(502).json({
          error: 'Backend service unavailable',
          detail:
            `Could not reach the Flask backend. ` +
            `Make sure it is running on ${FLASK_BACKEND_URL}`,
        });
      }
    });

    if (rawBody !== undefined) {
      // AI endpoints: the validation layer consumed the stream; send the
      // buffered bytes it captured — the bytes that were validated
      // (post-decompression if the request was encoded).
      proxyReq.end(rawBody);
    } else {
      // Stream the raw request body through to Flask.
      // This middleware is mounted BEFORE express.json() so the body
      // stream has not been consumed.
      req.pipe(proxyReq, { end: true });
    }
  }
}

/** Backward-compatible alias for auth routes. */
export function createAuthProxy() {
  return createFlaskProxy('Auth');
}
