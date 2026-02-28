/**
 * Lightweight reverse proxy for forwarding /api/auth/* requests
 * to the Flask authentication backend.
 *
 * Uses Node's built-in `http` module — no extra dependencies.
 *
 * Why this exists:
 *   In the production-like local setup, the browser only talks to Express (:8080).
 *   Express serves the Angular SPA and handles AI endpoints directly, but auth
 *   lives in Flask (:5000). This proxy bridges the two so session cookies, OAuth
 *   redirects, and url_for(_external=True) all resolve to the same origin the
 *   browser is on.
 */

import http from "node:http";
import https from "node:https";
import type { Request, Response } from "express";

const FLASK_BACKEND_URL =
  process.env.FLASK_BACKEND_URL || "http://localhost:5000";

/**
 * Returns Express middleware that proxies every matched request to the
 * Flask backend, preserving the original Host header so Flask's
 * url_for(_external=True) generates URLs that point back to Express.
 */
export function createAuthProxy() {
  const target = new URL(FLASK_BACKEND_URL);
  const transport = target.protocol === "https:" ? https : http;

  return (req: Request, res: Response) => {
    const options: http.RequestOptions = {
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      path: req.originalUrl, // includes query string
      method: req.method,
      headers: {
        ...req.headers,
        // Keep the browser's Host header so Flask generates URLs on :8080,
        // not :5000.  This is critical for the OAuth redirect_uri to match.
      },
    };

    const proxyReq = transport.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on("error", (err) => {
      console.error(
        `[Auth Proxy] ${req.method} ${req.originalUrl} → ${FLASK_BACKEND_URL} failed:`,
        err.message,
      );
      if (!res.headersSent) {
        res.status(502).json({
          error: "Auth service unavailable",
          detail:
            "Could not reach the Flask authentication backend. " +
            "Make sure it is running on " +
            FLASK_BACKEND_URL,
        });
      }
    });

    // Stream the raw request body through to Flask.
    // This middleware is mounted BEFORE express.json() so the body
    // stream has not been consumed.
    req.pipe(proxyReq, { end: true });
  };
}
