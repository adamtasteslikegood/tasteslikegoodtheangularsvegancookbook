import { describe, expect, it } from 'vitest';
import { adoptImagePipelineFields, recipeFromRow, type RecipeRow } from './recipe-row';
import type { Recipe } from '../recipe.types';

const blob = (over: Partial<Recipe> = {}): Recipe =>
  ({
    id: 'r1',
    name: 'Vegan Zucchini Poppers',
    description: '',
    prepTime: 10,
    cookTime: 20,
    servings: 4,
    ingredients: { wet: [], dry: [], other: [] },
    instructions: ['fry'],
    tags: ['snack'],
    ...over,
  }) as Recipe;

const row = (over: Partial<RecipeRow> = {}): RecipeRow => ({
  id: 'r1',
  data: blob(),
  slug: 'vegan-zucchini-poppers-2',
  is_public: true,
  is_canonical: false,
  source_slug: null,
  origin: 'generated',
  ...over,
});

// GH #3263: GET /api/recipes/:id returns the row shape; rendering it raw
// blanks the page (`@for` over undefined ingredients). Every API consumer
// must go through this merge.
describe('recipeFromRow', () => {
  it('unwraps the blob and overlays the authoritative columns', () => {
    const merged = recipeFromRow(
      row({ data: blob({ slug: 'stale-blob-slug', is_public: false }) })
    );

    expect(merged.ingredients).toEqual({ wet: [], dry: [], other: [] });
    expect(merged.instructions).toEqual(['fry']);
    expect(merged.servings).toBe(4);
    // Columns win over lagging blob copies (KAN-139).
    expect(merged.slug).toBe('vegan-zucchini-poppers-2');
    expect(merged.is_public).toBe(true);
    expect(merged.is_canonical).toBe(false);
    expect(merged.origin).toBe('generated');
  });

  it('clears a lagging blob slug when the column is null', () => {
    const merged = recipeFromRow(
      row({ slug: null, is_public: false, data: blob({ slug: 'ghost' }) })
    );

    expect(merged.slug).toBeUndefined();
    expect(merged.is_public).toBe(false);
  });

  it('prefers the blob sourceSlug and falls back to the source_slug column', () => {
    expect(
      recipeFromRow(row({ source_slug: 'col-slug', data: blob({ sourceSlug: 'blob-slug' }) }))
        .sourceSlug
    ).toBe('blob-slug');
    expect(recipeFromRow(row({ source_slug: 'col-slug' })).sourceSlug).toBe('col-slug');
  });

  it('maps the stable server-owned source recipe id', () => {
    expect(recipeFromRow(row({ source_recipe_id: 'source-uuid-1' })).sourceRecipeId).toBe(
      'source-uuid-1'
    );
    expect(recipeFromRow(row({ source_recipe_id: null })).sourceRecipeId).toBeUndefined();
  });

  it('lets a null source id column clear a stale blob value', () => {
    expect(
      recipeFromRow(
        row({ source_recipe_id: null, data: blob({ sourceRecipeId: 'stale-source-id' }) })
      ).sourceRecipeId
    ).toBeUndefined();
  });

  it('falls back to the blob origin when the column is null', () => {
    expect(recipeFromRow(row({ origin: null, data: blob({ origin: 'manual' }) })).origin).toBe(
      'manual'
    );
  });

  it('returns the blob unchanged on the pre-columns contract (no is_canonical)', () => {
    const data = blob({ slug: 'blob-slug' });
    const merged = recipeFromRow({ id: 'r1', data } as RecipeRow);

    expect(merged).toBe(data);
  });

  it('passes a bare Recipe blob through untouched', () => {
    const bare = blob();
    expect(recipeFromRow(bare)).toBe(bare);
  });
});

/**
 * KAN-255 — the reconcile that reads worker-written image metadata back must
 * not carry the rest of the server row with it. The GET fires 30-60s after the
 * user asked for an image, which is long enough for them to edit notes or hit
 * publish; the row it reads predates that write.
 */
describe('adoptImagePipelineFields (KAN-255)', () => {
  const local = (over: Record<string, unknown> = {}) =>
    ({
      id: 'r1',
      name: 'Vegan Cornbread',
      personalNotes: 'edited while the image was generating',
      is_public: true,
      slug: 'vegan-cornbread',
      ai_image_url: '/api/recipes/r1/image?_t=1',
      ai_metadata: { image_request: { status: 'pending' } },
      ...over,
    }) as unknown as Recipe;

  const server = (over: Record<string, unknown> = {}) =>
    ({
      id: 'r1',
      name: 'Vegan Cornbread',
      personalNotes: '',
      is_public: false,
      slug: null,
      ai_image_url: '/api/recipes/r1/image',
      ai_image_gcs: 'gs://bucket/r1/claim.png',
      ai_metadata: { image_request: { status: 'complete' }, image_generation: { success: true } },
      ...over,
    }) as unknown as Recipe;

  it('adopts the three pipeline-owned fields from the server row', () => {
    const merged = adoptImagePipelineFields(local(), server()) as unknown as Record<string, never>;
    expect(merged['ai_image_url']).toBe('/api/recipes/r1/image');
    expect(merged['ai_image_gcs']).toBe('gs://bucket/r1/claim.png');
    expect(merged['ai_metadata']).toEqual({
      image_request: { status: 'complete' },
      image_generation: { success: true },
    });
  });

  // The regression this function exists to prevent: a wholesale adopt reverted
  // the edit on screen AND in localStorage, and because saveNotes POSTs the
  // whole recipe, the next save wrote the stale copy back to the server.
  it('keeps a concurrent local edit that the server row predates', () => {
    const merged = adoptImagePipelineFields(local(), server());
    expect(merged.personalNotes).toBe('edited while the image was generating');
  });

  it('keeps an optimistic publish that the server row predates', () => {
    const merged = adoptImagePipelineFields(local(), server());
    expect(merged.is_public).toBe(true);
    expect(merged.slug).toBe('vegan-cornbread');
  });

  it('leaves the local value alone when the server row omits the field', () => {
    const partial = server();
    delete (partial as unknown as Record<string, unknown>)['ai_image_url'];
    const merged = adoptImagePipelineFields(local(), partial) as unknown as Record<string, never>;
    // A row that comes back without an image url must not blank the image the
    // user is currently looking at.
    expect(merged['ai_image_url']).toBe('/api/recipes/r1/image?_t=1');
  });

  it('leaves the local value alone when the server field is explicitly undefined', () => {
    const merged = adoptImagePipelineFields(
      local(),
      server({ ai_image_url: undefined })
    ) as unknown as Record<string, never>;
    expect(merged['ai_image_url']).toBe('/api/recipes/r1/image?_t=1');
  });

  // Same intent as the explicit-`undefined` case above: the reconcile GET can
  // lose the race with the worker's ai_image_url write (or read a briefly-null
  // column). If null were adopted, the just-rendered image would blank on
  // screen AND in localStorage — and because saveNotes POSTs the whole recipe,
  // the next save would clobber the canonical URL back to null server-side.
  it('leaves the local value alone when the server field is explicitly null', () => {
    const merged = adoptImagePipelineFields(
      local(),
      server({ ai_image_url: null, ai_image_gcs: null, ai_metadata: null })
    ) as unknown as Record<string, unknown>;
    expect(merged['ai_image_url']).toBe('/api/recipes/r1/image?_t=1');
    // ai_image_gcs is not on local, so preserving "local" means it stays absent
    // rather than being adopted as null.
    expect(merged['ai_image_gcs']).toBeUndefined();
    // ai_metadata on local carried the pending request — the null server value
    // must not wipe it either.
    expect(merged['ai_metadata']).toEqual({ image_request: { status: 'pending' } });
  });

  it('does not mutate either input', () => {
    const l = local();
    const s = server();
    adoptImagePipelineFields(l, s);
    expect((l as unknown as Record<string, never>)['ai_image_gcs']).toBeUndefined();
    expect(s.personalNotes).toBe('');
  });
});
