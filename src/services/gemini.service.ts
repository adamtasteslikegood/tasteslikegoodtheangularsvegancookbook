import { Injectable } from '@angular/core';
import { Recipe } from '../recipe.types';

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  constructor() {}

  /**
   * Generate a vegan recipe via the Flask backend.
   * The backend saves the recipe to the database and returns it.
   */
  async generateRecipe(userPrompt: string): Promise<Recipe> {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ prompt: userPrompt }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || 'Recipe generation failed.');
    }

    const payload = await response.json();
    const recipe = payload.recipe as Recipe;
    recipe.id = recipe.id || crypto.randomUUID();
    return recipe;
  }

  /**
   * Generate an AI image for a recipe via the Flask backend.
   * The backend saves the image server-side and returns a URL path.
   */
  async generateImage(recipeId: string, forceRegenerate = false): Promise<string> {
    const response = await fetch('/api/generate_image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ recipe_id: recipeId, force_regenerate: forceRegenerate }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || 'Image generation failed.');
    }

    const payload = await response.json();
    if (!payload.image_url) {
      throw new Error('No image generated');
    }

    return payload.image_url;
  }
}
