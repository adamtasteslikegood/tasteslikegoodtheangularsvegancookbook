// Cache-Control for the files express.static serves from the Angular build
// (KAN-362). Everything here was `public, max-age=0`, so a returning visitor
// revalidated the 914 kB bundle on every page.

// Angular's output hashing: `main-7TDZDTLK.js`, `chunk-Bbf9mHX1.js`,
// `styles-URQ2QLMQ.css`. A new build gives changed content a new name, so the
// content behind an old name never changes. Named prefixes, not "anything with
// a dash and eight characters", so an unhashed file can never match by luck.
const HASHED_BUILD_ASSET_RE =
  /^(?:main|chunk|polyfills|styles|scripts)-[A-Za-z0-9_-]{8}\.(?:js|css)$/;

const ONE_YEAR_IMMUTABLE = 'public, max-age=31536000, immutable';
// The RUM scripts keep their names across releases, so they cannot be
// immutable. An hour bounds how long a change to the consent loader takes to
// reach a returning visitor.
const ONE_HOUR = 'public, max-age=3600';

/**
 * The Cache-Control to set for a build file, given its path relative to the
 * build directory, or undefined to keep express.static's default
 * (`public, max-age=0`: revalidate every time). index.html must stay on the
 * default: it is the one file that names the current hashed bundles.
 */
export function staticCacheControl(relativePath: string): string | undefined {
  const normalized = relativePath.split('\\').join('/');
  if (!normalized.includes('/') && HASHED_BUILD_ASSET_RE.test(normalized)) {
    return ONE_YEAR_IMMUTABLE;
  }
  if (/^rum\/[a-z0-9-]+\.js$/.test(normalized)) return ONE_HOUR;
  return undefined;
}
