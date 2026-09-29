import express, { type Request, type Response, type Router } from 'express';
import type { RequestHandler } from 'express';

/**
 * Datadog RUM plumbing (KAN-292 / RCP-101): runtime config + same-origin
 * intake proxy. The consent gate itself lives in public/rum/consent.js.
 *
 * Why a proxy: server/security.ts pins `connect-src 'self'`. Routing the SDK's
 * beacons through `/rum/intake` (the SDK's documented `proxy` option) keeps it
 * that way — no Datadog host is ever added to the CSP.
 *
 * Why it is strict: an unvalidated forwarder is an open relay for anyone's
 * Datadog org. So it forwards to exactly one host, one path, and only batches
 * carrying OUR client token; everything else is refused before any fetch.
 *
 * Configuration (env, never hardcoded; all optional — unset means RUM off):
 *   DATADOG_RUM_APPLICATION_ID      RUM application id (us5, RUM Measure)
 *   DATADOG_RUM_CLIENT_TOKEN        RUM client token (public-ish, still config)
 *   DATADOG_RUM_SESSION_SAMPLE_RATE 0-100, default 100 — the cost lever
 *   DATADOG_RUM_ENV                 default: 'staging' under NODE_ENV=staging, else 'production'
 *   DATADOG_RUM_SERVICE             default 'tasteslikegood-web'
 *
 * Not `DD_*`: dd-trace and serverless-init own that namespace in this image.
 */

/** The only host the proxy will ever talk to: Datadog's us5 browser intake. */
export const RUM_INTAKE_ORIGIN = 'https://browser-intake-us5-datadoghq.com';
/** The only intake path the proxy forwards (RUM events; no replay, no logs). */
export const RUM_INTAKE_PATH = '/api/v2/rum';
/** Largest batch accepted. The SDK caps a single message well below this. */
export const RUM_MAX_BODY = '512kb';
const UPSTREAM_TIMEOUT_MS = 10_000;

export interface RumConfig {
  enabled: true;
  applicationId: string;
  clientToken: string;
  sessionSampleRate: number;
  env: string;
  service: string;
  version: string;
}

/** Resolve RUM config from the environment; null when RUM is not configured. */
export function resolveRumConfig(
  env: Record<string, string | undefined> = process.env,
  version = '0.0.0'
): RumConfig | null {
  const applicationId = (env.DATADOG_RUM_APPLICATION_ID || '').trim();
  const clientToken = (env.DATADOG_RUM_CLIENT_TOKEN || '').trim();
  if (!applicationId || !clientToken) return null;
  const rawRate = Number.parseFloat(env.DATADOG_RUM_SESSION_SAMPLE_RATE ?? '');
  const sessionSampleRate = Number.isFinite(rawRate) ? Math.min(100, Math.max(0, rawRate)) : 100;
  return {
    enabled: true,
    applicationId,
    clientToken,
    sessionSampleRate,
    env:
      (env.DATADOG_RUM_ENV || '').trim() || (env.NODE_ENV === 'staging' ? 'staging' : 'production'),
    service: (env.DATADOG_RUM_SERVICE || '').trim() || 'tasteslikegood-web',
    version,
  };
}

/**
 * Validate the SDK's `ddforward` parameter and build the upstream URL, or
 * return null. Accepts only `/api/v2/rum?...` on the us5 intake, and only when
 * `dd-api-key` equals our configured client token.
 *
 * Exported for unit testing.
 */
export function buildUpstreamUrl(query: Request['query'], clientToken: string): string | null {
  const forward = query.ddforward;
  if (typeof forward !== 'string' || !forward.startsWith(`${RUM_INTAKE_PATH}?`)) return null;
  // Subdomain forwarding (remote configuration) is never used here.
  if (query.ddforwardSubdomain !== undefined) return null;
  let upstream: URL;
  try {
    upstream = new URL(forward, RUM_INTAKE_ORIGIN);
  } catch {
    return null;
  }
  if (upstream.origin !== RUM_INTAKE_ORIGIN || upstream.pathname !== RUM_INTAKE_PATH) return null;
  // Reject ambiguous duplicates: different URL parsers may choose the first or
  // last value, which could otherwise bypass the single-org relay boundary.
  const apiKeys = upstream.searchParams.getAll('dd-api-key');
  if (apiKeys.length !== 1 || apiKeys[0] !== clientToken) return null;
  // Rebuild from constants so only the query string is caller-supplied.
  const safe = new URL(RUM_INTAKE_PATH, RUM_INTAKE_ORIGIN);
  safe.search = upstream.search;
  return safe.href;
}

export interface RumRouterOptions {
  config: RumConfig | null;
  /**
   * Rate limiter for both RUM routes (own `rl:rum:` keyspace). /rum/config is
   * hit once per page load, so sharing the RUM budget keeps it off the page
   * limiter while still capping a client that bypasses the cache.
   */
  intakeLimiter: RequestHandler;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export function createRumRouter({
  config,
  intakeLimiter,
  fetchImpl = fetch,
}: RumRouterOptions): Router {
  const router = express.Router();

  // Public runtime config for the consent loader. Short cache: the loader asks
  // on every page, and a sample-rate change should land within minutes.
  router.get('/rum/config', intakeLimiter, (_req: Request, res: Response) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(config ?? { enabled: false });
  });

  router.all('/rum/intake', intakeLimiter, (req, res, next) => {
    if (!config) {
      res.status(404).end();
      return;
    }
    if (req.method !== 'POST') {
      res.set('Allow', 'POST').status(405).end();
      return;
    }
    next();
  });

  router.post(
    '/rum/intake',
    // The SDK posts text/plain (fetch keepalive and sendBeacon), deflate-encoded
    // bytes when compression is on; accept any type, but only on this route.
    express.raw({ type: () => true, limit: RUM_MAX_BODY }),
    async (req: Request, res: Response) => {
      const upstreamUrl = buildUpstreamUrl(req.query, config!.clientToken);
      if (!upstreamUrl) {
        res.status(400).end();
        return;
      }
      const headers: Record<string, string> = {
        'Content-Type': req.get('content-type') || 'text/plain;charset=UTF-8',
      };
      // Datadog derives geo/IP attributes from X-Forwarded-For when proxied.
      if (req.ip) headers['X-Forwarded-For'] = req.ip;
      try {
        const upstream = await fetchImpl(upstreamUrl, {
          method: 'POST',
          headers,
          body: new Uint8Array(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)),
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
        // This proxy relays only the status. Release any Datadog response body
        // so Undici can reuse the connection instead of retaining a socket.
        try {
          await upstream.body?.cancel();
        } catch {
          // A body-cleanup failure must not replace the upstream status.
        }
        res.status(upstream.status).end();
      } catch (err) {
        console.warn('[rum] intake forward failed:', err instanceof Error ? err.name : 'error');
        res.status(502).end();
      }
    }
  );

  return router;
}
