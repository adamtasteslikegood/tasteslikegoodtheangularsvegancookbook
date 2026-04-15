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
vi.mock('ioredis', () => ({ default: MockRedis }));

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
    const { createApiLimiter } = await import('./security');
    const limiter = createApiLimiter();
    expect(typeof limiter).toBe('function');
  });

  it('should accept custom windowMs and max parameters', async () => {
    const { createApiLimiter } = await import('./security');
    const limiter = createApiLimiter(null, 5000, 10);
    expect(typeof limiter).toBe('function');
  });
});

describe('shouldSkipRateLimiting', () => {
  it('skips /health', async () => {
    const { shouldSkipRateLimiting } = await import('./security');
    const req = { path: '/health' } as Request;
    expect(shouldSkipRateLimiting(req)).toBe(true);
  });

  it('skips /recipes/<uuid>/image', async () => {
    const { shouldSkipRateLimiting } = await import('./security');
    const req = { path: '/recipes/550e8400-e29b-41d4-a716-446655440000/image' } as Request;
    expect(shouldSkipRateLimiting(req)).toBe(true);
  });

  it('skips /recipes/<short-id>/image', async () => {
    const { shouldSkipRateLimiting } = await import('./security');
    const req = { path: '/recipes/abc123/image' } as Request;
    expect(shouldSkipRateLimiting(req)).toBe(true);
  });

  it('does not skip /recipes (list endpoint)', async () => {
    const { shouldSkipRateLimiting } = await import('./security');
    const req = { path: '/recipes' } as Request;
    expect(shouldSkipRateLimiting(req)).toBe(false);
  });

  it('does not skip /generate', async () => {
    const { shouldSkipRateLimiting } = await import('./security');
    const req = { path: '/generate' } as Request;
    expect(shouldSkipRateLimiting(req)).toBe(false);
  });

  it('does not skip /recipes/<uuid>/data (non-image sub-paths)', async () => {
    const { shouldSkipRateLimiting } = await import('./security');
    const req = { path: '/recipes/550e8400-e29b-41d4-a716-446655440000/data' } as Request;
    expect(shouldSkipRateLimiting(req)).toBe(false);
  });
});

describe('createExpensiveOperationLimiter', () => {
  it('should return a middleware function', async () => {
    const { createExpensiveOperationLimiter } = await import('./security');
    const limiter = createExpensiveOperationLimiter();
    expect(typeof limiter).toBe('function');
  });
});

describe('createRequestLogger', () => {
  it('should return a middleware function', async () => {
    const { createRequestLogger } = await import('./security');
    const logger = createRequestLogger();
    expect(typeof logger).toBe('function');
  });

  it('should call next() and log on response finish', async () => {
    const { createRequestLogger } = await import('./security');
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
    const { createErrorHandler } = await import('./security');
    const handler = createErrorHandler();
    expect(typeof handler).toBe('function');
    expect(handler.length).toBe(4);
  });

  it('should respond with 500 and a generic message for unhandled errors', async () => {
    const { createErrorHandler } = await import('./security');
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
    const { createErrorHandler } = await import('./security');
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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
    const { applySecurityMiddleware } = await import('./security');
    const useMock = vi.fn();
    applySecurityMiddleware({ use: useMock } as unknown as Express);
    expect(useMock).toHaveBeenCalled();
  });

  it('registers X-Robots-Tag middleware in production (two app.use calls)', async () => {
    process.env.NODE_ENV = 'production';
    const { applySecurityMiddleware } = await import('./security');
    const useMock = vi.fn();
    applySecurityMiddleware({ use: useMock } as unknown as Express);
    expect(useMock).toHaveBeenCalledTimes(2);
  });

  it('does not register X-Robots-Tag middleware outside production', async () => {
    process.env.NODE_ENV = 'development';
    const { applySecurityMiddleware } = await import('./security');
    const useMock = vi.fn();
    applySecurityMiddleware({ use: useMock } as unknown as Express);
    expect(useMock).toHaveBeenCalledTimes(1);
  });

  it('X-Robots-Tag middleware sets header for HTML page requests', async () => {
    process.env.NODE_ENV = 'production';
    const { applySecurityMiddleware } = await import('./security');
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
    const { applySecurityMiddleware } = await import('./security');
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
    const { applySecurityMiddleware } = await import('./security');
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
    const { createApiLimiter } = await import('./security');
    const limiter = createApiLimiter({ call: vi.fn() } as unknown as Parameters<
      typeof createApiLimiter
    >[0]);
    expect(typeof limiter).toBe('function');
  });
});

describe('createExpensiveOperationLimiter with non-null Valkey client', () => {
  it('builds a RedisStore when a Valkey client is provided', async () => {
    const { createExpensiveOperationLimiter } = await import('./security');
    const limiter = createExpensiveOperationLimiter({ call: vi.fn() } as unknown as Parameters<
      typeof createExpensiveOperationLimiter
    >[0]);
    expect(typeof limiter).toBe('function');
  });
});
