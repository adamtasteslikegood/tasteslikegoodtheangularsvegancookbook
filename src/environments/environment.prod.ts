/**
 * Production environment configuration.
 *
 * In production, the Flask backend is either co-located behind
 * a reverse proxy (same origin) or set via VITE_FLASK_API_URL.
 */
export const environment = {
  production: true,
  flaskApiUrl: '',  // Empty = same-origin (reverse proxy in production)
};
