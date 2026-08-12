import rateLimit, { type Store } from 'express-rate-limit';
import RedisStore, { type RedisReply } from 'rate-limit-redis';
import helmet from 'helmet';
import type { Express, Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import type { Redis } from 'ioredis';
import { RATE_LIMIT_PREFIXES } from './valkey-config.js';

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

// KAN-160: isPageSubresource and its regex patterns moved to route-manifest.ts.
// Imported for local use (createPageLimiter skip function) and re-exported so
// existing consumers (tests importing from security.ts) don't break.
import { isPageSubresource } from './route-manifest.js';
export { isPageSubresource };

// KAN-218: known search-engine and social-media crawlers. User-agent detection
// is sufficient here — this exempts rate limiting, not authentication. Crawlers
// self-throttle via robots.txt; rate-limiting them costs SEO while protecting
// nothing (the AI endpoints have their own limiter on /api).
const CRAWLER_UA_RE =
  /\b(Googlebot|Bingbot|Applebot|DuckDuckBot|YandexBot|Slurp|facebookexternalhit|Twitterbot|LinkedInBot|Pinterestbot|AdsBot-Google)\b/i;

/**
 * Returns true for requests from known crawlers that should be exempt from the
 * page rate limiter. Exported for unit testing.
 */
export function isKnownCrawler(req: Request): boolean {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' && CRAWLER_UA_RE.test(ua);
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
    store: buildRedisStore(valkeyClient, RATE_LIMIT_PREFIXES.api),
  });
};

/**
 * Rate limiter for the public HTML surface: the SPA shell, the Flask-rendered
 * SSR pages, and the standalone static pages.
 *
 * KAN-154: kept separate from createApiLimiter for two reasons. It skips
 * static subresources (see isPageSubresource), and it writes to its own Valkey
 * keyspace — previously both limiters were built from createApiLimiter and so
 * shared the `rl:api:` prefix, letting ordinary browsing exhaust the budget
 * for /api/* on the same IP.
 */
export const createPageLimiter = (
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
    skip: (req) => isPageSubresource(req) || isKnownCrawler(req),
    keyGenerator: (req) => getClientIp(req),
    store: buildRedisStore(valkeyClient, RATE_LIMIT_PREFIXES.page),
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
    store: buildRedisStore(valkeyClient, RATE_LIMIT_PREFIXES.expensive),
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
  // Scripts/styles/fonts are locked to known origins: Google Fonts CSS loads from
  // fonts.googleapis.com and its font files from fonts.gstatic.com.
  // img-src deliberately allows any https: origin (plus data:/blob:): recipe image URLs are
  // per-recipe data — stock photos come from images.unsplash.com today, AI images are served
  // same-origin via the Flask proxy, but stored/legacy recipes may reference other HTTPS hosts.
  // Images cannot execute script, so the exposure is limited; scripts stay 'self'-only.
  // script-src-attr: Angular's critical-CSS optimization (inlineCritical) emits the stylesheet
  // link as <link ... media="print" onload="this.media='all'"> in the built index.html. Helmet's
  // default script-src-attr 'none' would block that inline handler and the main stylesheet would
  // stay media="print" (never applied on screen). 'unsafe-hashes' plus the SHA-256 hash of the
  // exact handler string ("this.media='all'") allows only that one handler — no other inline
  // event handlers can run. If Angular ever changes the emitted handler, regenerate the hash:
  //   printf %s "NEW_HANDLER" | openssl dgst -sha256 -binary | openssl base64
  // (Alternatives rejected: disabling inlineCritical in angular.json costs first-paint
  // performance; script-src-attr 'unsafe-inline' would allow ALL inline handlers.)
  // All other Helmet protections remain active (X-Content-Type-Options, X-Frame-Options,
  // HSTS, Referrer-Policy, X-Powered-By removal, etc.).
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // Hash of Angular's critical-CSS onload handler: this.media='all'
          scriptSrcAttr: [
            "'unsafe-hashes'",
            "'sha256-MhtPZXr7+LpJUY5qtMutB+qWfQtMaPccfe7QXtCcEYc='",
          ],
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
 * Replaces newlines, carriage returns, and other control characters with `_`
 * so user-controlled values can't forge extra log lines (CodeQL js/log-injection).
 */
export function sanitizeForLog(value: string | null | undefined): string {
  if (value == null) return '';
  return (
    value
      // Replace all C0 control characters (0x00-0x1F, which includes \n, \r,
      // and ESC/0x1B), DEL (0x7F), and the Unicode line separators U+2028 and
      // U+2029 (rendered as line breaks by many log sinks) with a visible
      // placeholder.
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f\u2028\u2029]/g, '_')
      // Defense-in-depth newline strip -- a no-op after the pass above, but it
      // is the exact shape CodeQL's js/log-injection query recognizes as a
      // sanitizer: its StringReplaceSanitizer only models a replace of "\n"
      // with the empty string, so replacing with '_' alone is not treated as
      // a taint barrier and the alert stays open.
      .replace(/\n/g, '')
  );
}

/**
 * Logger middleware for API requests
 */
export const createRequestLogger = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(
        `[${new Date().toISOString()}] ${sanitizeForLog(req.method)} ${sanitizeForLog(req.path)} - ${res.statusCode} (${duration}ms)`
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
      method: sanitizeForLog(req.method),
      path: sanitizeForLog(req.path),
      statusCode: res.statusCode,
      error: sanitizeForLog(err.message),
      stack: sanitizeForLog(err.stack),
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
