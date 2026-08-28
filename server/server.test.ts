import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express, NextFunction, Request, Response } from 'express';

// ── Hoisted mock factories ─────────────────────────────────────────────────
// vi.hoisted() runs before vi.mock() factories so these references are safe
// to capture inside the ioredis / google-auth-library mock factories below.

const { MockRedis } = vi.hoisted(() => {
  const mockRedisInstance = {
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: vi.fn().mockResolvedValue('OK'),
    call: vi.fn().mockResolvedValue('OK'),
    on: vi.fn(),
    options: {} as Record<string, unknown>,
  };
  // Must be a regular function (not arrow) so it can be called with `new`
  const MockRedis = vi.fn(function MockRedisImpl() {
    return mockRedisInstance;
  });
  return { MockRedis };
});

// ── Module mocks ───────────────────────────────────────────────────────────

// Mock ioredis so tests never open real TCP connections
vi.mock('ioredis', () => ({ default: MockRedis, Redis: MockRedis }));

// Mock google-auth-library so tests never call GCP IAM APIs.
// GoogleAuth must be a regular function (not arrow) to support `new GoogleAuth()`.
vi.mock('google-auth-library', () => ({
  GoogleAuth: vi.fn(function GoogleAuthImpl() {
    return {
      getClient: vi.fn().mockResolvedValue({
        getAccessToken: vi.fn().mockResolvedValue({ token: 'test-iam-token' }),
        email: 'test@project.iam.gserviceaccount.com',
      }),
    };
  }),
}));

// Mock rate-limit-redis so tests that pass a non-null Valkey client to
// createApiLimiter / createExpensiveOperationLimiter never open real sockets.
vi.mock('rate-limit-redis', () => ({
  default: vi.fn(function RedisStoreMock() {
    return {
      increment: vi.fn().mockResolvedValue({ totalHits: 1, resetTime: new Date() }),
      decrement: vi.fn().mockResolvedValue(undefined),
      resetKey: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

// Security middleware factory tests

describe('createApiLimiter', () => {
  it('should return a middleware function', async () => {
    const { createApiLimiter } = await import('./security.js');
    const limiter = createApiLimiter();
    expect(typeof limiter).toBe('function');
  });

  it('should accept custom windowMs and max parameters', async () => {
    const { createApiLimiter } = await import('./security.js');
    const limiter = createApiLimiter(null, 5000, 10);
    expect(typeof limiter).toBe('function');
  });
});

describe('shouldSkipRateLimiting', () => {
  it('skips /health', async () => {
    const { shouldSkipRateLimiting } = await import('./security.js');
    const req = { path: '/health' } as Request;
    expect(shouldSkipRateLimiting(req)).toBe(true);
  });

  it('skips /recipes/<uuid>/image', async () => {
    const { shouldSkipRateLimiting } = await import('./security.js');
    const req = { path: '/recipes/550e8400-e29b-41d4-a716-446655440000/image' } as Request;
    expect(shouldSkipRateLimiting(req)).toBe(true);
  });

  it('skips /recipes/<short-id>/image', async () => {
    const { shouldSkipRateLimiting } = await import('./security.js');
    const req = { path: '/recipes/abc123/image' } as Request;
    expect(shouldSkipRateLimiting(req)).toBe(true);
  });

  it('does not skip /recipes (list endpoint)', async () => {
    const { shouldSkipRateLimiting } = await import('./security.js');
    const req = { path: '/recipes' } as Request;
    expect(shouldSkipRateLimiting(req)).toBe(false);
  });

  it('does not skip /generate', async () => {
    const { shouldSkipRateLimiting } = await import('./security.js');
    const req = { path: '/generate' } as Request;
    expect(shouldSkipRateLimiting(req)).toBe(false);
  });

  it('does not skip /recipes/<uuid>/data (non-image sub-paths)', async () => {
    const { shouldSkipRateLimiting } = await import('./security.js');
    const req = { path: '/recipes/550e8400-e29b-41d4-a716-446655440000/data' } as Request;
    expect(shouldSkipRateLimiting(req)).toBe(false);
  });
});

// KAN-154: a browser fires these on its own for every page view — the SSR
// stylesheets, the icon set, Angular's hashed bundles. Metering them made one
// page view cost ~8 requests against a 300/15min per-IP budget, so two people
// behind one NAT'd IP hit 429 during ordinary browsing. They are static bytes;
// the limiter exists to protect Flask and the AI endpoints.
describe('isPageSubresource', () => {
  const subresources = [
    '/static/css/tokens.css',
    '/static/css/recipe-site.css',
    '/static/js/public.js',
    '/favicon.ico',
    '/favicon.svg',
    '/apple-touch-icon.png',
    '/apple-touch-icon-precomposed.png',
    '/styles-VFQLW5EH.css',
    '/main-GTOZZOJH.js',
    '/chunk-UORTPREJ.js',
    // Angular emits bundle requests relative to the current route, so the
    // same asset also arrives under a route prefix.
    '/recipe/styles-VFQLW5EH.css',
    '/recipe/chunk-CSQ5XSFZ.js',
  ];

  for (const path of subresources) {
    it(`treats ${path} as a subresource`, async () => {
      const { isPageSubresource } = await import('./security.js');
      expect(isPageSubresource({ path } as Request)).toBe(true);
    });
  }

  // Real navigations must keep counting — exempting these would remove the
  // rate limit from the public surface entirely.
  const pages = [
    '/',
    '/browse',
    '/kitchen',
    '/privacy-policy',
    '/sitemap.xml',
    '/r/vegan-baked-blooming-onion-with-zesty-dip',
    '/recipe/db958616-04b4-495f-a67b-34b0760dc97a',
  ];

  for (const path of pages) {
    it(`does not treat ${path} as a subresource`, async () => {
      const { isPageSubresource } = await import('./security.js');
      expect(isPageSubresource({ path } as Request)).toBe(false);
    });
  }

  it('does not exempt an unhashed .js path (only content-hashed bundles)', async () => {
    const { isPageSubresource } = await import('./security.js');
    expect(isPageSubresource({ path: '/evil.js' } as Request)).toBe(false);
  });
});

// KAN-218: known crawlers are exempt from the page rate limiter so they can
// index the public surface without hitting 429. The AI endpoints (/api) have
// their own limiter; metering crawlers on the HTML surface costs SEO.
describe('isKnownCrawler', () => {
  const crawlers: Array<[string, string]> = [
    ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    ['Bingbot', 'Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
    [
      'Applebot',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1)',
    ],
    ['DuckDuckBot', 'DuckDuckBot/1.0; (+http://duckduckgo.com/duckduckbot.html)'],
    ['YandexBot', 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)'],
    [
      'facebookexternalhit',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatype.html)',
    ],
    ['Twitterbot', 'Twitterbot/1.0'],
    ['LinkedInBot', 'LinkedInBot/1.0'],
    [
      'AdsBot-Google',
      'Mozilla/5.0 (compatible; AdsBot-Google; +http://www.google.com/adsbot.html)',
    ],
    ['Pinterestbot', 'Pinterestbot/1.0'],
    [
      'Slurp',
      'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)',
    ],
  ];

  for (const [label, ua] of crawlers) {
    it(`exempts ${label}`, async () => {
      const { isKnownCrawler } = await import('./security.js');
      expect(isKnownCrawler({ headers: { 'user-agent': ua } } as Request)).toBe(true);
    });
  }

  const browsers = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'curl/8.5.0',
  ];

  for (const ua of browsers) {
    it(`does not exempt ${ua.slice(0, 40)}`, async () => {
      const { isKnownCrawler } = await import('./security.js');
      expect(isKnownCrawler({ headers: { 'user-agent': ua } } as Request)).toBe(false);
    });
  }

  it('returns false when no user-agent header', async () => {
    const { isKnownCrawler } = await import('./security.js');
    expect(isKnownCrawler({ headers: {} } as Request)).toBe(false);
  });
});

describe('createPageLimiter', () => {
  it('uses a Valkey keyspace separate from the API limiter', async () => {
    const { createPageLimiter, createApiLimiter } = await import('./security.js');
    const RedisStore = (await import('rate-limit-redis')).default as unknown as {
      mockClear: () => void;
      mock: { calls: Array<[{ prefix: string }]> };
    };
    RedisStore.mockClear();

    const valkeyClient = { call: vi.fn() } as unknown as Parameters<typeof createPageLimiter>[0];
    expect(typeof createPageLimiter(valkeyClient)).toBe('function');
    expect(createPageLimiter(valkeyClient)).not.toBe(createApiLimiter(valkeyClient));

    // KAN-154 regression guard: the page and API limiters must write to
    // separate Valkey keyspaces, or ordinary browsing exhausts the /api budget.
    const prefixes = RedisStore.mock.calls.map((call) => call[0].prefix);
    expect(prefixes).toContain('rl:page:');
    expect(prefixes).toContain('rl:api:');
  });
});

describe('createExpensiveOperationLimiter', () => {
  it('should return a middleware function', async () => {
    const { createExpensiveOperationLimiter } = await import('./security.js');
    const limiter = createExpensiveOperationLimiter();
    expect(typeof limiter).toBe('function');
  });
});

// KAN-161: IPv6 rate-limit bypass — rateLimitKeyGenerator must mask IPv6
// addresses to /56 subnets via ipKeyGenerator so rotating addresses within
// the same allocation cannot bypass per-IP rate limits.
describe('rateLimitKeyGenerator (IPv6 masking)', () => {
  it('passes IPv4 addresses through unchanged', async () => {
    const { rateLimitKeyGenerator } = await import('./security.js');
    const req = { ip: '192.168.1.42', socket: {} } as unknown as Request;
    expect(rateLimitKeyGenerator(req)).toBe('192.168.1.42');
  });

  it('masks two IPv6 addresses in the same /56 to the same key', async () => {
    const { rateLimitKeyGenerator } = await import('./security.js');
    const req1 = { ip: '2001:db8:abcd:1200::1', socket: {} } as unknown as Request;
    const req2 = { ip: '2001:db8:abcd:12ff::9999', socket: {} } as unknown as Request;
    const key1 = rateLimitKeyGenerator(req1);
    const key2 = rateLimitKeyGenerator(req2);
    expect(key1).toBe(key2);
    // The key must differ from the raw input (it was masked)
    expect(key1).not.toBe('2001:db8:abcd:1200::1');
  });

  it('produces different keys for IPv6 addresses in different /56 subnets', async () => {
    const { rateLimitKeyGenerator } = await import('./security.js');
    const req1 = { ip: '2001:db8:abcd:1200::1', socket: {} } as unknown as Request;
    const req2 = { ip: '2001:db8:abcd:1300::1', socket: {} } as unknown as Request;
    expect(rateLimitKeyGenerator(req1)).not.toBe(rateLimitKeyGenerator(req2));
  });

  it('falls back to req.socket.remoteAddress when req.ip is undefined', async () => {
    const { rateLimitKeyGenerator } = await import('./security.js');
    const req = {
      ip: undefined,
      socket: { remoteAddress: '10.0.0.1' },
    } as unknown as Request;
    expect(rateLimitKeyGenerator(req)).toBe('10.0.0.1');
  });

  it("returns 'unknown' when no IP is available", async () => {
    const { rateLimitKeyGenerator } = await import('./security.js');
    const req = { ip: undefined, socket: {} } as unknown as Request;
    expect(rateLimitKeyGenerator(req)).toBe('unknown');
  });
});

describe('createRequestLogger', () => {
  it('should return a middleware function', async () => {
    const { createRequestLogger } = await import('./security.js');
    const logger = createRequestLogger();
    expect(typeof logger).toBe('function');
  });

  it('should call next() and log on response finish', async () => {
    const { createRequestLogger } = await import('./security.js');
    const logger = createRequestLogger();

    const listeners: Record<string, () => void> = {};
    const req = { method: 'GET', path: '/api/health' } as Request;
    const res = {
      on: (event: string, cb: () => void) => {
        listeners[event] = cb;
      },
      statusCode: 200,
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    logger(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    // Simulate the response 'finish' event to trigger the log
    listeners['finish']?.();
  });
});

describe('createErrorHandler', () => {
  it('should return a function with arity 4 (Express error handler signature)', async () => {
    const { createErrorHandler } = await import('./security.js');
    const handler = createErrorHandler();
    expect(typeof handler).toBe('function');
    expect(handler.length).toBe(4);
  });

  it('should respond with 500 and a generic message for unhandled errors', async () => {
    const { createErrorHandler } = await import('./security.js');
    const handler = createErrorHandler();

    const jsonMock = vi.fn();
    const req = { method: 'POST', path: '/api/recipe' } as Request;
    const res = {
      headersSent: false,
      statusCode: 200,
      status: vi.fn().mockReturnValue({ json: jsonMock }),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    handler(new Error('Something broke'), req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('should delegate to next() if headers are already sent', async () => {
    const { createErrorHandler } = await import('./security.js');
    const handler = createErrorHandler();

    const req = { method: 'GET', path: '/api/health' } as Request;
    const res = {
      headersSent: true,
      statusCode: 200,
      status: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;
    const err = new Error('Already sent');

    handler(err, req, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// Environment / runtime checks

describe('Runtime environment', () => {
  it('should run in a valid NODE_ENV', () => {
    const nodeEnv = process.env.NODE_ENV || 'development';
    expect(['development', 'production', 'test']).toContain(nodeEnv);
  });
});

// ── createValkeyClient tests ───────────────────────────────────────────────

describe('createValkeyClient', () => {
  beforeEach(() => {
    // Reset mock call history (keeps implementations intact)
    vi.clearAllMocks();
    // Ensure Valkey env vars are absent at the start of every test
    delete process.env.VALKEY_HOST;
    delete process.env.VALKEY_PORT;
    delete process.env.VALKEY_AUTH_MODE;
    delete process.env.VALKEY_TLS_INSECURE;
    delete process.env.VALKEY_CA_CERT;
  });

  afterEach(async () => {
    // Always clean up any Redis client that was created during the test so
    // module-level state (client / refreshTimer) is reset to null.
    const { shutdownValkey } = await import('./valkey.js');
    await shutdownValkey();
    // Remove all Valkey-related env vars set during the test
    delete process.env.VALKEY_HOST;
    delete process.env.VALKEY_AUTH_MODE;
    delete process.env.VALKEY_PORT;
    delete process.env.VALKEY_TLS_INSECURE;
    delete process.env.VALKEY_CA_CERT;
  });

  it('returns null when VALKEY_HOST is not set', async () => {
    const { createValkeyClient } = await import('./valkey.js');
    const result = await createValkeyClient();
    expect(result).toBeNull();
    expect(MockRedis).not.toHaveBeenCalled();
  });

  it('creates a Redis client and returns it when VALKEY_HOST is set', async () => {
    process.env.VALKEY_HOST = '10.0.0.1';
    const { createValkeyClient } = await import('./valkey.js');
    const result = await createValkeyClient();
    expect(result).not.toBeNull();
    expect(MockRedis).toHaveBeenCalledOnce();
  });

  it('sets password and tls options when VALKEY_AUTH_MODE=iam', async () => {
    process.env.VALKEY_HOST = '10.0.0.1';
    process.env.VALKEY_AUTH_MODE = 'iam';
    const { createValkeyClient } = await import('./valkey.js');
    await createValkeyClient();
    expect(MockRedis).toHaveBeenCalledWith(
      expect.objectContaining({
        password: 'test-iam-token',
        tls: expect.any(Object),
      })
    );
  });

  it('sets tls.ca from VALKEY_CA_CERT when VALKEY_AUTH_MODE=iam', async () => {
    const pem = '-----BEGIN CERTIFICATE-----\nMIIFakeCaCert\n-----END CERTIFICATE-----\n';
    process.env.VALKEY_HOST = '10.0.0.1';
    process.env.VALKEY_AUTH_MODE = 'iam';
    process.env.VALKEY_CA_CERT = pem;
    const { createValkeyClient } = await import('./valkey.js');
    await createValkeyClient();
    expect(MockRedis).toHaveBeenCalledWith(
      expect.objectContaining({
        tls: expect.objectContaining({ ca: pem }),
      })
    );
    // Supplying a CA must not weaken verification
    const callArg = (MockRedis.mock.calls[0] as unknown[])?.[0] as { tls: Record<string, unknown> };
    expect(callArg.tls).not.toHaveProperty('rejectUnauthorized');
  });

  it('does not set tls.ca when VALKEY_CA_CERT is unset', async () => {
    process.env.VALKEY_HOST = '10.0.0.1';
    process.env.VALKEY_AUTH_MODE = 'iam';
    const { createValkeyClient } = await import('./valkey.js');
    await createValkeyClient();
    const callArg = (MockRedis.mock.calls[0] as unknown[])?.[0] as { tls: Record<string, unknown> };
    expect(callArg.tls).not.toHaveProperty('ca');
  });

  it('does NOT set password or tls when VALKEY_AUTH_MODE is not iam', async () => {
    process.env.VALKEY_HOST = '10.0.0.1';
    const { createValkeyClient } = await import('./valkey.js');
    await createValkeyClient();
    const callArg = (MockRedis.mock.calls[0] as unknown[])?.[0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty('password');
    expect(callArg).not.toHaveProperty('tls');
  });

  it('starts a token refresh timer only in IAM mode', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');

    // Non-IAM: no timer should be started
    process.env.VALKEY_HOST = '10.0.0.1';
    const { createValkeyClient, shutdownValkey } = await import('./valkey.js');
    await createValkeyClient();
    expect(setIntervalSpy).not.toHaveBeenCalled();

    // Clean up so the next call starts fresh
    await shutdownValkey();
    vi.clearAllMocks();

    // IAM mode: timer must be started
    process.env.VALKEY_AUTH_MODE = 'iam';
    await createValkeyClient();
    expect(setIntervalSpy).toHaveBeenCalled();

    setIntervalSpy.mockRestore();
  });

  it('returns the existing healthy client without reinitializing on a second call', async () => {
    process.env.VALKEY_HOST = '10.0.0.1';
    const { createValkeyClient } = await import('./valkey.js');
    const first = await createValkeyClient();
    const second = await createValkeyClient();
    expect(first).toBe(second);
    // Constructor should only have been called once
    expect(MockRedis).toHaveBeenCalledOnce();
  });

  it('shuts down stale client when VALKEY_HOST is removed between calls', async () => {
    process.env.VALKEY_HOST = '10.0.0.1';
    const { createValkeyClient } = await import('./valkey.js');
    const first = await createValkeyClient();
    expect(first).not.toBeNull();

    // Simulate VALKEY_HOST being removed
    delete process.env.VALKEY_HOST;
    const second = await createValkeyClient();
    expect(second).toBeNull();
  });

  it('returns null and falls back to in-memory when initial ping fails', async () => {
    MockRedis.mockImplementationOnce(function () {
      return {
        ping: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        quit: vi.fn().mockResolvedValue('OK'),
        call: vi.fn(),
        disconnect: vi.fn(),
        on: vi.fn(),
        options: {} as Record<string, unknown>,
      };
    });

    process.env.VALKEY_HOST = '10.0.0.1';
    const { createValkeyClient } = await import('./valkey.js');
    const result = await createValkeyClient();
    expect(result).toBeNull();
  });

  it('reinitializes when the cached client fails the health-check ping', async () => {
    process.env.VALKEY_HOST = '10.0.0.1';
    const { createValkeyClient } = await import('./valkey.js');

    await createValkeyClient();
    expect(MockRedis).toHaveBeenCalledOnce();

    // Make the next ping call (health check on second createValkeyClient()) fail
    const existingInstance = MockRedis.mock.results[0]?.value as {
      ping: ReturnType<typeof vi.fn>;
    };
    existingInstance.ping.mockRejectedValueOnce(new Error('Connection lost'));

    vi.clearAllMocks(); // reset call counts; mockRejectedValueOnce queue survives

    await createValkeyClient();
    expect(MockRedis).toHaveBeenCalledOnce(); // called once more for the new client
  });

  it('invokes the error-event callback when the client emits an error', async () => {
    let errorHandler: ((err: Error) => void) | null = null;

    MockRedis.mockImplementationOnce(function () {
      return {
        ping: vi.fn().mockResolvedValue('PONG'),
        quit: vi.fn().mockResolvedValue('OK'),
        call: vi.fn(),
        disconnect: vi.fn(),
        on: vi.fn().mockImplementation((event: string, cb: (err: Error) => void) => {
          if (event === 'error') errorHandler = cb;
        }),
        options: {} as Record<string, unknown>,
      };
    });

    process.env.VALKEY_HOST = '10.0.0.1';
    const { createValkeyClient } = await import('./valkey.js');
    await createValkeyClient();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(errorHandler).not.toBeNull();
    errorHandler!(new Error('Connection reset by peer'));
    expect(errorSpy).toHaveBeenCalledWith('[Valkey] Connection error:', 'Connection reset by peer');
    errorSpy.mockRestore();
  });

  it('calls disconnect() when quit times out during shutdown', async () => {
    const disconnectMock = vi.fn();

    MockRedis.mockImplementationOnce(function () {
      return {
        ping: vi.fn().mockResolvedValue('PONG'),
        quit: vi.fn().mockReturnValue(new Promise(() => {})), // never resolves
        call: vi.fn(),
        disconnect: disconnectMock,
        on: vi.fn(),
        options: {} as Record<string, unknown>,
      };
    });

    process.env.VALKEY_HOST = '10.0.0.1';
    const { createValkeyClient, shutdownValkey } = await import('./valkey.js');
    await createValkeyClient();

    vi.useFakeTimers();
    try {
      const shutdownPromise = shutdownValkey();
      await vi.advanceTimersByTimeAsync(4000); // past the 3 s timeout
      await shutdownPromise;
    } finally {
      vi.useRealTimers();
    }

    expect(disconnectMock).toHaveBeenCalled();
  });
});

// ── applySecurityMiddleware tests ──────────────────────────────────────────

describe('applySecurityMiddleware', () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('registers at least one middleware (helmet) on the app', async () => {
    const { applySecurityMiddleware } = await import('./security.js');
    const useMock = vi.fn();
    applySecurityMiddleware({ use: useMock } as unknown as Express);
    expect(useMock).toHaveBeenCalled();
  });

  it('sets a scoped Content-Security-Policy header (incl. Google Fonts origins)', async () => {
    const { applySecurityMiddleware } = await import('./security.js');
    const useMock = vi.fn();
    applySecurityMiddleware({ use: useMock } as unknown as Express);

    const helmetMiddleware = useMock.mock.calls[0]?.[0] as (
      req: Request,
      res: Response,
      next: NextFunction
    ) => void;

    const headers: Record<string, string> = {};
    const res = {
      setHeader: (name: string, value: string) => {
        headers[name.toLowerCase()] = String(value);
      },
      removeHeader: vi.fn(),
      getHeader: (name: string) => headers[name.toLowerCase()],
    } as unknown as Response;
    const next = vi.fn();

    helmetMiddleware({ headers: {} } as unknown as Request, res, next);

    expect(next).toHaveBeenCalled();
    const csp = headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");
    expect(csp).toContain("img-src 'self' data: blob: https:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("allows Angular's critical-CSS inline onload handler via script-src-attr hash", async () => {
    const { applySecurityMiddleware } = await import('./security.js');
    const useMock = vi.fn();
    applySecurityMiddleware({ use: useMock } as unknown as Express);

    const helmetMiddleware = useMock.mock.calls[0]?.[0] as (
      req: Request,
      res: Response,
      next: NextFunction
    ) => void;

    const headers: Record<string, string> = {};
    const res = {
      setHeader: (name: string, value: string) => {
        headers[name.toLowerCase()] = String(value);
      },
      removeHeader: vi.fn(),
      getHeader: (name: string) => headers[name.toLowerCase()],
    } as unknown as Response;

    helmetMiddleware({ headers: {} } as unknown as Request, res, vi.fn());

    const csp = headers['content-security-policy'];
    expect(csp).toBeDefined();
    // Angular's inlineCritical optimization emits onload="this.media='all'" on the
    // production stylesheet <link>; Helmet's default script-src-attr 'none' would block it.
    // The hash below is sha256 of exactly: this.media='all'
    expect(csp).toContain(
      "script-src-attr 'unsafe-hashes' 'sha256-MhtPZXr7+LpJUY5qtMutB+qWfQtMaPccfe7QXtCcEYc='"
    );
    // It must not fall back to blocking everything or allowing everything.
    expect(csp).not.toContain("script-src-attr 'none'");
    expect(csp).not.toContain("script-src-attr 'unsafe-inline'");
  });

  it('registers X-Robots-Tag middleware in production (two app.use calls)', async () => {
    process.env.NODE_ENV = 'production';
    const { applySecurityMiddleware } = await import('./security.js');
    const useMock = vi.fn();
    applySecurityMiddleware({ use: useMock } as unknown as Express);
    expect(useMock).toHaveBeenCalledTimes(2);
  });

  it('does not register X-Robots-Tag middleware outside production', async () => {
    process.env.NODE_ENV = 'development';
    const { applySecurityMiddleware } = await import('./security.js');
    const useMock = vi.fn();
    applySecurityMiddleware({ use: useMock } as unknown as Express);
    expect(useMock).toHaveBeenCalledTimes(1);
  });

  it('X-Robots-Tag middleware sets header for HTML page requests', async () => {
    process.env.NODE_ENV = 'production';
    const { applySecurityMiddleware } = await import('./security.js');
    const useMock = vi.fn();
    applySecurityMiddleware({ use: useMock } as unknown as Express);

    const robotsMiddleware = useMock.mock.calls[1]?.[0] as (
      req: Request,
      res: Response,
      next: NextFunction
    ) => void;

    const setHeader = vi.fn();
    const next = vi.fn();
    robotsMiddleware(
      { accepts: vi.fn().mockReturnValue('html'), path: '/about' } as unknown as Request,
      { setHeader } as unknown as Response,
      next
    );

    expect(setHeader).toHaveBeenCalledWith('X-Robots-Tag', 'index, follow');
    expect(next).toHaveBeenCalled();
  });

  it('X-Robots-Tag middleware skips /api/ paths', async () => {
    process.env.NODE_ENV = 'production';
    const { applySecurityMiddleware } = await import('./security.js');
    const useMock = vi.fn();
    applySecurityMiddleware({ use: useMock } as unknown as Express);

    const robotsMiddleware = useMock.mock.calls[1]?.[0] as (
      req: Request,
      res: Response,
      next: NextFunction
    ) => void;

    const setHeader = vi.fn();
    const next = vi.fn();
    robotsMiddleware(
      { accepts: vi.fn().mockReturnValue('html'), path: '/api/generate' } as unknown as Request,
      { setHeader } as unknown as Response,
      next
    );

    expect(setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('X-Robots-Tag middleware skips non-HTML requests', async () => {
    process.env.NODE_ENV = 'production';
    const { applySecurityMiddleware } = await import('./security.js');
    const useMock = vi.fn();
    applySecurityMiddleware({ use: useMock } as unknown as Express);

    const robotsMiddleware = useMock.mock.calls[1]?.[0] as (
      req: Request,
      res: Response,
      next: NextFunction
    ) => void;

    const setHeader = vi.fn();
    const next = vi.fn();
    robotsMiddleware(
      { accepts: vi.fn().mockReturnValue(false), path: '/data.json' } as unknown as Request,
      { setHeader } as unknown as Response,
      next
    );

    expect(setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});

// ── buildRedisStore (via createApiLimiter / createExpensiveOperationLimiter) ──

describe('createApiLimiter with non-null Valkey client', () => {
  it('builds a RedisStore when a Valkey client is provided', async () => {
    const { createApiLimiter } = await import('./security.js');
    const limiter = createApiLimiter({ call: vi.fn() } as unknown as Parameters<
      typeof createApiLimiter
    >[0]);
    expect(typeof limiter).toBe('function');
  });
});

describe('createExpensiveOperationLimiter with non-null Valkey client', () => {
  it('builds a RedisStore when a Valkey client is provided', async () => {
    const { createExpensiveOperationLimiter } = await import('./security.js');
    const limiter = createExpensiveOperationLimiter({ call: vi.fn() } as unknown as Parameters<
      typeof createExpensiveOperationLimiter
    >[0]);
    expect(typeof limiter).toBe('function');
  });
});

// ── createFlaskProxy — Host header routing (regression) ───────────────────
// Regression: Cloud Run's frontend load balancer routes by Host header.
// If the proxy forwards the browser's Host (custom domain) to a
// *.run.app target, Cloud Run returns its branded 404 before the request
// reaches Flask. The proxy must set Host = target host and communicate
// the browser's original host via X-Forwarded-Host.

describe('createFlaskProxy Host header', () => {
  it('sets Host to the target backend, X-Forwarded-Host to the original', async () => {
    const originalUrl = process.env.FLASK_BACKEND_URL;
    process.env.FLASK_BACKEND_URL = 'https://flask-backend-xyz.a.run.app';

    const captured: { host?: string; xfh?: string } = {};
    vi.resetModules();
    vi.doMock('node:https', () => ({
      default: {
        request: (opts: { headers: Record<string, string> }) => {
          captured.host = opts.headers.host;
          captured.xfh = opts.headers['x-forwarded-host'];
          return {
            on: vi.fn(),
            end: vi.fn(),
            write: vi.fn(),
          };
        },
      },
    }));

    const { createFlaskProxy } = await import('./proxy.js');
    const handler = createFlaskProxy('Test');

    const req = {
      headers: { host: 'www.tasteslikegood.org' },
      hostname: 'www.tasteslikegood.org',
      originalUrl: '/api/auth/login',
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
    // KAN-170: the proxy awaits an ID token before dispatching, so the
    // outgoing request is issued on a later tick rather than synchronously.
    await new Promise((resolve) => setImmediate(resolve));

    expect(captured.host).toBe('flask-backend-xyz.a.run.app');
    expect(captured.xfh).toBe('www.tasteslikegood.org');

    vi.doUnmock('node:https');
    vi.resetModules();
    if (originalUrl) process.env.FLASK_BACKEND_URL = originalUrl;
    else delete process.env.FLASK_BACKEND_URL;
  });
});

// ── createFlaskProxy — log injection prevention ────────────────────────────
// Regression: user-controlled req.method and req.originalUrl must be
// sanitized before being written to the error log to prevent log injection.
// err.message is sanitized too — the error text can echo attacker-influenced
// request data (CodeQL treats the client-request error callback as a source).

describe('createFlaskProxy log injection prevention', () => {
  it('sanitizes newlines in req.method, req.originalUrl, and err.message before logging', async () => {
    vi.resetModules();

    let errorCallback: ((err: Error) => void) | undefined;
    vi.doMock('node:http', () => ({
      default: {
        request: (_opts: unknown, _cb: unknown) => ({
          on: vi.fn((_event: string, cb: (err: Error) => void) => {
            errorCallback = cb;
          }),
          end: vi.fn(),
          write: vi.fn(),
          pipe: vi.fn(),
        }),
      },
    }));

    const { createFlaskProxy } = await import('./proxy.js');
    const handler = createFlaskProxy('Test');

    const req = {
      headers: { host: 'example.com' },
      hostname: 'example.com',
      originalUrl: '/api/recipes\nGET /admin HTTP/1.1',
      method: 'GET\ninjected',
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

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    handler(req, res);
    // KAN-170: errorCallback is registered inside the proxy's async dispatch,
    // so it does not exist until the ID-token await has settled.
    await new Promise((resolve) => setImmediate(resolve));

    // Trigger the error event with a newline smuggled into the message
    errorCallback?.(new Error('connection\nrefused: forged entry'));

    expect(errorSpy).toHaveBeenCalledOnce();
    const logged: string = errorSpy.mock.calls[0][0] as string;
    expect(logged).not.toContain('\n');
    expect(logged).not.toContain('\r');
    expect(logged).toContain('GET_injected');
    expect(logged).toContain('/api/recipes_GET /admin HTTP/1.1');
    expect(logged).toContain('connection_refused: forged entry');

    errorSpy.mockRestore();
    vi.doUnmock('node:http');
    vi.resetModules();
  });

  it.each([
    ['\\r (CR)', '\r'],
    ['\\r\\n (CRLF)', '\r\n'],
    ['\\n (LF)', '\n'],
  ])('replaces %s in logged values', async (_desc, sep) => {
    vi.resetModules();

    let errorCallback: ((err: Error) => void) | undefined;
    vi.doMock('node:http', () => ({
      default: {
        request: (_opts: unknown, _cb: unknown) => ({
          on: vi.fn((_event: string, cb: (err: Error) => void) => {
            errorCallback = cb;
          }),
          end: vi.fn(),
          write: vi.fn(),
          pipe: vi.fn(),
        }),
      },
    }));

    const { createFlaskProxy } = await import('./proxy.js');
    const handler = createFlaskProxy('Test');

    const req = {
      headers: { host: 'example.com' },
      hostname: 'example.com',
      originalUrl: `/api/test${sep}injected`,
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

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    handler(req, res);
    // KAN-170: see above — the error handler is wired on a later tick.
    await new Promise((resolve) => setImmediate(resolve));
    errorCallback?.(new Error('connection refused'));

    const logged: string = errorSpy.mock.calls[0][0] as string;
    expect(logged).not.toContain('\n');
    expect(logged).not.toContain('\r');

    errorSpy.mockRestore();
    vi.doUnmock('node:http');
    vi.resetModules();
  });
});

// The shared sanitizeForLog helper (server/security.ts) backs the request
// logger, the error handler, and the proxy error log. Direct unit tests cover
// edge cases the behavioral suites above don't reach.
describe('sanitizeForLog', () => {
  it('returns an empty string for null and undefined', async () => {
    const { sanitizeForLog } = await import('./security.js');
    expect(sanitizeForLog(null)).toBe('');
    expect(sanitizeForLog(undefined)).toBe('');
  });

  it('replaces CR, LF, and other control characters with underscores', async () => {
    const { sanitizeForLog } = await import('./security.js');
    expect(sanitizeForLog('GET\ninjected')).toBe('GET_injected');
    expect(sanitizeForLog('/api\r\n/forged')).toBe('/api__/forged');
    expect(sanitizeForLog('/api/\x1b[31mred')).toBe('/api/_[31mred');
    expect(sanitizeForLog('/api/\x00null')).toBe('/api/_null');
  });

  it('passes safe values through unchanged', async () => {
    const { sanitizeForLog } = await import('./security.js');
    expect(sanitizeForLog('/api/recipes/123?q=vegan')).toBe('/api/recipes/123?q=vegan');
  });

  it('leaves percent-encoded sequences as literal text without decoding', async () => {
    const { sanitizeForLog } = await import('./security.js');
    // %0A stays literal text — an encoded newline can't break a log line, and
    // not decoding means malformed sequences like a lone % can never throw.
    expect(sanitizeForLog('/api/%0Ainjected')).toBe('/api/%0Ainjected');
    expect(sanitizeForLog('/api/%')).toBe('/api/%');
    expect(sanitizeForLog('/api/%E0%A4%A')).toBe('/api/%E0%A4%A');
  });
});

describe('createRequestLogger log injection prevention', () => {
  it('sanitizes req.method and req.path before logging', async () => {
    const { createRequestLogger } = await import('./security.js');
    const logger = createRequestLogger();

    const listeners: Record<string, () => void> = {};
    const req = { method: 'GET\ninjected', path: '/api/health\r\n[FAKE] forged' } as Request;
    const res = {
      on: (event: string, cb: () => void) => {
        listeners[event] = cb;
      },
      statusCode: 200,
    } as unknown as Response;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger(req, res, vi.fn() as NextFunction);
    listeners['finish']?.();

    expect(logSpy).toHaveBeenCalledOnce();
    const logged: string = logSpy.mock.calls[0][0] as string;
    expect(logged).not.toContain('\n');
    expect(logged).not.toContain('\r');
    expect(logged).toContain('GET_injected');
    expect(logged).toContain('/api/health__[FAKE] forged');
    logSpy.mockRestore();
  });

  it('sanitizes req.method and req.path in the error handler log', async () => {
    const { createErrorHandler } = await import('./security.js');
    const handler = createErrorHandler();

    const req = { method: 'POST\nforged', path: '/api/recipe\r\nfake' } as Request;
    const res = {
      headersSent: false,
      statusCode: 200,
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    handler(new Error('boom'), req, res, vi.fn() as NextFunction);

    expect(errorSpy).toHaveBeenCalledOnce();
    const details = errorSpy.mock.calls[0][1] as { method: string; path: string };
    expect(details.method).toBe('POST_forged');
    expect(details.path).toBe('/api/recipe__fake');
    errorSpy.mockRestore();
  });
});

describe('sanitizeForLog unicode line separators', () => {
  it('replaces raw U+2028/U+2029 (rendered as line breaks by many log sinks)', async () => {
    const { sanitizeForLog } = await import('./security.js');
    expect(sanitizeForLog('/api/\u2028forged')).toBe('/api/_forged');
    expect(sanitizeForLog('/api/\u2029forged')).toBe('/api/_forged');
    // Percent-encoded forms stay literal text — the sanitizer never decodes,
    // so %E2%80%A8 can't become a real line separator in the first place.
    expect(sanitizeForLog('/api/%E2%80%A8forged')).toBe('/api/%E2%80%A8forged');
  });
});
