import rateLimit, { type Store } from 'express-rate-limit';
import RedisStore, { type RedisReply } from 'rate-limit-redis';
import helmet from 'helmet';
import type { Express, Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import type { Redis } from 'ioredis';

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
    // rate-limit-redis v5 expects a sendCommand returning a Promise
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
  // Security headers — CSP is enabled with a scoped policy.
  // Angular's production build outputs bundled JS/CSS files; no external CDN scripts are loaded
  // (the stale esm.sh importmap was removed from index.html — the esbuild application builder
  // bundles all bare-specifier deps from node_modules at build time).
  // Inline styles are allowed because Angular applies component styles at runtime.
  // Google Fonts is the only external origin: the stylesheet loads from fonts.googleapis.com
  // and the font files it references load from fonts.gstatic.com.
  // All other Helmet protections remain active (X-Content-Type-Options, X-Frame-Options,
  // HSTS, Referrer-Policy, X-Powered-By removal, etc.).
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
    })
  );

  // X-Robots-Tag: signal to crawlers that HTML pages are indexable.
  // Only set in production to avoid unintentionally indexing staging/preview deploys.
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.accepts('html') && !req.path.startsWith('/api/')) {
        res.setHeader('X-Robots-Tag', 'index, follow');
      }
      next();
    });
  }
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
