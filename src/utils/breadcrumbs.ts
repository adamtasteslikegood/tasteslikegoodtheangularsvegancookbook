import siteNav from '../site-nav.json';
import type { Recipe } from '../recipe.types';

/**
 * KAN-295 — the SPA's visible breadcrumb trails.
 *
 * A published recipe's trail is the SSR page's `BreadcrumbList`
 * (Backend `public_bp._breadcrumbs`): Home → Browse → [first indexable hub] →
 * recipe. The hub step depends on live catalog counts only Flask knows, so the
 * SPA reads the trail from `GET /api/recipes/public/<slug>` (`breadcrumbs`) and
 * shows `publicRecipeFallbackTrail` until it arrives, or when the Backend
 * predates the field.
 *
 * Private recipes and the Kitchen have no SSR counterpart; their trails run
 * through My Kitchen, where the page's "Back to Kitchen" already points.
 *
 * URLs are same-origin paths: the SPA only uses relative URLs.
 */
export interface Crumb {
  name: string;
  url: string;
}

/** Labels as the SSR trail spells them. */
export const HOME_CRUMB: Crumb = { name: 'Home', url: '/' };
export const BROWSE_CRUMB: Crumb = { name: 'Browse', url: '/browse' };

/** The header's label, so the trail and the nav agree (KAN-294). */
export const KITCHEN_CRUMB: Crumb = {
  name: siteNav.header.find((link) => link.href === '/kitchen')?.label ?? 'My Kitchen',
  url: '/kitchen',
};

/** Paths the Angular router owns. Everything else (/browse, /r/…) is Flask SSR. */
export function isSpaPath(url: string): boolean {
  return url === '/' || url === '/kitchen' || url === '/generate' || url.startsWith('/recipe/');
}

/** `https://www.tasteslikegood.org/r/x` → `/r/x`. Returns null for anything unparseable. */
export function toSameOriginPath(url: string): string | null {
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return null;
  }
}

/**
 * The Backend's trail (absolute canonical URLs, SSR shape) as SPA crumbs, or
 * null when the payload is missing or malformed, so the caller falls back.
 */
export function trailFromApi(raw: unknown): Crumb[] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const crumbs: Crumb[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const { name, url } = item as { name?: unknown; url?: unknown };
    if (typeof name !== 'string' || !name || typeof url !== 'string' || !url) return null;
    const path = toSameOriginPath(url);
    if (!path) return null;
    crumbs.push({ name, url: path });
  }
  return crumbs;
}

/** Home → Browse → recipe: the SSR trail minus a hub the SPA cannot know. */
export function publicRecipeFallbackTrail(recipe: Pick<Recipe, 'name' | 'slug'>): Crumb[] {
  return [HOME_CRUMB, BROWSE_CRUMB, { name: recipe.name, url: `/r/${recipe.slug}` }];
}

/** Home → My Kitchen → recipe, for a recipe with no public page. */
export function privateRecipeTrail(recipe: Pick<Recipe, 'id' | 'name'>): Crumb[] {
  return [HOME_CRUMB, KITCHEN_CRUMB, { name: recipe.name, url: `/recipe/${recipe.id}` }];
}

/** Home → My Kitchen [→ cookbook]. A cookbook is Kitchen state, not a route. */
export function kitchenTrail(cookbookName?: string | null): Crumb[] {
  return cookbookName
    ? [HOME_CRUMB, KITCHEN_CRUMB, { name: cookbookName, url: KITCHEN_CRUMB.url }]
    : [HOME_CRUMB, KITCHEN_CRUMB];
}
