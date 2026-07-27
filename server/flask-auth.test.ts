/**
 * Tests for server/flask-auth.ts and the proxy's auth-header discipline (KAN-170).
 *
 * Context: flask-backend was anonymously invokable from the public internet for
 * ~4.6 months because run.googleapis.com/invoker-iam-disabled=true silently
 * voided cloudbuild.yaml's --no-allow-unauthenticated. Turning the invoker check
 * back on requires Express to authenticate, and these tests pin the three
 * properties that make that cutover safe:
 *
 *   1. The audience is the bare origin. A trailing slash or a path yields an
 *      audience Cloud Run does not recognise, which would 401 the entire site.
 *   2. The token travels in X-Serverless-Authorization, leaving the client's
 *      Authorization header untouched — Flask reads that header for
 *      require_admin (/api/admin/*) and require_pubsub_oidc (/api/worker/*).
 *   3. A client cannot inject its own X-Serverless-Authorization.
 *
 * flask-auth.js is imported STATICALLY on purpose: v8 does not attribute
 * coverage to modules pulled in via vi.resetModules() + dynamic import, so a
 * dynamically-imported module contributes nothing to the coverage gate and
 * silently drops out of the report entirely.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFlaskAudience, getFlaskAuthHeader, resetFlaskAuthForTests } from './flask-auth.js';

// Placeholder hosts only. The real flask-backend hostname is deliberately kept
// out of tracked files: both repos are public and the project number in
// cloudbuild.yaml already makes the URL derivable (KAN-170 / KAN-171).
const RUN_APP_URL = 'https://flask-backend-xyz.a.run.app';

const { getIdTokenClient } = vi.hoisted(() => ({ getIdTokenClient: vi.fn() }));

vi.mock('google-auth-library', () => ({
  // Must be a regular function (not an arrow) to support `new GoogleAuth()`.
  GoogleAuth: vi.fn(function GoogleAuthImpl() {
    return { getIdTokenClient };
  }),
}));

/** Make the mocked client hand back a working token. */
function authSucceeds(token = 'test-id-token') {
  getIdTokenClient.mockResolvedValue({
    getRequestHeaders: vi.fn().mockResolvedValue(new Headers({ authorization: `Bearer ${token}` })),
  });
}

/** Make the mocked client fail, as it does off-GCP with no metadata server. */
function authFails(message = 'metadata server unreachable') {
  getIdTokenClient.mockRejectedValue(new Error(message));
}

const originalFlaskUrl = process.env.FLASK_BACKEND_URL;

afterEach(() => {
  resetFlaskAuthForTests();
  getIdTokenClient.mockReset();
  vi.restoreAllMocks();
  if (originalFlaskUrl === undefined) delete process.env.FLASK_BACKEND_URL;
  else process.env.FLASK_BACKEND_URL = originalFlaskUrl;
});

describe('getFlaskAudience', () => {
  it('returns the bare origin for a run.app URL', () => {
    process.env.FLASK_BACKEND_URL = RUN_APP_URL;
    expect(getFlaskAudience()).toBe(RUN_APP_URL);
  });

  it('strips a trailing slash', () => {
    // A trailing slash here would mint aud="https://.../" and Cloud Run would
    // reject every proxied request with a 401 — a total outage, with no
    // validation anywhere else in the stack to catch it.
    process.env.FLASK_BACKEND_URL = `${RUN_APP_URL}/`;
    expect(getFlaskAudience()).toBe(RUN_APP_URL);
  });

  it('strips a path and query string', () => {
    process.env.FLASK_BACKEND_URL = `${RUN_APP_URL}/api/worker/recipe?x=1`;
    expect(getFlaskAudience()).toBe(RUN_APP_URL);
  });

  it('returns null for local development over http', () => {
    process.env.FLASK_BACKEND_URL = 'http://localhost:5000';
    expect(getFlaskAudience()).toBeNull();
  });

  it('returns null when FLASK_BACKEND_URL is unset (defaults to localhost)', () => {
    delete process.env.FLASK_BACKEND_URL;
    expect(getFlaskAudience()).toBeNull();
  });

  it('returns null for a custom domain, which Cloud Run rejects as an audience', () => {
    process.env.FLASK_BACKEND_URL = 'https://www.tasteslikegood.org';
    expect(getFlaskAudience()).toBeNull();
  });

  it('returns null for a malformed URL', () => {
    process.env.FLASK_BACKEND_URL = 'not a url';
    expect(getFlaskAudience()).toBeNull();
  });
});

describe('getFlaskAuthHeader', () => {
  it('returns a Bearer header minted for the service origin', async () => {
    process.env.FLASK_BACKEND_URL = RUN_APP_URL;
    authSucceeds();

    expect(await getFlaskAuthHeader()).toBe('Bearer test-id-token');
    expect(getIdTokenClient).toHaveBeenCalledWith(RUN_APP_URL);
  });

  it('derives the audience from a URL with a trailing slash', async () => {
    process.env.FLASK_BACKEND_URL = `${RUN_APP_URL}/`;
    authSucceeds();

    await getFlaskAuthHeader();
    expect(getIdTokenClient).toHaveBeenCalledWith(RUN_APP_URL);
  });

  it('reuses one client across calls instead of re-minting per request', async () => {
    process.env.FLASK_BACKEND_URL = RUN_APP_URL;
    authSucceeds();

    await getFlaskAuthHeader();
    await getFlaskAuthHeader();
    await getFlaskAuthHeader();

    // createFlaskProxy is called twice (API + SSR) and this runs on every
    // proxied request; a client per call would mean a metadata round-trip per
    // request instead of a cache hit.
    expect(getIdTokenClient).toHaveBeenCalledOnce();
  });

  it('mints a new client when the audience changes', async () => {
    authSucceeds();
    process.env.FLASK_BACKEND_URL = RUN_APP_URL;
    await getFlaskAuthHeader();
    process.env.FLASK_BACKEND_URL = 'https://flask-backend-other.a.run.app';
    await getFlaskAuthHeader();

    expect(getIdTokenClient).toHaveBeenCalledTimes(2);
  });

  it('returns null without calling GCP when the target is localhost', async () => {
    process.env.FLASK_BACKEND_URL = 'http://localhost:5000';
    authSucceeds();

    expect(await getFlaskAuthHeader()).toBeNull();
    // `npm run dev` has no metadata server; it must not pay a probe timeout.
    expect(getIdTokenClient).not.toHaveBeenCalled();
  });

  it('returns null and logs once when minting fails, rather than throwing', async () => {
    process.env.FLASK_BACKEND_URL = RUN_APP_URL;
    authFails();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await getFlaskAuthHeader()).toBeNull();
    // Second failure inside the throttle window must not re-log.
    expect(await getFlaskAuthHeader()).toBeNull();

    expect(errorSpy).toHaveBeenCalledOnce();
    // The log has to name the consequence, or a 403 storm after cutover looks
    // like a Cloud Run problem rather than a token problem.
    expect(errorSpy.mock.calls[0][0]).toContain('403');
  });

  it('retries after a failure instead of caching the rejection forever', async () => {
    process.env.FLASK_BACKEND_URL = RUN_APP_URL;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    authFails();
    expect(await getFlaskAuthHeader()).toBeNull();

    authSucceeds('recovered-token');
    expect(await getFlaskAuthHeader()).toBe('Bearer recovered-token');
  });
});

// The proxy-level header assertions live in server/proxy-auth.test.ts. They
// need vi.resetModules() (proxy.ts reads FLASK_BACKEND_URL at import time), and
// calling that anywhere in THIS file drops flask-auth.ts out of the v8 coverage
// report entirely — including the statically-imported instance above.
