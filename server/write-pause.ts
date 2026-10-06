import type { RequestHandler } from 'express';

/**
 * KAN-330 — the recipe write pause.
 *
 * While the publish-state audit runs on the database, nothing may change a
 * recipe row: a save that lands between the listing and the cutover would be
 * judged against stale data. With `RECIPE_WRITE_PAUSE=1` every mutating request
 * under `/api/recipes` and `/api/generate` stops here with a 503 the SPA can
 * name (`code`), before the body is buffered and before Flask sees it. Reads,
 * the health check and every other API route are untouched, so browsing and
 * the kitchen keep working.
 *
 * The flag is read on every request rather than at import: the pause is lifted
 * by removing the variable, and a per-request read means a single test file
 * can cover both states without re-importing the app.
 */
export const RECIPE_WRITE_PAUSE_CODE = 'RECIPE_WRITE_PAUSE';

export const RECIPE_WRITE_PAUSE_MESSAGE =
  'Recipes are read-only for a few minutes while we finish some maintenance. Nothing was saved — please try again shortly.';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Mount-relative (the handler is mounted at /api): /recipes, /recipes/<id>,
// /generate and /generate_image — nothing else.
const PAUSED_PATHS = /^\/(?:recipes|generate)(?:[/_]|$)/;

export function isRecipeWritePaused(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env['RECIPE_WRITE_PAUSE'] === '1';
}

export function createWritePause(isPaused: () => boolean = isRecipeWritePaused): RequestHandler {
  return (req, res, next) => {
    if (!isPaused() || !MUTATING_METHODS.has(req.method) || !PAUSED_PATHS.test(req.path)) {
      next();
      return;
    }
    res
      .status(503)
      .set('Retry-After', '120')
      .json({ error: RECIPE_WRITE_PAUSE_MESSAGE, code: RECIPE_WRITE_PAUSE_CODE });
  };
}
