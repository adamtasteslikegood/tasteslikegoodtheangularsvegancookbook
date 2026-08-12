/**
 * Valkey configuration factory — single source of truth for the Express side.
 *
 * Every Valkey-related env var is read here and nowhere else. Consumers
 * (`valkey.ts` for the connection, `security.ts` for the rate-limiter stores)
 * import typed config from this module instead of reading env vars directly.
 *
 * KAN-160: this replaces the pattern where valkey.ts read VALKEY_HOST/PORT/
 * AUTH_MODE/CA_CERT/TLS_INSECURE inline and security.ts hardcoded the
 * rate-limit key prefixes in each limiter constructor. A config detail
 * changing in one place but not the other caused repeated production incidents.
 *
 * Flask-side equivalent: Backend/utils/valkey_config.py — the config factory
 * being added in a Backend PR for KAN-160 (in flight). Backend/utils/
 * valkey_auth.py is the IAM-token auth utility, not a config factory.
 */

/** Connection-level configuration for the Valkey/Redis client. */
export interface ValkeyConnectionConfig {
  /** Valkey/Redis host. Null means Valkey is not configured (use in-memory). */
  host: string | null;
  /** Valkey/Redis port (default 6379). */
  port: number;
  /** Authentication mode: 'iam' for GCP Memorystore IAM auth, undefined for none. */
  authMode: 'iam' | undefined;
  /** PEM CA cert for Memorystore's Google-managed private CA (TLS verification). */
  caCert: string | undefined;
  /** Disable TLS certificate verification (dev/local only). */
  tlsInsecure: boolean;
}

/** Default Valkey/Redis port, used when VALKEY_PORT is unset or invalid. */
export const DEFAULT_VALKEY_PORT = 6379;

/**
 * Validate VALKEY_PORT. A NaN or out-of-range port must not slip through:
 * ioredis would fail to connect and Express would silently fall back to
 * MemoryStore — the exact silent-degradation class KAN-160 exists to kill.
 * Invalid values are loudly logged and replaced with the explicit default.
 *
 * Exported for unit testing (valkey-config.test.ts).
 */
export function resolveValkeyPort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_VALKEY_PORT;
  // Number() (not parseInt) so trailing garbage like "6379abc" is rejected
  // instead of silently truncated.
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    console.warn(
      `[ValkeyConfig] Invalid VALKEY_PORT ${JSON.stringify(raw)} — ` +
        `must be an integer between 1 and 65535. Using default ${DEFAULT_VALKEY_PORT}.`
    );
    return DEFAULT_VALKEY_PORT;
  }
  return parsed;
}

/**
 * Resolve Valkey connection config from environment variables.
 *
 * Env vars consumed (read HERE, not by callers):
 *   VALKEY_HOST       — required for Valkey; unset = in-memory fallback
 *   VALKEY_PORT       — default 6379; non-numeric/out-of-range values are
 *                       logged and replaced with the default (never NaN)
 *   VALKEY_AUTH_MODE  — 'iam' for GCP Memorystore
 *   VALKEY_CA_CERT    — PEM for Memorystore's private CA
 *   VALKEY_TLS_INSECURE — 'true' disables cert verification (dev only)
 */
export function resolveValkeyConfig(): ValkeyConnectionConfig {
  const host = process.env.VALKEY_HOST || null;
  const port = resolveValkeyPort(process.env.VALKEY_PORT);
  const rawAuthMode = process.env.VALKEY_AUTH_MODE;
  const authMode = rawAuthMode === 'iam' ? 'iam' : undefined;
  const caCert = process.env.VALKEY_CA_CERT || undefined;
  const tlsInsecure = process.env.VALKEY_TLS_INSECURE === 'true';

  return { host, port, authMode, caCert, tlsInsecure };
}

/**
 * Rate-limit key prefixes — one per limiter, all defined here so they
 * cannot collide or be silently changed in a single limiter's constructor.
 *
 * KAN-154: previously the API and page limiters shared the `rl:api:` prefix
 * because both were built from createApiLimiter, so ordinary browsing
 * exhausted the budget for /api/* on the same IP.
 */
export const RATE_LIMIT_PREFIXES = {
  /** General API rate limiter (/api/*) */
  api: 'rl:api:',
  /** Public HTML surface rate limiter (SPA shell, SSR pages) */
  page: 'rl:page:',
  /** Expensive AI operations rate limiter (/api/generate, /api/generate_image) */
  expensive: 'rl:expensive:',
} as const;
