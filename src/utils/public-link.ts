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

/**
 * KAN-137 — which public page the View link points at.
 *
 * 'own'    — the recipe's own published page (is_public + slug): the publish
 *            toggle and the link agree, render the link normally.
 * 'source' — only the sourceSlug fallback resolves: the link opens the page
 *            this copy was saved FROM, not a page this recipe owns. The UI
 *            must render it visibly differently (muted + explanatory title),
 *            otherwise a publish-capable user sees "toggle off + View
 *            present" and reads it as an inconsistency.
 * null     — no public page; no link.
 */
export function publicLinkKind(recipe: {
  is_public?: boolean;
  slug?: string;
  sourceSlug?: string;
}): 'own' | 'source' | null {
  if (recipe.is_public === true && recipe.slug) {
    return 'own';
  }
  return recipe.sourceSlug ? 'source' : null;
}
