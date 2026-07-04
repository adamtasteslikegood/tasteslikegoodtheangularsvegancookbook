import type { Recipe } from '../recipe.types';

/**
 * Build a cookbook-savable Recipe from the public SSR endpoint's payload
 * (`/api/recipes/public/<slug>`).
 *
 * Always assigns a fresh id: a saved copy is a new entry in the user's
 * cookbook. Reusing the source public recipe's id makes the API POST collide
 * with the existing row (409 → treated as success), so it would never persist
 * to the server cookbook / other devices.
 */
export function buildSavedRecipeFromPublic(recipeData: Partial<Recipe>): Recipe {
  return {
    id: crypto.randomUUID(),
    name: recipeData.name || 'Saved Recipe',
    ingredients: recipeData.ingredients || { wet: [], dry: [], other: [] },
    instructions: recipeData.instructions || [],
    prepTime: recipeData.prepTime ?? 0,
    cookTime: recipeData.cookTime ?? 0,
    servings: recipeData.servings ?? 0,
    description: recipeData.description || '',
    tags: recipeData.tags || [],
    notes: recipeData.notes || '',
    // The public pages are photo-backed; without these the kitchen card
    // falls back to a placeholder even though the source recipe had an image.
    ai_image_url: recipeData.ai_image_url,
    stock_image_url: recipeData.stock_image_url,
  };
}
