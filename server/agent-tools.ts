import type { RequestHandler } from 'express';

/**
 * KAN-401: which agent tool calls generate.
 *
 * Flask serves the agent tools at POST /api/agent/tools/<name>
 * (Backend `services/agent_tools.py`). A tool whose name starts with
 * `generate_` spends a paid model call and writes a recipe row, so it gets the
 * same treatment here as /api/generate: the expensive-operation limit and the
 * recipe write pause. The read tools (`search_recipes`, `get_recipe`,
 * `get_generation_status`) do not.
 *
 * The match is on the name prefix, so a generation tool added in Flask is
 * covered without a change here, provided it keeps the `generate_` prefix.
 */
const AGENT_GENERATION_PATH = /^\/agent\/tools\/generate_/;

/**
 * `path` is relative to the /api mount. The proxy forwards the URL verbatim
 * and Flask decodes it before routing, so /agent/tools/generate%5Frecipe is
 * served as generate_recipe: match the decoded spelling. A path that does not
 * decode is treated as a generation call.
 */
export function isAgentGenerationPath(path: string): boolean {
  try {
    return AGENT_GENERATION_PATH.test(decodeURIComponent(path));
  } catch {
    return true;
  }
}

/** Run `handler` for agent generation calls only. Mount at /api. */
export function forAgentGeneration(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    if (isAgentGenerationPath(req.path)) {
      handler(req, res, next);
      return;
    }
    next();
  };
}
