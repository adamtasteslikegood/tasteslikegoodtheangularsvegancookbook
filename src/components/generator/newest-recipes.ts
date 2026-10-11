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
