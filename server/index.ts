import express from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import {
  applySecurityMiddleware,
  createApiLimiter,
  createPageLimiter,
  createErrorHandler,
  createExpensiveOperationLimiter,
  createRequestLogger,
  createRumConfigLimiter,
  createRumIntakeLimiter,
  createMcpLimiter,
} from './security.js';
import { createRumRouter, resolveRumConfig } from './rum.js';
import { createFlaskProxy } from './proxy.js';
import { mountGenerationLimiter } from './agent-tools.js';
import { applyTrustProxy } from './trust-proxy.js';
import { createAiValidation } from './validation.js';
import { createWritePause } from './write-pause.js';
import { createValkeyClient, shutdownValkey } from './valkey.js';
import { absoluteRequestPath, classifyRoute } from './route-manifest.js';
import { MCP_PATH } from './api-catalog.js';
import {
  createRouteNeutralSpaShellGetter,
  mountCanonicalHostRedirect,
  mountHealthAndCompression,
  mountPublicAndSsrRoutes,
  mountStagingMiddleware,
} from './middleware.js';

// Exported for route-mounting integration tests (server/routes.test.ts).
export const app = express();
const port = Number.parseInt(process.env.PORT || '8080', 10);
const flaskUrl = process.env.FLASK_BACKEND_URL || 'http://localhost:5000';

// Trust the external load balancer's hops so req.ip (rate-limit keys, RUM geo)
// is the visitor, not the LB, without trusting a direct internal caller's
// X-Forwarded-For. Policy and reasoning: ./trust-proxy.ts.
applyTrustProxy(app);

// Module-level reference so the graceful-shutdown handler can close it.
let server: Server | null = null;

// ── Async startup ───────────────────────────────────────────────
// Exported so tests can await route mounting; under Vitest the routes are
// mounted but the HTTP listener is not started (tests call app.listen(0)).
export const ready = (async () => {
  // Connect to Valkey for shared rate limiting (falls back to in-memory)
  const valkeyClient = await createValkeyClient();

  mountCanonicalHostRedirect(app);

  const isStaging = process.env.NODE_ENV === 'staging';
  mountStagingMiddleware(app, isStaging);

  mountHealthAndCompression(app, isStaging, Boolean(valkeyClient));

  // General: 300 req / 15 min per IP (image serving is exempt)
  app.use('/api', createApiLimiter(valkeyClient));
  // Expensive AI operations: 20 req / hour per IP
  // The agent generation tools (KAN-401) spend the same budget.
  mountGenerationLimiter(app, createExpensiveOperationLimiter(valkeyClient));
  // Public HTML surface (SPA shell, SSR pages, standalone static pages).
  // KAN-154: its own limiter, not a second createApiLimiter — that shared the
  // `rl:api:` Valkey keyspace with the /api limiter above, and it metered
  // static subresources as if they were navigations.
  const staticPageLimiter = createPageLimiter(valkeyClient);

  // Apply security middleware (Helmet headers) and request logging before
  // the Flask proxy so that security headers and telemetry cover all
  // responses, including proxied /api/* traffic.
  applySecurityMiddleware(app);
  app.use(createRequestLogger());

  // ── Recipe write pause (KAN-330) ────────────────────────────────
  // RECIPE_WRITE_PAUSE=1 answers every write to /api/recipes*,
  // /api/generate* and the agent generation tools with a 503 before the body is buffered or proxied, so a
  // publish-state audit can run against a database nothing is changing.
  app.use('/api', createWritePause());

  // ── Input validation for AI endpoints ───────────────────────────
  // Buffers + validates JSON bodies for POST /api/generate and
  // POST /api/generate_image, rejecting malformed/oversized payloads before
  // they reach Flask. Valid requests carry req.rawBody, which the proxy
  // replays to Flask verbatim. All other /api/* routes pass through
  // untouched and keep raw streaming (see server/validation.ts).
  app.use('/api', createAiValidation());

  // ── Flask proxy routes ──────────────────────────────────────────
  // Must be mounted BEFORE express.json() so raw request bodies stream
  // through to Flask without being consumed by the JSON parser (the AI
  // endpoints above are the deliberate buffer-and-replay exception).
  app.use('/api', createFlaskProxy('API'));

  // MCP endpoint (KAN-399): Flask answers POST; GET and DELETE get Flask's 405.
  // Exact path only, all methods, its own limiter (it is outside /api).
  app.all(MCP_PATH, createMcpLimiter(valkeyClient), createFlaskProxy('MCP'));

  // ── Datadog RUM (KAN-292) ───────────────────────────────────────
  // GET /rum/config feeds the consent loader (public/rum/consent.js);
  // POST /rum/intake is the same-origin intake proxy that keeps the CSP's
  // connect-src at 'self'. Mounted before express.json(): the intake route
  // reads its body raw. RUM is off (no banner, intake 404) until
  // DATADOG_RUM_APPLICATION_ID and DATADOG_RUM_CLIENT_TOKEN are set.
  // Source runs from server/ (tests), production from server/dist/.
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(serverDir, path.basename(serverDir) === 'dist' ? '../..' : '..');
  const packageVersion = await readFile(path.join(repoRoot, 'package.json'), 'utf8')
    .then((raw) => String((JSON.parse(raw) as { version?: unknown }).version ?? '0.0.0'))
    .catch(() => '0.0.0');
  app.use(
    createRumRouter({
      config: resolveRumConfig(process.env, packageVersion),
      configLimiter: createRumConfigLimiter(valkeyClient),
      intakeLimiter: createRumIntakeLimiter(valkeyClient),
    })
  );

  // Reduce default JSON payload limit to 50KB for security
  app.use(express.json({ limit: '50kb' }));

  // ── Static file serving ─────────────────────────────────────────
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // SPA_DIST_DIR is a test-only override: under Vitest this module runs from
  // server/ (not the compiled server/dist/), so the relative resolution lands
  // outside the repo and the SPA catch-all would have no index.html to serve.
  // routes.test.ts points it at a stub dist/ fixture to exercise the catch-all.
  const distPath = process.env.SPA_DIST_DIR
    ? path.resolve(process.env.SPA_DIST_DIR)
    : path.resolve(__dirname, '..', '..', 'dist');

  const spaIndexPath = path.join(distPath, 'index.html');
  const getRouteNeutralSpaShell = createRouteNeutralSpaShellGetter(spaIndexPath, isStaging);

  // Source tests execute from server/, while production runs the compiled file
  // from server/dist/. Resolve the checked-in server/public directory in both
  // modes so standalone pages are testable through the real Express route.
  // Every sendFile below passes `root` instead of an absolute path: `send`
  // refuses any absolute path with a dot-segment (dotfiles: 'ignore'), so a
  // checkout under e.g. .claude/worktrees/ 404'd /favicon.ico and /about. With
  // `root`, only the requested name is checked for dotfiles.
  const publicPath =
    path.basename(__dirname) === 'dist'
      ? path.resolve(__dirname, '..', 'public')
      : path.resolve(__dirname, 'public');

  const newestRecipesPreload = mountPublicAndSsrRoutes(app, {
    distPath,
    publicPath,
    spaIndexPath,
    flaskUrl,
    staticPageLimiter,
  });

  app.get('{*path}', staticPageLimiter, async (req, res) => {
    // Classified through absoluteRequestPath() — the same composed,
    // trailing-slash-trimmed path security.ts asks the manifest about — so
    // `/kitchen/` reads as the SPA route it is rather than an unknown path.
    const routePath = absoluteRequestPath(req);
    const routeClass = classifyRoute(routePath);

    // KAN-276: the home page is the only SPA shell worth indexing. Every
    // other shell response is either a private per-user surface (/kitchen),
    // a duplicate of a public SSR page (/recipe/<id> vs /r/<slug>), or a
    // soft-404, and all of them carry the home page's canonical. Overrides
    // the production `index, follow` security.ts set earlier in the chain.
    // Staging is left alone: its global `noindex, nofollow` is stricter.
    if (routePath !== '/' && !isStaging) {
      res.setHeader('X-Robots-Tag', 'noindex, follow');
    }

    // RCP-77 AC4 (KAN-160): an asset-like path reaching the catch-all was not
    // found by express.static or any earlier route. Serving index.html here
    // would answer 200 text/html for a missing .js/.css/.map — the browser
    // refuses it under nosniff and crawlers see soft-404 shell spam. 404
    // instead. Classification comes from the route manifest so the policy
    // lives in one place (server/route-manifest.ts).
    if (routeClass === 'asset') {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    // KAN-276: a path that is not a known SPA route is a real 404, not a
    // soft one. The shell is still served so the browser lands somewhere
    // sensible (Angular's `**` route redirects to the home page).
    if (routeClass === 'unknown') {
      res.status(404);
      // KAN-285: no cache should hold a 404 shell. Set before either send
      // below; `send` leaves an existing Cache-Control header alone.
      res.setHeader('Cache-Control', 'no-store');
    }
    // KAN-272: only the home page gets the full shell with its landing copy
    // and home metadata; express.static normally answers "/" first, so this
    // is a safety net. Every other route gets the route-neutral shell.
    if (routePath === '/') {
      res.sendFile('index.html', { root: distPath });
      return;
    }
    let neutralShell: string;
    try {
      neutralShell = await getRouteNeutralSpaShell();
    } catch (err) {
      // A shell we cannot neutralise (no sentinels, no <app-root>) must not
      // take every non-home route down with a 500. Fall back to the full
      // shell: the pre-KAN-272 behaviour, a flash of home copy at worst.
      console.warn('[spa] serving the full shell; route-neutral shell unavailable:', err);
      res.sendFile('index.html', { root: distPath });
      return;
    }
    // Mirror the Cache-Control the / sendFile branch inherits from Express's
    // static/send defaults so intermediaries don't cache the noindex shell
    // longer than the indexable home shell. A 404 keeps its no-store.
    if (routeClass !== 'unknown') res.setHeader('Cache-Control', 'public, max-age=0');
    res.type('html').send(neutralShell);
  });

  // Error handling middleware (must be last)
  app.use(createErrorHandler());

  await newestRecipesPreload;

  // Skip the real listener under test runners: Vitest sets VITEST itself,
  // and NODE_ENV=test covers any other harness importing this module.
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return;

  server = app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Flask backend → ${flaskUrl}`);
    console.log(`Rate limit store: ${valkeyClient ? 'Valkey' : 'in-memory'}`);
  });
})();

ready.catch((err) => {
  console.error('Fatal error during server startup:', err);
  process.exit(1);
});

// Graceful shutdown on SIGTERM / SIGINT
// Drains in-flight HTTP connections, stops the Valkey token-refresh timer,
// and closes the Redis connection so Cloud Run terminations and local dev
// restarts don't leave dangling handles or abruptly terminate requests.
let isShuttingDown = false;

const gracefulShutdown = async (signal: string): Promise<void> => {
  // Guard: ignore duplicate signals (e.g. two rapid Ctrl-C presses)
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[Server] Received ${signal}, shutting down gracefully...`);
  try {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    await shutdownValkey();
    process.exit(0);
  } catch (err) {
    console.error('[Server] Error during graceful shutdown (forcing exit):', err);
    process.exit(1);
  }
};

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
