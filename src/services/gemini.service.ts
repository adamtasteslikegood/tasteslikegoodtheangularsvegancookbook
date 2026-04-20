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
       // Poll until image_url is populated
       return new Promise((resolve, reject) => {
         const poll = setInterval(async () => {
           try {
             const res = await fetch(`/api/recipes/${recipeId}/status`);
             if (!res.ok) {
               clearInterval(poll);
               reject(new Error('Failed to get recipe status'));
               return;
             }
             const { recipe } = await res.json();
             if (recipe.ai_image_url) {
               clearInterval(poll);
               resolve(recipe.ai_image_url);
             } else if (recipe.ai_metadata?.image_generation?.success === false) {
               clearInterval(poll);
               reject(new Error('Image generation failed during async processing'));
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
