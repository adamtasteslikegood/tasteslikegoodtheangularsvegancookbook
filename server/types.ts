/**
 * Security-related TypeScript types and interfaces
 */

import { Request, Response, NextFunction } from "express";

/**
 * Rate limit configuration options
 */
export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  max: number; // Maximum number of requests per window
  standardHeaders: boolean; // Return rate limit info in headers
  legacyHeaders: boolean; // Use legacy X-RateLimit headers
  message: Record<string, string>;
  skip?: (req: Request) => boolean;
}

/**
 * Security configuration
 */
export interface SecurityConfig {
  enableHelmet: boolean;
  enableRateLimit: boolean;
  enableValidation: boolean;
  enableLogging: boolean;
  rateLimit: {
    general: RateLimitConfig;
    expensiveOp: RateLimitConfig;
  };
}

/**
 * Request with rate limit info
 */
export interface RateLimitedRequest extends Request {
  rateLimit?: {
    limit: number;
    current: number;
    remaining: number;
  };
}

/**
 * Validation error format
 */
export interface ValidationError {
  error: string;
  details?: Array<{
    field: string;
    message: string;
  }>;
}

/**
 * API Error response
 */
export interface ApiError {
  error: string;
  timestamp?: string;
  path?: string;
}

/**
 * API Success response wrapper
 */
export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  timestamp?: string;
}

/**
 * Middleware function type
 */
export type SecurityMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => void | Promise<void>;

/**
 * Error handler middleware type
 */
export type ErrorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => void;
