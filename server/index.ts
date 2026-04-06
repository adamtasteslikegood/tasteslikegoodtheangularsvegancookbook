import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySecurityMiddleware, createErrorHandler, createRequestLogger } from './security.js';
import { createFlaskProxy } from './proxy.js';

const app = express();
const port = Number.parseInt(process.env.PORT || '8080', 10);
const flaskUrl = process.env.FLASK_BACKEND_URL || 'http://localhost:5000';

// Trust the first proxy (Cloud Run / GFE load balancer) so express-rate-limit
// uses the real client IP from X-Forwarded-For instead of the proxy's IP.
app.set('trust proxy', 1);

// Health check (local to Express — handled before the proxy)
app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Flask proxy routes ──────────────────────────────────────────
// Must be mounted BEFORE express.json() so raw request bodies stream
// through to Flask without being consumed by the JSON parser.
app.use('/api', createFlaskProxy('API'));

// Reduce default JSON payload limit to 50KB for security
app.use(express.json({ limit: '50kb' }));

// Apply security middleware
applySecurityMiddleware(app);

// Request logging
app.use(createRequestLogger());

// ── Static file serving ─────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '..', '..', 'dist');

app.use(express.static(distPath));

app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Error handling middleware (must be last)
app.use(createErrorHandler());

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Flask backend → ${flaskUrl}`);
});
