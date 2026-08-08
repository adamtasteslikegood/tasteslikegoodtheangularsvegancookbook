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

  // KAN-156/KAN-198: ssrEntryGuard calls handleSave fire-and-forget and returns
  // a redirect immediately, so a guard that runs more than once for the same
  // ?save=<slug> entry starts overlapping saves. Without this map both pass the
  // dedup check below while savedRecipes is still empty, and BOTH persist —
  // whichever finishes second then re-reads the row the first just wrote and
  // emits the bogus "you already have this recipe" toast. KAN-156 was triaged as
  // cosmetic; the duplicate row is the part that was missed.
  //
  // Scoped to in-flight calls only, deliberately not a permanent handled-set: a
  // user who saves, deletes, and saves again is making a genuine second request
  // and must get a response rather than silence.
  private readonly inFlightSaves = new Map<string, Promise<void>>();

  async handleSave(slug: string): Promise<void> {
    const normalizedSlug = slug.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(normalizedSlug)) {
      console.warn(`Ignoring save request for invalid recipe slug: "${slug}"`);
      return;
    }

    const inFlight = this.inFlightSaves.get(normalizedSlug);
    if (inFlight) return inFlight;

    const save = this.runSave(normalizedSlug).finally(() => {
      this.inFlightSaves.delete(normalizedSlug);
    });
    this.inFlightSaves.set(normalizedSlug, save);
    return save;
  }

  private async runSave(normalizedSlug: string): Promise<void> {
    try {
      await this.auth.ready;
      this.auth.ensureGuestSession();
    } catch (err) {
      console.error('Failed to initialize session for SSR save:', err);
      this.toast.show('Something went wrong saving this recipe.');
      return;
    }

    // KAN-139: the dedup check below must see the server's rows, not just
    // whatever localStorage happens to hold — a copy saved on another
    // device (or one whose local blob predates the slug-column sync) is
    // otherwise invisible and gets saved again. Bounded so a hanging API
    // degrades to the old local-only check instead of blocking the save.
    await Promise.race([
      this.persistence.firstSyncSettled,
      new Promise<void>((resolve) => setTimeout(resolve, 8_000)),
    ]);

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
