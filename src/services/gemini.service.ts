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
    const recipeId = payload.recipe_id || (payload.recipe && payload.recipe.id);

    // Poll for status if generating asynchronously
    if (payload.status === 'generating') {
      return new Promise((resolve, reject) => {
        const poll = setInterval(async () => {
          try {
            const res = await fetch(`/api/recipes/${recipeId}/status`);
            if (!res.ok) {
              clearInterval(poll);
              reject(new Error('Failed to get recipe status'));
              return;
            }
            const { status, recipe } = await res.json();
            if (status === 'ready') {
              clearInterval(poll);
              resolve(recipe as Recipe);
            } else if (status === 'error') {
              clearInterval(poll);
              reject(new Error('Recipe generation failed during async processing'));
            }
          } catch (e) {
            clearInterval(poll);
            reject(e);
          }
        }, 2000);
      });
    }

    const recipe = payload.recipe as Recipe;
    recipe.id = recipe.id || crypto.randomUUID();
    return recipe;
  }

  /**
   * Generate an AI image for a recipe via the Flask backend.
   * The backend saves the image server-side and returns a URL path.
   *
   * KAN-243: added a 5-minute timeout to the async polling loop. Before
   * this, a silent worker failure (status stuck on generating_image, or
   * status=ready with no ai_image_url and no failure metadata) left the
   * poll running indefinitely — the caller's promise never settled, so
   * the loading spinner spun forever and the regenerate button stayed
   * disabled.
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

    if (payload.status === 'generating_image') {
      // Poll until image_url is populated, with a 5-minute timeout.
      return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const TIMEOUT_MS = 5 * 60 * 1000;
        const poll = setInterval(async () => {
          if (Date.now() - startTime > TIMEOUT_MS) {
            clearInterval(poll);
            reject(new Error('Image generation timed out after 5 minutes'));
            return;
          }
          try {
            const res = await fetch(`/api/recipes/${recipeId}/status`);
            if (!res.ok) {
              clearInterval(poll);
              reject(new Error('Failed to get recipe status'));
              return;
            }
            const { status, recipe } = await res.json();
            if (status === 'ready' && recipe.ai_metadata?.image_generation?.success === false) {
              clearInterval(poll);
              reject(new Error('Image generation failed during async processing'));
            } else if (status === 'ready' && recipe.ai_image_url) {
              clearInterval(poll);
              resolve(recipe.ai_image_url);
            }
          } catch (e) {
            clearInterval(poll);
            reject(e);
          }
        }, 2000);
      });
    }

    if (!payload.image_url) {
      throw new Error('No image generated');
    }

    return payload.image_url;
  }
}
