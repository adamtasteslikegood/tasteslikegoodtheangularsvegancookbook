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
    origin: payload.origin ?? payload.data.origin,
  };
}

/**
 * Fields the image pipeline owns end-to-end.
 *
 * `ai_image_url` is written by the client (the canonical url, right after
 * generation) and then re-confirmed by the server. The other two are written
 * ONLY by the Pub/Sub worker — the SPA reads `ai_metadata` (gemini.service
 * checks `image_generation.success`) and never writes it.
 */
const IMAGE_PIPELINE_FIELDS = ['ai_image_url', 'ai_image_gcs', 'ai_metadata'] as const;

/**
 * KAN-255 — adopt the image-pipeline fields from a freshly-read server row,
 * keeping every other field from the local copy.
 *
 * Why not adopt the row wholesale: the reconcile GET fires when an image
 * settles, which is 30–60s after the user asked for it. That window is wide
 * enough for the user to edit personal notes or hit publish, and for that
 * write's POST to reach the server AFTER this reconcile's GET has already read
 * the pre-edit row. A wholesale `set`/`save` of the returned row then reverts
 * the edit on screen and in localStorage.
 *
 * The localStorage half is the damaging one and does not self-heal: `saveNotes`
 * POSTs the whole recipe, so the next save after a clobber writes the stale
 * copy back to the server and the edit is gone for good.
 *
 * Adopting only these three fields serves the ticket in full — they are exactly
 * the fields the reconcile exists to read back — while leaving every
 * user-editable field alone. A field absent from the server row leaves the
 * local value untouched rather than clearing it: a row that somehow comes back
 * without `ai_image_url` must not blank the image the user is looking at.
 */
export function adoptImagePipelineFields(local: Recipe, fresh: Recipe): Recipe {
  const merged = { ...local } as Record<string, unknown>;
  const source = fresh as unknown as Record<string, unknown>;
  for (const field of IMAGE_PIPELINE_FIELDS) {
    if (source[field] !== undefined) merged[field] = source[field];
  }
  return merged as unknown as Recipe;
}
