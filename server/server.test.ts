import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {NextFunction, Request, Response} from 'express';

// Module-level mock for express-validator.
// vi.mock() is hoisted to the top of the module by Vitest's transform pass.
// Default returns "no errors"; individual tests override in beforeEach.
vi.mock('express-validator', async (importOriginal) => {
    const actual = await importOriginal<typeof import('express-validator')>();
    return {
        ...actual,
        validationResult: vi.fn(() => ({isEmpty: () => true, array: () => []})),
    };
});

// Validation tests

describe('handleValidationErrors', () => {
    beforeEach(async () => {
        // Reset to "no errors" state before each test
        const {validationResult} = await import('express-validator');
        vi.mocked(validationResult).mockReturnValue({
            isEmpty: () => true,
            array: () => [],
        } as unknown as ReturnType<typeof validationResult>);
    });

    it('should call next() when there are no validation errors', async () => {
        const {handleValidationErrors} = await import('./validation.js');

        const req = {} as Request;
        const res = {status: vi.fn().mockReturnThis(), json: vi.fn()} as unknown as Response;
        const next = vi.fn() as NextFunction;

        handleValidationErrors(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 400 with error details when validation fails', async () => {
        const {validationResult} = await import('express-validator');
        vi.mocked(validationResult).mockReturnValue({
            isEmpty: () => false,
            array: () => [{type: 'field', path: 'prompt', msg: 'Prompt is required'}],
        } as unknown as ReturnType<typeof validationResult>);

        const {handleValidationErrors} = await import('./validation.js');

        const req = {} as Request;
        const jsonMock = vi.fn();
        const res = {
            status: vi.fn().mockReturnValue({json: jsonMock}),
        } as unknown as Response;
        const next = vi.fn() as NextFunction;

        handleValidationErrors(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
            expect.objectContaining({
                error: 'Invalid request',
                details: expect.arrayContaining([
                    expect.objectContaining({field: 'prompt', message: 'Prompt is required'}),
                ]),
            })
        );
        expect(next).not.toHaveBeenCalled();
    });
});

describe('validateRecipeRequest', () => {
    it('should be a non-empty array of validation middleware', async () => {
        const {validateRecipeRequest} = await import('./validation.js');
        expect(Array.isArray(validateRecipeRequest)).toBe(true);
        expect(validateRecipeRequest.length).toBeGreaterThan(0);
    });
});

describe('validateImageRequest', () => {
    it('should be a non-empty array of validation middleware', async () => {
        const {validateImageRequest} = await import('./validation.js');
        expect(Array.isArray(validateImageRequest)).toBe(true);
        expect(validateImageRequest.length).toBeGreaterThan(0);
    });
});

// Security middleware factory tests

describe('createApiLimiter', () => {
    it('should return a middleware function', async () => {
        const {createApiLimiter} = await import('./security.js');
        const limiter = createApiLimiter();
        expect(typeof limiter).toBe('function');
    });

    it('should accept custom windowMs and max parameters', async () => {
        const {createApiLimiter} = await import('./security.js');
        const limiter = createApiLimiter(null, 5000, 10);
        expect(typeof limiter).toBe('function');
    });
});

describe('shouldSkipRateLimiting', () => {
    it('skips /health', async () => {
        const {shouldSkipRateLimiting} = await import('./security.js');
        const req = {path: '/health'} as Request;
        expect(shouldSkipRateLimiting(req)).toBe(true);
    });

    it('skips /recipes/<uuid>/image', async () => {
        const {shouldSkipRateLimiting} = await import('./security.js');
        const req = {path: '/recipes/550e8400-e29b-41d4-a716-446655440000/image'} as Request;
        expect(shouldSkipRateLimiting(req)).toBe(true);
    });

    it('skips /recipes/<short-id>/image', async () => {
        const {shouldSkipRateLimiting} = await import('./security.js');
        const req = {path: '/recipes/abc123/image'} as Request;
        expect(shouldSkipRateLimiting(req)).toBe(true);
    });

    it('does not skip /recipes (list endpoint)', async () => {
        const {shouldSkipRateLimiting} = await import('./security.js');
        const req = {path: '/recipes'} as Request;
        expect(shouldSkipRateLimiting(req)).toBe(false);
    });

    it('does not skip /generate', async () => {
        const {shouldSkipRateLimiting} = await import('./security.js');
        const req = {path: '/generate'} as Request;
        expect(shouldSkipRateLimiting(req)).toBe(false);
    });

    it('does not skip /recipes/<uuid>/data (non-image sub-paths)', async () => {
        const {shouldSkipRateLimiting} = await import('./security.js');
        const req = {path: '/recipes/550e8400-e29b-41d4-a716-446655440000/data'} as Request;
        expect(shouldSkipRateLimiting(req)).toBe(false);
    });
});

describe('createExpensiveOperationLimiter', () => {
    it('should return a middleware function', async () => {
        const {createExpensiveOperationLimiter} = await import('./security.js');
        const limiter = createExpensiveOperationLimiter();
        expect(typeof limiter).toBe('function');
    });
});

describe('createRequestLogger', () => {
    it('should return a middleware function', async () => {
        const {createRequestLogger} = await import('./security.js');
        const logger = createRequestLogger();
        expect(typeof logger).toBe('function');
    });

    it('should call next() and log on response finish', async () => {
        const {createRequestLogger} = await import('./security.js');
        const logger = createRequestLogger();

        const listeners: Record<string, () => void> = {};
        const req = {method: 'GET', path: '/api/health'} as Request;
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
        const {createErrorHandler} = await import('./security.js');
        const handler = createErrorHandler();
        expect(typeof handler).toBe('function');
        expect(handler.length).toBe(4);
    });

    it('should respond with 500 and a generic message for unhandled errors', async () => {
        const {createErrorHandler} = await import('./security.js');
        const handler = createErrorHandler();

        const jsonMock = vi.fn();
        const req = {method: 'POST', path: '/api/recipe'} as Request;
        const res = {
            headersSent: false,
            statusCode: 200,
            status: vi.fn().mockReturnValue({json: jsonMock}),
        } as unknown as Response;
        const next = vi.fn() as NextFunction;

        handler(new Error('Something broke'), req, res, next);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({error: expect.any(String)}));
    });

    it('should delegate to next() if headers are already sent', async () => {
        const {createErrorHandler} = await import('./security.js');
        const handler = createErrorHandler();

        const req = {method: 'GET', path: '/api/health'} as Request;
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
