import { inject, Injectable } from '@angular/core';
import { AuthService } from './auth.service';
import { PersistenceService } from './persistence.service';
import { ToastService } from './toast.service';
import { buildSavedRecipeFromPublic } from './public-recipe.mapper';
import type { Recipe } from '../recipe.types';

@Injectable({ providedIn: 'root' })
export class SsrEntryService {
  private readonly auth = inject(AuthService);
  private readonly persistence = inject(PersistenceService);
  private readonly toast = inject(ToastService);

  async handleSave(slug: string): Promise<void> {
    const normalizedSlug = slug.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(normalizedSlug)) {
      console.warn(`Ignoring save request for invalid recipe slug: "${slug}"`);
      return;
    }

    try {
      await this.auth.ready;
      this.auth.ensureGuestSession();
    } catch (err) {
      console.error('Failed to initialize session for SSR save:', err);
      this.toast.show('Something went wrong saving this recipe.');
      return;
    }

    const alreadySaved = this.auth
      .currentUser()
      ?.savedRecipes.find(
        (r: Recipe) => r.sourceSlug === normalizedSlug || r.slug === normalizedSlug
      );
    if (alreadySaved) {
      this.toast.show('Good news — you already have this recipe.', alreadySaved);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`/api/recipes/public/${encodeURIComponent(normalizedSlug)}`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        console.warn(`Could not fetch recipe for slug "${normalizedSlug}": ${response.status}`);
        this.toast.show('Could not save this recipe. Please try again.');
        return;
      }
      const recipeData = await response.json();
      const recipe: Recipe = buildSavedRecipeFromPublic(recipeData);
      const synced = await this.persistence.saveRecipe(recipe);
      this.toast.show(
        synced
          ? 'Saved to your cookbook.'
          : "Saved on this device — we'll sync it when you're back online.",
        recipe
      );
    } catch (err) {
      console.error('Failed to save recipe from SSR CTA:', err);
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.toast.show('Save timed out. Check your connection and try again.');
      } else {
        this.toast.show('Something went wrong saving this recipe.');
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async handleAuth(): Promise<void> {
    await this.auth.ready;
  }
}
