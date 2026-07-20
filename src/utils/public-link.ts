/**
 * KAN-119 — visibility rule for the "View" link to a recipe's public page.
 *
 * Deliberately a pure function of recipe data with no auth input: viewing a
 * public /r/<slug> page requires no publish rights, so the link must render
 * for guests and in-app-webview visitors (who may be unable to sign in at
 * all — see in-app-browser.ts). Publishing stays gated by canPublish().
 *
 * Two ways a recipe has a public page:
 *  - it is itself published (`is_public` + server-derived `slug`), or
 *  - it was saved from a public page and remembers it via `sourceSlug`
 *    (buildSavedRecipeFromPublic copies neither is_public nor slug — the
 *    guest case would silently never link without this fallback).
 * The own published slug wins when both exist. A sourceSlug target can have
 * been unpublished since saving; worst case is a 404 on a public route, not
 * a leak.
 */
export function publicSlugOf(recipe: {
  is_public?: boolean;
  slug?: string;
  sourceSlug?: string;
}): string | null {
  if (recipe.is_public === true && recipe.slug) {
    return recipe.slug;
  }
  return recipe.sourceSlug || null;
}

export function isPublicViewable(recipe: {
  is_public?: boolean;
  slug?: string;
  sourceSlug?: string;
}): boolean {
  return publicSlugOf(recipe) !== null;
}
