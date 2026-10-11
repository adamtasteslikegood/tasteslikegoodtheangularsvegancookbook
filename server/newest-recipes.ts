// The home page's newest-recipes row (KAN-348).
//
// Home is the one page crawlers visit often, and a build-time list would go
// stale between releases. So Express asks Flask for the newest public recipes,
// keeps the answer for a few minutes, and writes the links into the home shell
// at a marker. This is the one place Express composes HTML from Flask data; it
// holds no recipe logic of its own. Order and visibility are Flask's
// (`/api/public/newest-recipes`, ordered by first_published_at).
//
// The row is an addition, never a dependency: with no list (Flask slow, down,
// or answering nonsense) the shell is served exactly as built, and the fixed
// recipe links in its <noscript> block are what a crawler finds.

import { getFlaskAuthHeader } from './flask-auth.js';

export interface NewestRecipe {
  slug: string;
  name: string;
}

/** Shared with index.html, the Angular landing page and landing-copy.test.ts. */
export const NEWEST_RECIPES_HEADING = 'Newest vegan recipes';
export const NEWEST_RECIPES_LIMIT = 8;

/**
 * A list younger than this is served as is. Between one and two TTLs it is
 * still served while a refresh runs behind it; past two TTLs it is not served
 * at all. So two TTLs is the longest an unpublished recipe can stay linked
 * from home (the link then answers 410).
 */
export const NEWEST_RECIPES_TTL_MS = 3 * 60_000;
/** The most a home request ever waits on Flask, and only when it has no usable list. */
const FETCH_TIMEOUT_MS = 1_500;
const FAILURE_LOG_INTERVAL_MS = 60_000;

// An element, not a comment: Angular's production HTML minification drops
// comments (see spa-shell.ts). Tolerant of quote style and attribute order.
const MARKER_RE =
  /<div\s+[^>]*id=(?:"tlg-newest-recipes"|'tlg-newest-recipes'|tlg-newest-recipes(?=[\s>]))[^>]*>\s*<\/div>/i;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);

/** True when the shell still has the marker the row is written into. */
export function hasNewestRecipesMarker(shell: string): boolean {
  return MARKER_RE.test(shell);
}

/**
 * Keep only rows that are safe to link: a slug in the public-URL alphabet and
 * a non-empty name. Anything else in the payload is dropped, not repaired.
 */
export function parseNewestRecipes(payload: unknown): NewestRecipe[] {
  const rows = (payload as { recipes?: unknown } | null)?.recipes;
  if (!Array.isArray(rows)) return [];
  const recipes: NewestRecipe[] = [];
  for (const row of rows) {
    const { slug, name } = (row ?? {}) as { slug?: unknown; name?: unknown };
    if (typeof slug !== 'string' || !SLUG_RE.test(slug) || slug.length > 200) continue;
    if (typeof name !== 'string' || !name.trim()) continue;
    recipes.push({ slug, name: name.trim() });
    if (recipes.length === NEWEST_RECIPES_LIMIT) break;
  }
  return recipes;
}

/** Same classes as the "Browse by category" block it sits under in index.html. */
export function renderNewestRecipes(recipes: readonly NewestRecipe[]): string {
  const items = recipes
    .map(
      (recipe) =>
        `<li><a href="/r/${recipe.slug}" class="font-bold text-green-800 underline underline-offset-2">${escapeHtml(recipe.name)}</a></li>`
    )
    .join('');
  return (
    '<nav aria-labelledby="landing-newest-title">' +
    `<h2 id="landing-newest-title" class="text-2xl font-bold text-stone-800 mb-4">${NEWEST_RECIPES_HEADING}</h2>` +
    `<ul class="flex flex-wrap gap-x-5 gap-y-2 max-w-3xl">${items}</ul>` +
    '</nav>'
  );
}

/** The home shell with the row written in, or the shell untouched. */
export function injectNewestRecipes(shell: string, recipes: readonly NewestRecipe[]): string {
  if (recipes.length === 0) return shell;
  // A replacer function, so `$` in a recipe name is never read as a pattern.
  return shell.replace(MARKER_RE, () => renderNewestRecipes(recipes));
}

export interface NewestRecipesSource {
  /**
   * The list to render now; empty means "serve the shell as built". Waits on
   * Flask only when there is no usable list (first request, or the instance
   * sat idle past two TTLs), and then for at most the fetch timeout.
   */
  get(): Promise<readonly NewestRecipe[]>;
  /** Start (or join) a refresh. Resolves when it settles; never rejects. */
  refresh(): Promise<void>;
}

export interface NewestRecipesSourceOptions {
  flaskUrl: string;
  ttlMs?: number;
  timeoutMs?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
  authHeader?: () => Promise<string | null>;
}

export function createNewestRecipesSource(
  options: NewestRecipesSourceOptions
): NewestRecipesSource {
  const {
    flaskUrl,
    ttlMs = NEWEST_RECIPES_TTL_MS,
    timeoutMs = FETCH_TIMEOUT_MS,
    now = Date.now,
    fetchImpl = fetch,
    authHeader = getFlaskAuthHeader,
  } = options;
  const endpoint = new URL(`/api/public/newest-recipes?limit=${NEWEST_RECIPES_LIMIT}`, flaskUrl);

  let recipes: readonly NewestRecipe[] = [];
  let fetchedAt: number | null = null;
  let inFlight: Promise<void> | null = null;
  let lastFailureLoggedAt = -Infinity;

  const load = async (): Promise<void> => {
    try {
      const headers: Record<string, string> = { accept: 'application/json' };
      const auth = await authHeader();
      if (auth) headers.authorization = auth;
      const response = await fetchImpl(endpoint, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`Flask answered ${response.status}`);
      recipes = parseNewestRecipes(await response.json());
    } catch (err) {
      // Drop the old list rather than keep serving it: it may link a recipe
      // that has since been unpublished.
      recipes = [];
      if (now() - lastFailureLoggedAt >= FAILURE_LOG_INTERVAL_MS) {
        lastFailureLoggedAt = now();
        console.warn(
          '[newest-recipes] list unavailable; home is served without the row:',
          (err as Error).message
        );
      }
    } finally {
      // Stamp failures too, so a down Flask is retried once per TTL and not
      // on every home request.
      fetchedAt = now();
    }
  };

  const refresh = (): Promise<void> => {
    inFlight ??= load().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    async get() {
      const age = fetchedAt === null ? Infinity : now() - fetchedAt;
      if (age >= 2 * ttlMs) await refresh();
      else if (age >= ttlMs) void refresh();
      return recipes;
    },
    refresh,
  };
}
