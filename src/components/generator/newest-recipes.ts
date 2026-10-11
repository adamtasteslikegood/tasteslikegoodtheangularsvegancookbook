/**
 * The home page's newest-recipes row, as the server wrote it (KAN-348).
 *
 * Express writes the row into index.html inside <app-root>, and bootstrapping
 * Angular replaces everything in <app-root>. So the links are read here, when
 * this module is first evaluated: module scripts run after the document is
 * parsed and before `bootstrapApplication`. The landing page then renders the
 * same list, with no second request and no row that flashes and disappears.
 */
export interface NewestRecipeLink {
  href: string;
  label: string;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NEWEST_RECIPES_LIMIT = 8;
// Match the server's hard upper bound (2 * its three-minute cache TTL).
// After this, an SPA revisit must not reuse the boot-time row indefinitely.
const NEWEST_RECIPES_MAX_AGE_MS = 6 * 60_000;

const parseNewestRecipesPayload = (payload: unknown): NewestRecipeLink[] => {
  const rows = (payload as { recipes?: unknown } | null)?.recipes;
  if (!Array.isArray(rows)) return [];
  const links: NewestRecipeLink[] = [];
  for (const row of rows) {
    const { slug, name } = (row ?? {}) as { slug?: unknown; name?: unknown };
    if (typeof slug !== 'string' || !SLUG_RE.test(slug) || slug.length > 200) continue;
    if (typeof name !== 'string') continue;
    const label = name.trim();
    if (!label || label.length > 200) continue;
    links.push({ href: `/r/${slug}`, label });
    if (links.length === NEWEST_RECIPES_LIMIT) break;
  }
  return links;
};

export function readNewestRecipes(doc: Pick<Document, 'querySelectorAll'>): NewestRecipeLink[] {
  const anchors = doc.querySelectorAll(
    'nav[aria-labelledby="landing-newest-title"] a[href^="/r/"]'
  );
  return Array.from(anchors, (anchor) => ({
    href: anchor.getAttribute('href') ?? '',
    label: (anchor.textContent ?? '').trim(),
  })).filter((link) => link.href && link.label);
}

export const SERVER_NEWEST_RECIPES: readonly NewestRecipeLink[] =
  typeof document === 'undefined' ? [] : readNewestRecipes(document);
const SERVER_NEWEST_RECIPES_CAPTURED_AT = Date.now();

/**
 * True when the browser should ask for the row itself: the page arrived with
 * none (a route-neutral shell, or a home page served while Flask had no
 * answer), or the row read at boot has aged out.
 */
export function needsNewestRecipesFallback(
  links: readonly NewestRecipeLink[],
  now = Date.now(),
  capturedAt = SERVER_NEWEST_RECIPES_CAPTURED_AT
): boolean {
  return links.length === 0 || now - capturedAt >= NEWEST_RECIPES_MAX_AGE_MS;
}

/**
 * The longest the fallback fetch may take. The server bounds its own fetch for
 * the same reason (server/newest-recipes.ts); a browser has no default limit,
 * so a stalled backend would leave the request open for the life of the page.
 */
export const NEWEST_RECIPES_FETCH_TIMEOUT_MS = 4_000;

/**
 * Load the row in the browser, when `needsNewestRecipesFallback` says so.
 * Answers [] on any failure, including the timeout.
 */
export async function fetchNewestRecipes(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = NEWEST_RECIPES_FETCH_TIMEOUT_MS
): Promise<readonly NewestRecipeLink[]> {
  try {
    const response = await fetchImpl(`/api/public/newest-recipes?limit=${NEWEST_RECIPES_LIMIT}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return [];
    return parseNewestRecipesPayload(await response.json());
  } catch {
    return [];
  }
}
