import type { Recipe } from '../recipe.types';

/**
 * KAN-149 — shared column-over-blob merge for API recipe rows.
 *
 * The Flask recipe endpoints (`GET /api/recipes`, `GET /api/recipes/:id`,
 * `POST /api/recipes`) all return the row shape (`recipe.to_dict()`):
 * `{id, name, slug, is_public, is_canonical, origin, data: {…blob…}}`.
 * The blob (`data`) is the complete recipe, but its slug/is_public copies
 * can lag the DB columns on rows written before the backend synced blob and
 * column on every write — Adam's repeat-save trap miss (KAN-139) was exactly
 * such a row. When the backend exposes the columns (`is_canonical` present =
 * new contract), they win, including nulls; older backends fall back to the
 * blob unchanged.
 *
 * Every consumer of a recipe API response must go through this merge —
 * recipe-detail's cold deep-link fetch treating the raw row as a Recipe blob
 * was GH #3263 (blank page: `@for` over `undefined` ingredients).
 */
export interface RecipeRow {
  id: string;
  data: Recipe;
  slug?: string | null;
  is_public?: boolean;
  is_canonical?: boolean;
  source_slug?: string | null;
  source_recipe_id?: string | null;
  origin?: Recipe['origin'] | null;
}

/** True when the payload is a row envelope rather than a bare Recipe blob. */
function isRecipeRow(payload: RecipeRow | Recipe): payload is RecipeRow {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'data' in payload &&
    !!(payload as RecipeRow).data
  );
}

/**
 * Normalizes an API recipe payload to the client Recipe shape. Accepts a
 * bare blob too (defensive: a backend predating the row envelope) and
 * returns it untouched.
 */
export function recipeFromRow(payload: RecipeRow | Recipe): Recipe {
  if (!isRecipeRow(payload)) return payload;
  if (payload.is_canonical === undefined) return payload.data;
  return {
    ...payload.data,
    slug: payload.slug ?? undefined,
    is_public: payload.is_public,
    is_canonical: payload.is_canonical,
    sourceSlug: payload.data.sourceSlug ?? payload.source_slug ?? undefined,
    sourceRecipeId: payload.source_recipe_id ?? payload.data.sourceRecipeId,
    origin: payload.origin ?? payload.data.origin,
  };
}
