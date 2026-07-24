import { Injectable, effect, signal, untracked, inject } from '@angular/core';
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
  private readonly auth = inject(AuthService);

  /**
   * KAN-139 — publish state is server-owned, so the publish toggle renders
   * greyed until the first API load settles: 'pending' while the initial
   * sync is in flight, 'synced' once server rows have been merged in,
   * 'failed' when all retries were exhausted (local state is then the best
   * we have and the toggle re-enables rather than staying dead).
   */
  readonly publishStateSync = signal<'pending' | 'synced' | 'failed'>('pending');

  /** Resolves when the first loadFromApi() settles (success OR exhausted
   *  retries) — lets flows that must see server rows (the SSR CTA's
   *  repeat-save dedup) wait for the merge instead of racing it. */
  readonly firstSyncSettled: Promise<void>;
  private _settleFirstSync!: () => void;

  constructor() {
    this.firstSyncSettled = new Promise<void>((resolve) => {
      this._settleFirstSync = resolve;
    });
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

  /** Resolves `false` when the API sync failed so callers with optimistic UI
   *  (e.g. togglePublic) can revert; never rejects — see `_apiSaveRecipe`. */
  async saveRecipe(recipe: Recipe): Promise<boolean> {
    const user = this.auth.currentUser();
    if (!user) return true;

    // Always update localStorage first for instant UI feedback.
    this.auth.saveRecipe(recipe);

    return await this._apiSaveRecipe(recipe);
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

  /**
   * Creates a cookbook and returns its resolved id, or null if creation
   * failed outright (caller should not treat the operation as complete).
   */
  async createCookbook(name: string, description = ''): Promise<string | null> {
    const user = this.auth.currentUser();
    if (!user) return null;

    // Pre-generated so the same id is reused by every path below (server
    // create, 409 reconcile, or local fallback) — a fallback that minted
    // its own id would leave the server and local caches holding two
    // different cookbooks with the same name.
    const id = crypto.randomUUID();
    let res: Response;
    try {
      res = await this._fetch('/api/collections', {
        method: 'POST',
        // The backend honors either this header or the body `id` for
        // idempotent replay, returning the existing cookbook instead of a
        // fresh insert (adamtasteslikegood/tasteslikegood.com#216).
        headers: { 'Idempotency-Key': id },
        body: JSON.stringify({ id, name, description }),
      });
    } catch {
      // Network failure — fall back to localStorage so the UI still works.
      return this.auth.createCookbook(name, description, id)?.id ?? null;
    }

    // 409 = a cookbook with this name already exists for this owner. The
    // server is authoritative, so do NOT fall back to a local duplicate;
    // reconcile the existing cookbook into local state if it isn't there yet
    // (server-side enforcement + idempotent replay shipped in #216).
    if (res.status === 409) {
      const body = await res.json().catch(() => null);
      // Accept either a `{collection: {...}}` envelope or a raw cookbook
      // dict (matching the 201 shape) — the eventual 409 contract isn't
      // settled yet, so guard on `id` rather than assuming one shape.
      const existing = body?.collection ?? (body && typeof body.id === 'string' ? body : null);
      if (!existing) return null;
      const current = this.auth.currentUser();
      if (current && !current.cookbooks.some((c) => c.id === existing.id)) {
        this.auth.hydrate(current.savedRecipes, [...current.cookbooks, this._toCookbook(existing)]);
      }
      return existing.id;
    }

    if (res.status >= 500) {
      // Server error — fall back to localStorage so the UI still works.
      return this.auth.createCookbook(name, description, id)?.id ?? null;
    }

    if (!res.ok) {
      // Genuine client-side rejection (400/401/403/...) — do not fall back
      // to a local duplicate the server never agreed to.
      console.warn(`[PersistenceService] createCookbook ${res.status}`);
      return null;
    }

    const data = await res.json();
    // Sync the server-assigned cookbook into local state
    const current = this.auth.currentUser();
    if (current) {
      this.auth.hydrate(current.savedRecipes, [...current.cookbooks, this._toCookbook(data)]);
    }
    return data?.id ?? null;
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
   * Retries up to 2 times on failure (session may not be ready immediately after OAuth redirect).
   * The awaited loop makes retries run sequentially within a single invocation, and any
   * caller that explicitly awaits this method will wait for the full operation (including retries).
   * This method does not by itself prevent separate loadFromApi() invocations from overlapping.
   */
  async loadFromApi(retries = 2): Promise<void> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        const remaining = retries - attempt;
        console.log(`[PersistenceService] Retrying in 1s (${remaining} retries left)...`);
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      }
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
          console.warn('[PersistenceService] API returned non-OK');
          continue;
        }

        const recipesData = await recipesRes.json();
        const collectionsData = await collectionsRes.json();

        // The blob (r.data) is the complete recipe, but its slug/is_public
        // copies can lag the DB columns on rows written before the backend
        // synced blob and column on every write — Adam's repeat-save trap
        // miss (KAN-139) was exactly such a row. When the backend exposes
        // the columns (is_canonical present = new contract), they win,
        // including nulls; older backends fall back to the blob unchanged.
        const recipes: Recipe[] = (recipesData.recipes ?? []).map(
          (r: {
            id: string;
            data: Recipe;
            slug?: string | null;
            is_public?: boolean;
            is_canonical?: boolean;
            source_slug?: string | null;
            origin?: Recipe['origin'] | null;
          }) => {
            if (r.is_canonical === undefined) return r.data;
            return {
              ...r.data,
              slug: r.slug ?? undefined,
              is_public: r.is_public,
              is_canonical: r.is_canonical,
              sourceSlug: r.data.sourceSlug ?? r.source_slug ?? undefined,
              origin: r.origin ?? r.data.origin,
            };
          }
        );

        const cookbooks: Cookbook[] = (collectionsData.collections ?? []).map(this._toCookbook);

        console.log(
          `[PersistenceService] Hydrating ${recipes.length} recipes, ${cookbooks.length} cookbooks`
        );
        this.auth.hydrate(recipes, cookbooks);
        this.publishStateSync.set('synced');
        this._settleFirstSync();
        return;
      } catch (err) {
        console.warn('[PersistenceService] loadFromApi attempt failed:', err);
      }
    }
    console.warn(
      '[PersistenceService] loadFromApi failed after all retries, will retry on next auth change'
    );
    this._apiSynced = false;
    this.publishStateSync.set('failed');
    this._settleFirstSync();
  }

  /** POST a recipe to Flask; the endpoint upserts same-owner recipes, so
   *  re-saves are idempotent (201 both on create and on update).
   *  Never rejects — background-sync callers (restoreRecipe,
   *  addRecipeToCookbook, ...) rely on that. Returns `false` on failure
   *  instead so callers that need to react to a failed sync (e.g. revert
   *  optimistic UI state) can check the resolved value. */
  private async _apiSaveRecipe(recipe: Recipe): Promise<boolean> {
    try {
      const res = await this._fetch('/api/recipes', {
        method: 'POST',
        body: JSON.stringify({ ...recipe, id: recipe.id }),
      });
      // The current API never returns 409 (it upserts instead of conflicting);
      // tolerated defensively so a backend that reintroduces duplicate
      // conflicts doesn't spam warnings for an already-persisted recipe.
      if (!res.ok && res.status !== 409) {
        console.warn(`[PersistenceService] saveRecipe ${res.status}`);
        return false;
      }
      // Publish flow: the server may assign a different slug than the client
      // sent (uniqueness collision suffix), so mirror its authoritative
      // value back into local state — otherwise the /r/<slug> link in the UI
      // silently points at another recipe or 404s until the next reload.
      try {
        const body = await res.json();
        const serverSlug = body?.slug;
        if (typeof serverSlug === 'string' && serverSlug && serverSlug !== recipe.slug) {
          recipe.slug = serverSlug;
          this.auth.saveRecipe(recipe);
        }
      } catch {
        // Body missing or not JSON — keep the optimistic local value.
      }
      return true;
    } catch (err) {
      console.warn('[PersistenceService] apiSaveRecipe failed:', err);
      return false;
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
