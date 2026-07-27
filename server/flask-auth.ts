/**
 * Google-signed ID tokens for authenticating Express → Flask calls (KAN-170).
 *
 * Why this exists:
 *   flask-backend runs with ingress=all. It was ALSO running with the
 *   annotation run.googleapis.com/invoker-iam-disabled=true, which switches
 *   Cloud Run's invoker IAM check off wholesale — so the service accepted
 *   unauthenticated requests from the public internet, and POST /api/generate
 *   billed Gemini/Imagen for anonymous callers. cloudbuild.yaml's
 *   --no-allow-unauthenticated could never fix that: it edits the IAM policy,
 *   and the annotation bypasses IAM entirely.
 *
 *   Closing it means turning the invoker check back on, which in turn means
 *   Express has to prove who it is. This module mints the proof: a Google-signed
 *   ID token whose audience is the Flask service URL. Cloud Run validates it at
 *   the edge, before the request ever reaches the container.
 *
 * Caching:
 *   google-auth-library's IdTokenClient caches the token and decodes its JWT
 *   `exp`, refetching only inside a 5-minute eager-refresh threshold. So calling
 *   getFlaskAuthHeader() per request is a cache hit in steady state, not a
 *   metadata-server round-trip. That is deliberately NOT the hand-rolled
 *   setInterval pattern in valkey.ts — that one is right for Valkey's stateful
 *   AUTH command, but here it would add a refresh timer to leak across SIGTERM
 *   for no benefit.
 */

import { GoogleAuth, type IdTokenClient } from 'google-auth-library';

/** Throttle for the failure log so a broken metadata path can't flood logs. */
const FAILURE_LOG_INTERVAL_MS = 60_000;

/**
 * Memoized client, keyed by audience. Keyed rather than a bare singleton so the
 * env var is read lazily instead of at import time: that removes the
 * import-order footgun proxy.ts has (tests must set FLASK_BACKEND_URL before
 * importing it) and lets this module be unit-tested through a normal static
 * import — which matters, because v8 does not attribute coverage to modules
 * loaded via vi.resetModules() + dynamic import, so a dynamically-imported
 * module silently contributes nothing to the coverage gate.
 */
let cached: { audience: string; client: Promise<IdTokenClient> } | null = null;
let lastFailureLoggedAt = 0;

/**
 * Resolve the ID-token audience for a Flask backend URL, or null when token
 * auth does not apply (local dev against http://localhost:5000).
 *
 * Returns `origin` rather than the raw string on purpose: it strips any path,
 * query, and trailing slash. A trailing slash would produce an audience of
 * "https://host/" and Cloud Run would reject every request with a 401 — and
 * nothing else in the stack validates the shape of FLASK_BACKEND_URL.
 *
 * Only *.run.app over https gets a token. Cloud Run does not accept a custom
 * domain as an audience value, and checking the URL here avoids paying
 * google-auth-library's multi-second metadata probe on every local dev request.
 */
export function resolveFlaskAudience(rawUrl: string): string | null {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return null;
  }
  if (target.protocol !== 'https:') return null;
  if (target.hostname !== 'run.app' && !target.hostname.endsWith('.run.app')) return null;
  return target.origin;
}

/** The audience this process mints tokens for, or null when auth is disabled. */
export function getFlaskAudience(): string | null {
  return resolveFlaskAudience(process.env.FLASK_BACKEND_URL || 'http://localhost:5000');
}

/**
 * Returns the value for an Authorization-style header ("Bearer <id-token>"),
 * or null when ID-token auth is disabled or the token could not be minted.
 *
 * Never throws. A mint failure returns null so the proxy still forwards the
 * request: while the invoker check is disabled, Flask accepts the call and the
 * site keeps working; once it is enabled, Cloud Run answers 403 and the
 * throttled error below is the breadcrumb explaining why.
 */
export async function getFlaskAuthHeader(): Promise<string | null> {
  const audience = getFlaskAudience();
  if (!audience) return null;

  try {
    if (!cached || cached.audience !== audience) {
      const auth = new GoogleAuth();
      cached = { audience, client: auth.getIdTokenClient(audience) };
    }
    const client = await cached.client;
    const headers = await client.getRequestHeaders();
    return headers.get('authorization');
  } catch (err) {
    // Drop the memoized client so the next request retries rather than
    // reusing a rejected promise forever.
    cached = null;
    const now = Date.now();
    if (now - lastFailureLoggedAt > FAILURE_LOG_INTERVAL_MS) {
      lastFailureLoggedAt = now;
      console.error(
        `[FlaskAuth] Could not mint an ID token (audience=${audience}): ` +
          `${(err as Error).message}. Requests are being forwarded WITHOUT ` +
          `Authorization — Cloud Run will reject them with 403 once the ` +
          `invoker IAM check is enabled on flask-backend.`
      );
    }
    return null;
  }
}

/** Test-only: clear the memoized client and the failure-log throttle. */
export function resetFlaskAuthForTests(): void {
  cached = null;
  lastFailureLoggedAt = 0;
}
