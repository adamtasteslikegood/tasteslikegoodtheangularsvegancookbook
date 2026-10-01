import siteNav from '../site-nav.json';
import type { Cookbook } from '../auth.types';
import type { Recipe } from '../recipe.types';

/**
 * KAN-295 / KAN-321 — the SPA's visible breadcrumb trails.
 *
 * Breadcrumbs stay on their own side of auth (KAN-321, Adam). The in-app
 * trails start at My Kitchen and link only to in-app routes (/kitchen,
 * /kitchen/<cookbookId>, /recipe/<id>). The public SSR trail
 * (Backend `public_bp._breadcrumbs`: Home → Browse → [hub] → recipe) belongs
 * to the /r/<slug> page alone; showing it on the signed-in recipe page sent
 * users into /browse hubs that never lead back to the Kitchen. The recipe
 * page's "View ↗" link is the one deliberate exit to the public side.
 *
 * No Home crumb in-app: the SPA "/" is the Generator landing, the indexable
 * public-facing page, not the root of the Kitchen.
 *
 * URLs are same-origin paths: the SPA only uses relative URLs.
 */
export interface Crumb {
  name: string;
  url: string;
}

/** The header's label, so the trail and the nav agree (KAN-294). */
export const KITCHEN_CRUMB: Crumb = {
  name: siteNav.header.find((link) => link.href === '/kitchen')?.label ?? 'My Kitchen',
  url: '/kitchen',
};

/** `/kitchen/<id>`: a cookbook is a route (KAN-321), so back/forward and reload keep it. */
export function cookbookUrl(cookbookId: string): string {
  return `${KITCHEN_CRUMB.url}/${encodeURIComponent(cookbookId)}`;
}

/**
 * The rule as a predicate: the only destinations an in-app crumb may have.
 * The breadcrumb component links nothing else.
 */
export function isInAppCrumbPath(url: string): boolean {
  return url === KITCHEN_CRUMB.url || /^\/(kitchen|recipe)\/[^/]+$/.test(url);
}

/** My Kitchen [→ cookbook]. */
export function kitchenTrail(cookbook?: Pick<Cookbook, 'id' | 'name'> | null): Crumb[] {
  return cookbook
    ? [KITCHEN_CRUMB, { name: cookbook.name, url: cookbookUrl(cookbook.id) }]
    : [KITCHEN_CRUMB];
}

/**
 * My Kitchen [→ cookbook] → recipe. Published or not: the recipe page is the
 * Kitchen's view of the recipe, so its trail never names a public hub.
 */
export function recipeTrail(
  recipe: Pick<Recipe, 'id' | 'name'>,
  cookbook?: Pick<Cookbook, 'id' | 'name'> | null
): Crumb[] {
  return [
    ...kitchenTrail(cookbook),
    { name: recipe.name, url: `/recipe/${encodeURIComponent(recipe.id)}` },
  ];
}
