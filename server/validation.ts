/**
 * Express-layer input validation for the AI generation endpoints.
 *
 * The Flask proxy (server/proxy.ts) is mounted before express.json() so raw
 * request bodies stream through to Flask untouched. That means validation
 * middleware here must NOT leave the body stream consumed-but-unforwarded:
 * for the two expensive AI endpoints this module buffers the JSON body
 * (capped at AI_REQUEST_BODY_LIMIT), validates it with express-validator,
 * and stashes the exact bytes it validated on req.rawBody so the proxy can
 * replay them to Flask. Every other /api/* route is untouched and keeps the
 * raw streaming behavior.
 *
 * Rules mirror Flask's own checks (Backend/blueprints/generation_bp.py
 * validate_generation_input and generation_api_bp.py) so a request rejected
 * here would have been rejected by Flask anyway — this layer just stops
 * malformed and oversized payloads before they consume a proxied connection
 * and a Flask worker.
 */

import express, { Router } from 'express';
import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';

/** Request augmented with the buffered raw body the proxy replays to Flask. */
export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

// Legitimate AI payloads are tiny (a ≤500-char prompt or a UUID), so cap the
// body well below the app-wide 50kb express.json limit.
export const AI_REQUEST_BODY_LIMIT = '10kb';

// Gemini model identifiers: optional "models/" prefix, then one segment of
// letters, digits, dots, dashes, and underscores (e.g.
// "models/gemini-3.1-pro-preview", "gemini-2.5-flash"). No other slashes, so
// path-like values ("models/../v1", "a/b/c") are rejected at the boundary.
const MODEL_NAME_RE = /^(?:models\/)?[A-Za-z0-9._-]{1,120}$/;

/**
 * JSON body parser scoped to the AI endpoints. The verify hook captures the
 * buffered bytes before parsing so the proxy can forward the bytes that were
 * validated (post-decompression if the request was encoded — body-parser
 * inflates gzip/deflate/br bodies before verify runs, which is why the proxy
 * strips content-encoding and recomputes content-length when replaying).
 */
function createAiBodyParser() {
  return express.json({
    limit: AI_REQUEST_BODY_LIMIT,
    verify: (req, _res, buf) => {
      (req as RawBodyRequest).rawBody = buf;
    },
  });
}

// Validation chain for POST /api/generate — mirrors Flask's
// validate_generation_input messages so the SPA surfaces identical errors.
const generateRules = [
  body('prompt')
    .exists({ values: 'falsy' })
    .withMessage('A prompt describing the desired recipe is required.')
    .bail()
    .isString()
    .withMessage('Prompt must be a string.')
    .bail()
    // No .trim(): Flask's validate_generation_input length-checks the raw
    // string and the proxy replays req.rawBody verbatim, so the value
    // validated here must be byte-identical to what Flask validates.
    .isLength({ min: 10 })
    .withMessage('Prompt must be at least 10 characters.')
    .isLength({ max: 500 })
    .withMessage('Prompt must be no more than 500 characters.'),
  body('model')
    .optional({ values: 'null' })
    .isString()
    .withMessage('Model must be a string.')
    .bail()
    .matches(MODEL_NAME_RE)
    .withMessage('Model name contains invalid characters.'),
];

// Validation chain for POST /api/generate_image.
const generateImageRules = [
  body('recipe_id')
    .exists({ values: 'falsy' })
    .withMessage('recipe_id is required')
    .bail()
    .isString()
    .withMessage('recipe_id must be a string.')
    .bail()
    .isUUID()
    .withMessage('recipe_id must be a valid UUID.'),
  body('force_regenerate')
    .optional()
    .isBoolean({ strict: true })
    .withMessage('force_regenerate must be a boolean.'),
];

/**
 * Terminal middleware for a validation chain: 400 with the first error in
 * Flask's { error: "..." } shape, or next() into the proxy when clean.
 */
function rejectInvalid(req: Request, res: Response, next: NextFunction): void {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    next();
    return;
  }
  res.status(400).json({ error: errors.array({ onlyFirstError: true })[0].msg });
}

/**
 * Converts body-parser failures (oversized payload, malformed JSON, bad
 * content encoding) into JSON error responses matching Flask's shape instead
 * of falling through to the generic 500 handler. Non-client errors are
 * delegated to the app-level error handler.
 */
const bodyParserErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  const status: unknown = (err as { status?: unknown }).status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({
      error: status === 413 ? 'Request body too large.' : 'Request body must be valid JSON.',
    });
    return;
  }
  next(err);
};

/**
 * Router mounted on /api BEFORE the Flask proxy. Only POSTs to the two AI
 * endpoints are intercepted; everything else falls through untouched so the
 * proxy still streams raw bodies for the rest of the API surface.
 */
export function createAiValidation(): Router {
  const router = Router();
  const parseAiJson = createAiBodyParser();
  router.post('/generate', parseAiJson, ...generateRules, rejectInvalid);
  router.post('/generate_image', parseAiJson, ...generateImageRules, rejectInvalid);
  router.use(bodyParserErrorHandler);
  return router;
}
