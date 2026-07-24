import { describe, it, expect, beforeEach } from 'vitest';
import { RecipeStateService } from './recipe-state.service';
import type { Recipe } from '../recipe.types';

const recipe = (over: Partial<Recipe> = {}): Recipe =>
  ({
    id: 'r1',
    name: 'Vegan Cornbread',
    ingredients: { wet: [], dry: [], other: [] },
    instructions: [],
    prepTime: 5,
    cookTime: 20,
    servings: 8,
    description: '',
    tags: [],
    notes: '',
    ...over,
  }) as Recipe;

// GH #3210 / KAN-137: viewRecipe unconditionally set isSaved=true, so a
// recipe fetched via cold deep link (not in the user's cookbook) misreported
// as saved and disabled the Save button.
describe('RecipeStateService.viewRecipe', () => {
  let service: RecipeStateService;

  beforeEach(() => {
    // No deps — construct directly, same as recipe-detail.component.test.ts.
    service = new RecipeStateService();
  });

  it('marks the recipe saved by default (cookbook navigation path)', () => {
    service.viewRecipe(recipe());
    expect(service.isSaved()).toBe(true);
    expect(service.currentRecipe()?.id).toBe('r1');
  });

  it('leaves the recipe unsaved when told so (deep-link API fetch path)', () => {
    service.viewRecipe(recipe(), false);
    expect(service.isSaved()).toBe(false);
    expect(service.currentRecipe()?.id).toBe('r1');
  });

  it('clearRecipe resets the saved flag', () => {
    service.viewRecipe(recipe());
    service.clearRecipe();
    expect(service.isSaved()).toBe(false);
    expect(service.currentRecipe()).toBeNull();
  });
});
