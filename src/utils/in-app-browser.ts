/**
 * In-app browser (embedded webview) detection.
 *
 * Google blocks OAuth inside embedded webviews with
 * `Error 403: disallowed_useragent` (secure-browser policy, enforced since
 * 2021-09-30). Visitors who arrive from a third-party app's in-app browser —
 * most notably Pinterest, one of the largest referral sources for recipe
 * sites — are trapped: tapping "Sign in with Google" fires a request Google
 * refuses to render.
 *
 * These helpers detect that situation from the User-Agent string so the UI can
 * offer an "Open in your browser to sign in" fallback instead of a doomed
 * OAuth redirect. Detection is heuristic — User-Agents are not standardized —
 * so it errs toward known in-app markers rather than guessing aggressively.
 */

/**
 * User-Agent substrings that identify a known in-app browser / embedded
 * webview. Matched case-insensitively. Ordered roughly by referral relevance
 * for a recipe site (Pinterest first).
 */
const IN_APP_BROWSER_MARKERS: readonly string[] = [
  'Pinterest', // Pinterest in-app browser — the primary recipe-referral trigger
  'FBAN', // Facebook app (iOS)
  'FBAV', // Facebook app (version token, iOS/Android)
  'FB_IAB', // Facebook in-app browser (Android)
  'FBIOS',
  'Instagram',
  'Line/', // LINE messenger
  'Twitter', // legacy Twitter app
  'TwitterAndroid',
  'LinkedInApp',
  'Snapchat',
  'musical_ly', // TikTok (legacy token)
  'Bytedance', // TikTok / Bytedance webviews
  'TikTok',
  'WhatsApp',
  'GSA/', // Google Search App in-app browser
];

/**
 * Returns true when the given User-Agent looks like a known third-party
 * in-app browser / embedded webview where Google OAuth is blocked.
 *
 * Pure and side-effect free so it can be unit tested and called safely on the
 * server during SSR (pass `''` when no UA is available).
 */
export function isInAppBrowser(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();

  if (IN_APP_BROWSER_MARKERS.some((marker) => ua.includes(marker.toLowerCase()))) {
    return true;
  }

  // Generic Android System WebView: Chrome's mobile UA plus the `; wv` token
  // (or the legacy `Version/x.x` + Chrome combo used by many wrapped apps).
  // Real Chrome for Android never carries `; wv`.
  if (ua.includes('android') && ua.includes('wv')) {
    return true;
  }

  return false;
}

/**
 * Browser-safe wrapper around {@link isInAppBrowser} that reads the current
 * navigator's User-Agent. Returns false during SSR (no `navigator`), where an
 * OAuth redirect never originates anyway.
 */
export function isInAppBrowserEnvironment(): boolean {
  if (typeof navigator === 'undefined') return false;
  return isInAppBrowser(navigator.userAgent);
}
