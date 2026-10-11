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

export const INITIAL_PAGE_PATH = typeof location === 'undefined' ? '/' : location.pathname;

export function needsNewestRecipesFallback(
  initialPath: string,
  links: readonly NewestRecipeLink[]
): boolean {
  return initialPath !== '/' && links.length === 0;
}

/** Load the row only when an SPA session started on a route-neutral shell. */
export async function fetchNewestRecipes(
  fetchImpl: typeof fetch = fetch
): Promise<readonly NewestRecipeLink[]> {
  try {
    const response = await fetchImpl(`/api/public/newest-recipes?limit=${NEWEST_RECIPES_LIMIT}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return [];
    return parseNewestRecipesPayload(await response.json());
  } catch {
    return [];
  }
}
