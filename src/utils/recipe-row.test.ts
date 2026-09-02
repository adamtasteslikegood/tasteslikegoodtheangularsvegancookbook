import { describe, expect, it } from 'vitest';
import { recipeFromRow, type RecipeRow } from './recipe-row';
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
