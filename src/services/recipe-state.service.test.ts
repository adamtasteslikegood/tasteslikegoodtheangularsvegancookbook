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

// KAN-243: image generation tracking survives component destruction.
describe('RecipeStateService.trackImageGeneration', () => {
  let service: RecipeStateService;

  beforeEach(() => {
    service = new RecipeStateService();
  });

  it('isImageGenerating is false when no recipe is viewed', () => {
    expect(service.isImageGenerating()).toBe(false);
  });

  it('isImageGenerating is false when viewed recipe has no pending generation', () => {
    service.viewRecipe(recipe());
    expect(service.isImageGenerating()).toBe(false);
  });

  it('isImageGenerating becomes true when tracking starts for the viewed recipe', () => {
    service.viewRecipe(recipe());
    const promise = new Promise<string>(() => {}); // never settles
    service.trackImageGeneration('r1', promise);
    expect(service.isImageGenerating()).toBe(true);
  });

  it('isImageGenerating is false for a different recipe than the pending one', () => {
    service.viewRecipe(recipe({ id: 'r2' }));
    const promise = new Promise<string>(() => {});
    service.trackImageGeneration('r1', promise);
    expect(service.isImageGenerating()).toBe(false);
  });

  it('isImageGenerating becomes true when navigating to a recipe with pending generation', () => {
    const promise = new Promise<string>(() => {});
    service.trackImageGeneration('r1', promise);
    // No recipe viewed yet — should be false.
    expect(service.isImageGenerating()).toBe(false);
    // Navigate to the recipe with pending generation.
    service.viewRecipe(recipe());
    expect(service.isImageGenerating()).toBe(true);
  });

  it('clears pending state when the promise resolves', async () => {
    service.viewRecipe(recipe());
    let resolve!: (v: string) => void;
    const promise = new Promise<string>((r) => {
      resolve = r;
    });
    service.trackImageGeneration('r1', promise);
    expect(service.isImageGenerating()).toBe(true);

    resolve('/api/recipes/r1/image');
    // Settlement callbacks are microtasks — flush them.
    await Promise.resolve();
    expect(service.isImageGenerating()).toBe(false);
  });

  it('clears pending state when the promise rejects', async () => {
    service.viewRecipe(recipe());
    let reject!: (e: Error) => void;
    const promise = new Promise<string>((_, r) => {
      reject = r;
    });
    service.trackImageGeneration('r1', promise);
    expect(service.isImageGenerating()).toBe(true);

    reject(new Error('timeout'));
    await Promise.resolve();
    expect(service.isImageGenerating()).toBe(false);
  });

  it('tracks multiple recipes independently', async () => {
    let resolveR1!: (v: string) => void;
    const p1 = new Promise<string>((r) => {
      resolveR1 = r;
    });
    const p2 = new Promise<string>(() => {}); // never settles

    service.trackImageGeneration('r1', p1);
    service.trackImageGeneration('r2', p2);

    service.viewRecipe(recipe({ id: 'r1' }));
    expect(service.isImageGenerating()).toBe(true);

    resolveR1('/img');
    await Promise.resolve();
    // r1 done, switch to r2 which is still pending.
    expect(service.isImageGenerating()).toBe(false);
    service.viewRecipe(recipe({ id: 'r2' }));
    expect(service.isImageGenerating()).toBe(true);
  });
});
