import { Injectable, effect, untracked, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { Recipe } from '../recipe.types';
import { Cookbook } from '../auth.types';

/**
 * PersistenceService — hybrid persistence layer for Phase IV.
 *
 * Strategy:
 *   - Guest users  → Flask API scoped by session_id + localStorage cache
 *   - Logged-in    → Flask API scoped by user_id + localStorage cache
 *
 * All calls go through relative URLs so the Express proxy forwards
 * them to Flask transparently (no CORS, no env var changes needed).
 * See docs/ADR-001-auth-and-persistence-routing.md for the full decision record.
 */
@Injectable({
  providedIn: 'root',
})
export class PersistenceService {
  /** Prevents duplicate API loads for the same session. */
  private _apiSynced = false;
  private auth = inject(AuthService);

  constructor() {
    // Auto-load from API when a logged-in user's session is confirmed.
    // Uses untracked() so signal writes inside loadFromApi() don't
    // create a reactive dependency in the effect.
    effect(() => {
      const user = this.auth.currentUser();
      const loading = this.auth.authLoading();

      if (!user) {
        this._apiSynced = false;
        return;
      }

      if (!loading && !this._apiSynced) {
        this._apiSynced = true;
        console.log(
          '[PersistenceService] Effect triggered: loading from API for',
          user.email || user.id
        );
        untracked(() => this.loadFromApi());
      }
    });
  }

  // ─── Public API (components call these instead of AuthService directly) ──

  async saveRecipe(recipe: Recipe): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;

    // Always update localStorage first for instant UI feedback.
    this.auth.saveRecipe(recipe);

    await this._apiSaveRecipe(recipe);
  }

  async deleteRecipe(recipeId: string): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;

    // Soft-delete: move to recycle bin in localStorage
    this.auth.deleteRecipe(recipeId);

    // Backend hard-deletes (no recycle bin server-side yet)
    await this._fetch(`/api/recipes/${recipeId}`, { method: 'DELETE' });
  }

  async restoreRecipe(recipeId: string): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;

    const entry = (user.deletedRecipes || []).find((d) => d.recipe.id === recipeId);
    if (!entry) return;

    // Restore locally
    this.auth.restoreRecipe(recipeId);

    // Re-save to backend
    await this._apiSaveRecipe(entry.recipe);
  }

  async permanentlyDeleteRecipe(recipeId: string): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;

    this.auth.permanentlyDeleteRecipe(recipeId);
    // Already deleted from backend during soft-delete
  }

  async emptyRecycleBin(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;
    this.auth.emptyRecycleBin();
  }

  async createCookbook(name: string, description = ''): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;

    try {
      const id = crypto.randomUUID();
      const res = await this._fetch('/api/collections', {
        method: 'POST',
        body: JSON.stringify({ id, name, description }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      // Sync the server-assigned cookbook into local state
      const current = this.auth.currentUser();
      if (current) {
        this.auth.hydrate(current.savedRecipes, [...current.cookbooks, this._toCookbook(data)]);
      }
    } catch {
      // Fall back to localStorage so the UI still works
      this.auth.createCookbook(name, description);
    }
  }

  async deleteCookbook(cookbookId: string): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;

    this.auth.deleteCookbook(cookbookId);

    await this._fetch(`/api/collections/${cookbookId}`, { method: 'DELETE' });
  }

  async addRecipeToCookbook(cookbookId: string, recipe: Recipe): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;

    this.auth.addRecipeToCookbook(cookbookId, recipe);

    await this._apiSaveRecipe(recipe); // ensure recipe exists in DB
    await this._fetch(`/api/collections/${cookbookId}/recipes`, {
      method: 'POST',
      body: JSON.stringify({ recipe_id: recipe.id }),
    });
  }

  async removeRecipeFromCookbook(cookbookId: string, recipeId: string): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;

    this.auth.removeRecipeFromCookbook(cookbookId, recipeId);

    await this._fetch(`/api/collections/${cookbookId}/recipes/${recipeId}`, {
      method: 'DELETE',
    });
  }

  // ─── Internal: API sync ───────────────────────────────────────────────────

  /**
   * Load all recipes and cookbooks from the Flask API and merge into
   * the Angular user state via AuthService.hydrate().
   * Called once after Google OAuth login is confirmed.
   */
  async loadFromApi(): Promise<void> {
    try {
      console.log('[PersistenceService] Loading recipes from API...');
      const [recipesRes, collectionsRes] = await Promise.all([
        this._fetch('/api/recipes'),
        this._fetch('/api/collections'),
      ]);

      console.log(
        `[PersistenceService] API responses: recipes=${recipesRes.status}, collections=${collectionsRes.status}`
      );

      if (!recipesRes.ok || !collectionsRes.ok) {
        console.warn('[PersistenceService] API returned non-OK, will retry on next auth change');
        this._apiSynced = false;
        return;
      }

      const recipesData = await recipesRes.json();
      const collectionsData = await collectionsRes.json();

      // With the backend fix, data.id and the outer id are now consistent.
      // We use the data field directly since it contains the complete recipe
      // with the correct ID already set by the backend.
      const recipes: Recipe[] = (recipesData.recipes ?? []).map(
        (r: { id: string; data: Recipe }) => r.data
      );

      const cookbooks: Cookbook[] = (collectionsData.collections ?? []).map(this._toCookbook);

      console.log(
        `[PersistenceService] Hydrating ${recipes.length} recipes, ${cookbooks.length} cookbooks`
      );
      this.auth.hydrate(recipes, cookbooks);
    } catch (err) {
      console.warn('[PersistenceService] loadFromApi failed, will retry:', err);
      this._apiSynced = false;
    }
  }

  /** POST a recipe to Flask; idempotent — ignores 409 conflicts. */
  private async _apiSaveRecipe(recipe: Recipe): Promise<void> {
    try {
      const res = await this._fetch('/api/recipes', {
        method: 'POST',
        body: JSON.stringify({ ...recipe, id: recipe.id }),
      });
      // 201 = created, 409 = already exists (idempotent), both are fine
      if (!res.ok && res.status !== 409) {
        console.warn(`[PersistenceService] saveRecipe ${res.status}`);
      }
    } catch (err) {
      console.warn('[PersistenceService] apiSaveRecipe failed:', err);
    }
  }

  /** Fetch with session cookie and JSON content-type. */
  private _fetch(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(path, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  }

  /** Map Flask collection JSON → Angular Cookbook interface. */
  private _toCookbook(raw: {
    id: string;
    name: string;
    description?: string;
    coverImage?: string;
    recipeIds?: string[];
  }): Cookbook {
    return {
      id: raw.id,
      name: raw.name,
      description: raw.description ?? '',
      coverImage: raw.coverImage,
      recipeIds: raw.recipeIds ?? [],
    };
  }
}
