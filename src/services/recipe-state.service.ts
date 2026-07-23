import { Injectable, signal } from '@angular/core';
import type { Recipe } from '../recipe.types';

@Injectable({ providedIn: 'root' })
export class RecipeStateService {
  readonly currentRecipe = signal<Recipe | null>(null);
  readonly generatedImageUrl = signal<string | null>(null);
  readonly isSaved = signal(false);

  viewRecipe(r: Recipe) {
    this.currentRecipe.set(r);
    this.generatedImageUrl.set(r.ai_image_url || null);
    this.isSaved.set(true);
  }

  clearRecipe() {
    this.currentRecipe.set(null);
    this.generatedImageUrl.set(null);
    this.isSaved.set(false);
  }
}
