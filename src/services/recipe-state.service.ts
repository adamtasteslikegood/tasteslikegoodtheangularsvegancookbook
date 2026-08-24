import { Injectable, computed, signal } from '@angular/core';
import type { Recipe } from '../recipe.types';

@Injectable({ providedIn: 'root' })
export class RecipeStateService {
  readonly currentRecipe = signal<Recipe | null>(null);
  readonly generatedImageUrl = signal<string | null>(null);
  readonly isSaved = signal(false);

  /**
   * KAN-243: recipe IDs with in-flight image generation.
   *
   * Tracked at the service level (root-scoped singleton) so the loading
   * state survives component destruction during SPA navigation. Before
   * this, `isImageLoading` was a per-component-instance signal — navigating
   * away from the generator destroyed the signal while the detached async
   * kept running, so recipe-detail showed neither image nor spinner.
   */
  private readonly _pendingImageIds = signal(new Set<string>());

  /** Whether the currently viewed recipe has an in-flight image generation. */
  readonly isImageGenerating = computed(() => {
    const recipe = this.currentRecipe();
    return recipe ? this._pendingImageIds().has(recipe.id) : false;
  });

  /**
   * Register an in-flight image generation. The promise's settlement
   * (resolve or reject) automatically clears the pending state.
   */
  trackImageGeneration(recipeId: string, completion: Promise<string>): void {
    this._pendingImageIds.update((ids) => new Set(ids).add(recipeId));
    const clear = () => {
      this._pendingImageIds.update((ids) => {
        const next = new Set(ids);
        next.delete(recipeId);
        return next;
      });
    };
    completion.then(clear, clear);
  }

  // saved=false is the cold deep-link path (GH #3210): the recipe came from
  // the API, not the user's cookbook, so the Save button must stay live.
  viewRecipe(r: Recipe, saved = true) {
    this.currentRecipe.set(r);
    this.generatedImageUrl.set(r.ai_image_url || null);
    this.isSaved.set(saved);
  }

  clearRecipe() {
    this.currentRecipe.set(null);
    this.generatedImageUrl.set(null);
    this.isSaved.set(false);
  }
}
