import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import {
  applySecurityMiddleware,
  createApiLimiter,
  createErrorHandler,
  createExpensiveOperationLimiter,
  createRequestLogger,
} from './security.js';
import { createFlaskProxy } from './proxy.js';
import { createValkeyClient, shutdownValkey } from './valkey.js';

const app = express();
const port = Number.parseInt(process.env.PORT || '8080', 10);
const flaskUrl = process.env.FLASK_BACKEND_URL || 'http://localhost:5000';

// Trust the first proxy (Cloud Run / GFE load balancer) so express-rate-limit
// uses the real client IP from X-Forwarded-For instead of the proxy's IP.
app.set('trust proxy', 1);

// Module-level reference so the graceful-shutdown handler can close it.
let server: Server | null = null;

// ── Async startup ───────────────────────────────────────────────
(async () => {
  // Connect to Valkey for shared rate limiting (falls back to in-memory)
  const valkeyClient = await createValkeyClient();

  // Health check (local to Express — handled before the proxy)
  app.get('/api/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      rateLimitStore: valkeyClient ? 'valkey' : 'memory',
    });
  });

  // ── Rate limiters (before proxy so they protect Flask) ──────────
  // General: 300 req / 15 min per IP (image serving is exempt)
  app.use('/api', createApiLimiter(valkeyClient));
  // Expensive AI operations: 20 req / hour per IP
  app.use('/api/generate', createExpensiveOperationLimiter(valkeyClient));
  app.use('/api/generate_image', createExpensiveOperationLimiter(valkeyClient));
  // Static HTML shell (index.html) catch-all: reuse general API limiter
  const staticPageLimiter = createApiLimiter(valkeyClient);

  // Apply security middleware (Helmet headers) and request logging before
  // the Flask proxy so that security headers and telemetry cover all
  // responses, including proxied /api/* traffic.
  applySecurityMiddleware(app);
  app.use(createRequestLogger());

  // ── Flask proxy routes ──────────────────────────────────────────
  // Must be mounted BEFORE express.json() so raw request bodies stream
  // through to Flask without being consumed by the JSON parser.
  app.use('/api', createFlaskProxy('API'));

  // Reduce default JSON payload limit to 50KB for security
  app.use(express.json({ limit: '50kb' }));

  // ── Static file serving ─────────────────────────────────────────
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const distPath = path.resolve(__dirname, '..', '..', 'dist');

  app.use(express.static(distPath));

  // Privacy policy — served as a standalone static HTML page.
  // Must be mounted BEFORE the SPA catch-all so it isn't swallowed by index.html.
  const publicPath = path.resolve(__dirname, '..', 'public');
  app.get('/privacy-policy', staticPageLimiter, (_req, res) => {
    res.sendFile(path.join(publicPath, 'privacy-policy.html'));
  });

  app.get('*', staticPageLimiter, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });

  // Error handling middleware (must be last)
  app.use(createErrorHandler());

  server = app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Flask backend → ${flaskUrl}`);
    console.log(`Rate limit store: ${valkeyClient ? 'Valkey' : 'in-memory'}`);
  });
})().catch((err) => {
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
