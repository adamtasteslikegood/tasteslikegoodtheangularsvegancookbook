/**
 * Valkey/Redis client for Express rate limiting.
 *
 * Supports GCP Memorystore IAM authentication with automatic token refresh.
 * Falls back gracefully to null (caller uses in-memory store) when Valkey
 * is unavailable or VALKEY_HOST is not set.
 *
 * Connection config is read from `valkey-config.ts` (KAN-160) — never from
 * env vars directly. See that module for the full list of env vars consumed.
 */

import { Redis, type RedisOptions } from 'ioredis';
import { GoogleAuth } from 'google-auth-library';
import { resolveValkeyConfig } from './valkey-config.js';

// Token refresh interval (45 min — tokens last 60 min, 15-min buffer prevents
// expiry under clock skew or delayed refresh execution)
const TOKEN_REFRESH_INTERVAL_MS = 45 * 60 * 1000;

let client: Redis | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Obtain a fresh IAM access token from the default service account.
 */
async function getIAMToken(): Promise<{ token: string; email: string }> {
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const credentials = await auth.getClient();
  const accessToken = await credentials.getAccessToken();
  if (!accessToken.token) {
    throw new Error('Failed to obtain IAM access token');
  }
  // Service account email for logging
  const email = (credentials as { email?: string }).email || 'unknown';
  return { token: accessToken.token, email };
}

/**
 * Refresh the IAM token on the existing ioredis client.
 *
 * ioredis maintains a single connection — we re-authenticate it with AUTH
 * and update options.password so reconnections use the new token.
 */
async function refreshTokenInPlace(): Promise<void> {
  if (!client) return;

  const { token, email } = await getIAMToken();

  // Update stored options for future reconnections
  client.options.password = token;

  // Re-authenticate the live connection (password-only, no username)
  await client.call('AUTH', token);

  console.log(`[Valkey] IAM token refreshed (sa=${email})`);
}

/**
 * Create and return a Valkey/Redis client for rate limiting.
 *
 * Returns null if VALKEY_HOST is not set or the connection fails,
 * allowing the caller to fall back to in-memory rate limiting.
 *
 * Guards against double-initialization: if a healthy client already exists,
 * it is returned immediately. If the existing client is unhealthy it is torn
 * down via shutdownValkey() before a fresh one is created.
 *
 * If VALKEY_HOST is unset and a client from a previous call is still alive
 * (e.g. the env var was removed between calls), it is shut down before
 * returning null so no handles are left dangling.
 */
export async function createValkeyClient(): Promise<Redis | null> {
  // KAN-160: all env-var reading is centralized in valkey-config.ts.
  const config = resolveValkeyConfig();

  if (!config.host) {
    // If a client exists from a previous call but VALKEY_HOST has since been
    // removed, tear it down to avoid leaking handles (e.g. in tests / dev).
    if (client) {
      console.warn('[Valkey] VALKEY_HOST removed — shutting down existing client');
      try {
        await shutdownValkey();
      } catch (err) {
        console.error('[Valkey] Shutdown failed during cleanup:', (err as Error).message);
      }
    }
    console.log('[Valkey] VALKEY_HOST not set — using in-memory rate limiting');
    return null;
  }

  // Guard: reuse an already-healthy client instead of creating a second one
  if (client) {
    try {
      await client.ping();
      return client;
    } catch {
      // Existing client is unhealthy — tear it down before reinitializing.
      // Catch shutdown errors so a broken quit() cannot prevent reinitialization.
      console.warn('[Valkey] Existing client unhealthy, reinitializing...');
      try {
        await shutdownValkey();
      } catch (err) {
        console.error('[Valkey] Shutdown failed during reinit:', (err as Error).message);
      }
    }
  }

  try {
    const options: Record<string, unknown> = {
      host: config.host,
      port: config.port,
      // ── RESP3 (ioredis 6's default) — the old RESP2 pin is gone (KAN-260) ──
      //
      // Under RESP3 ioredis authenticates via HELLO, and with a password-only
      // credential it injects the username `default`:
      // `HELLO 3 AUTH default <password>` (built/redis/event_handler.js:22).
      // That deviates from the form Google documents for Memorystore IAM auth —
      // "don't use either a username or service account name ... the
      // authentication uses the access token directly", CLI example
      // `valkey-cli -h HOST -p PORT -a ACCESS_TOKEN`, no `--user`. The pin
      // existed because a refused handshake would NOT fall back to RESP2
      // (ioredis' isProtocolNegotiationError only matches NOPROTO /
      // unknown-command), so every replica would have silently degraded to
      // in-memory rate limiting — on the limiter metering paid Gemini/Imagen.
      //
      // KAN-260 settled it on 2026-08-31 against `veganchef-valkeymem-test`, a
      // copy of the production instance (Valkey 8.0.6, IAM_AUTH,
      // SERVER_AUTHENTICATION TLS) one maintenance version ahead of prod:
      //   - `HELLO 3 AUTH default <iam-token>` returns the RESP3 map (proto 3).
      //     Memorystore accepts `default` + an IAM access token.
      //   - Password-only `AUTH <token>` returns OK on a connection that already
      //     negotiated RESP3, so refreshTokenInPlace() below needs no change.
      //   - ioredis 6.0.0 + rate-limit-redis 6.0.1 against that instance behave
      //     identically on protocol 2 and 3: same EVAL reply shape, CLIENT INFO
      //     reports `resp=3 user=default`, increments survive a token refresh.
      // Controls proving the test discriminates: a wrong password returns
      // WRONGPASS, no auth returns NOAUTH.
      //
      // LOAD-BEARING: `default` is the ONLY username Memorystore's IAM module
      // accepts — `HELLO 3 AUTH someotheruser <token>` returns
      // `ERR (ERR_IAM_OTHER) Memorystore IAM authentication backend error`. It
      // works only because ioredis happens to inject exactly that literal. If a
      // future ioredis changes the injected username, or this code starts
      // passing an explicit `username`, the handshake breaks with no fallback.
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times: number) => Math.min(times * 200, 5000),
    };

    if (config.authMode === 'iam') {
      const { token, email } = await getIAMToken();
      const tlsOptions: Record<string, unknown> = {};
      // Memorystore server certs chain to a Google-managed private CA that the
      // system trust store can't verify — trust it explicitly via VALKEY_CA_CERT.
      if (config.caCert) {
        tlsOptions.ca = config.caCert;
      }
      if (config.tlsInsecure) {
        tlsOptions.rejectUnauthorized = false;
        console.warn(
          '[Valkey] WARNING: VALKEY_TLS_INSECURE=true — TLS certificate verification is DISABLED. Use only for local/dev.'
        );
      }
      Object.assign(options, {
        password: token,
        tls: tlsOptions,
      });
      console.log(`[Valkey] Using IAM auth (sa=${email})`);
    }

    client = new Redis(options as RedisOptions);

    // Verify the connection works
    await client.ping();
    console.log(`✅ Valkey connected for rate limiting at ${config.host}:${config.port}`);

    // Start periodic token refresh for IAM auth
    if (config.authMode === 'iam') {
      refreshTimer = setInterval(async () => {
        try {
          await refreshTokenInPlace();
        } catch (err) {
          console.error('[Valkey] Token refresh failed (will retry next cycle):', err);
        }
      }, TOKEN_REFRESH_INTERVAL_MS);

      console.log(
        `✅ Started Valkey token refresh for rate limiter (every ${TOKEN_REFRESH_INTERVAL_MS / 60000}min)`
      );
    }

    // Handle connection errors gracefully — log but don't crash
    client.on('error', (err) => {
      console.error('[Valkey] Connection error:', err.message);
    });

    return client;
  } catch (err) {
    console.error('[Valkey] Connection failed, falling back to in-memory rate limiting:', err);
    try {
      await shutdownValkey();
    } catch (shutdownErr) {
      console.error('[Valkey] Shutdown failed during fallback:', (shutdownErr as Error).message);
    }
    return null;
  }
}

/**
 * Get the current Valkey client (may be null if not connected).
 */
export function getValkeyClient(): Redis | null {
  return client;
}

/**
 * Gracefully shut down the Valkey client and stop token refresh.
 *
 * quit() is raced against a 3-second timeout so a broken or unresponsive
 * Valkey connection cannot block Cloud Run's 10-second shutdown window.
 * On timeout, disconnect() is called to force-close the TCP socket.
 */
export async function shutdownValkey(): Promise<void> {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (client) {
    const closing = client;
    client = null; // Null out before await so concurrent calls don't double-quit
    try {
      await Promise.race([
        closing.quit(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Valkey quit timed out after 3s')), 3000)
        ),
      ]);
    } catch (err) {
      console.error('[Valkey] Shutdown timeout — forcing disconnect:', (err as Error).message);
      closing.disconnect();
    }
  }
}
