import rateLimit, { type Store } from 'express-rate-limit';
import RedisStore, { type RedisReply } from 'rate-limit-redis';
import helmet from 'helmet';
import type { Express, Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import type Redis from 'ioredis';

/**
 * Security Configuration
 * Implements rate limiting, security headers, and input validation.
 *
 * Rate limiters use Valkey (via RedisStore) when available for consistent
 * limits across Cloud Run instances. Falls back to in-memory MemoryStore
 * when Valkey is not connected (dev or connection failure).
 */

/**
 * Extract the real client IP using Express's IP resolution.
 *
 * This relies on Express's `req.ip`, which in turn uses the configured
 * `trust proxy` settings to safely interpret proxy headers.
 */
function getClientIp(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress;
  return ip || 'unknown';
}

/**
 * Build a RedisStore for express-rate-limit backed by the given ioredis client.
 * Returns undefined if client is null (caller uses default MemoryStore).
 */
function buildRedisStore(valkeyClient: Redis | null, prefix: string): Store | undefined {
  if (!valkeyClient) return undefined;
  return new RedisStore({
    // rate-limit-redis v4 expects a sendCommand returning a Promise
    sendCommand: (...args: string[]) =>
      valkeyClient.call(args[0], ...args.slice(1)) as unknown as Promise<RedisReply>,
    prefix,
  });
}

// Regex for image-serving paths: /recipes/<uuid>/image
const IMAGE_SERVING_RE = /^\/recipes\/[^/]+\/image$/;

/**
 * Returns true for paths that should be exempt from general API rate limiting.
 * Exported for unit testing.
 */
export function shouldSkipRateLimiting(req: Request): boolean {
  return req.path === '/health' || IMAGE_SERVING_RE.test(req.path);
}

// Rate limiter for general API requests
export const createApiLimiter = (
  valkeyClient: Redis | null = null,
  windowMs: number = 15 * 60 * 1000,
  max: number = 300
) => {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
    // When mounted on /api, req.path is relative: /health, /recipes/…/image
    skip: shouldSkipRateLimiting,
    keyGenerator: (req) => getClientIp(req),
    store: buildRedisStore(valkeyClient, 'rl:api:'),
  });
};

// Stricter rate limiter for expensive operations (recipe and image generation)
export const createExpensiveOperationLimiter = (
  valkeyClient: Redis | null = null,
  windowMs: number = 60 * 60 * 1000,
  max: number = 20
) => {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Rate limit exceeded for this operation. Please try again later.',
    },
    keyGenerator: (req) => getClientIp(req),
    store: buildRedisStore(valkeyClient, 'rl:expensive:'),
  });
};

/**
 * Apply security middleware to an Express app
 */
export const applySecurityMiddleware = (app: Express) => {
  // Security headers — CSP is disabled here because Angular's build output relies on
  // inline styles, inline event handlers (onload), and dynamic script loading from esm.sh.
  // In production, configure CSP at the reverse proxy or CDN level (e.g., nginx, Cloudflare).
  // All other Helmet protections remain active (X-Content-Type-Options, X-Frame-Options,
  // HSTS, Referrer-Policy, X-Powered-By removal, etc.).
  app.use(
    helmet({
      contentSecurityPolicy: false,
    })
  );

  // X-Robots-Tag: signal to crawlers that HTML pages are indexable
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.accepts('html') && !req.path.startsWith('/api/')) {
      res.setHeader('X-Robots-Tag', 'index, follow');
    }
    next();
  });
};

/**
 * Logger middleware for API requests
 */
export const createRequestLogger = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(
        `[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`
      );
    });
    next();
  };
};

/**
 * Error handler middleware
 */
export const createErrorHandler = (): ErrorRequestHandler => {
  return (err: Error & { status?: number }, req: Request, res: Response, next: NextFunction) => {
    // Log detailed error server-side
    console.error('[ERROR]', {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      error: err.message,
      stack: err.stack,
    });

    // Send generic error message to client
    if (res.headersSent) {
      return next(err);
    }

    res.status(err.status || 500).json({
      error: 'An unexpected error occurred on the server.',
    });
  };
};
