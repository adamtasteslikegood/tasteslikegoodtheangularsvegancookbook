import rateLimit, { Options } from "express-rate-limit";
import helmet from "helmet";
import { Express } from "express";

/**
 * Security Configuration
 * Implements rate limiting, security headers, and input validation
 */

// Rate limiter for general API requests
export const createApiLimiter = (windowMs: number = 15 * 60 * 1000, max: number = 100) => {
  return rateLimit({
    windowMs, // 15 minutes default
    max, // 100 requests per window default
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: { error: "Too many requests, please try again later." },
    skip: (req) => {
      // Skip rate limiting for health check
      return req.path === "/api/health";
    },
  });
};

// Stricter rate limiter for expensive operations (recipe and image generation)
export const createExpensiveOperationLimiter = (
  windowMs: number = 60 * 60 * 1000,
  max: number = 20
) => {
  return rateLimit({
    windowMs, // 1 hour default
    max, // 20 requests per window default
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "Rate limit exceeded for this operation. Please try again later.",
    },
  });
};

/**
 * Apply security middleware to an Express app
 */
export const applySecurityMiddleware = (app: Express) => {
  // Security headers
  app.use(helmet());

  // Additional CORS headers if needed (customize as per your frontend domain)
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });
};

/**
 * Logger middleware for API requests
 */
export const createRequestLogger = () => {
  return (req: any, res: any, next: any) => {
    const start = Date.now();
    res.on("finish", () => {
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
export const createErrorHandler = () => {
  return (err: any, req: any, res: any, next: any) => {
    // Log detailed error server-side
    console.error("[ERROR]", {
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
      error: "An unexpected error occurred on the server.",
    });
  };
};
