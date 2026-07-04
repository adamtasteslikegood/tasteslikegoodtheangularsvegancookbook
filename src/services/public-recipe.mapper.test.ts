import { describe, expect, it, vi } from 'vitest';
import { buildSavedRecipeFromPublic } from './public-recipe.mapper';

describe('buildSavedRecipeFromPublic', () => {
  it('preserves image fields and assigns a fresh id', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'fresh-uuid' });

    const recipe = buildSavedRecipeFromPublic({
      id: 'public-id',
      name: 'Thai Peanut Noodles',
      ai_image_url: 'https://img.example/ai.png',
      stock_image_url: 'https://img.example/stock.jpg',
    });

    expect(recipe.id).toBe('fresh-uuid');
    expect(recipe.id).not.toBe('public-id');
    expect(recipe.ai_image_url).toBe('https://img.example/ai.png');
    expect(recipe.stock_image_url).toBe('https://img.example/stock.jpg');

    vi.unstubAllGlobals();
  });

  it('fills safe defaults for missing fields without inventing image urls', () => {
    const recipe = buildSavedRecipeFromPublic({});

    expect(recipe.name).toBe('Saved Recipe');
    expect(recipe.ingredients).toEqual({ wet: [], dry: [], other: [] });
    expect(recipe.instructions).toEqual([]);
    expect(recipe.ai_image_url).toBeUndefined();
    expect(recipe.stock_image_url).toBeUndefined();
  });
});
