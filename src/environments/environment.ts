/**
 * Development environment configuration.
 *
 * In dev mode, /api/auth/* requests are proxied to Flask (port 5000)
 * via the Angular dev server proxy (proxy.conf.json), so we can use
 * relative paths. The flaskApiUrl is kept for any direct cross-origin
 * calls if needed.
 */
export const environment = {
  production: false,
  flaskApiUrl: '',  // Empty = use relative paths (proxied in dev)
};
