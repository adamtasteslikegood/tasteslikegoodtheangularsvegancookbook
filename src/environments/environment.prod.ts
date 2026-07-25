/**
 * Production environment configuration.
 *
 * In production the Flask backend is always same-origin: Express proxies
 * /api/* to it, so the SPA only ever uses relative URLs. There is no
 * environment-variable override — this is an Angular CLI build, and the
 * VITE_-prefixed variable this comment used to name was never read.
 */
export const environment = {
  production: true,
  flaskApiUrl: '', // Empty = same-origin (reverse proxy in production)
};
