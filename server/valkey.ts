/**
 * Valkey/Redis client for Express rate limiting.
 *
 * Supports GCP Memorystore IAM authentication with automatic token refresh.
 * Falls back gracefully to null (caller uses in-memory store) when Valkey
 * is unavailable or VALKEY_HOST is not set.
 *
 * Mirrors the pattern in Backend/utils/valkey_auth.py.
 */

import Redis, { type RedisOptions } from 'ioredis';
import { GoogleAuth } from 'google-auth-library';

// Token refresh interval (45 min — tokens last 60 min, refresh early)
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
 */
export async function createValkeyClient(): Promise<Redis | null> {
  const host = process.env.VALKEY_HOST;
  if (!host) {
    console.log('[Valkey] VALKEY_HOST not set — using in-memory rate limiting');
    return null;
  }

  // Guard: reuse an already-healthy client instead of creating a second one
  if (client) {
    try {
      await client.ping();
      return client;
    } catch {
      // Existing client is unhealthy — tear it down before reinitializing
      console.warn('[Valkey] Existing client unhealthy, reinitializing...');
      await shutdownValkey();
    }
  }

  const port = parseInt(process.env.VALKEY_PORT || '6379', 10);
  const authMode = process.env.VALKEY_AUTH_MODE;

  try {
    const options: Record<string, unknown> = {
      host,
      port,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times: number) => Math.min(times * 200, 5000),
    };

    if (authMode === 'iam') {
      const { token, email } = await getIAMToken();
      const tlsOptions: Record<string, unknown> = {};
      if (process.env.VALKEY_TLS_INSECURE === 'true') {
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
    console.log(`✅ Valkey connected for rate limiting at ${host}:${port}`);

    // Start periodic token refresh for IAM auth
    if (authMode === 'iam') {
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
    client = null;
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
 */
export async function shutdownValkey(): Promise<void> {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (client) {
    await client.quit();
    client = null;
  }
}
