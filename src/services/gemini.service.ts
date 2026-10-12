import { Injectable } from '@angular/core';
import { Recipe } from '../recipe.types';

const POLL_INTERVAL_MS = 2000;
/** Both waits give up after this long; the worker's own lease is ten minutes. */
const GENERATION_TIMEOUT_MS = 5 * 60 * 1000;
/** Ten seconds of failed status requests in a row before the wait gives up. */
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

/** A status answer no retry will change: the recipe is gone or not ours. */
const isTerminalStatusCode = (status: number) =>
  status >= 400 && status < 500 && status !== 408 && status !== 429;

interface RecipeStatusBody {
  status: string;
  recipe: Recipe & { ai_metadata?: { image_generation?: { success?: boolean } | null } };
}

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  constructor() {}

  /**
   * Ask `/api/recipes/<id>/status` every two seconds until `read` returns a
   * value. `read` returns undefined to keep waiting and throws to end the
   * wait with that error.
   *
   * KAN-379: one failed request used to end the wait, although the worker
   * finishes the recipe regardless. A phone changing networks, or a 502 while
   * an instance starts, showed an error for a recipe that then existed. A
   * failed request is now retried; only a run of them, or an answer no retry
   * will change, ends the wait.
   *
   * KAN-380 (and KAN-243 for images): every wait has a deadline. One request
   * at a time: the next is scheduled after the last settles, where a
   * `setInterval` stacked them up behind a slow response.
   */
  private async pollStatus<T>(
    recipeId: string,
    timeoutMessage: string,
    read: (body: RecipeStatusBody) => T | undefined
  ): Promise<T> {
    const deadline = Date.now() + GENERATION_TIMEOUT_MS;
    let failures = 0;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (Date.now() >= deadline) throw new Error(timeoutMessage);

      let body: RecipeStatusBody;
      try {
        const res = await fetch(`/api/recipes/${recipeId}/status`);
        if (!res.ok) {
          if (isTerminalStatusCode(res.status)) failures = MAX_CONSECUTIVE_POLL_FAILURES;
          throw new Error(`status ${res.status}`);
        }
        body = (await res.json()) as RecipeStatusBody;
      } catch {
        failures += 1;
        if (failures >= MAX_CONSECUTIVE_POLL_FAILURES) {
          throw new Error('Failed to get recipe status');
        }
        continue;
      }
      failures = 0;

      const result = read(body);
      if (result !== undefined) return result;
    }
  }

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
      return this.pollStatus(
        recipeId,
        'Recipe generation timed out after 5 minutes. Please try again.',
        ({ status, recipe }) => {
          if (status === 'error') {
            throw new Error('Recipe generation failed during async processing');
          }
          return status === 'ready' ? recipe : undefined;
        }
      );
    }

    const recipe = payload.recipe as Recipe;
    recipe.id = recipe.id || crypto.randomUUID();
    return recipe;
  }

  /**
   * Generate an AI image for a recipe via the Flask backend.
   * The backend saves the image server-side and returns a URL path.
   *
   * KAN-243: the wait has a 5-minute timeout (see `pollStatus`). Before
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
      // Poll until image_url is populated.
      return this.pollStatus(
        recipeId,
        'Image generation timed out after 5 minutes',
        ({ status, recipe }) => {
          if (status !== 'ready') return undefined;
          if (recipe.ai_metadata?.image_generation?.success === false) {
            throw new Error('Image generation failed during async processing');
          }
          return recipe.ai_image_url || undefined;
        }
      );
    }

    if (!payload.image_url) {
      throw new Error('No image generated');
    }

    return payload.image_url;
  }
}
