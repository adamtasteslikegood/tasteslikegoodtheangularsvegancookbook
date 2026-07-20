/**
 * KAN-119 — visibility rule for the "View" link to a recipe's public page.
 *
 * Deliberately a pure function of recipe data with no auth input: viewing a
 * public /r/<slug> page requires no publish rights, so the link must render
 * for guests and in-app-webview visitors (who may be unable to sign in at
 * all — see in-app-browser.ts). Publishing stays gated by canPublish().
 *
 * The slug guard prevents ever rendering href="/r/undefined" for a recipe
 * whose public flag is set but whose server-derived slug hasn't synced yet.
 */
export function isPublicViewable(recipe: { is_public?: boolean; slug?: string }): boolean {
  return recipe.is_public === true && !!recipe.slug;
}
