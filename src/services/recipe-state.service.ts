import { Injectable, signal } from '@angular/core';
import type { Recipe } from '../recipe.types';

@Injectable({ providedIn: 'root' })
export class RecipeStateService {
  readonly currentRecipe = signal<Recipe | null>(null);
  readonly generatedImageUrl = signal<string | null>(null);
  readonly isSaved = signal(false);

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
