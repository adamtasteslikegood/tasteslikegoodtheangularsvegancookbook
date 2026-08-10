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
 *
 * Derives from publicLinkKind rather than repeating its branches: the two must
 * never disagree (a spec case asserts it), and KAN-212 was a guard that would
 * otherwise have had to be written twice.
 */
export function publicSlugOf(recipe: {
  is_public?: boolean;
  slug?: string;
  sourceSlug?: string;
}): string | null {
  switch (publicLinkKind(recipe)) {
    case 'own':
      return recipe.slug ?? null;
    case 'source':
      return recipe.sourceSlug ?? null;
    default:
      return null;
  }
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
 *
 * KAN-212 — the 'source' fallback assumes the source is some OTHER recipe that
 * is still public. When sourceSlug equals this recipe's own slug, "the source"
 * and "this recipe" are the same page, so unpublishing left the link pointing
 * at the page just taken down: a guaranteed 404, found on live v0.4.9. There is
 * no other recipe to degrade to, so the honest answer is no link at all. The
 * guard is deliberately narrow — an unpublished copy of a DIFFERENT recipe
 * still keeps its link, which is the entire point of the fallback.
 */
export function publicLinkKind(recipe: {
  is_public?: boolean;
  slug?: string;
  sourceSlug?: string;
}): 'own' | 'source' | null {
  if (recipe.is_public === true && recipe.slug) {
    return 'own';
  }
  if (!recipe.sourceSlug || recipe.sourceSlug === recipe.slug) {
    return null;
  }
  return 'source';
}

/**
 * KAN-139 — how the publish toggle should render.
 *
 * 'locked' — canonical recipe: the server rejects unpublish/re-slug/delete
 *            with 400, so the toggle is disabled outright with an
 *            explanatory title.
 * 'manual' — a manually entered, unpublished recipe (KAN-140): the server
 *            rejects publishing it with 400, so the toggle is disabled.
 *            Published manual rows (legacy, pre-gate) fall through to
 *            'normal' — they must stay unpublishable-off but
 *            unpublish-able.
 * 'source' — a copy saved from a public recipe that is not itself
 *            published: rendered greyed and disabled (RCP-74). Publish
 *            state belongs to the source page; togglePublic() short-circuits
 *            with a toast, and the server returns 403 as a backstop.
 * 'normal' — everything else.
 */
export function publishToggleKind(recipe: {
  is_public?: boolean;
  slug?: string;
  sourceSlug?: string;
  is_canonical?: boolean;
  origin?: string;
}): 'locked' | 'manual' | 'source' | 'normal' {
  if (recipe.is_canonical === true) {
    return 'locked';
  }
  if (recipe.origin === 'manual' && recipe.is_public !== true) {
    return 'manual';
  }
  return publicLinkKind(recipe) === 'source' ? 'source' : 'normal';
}
