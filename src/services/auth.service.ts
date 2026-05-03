import { Injectable, signal, WritableSignal } from '@angular/core';
import { Cookbook, User } from '../auth.types';
import { Recipe } from '../recipe.types';
import { environment } from '../environments/environment';

/**
 * Authentication service that orchestrates both:
 * - Flask backend (Google OAuth via /api/auth/*)
 * - localStorage (guest sessions, recipe/cookbook persistence)
 *
 * Phase 2: Replaces the old localStorage-only email/password auth
 * with real Google OAuth through the Flask backend.
 */
@Injectable({
  providedIn: 'root',
})
export class AuthService {
  static readonly SESSION_STORAGE_KEY = 'vegan_genius_session';

  currentUser: WritableSignal<User | null> = signal(null);

  /** True while we're checking auth status on startup */
  authLoading: WritableSignal<boolean> = signal(true);

  private readonly STORAGE_KEY_SESSION = AuthService.SESSION_STORAGE_KEY;
  private readonly API_BASE = environment.flaskApiUrl; // '' = relative (proxied)

  constructor() {
    this.init();
  }

  // ─── Initialization ───────────────────────────────────────────

  /**
   * On startup, check if the user has an active Flask session (Google OAuth).
   * If not, fall back to any cached localStorage session (guest).
   */
  private async init() {
    this.authLoading.set(true);
    try {
      const authenticated = await this.checkAuthStatus();
      if (authenticated !== true) {
        // No Flask session — restore guest/local session if one exists.
        // Only an explicit authenticated:false response should clear stale
        // cached Google-authenticated state; transient failures must preserve it.
        this.loadLocalSession();
        if (authenticated === false) {
          this.clearStaleAuthenticatedSession('Flask session expired');
        }
      }
    } finally {
      this.authLoading.set(false);
    }
  }

  /**
   * If the loaded local session points at a Google-authed user but Flask
   * reports no active session, drop it entirely. Keeping the cached user
   * (even downgraded to guest) causes the UI to show the Sign In button
   * while still rendering the previously authenticated user's recipes —
   * a state mismatch (and a minor privacy leak on shared devices). The
   * authenticated user's recipes live in the Flask DB and will be re-
   * hydrated on re-login.
   */
  private clearStaleAuthenticatedSession(reason: string) {
    const restored = this.currentUser();
    if (restored && !restored.isGuest) {
      console.log(`${reason} — clearing cached authenticated session`);
      this.currentUser.set(null);
      localStorage.removeItem(this.STORAGE_KEY_SESSION);
    }
  }

  // ─── Flask Backend Auth (Google OAuth) ────────────────────────

  /**
   * Check if the user has a valid Flask session cookie.
   * Called during app startup to check whether a Flask session is still active.
   * Returns:
   * - true when the backend confirms an authenticated Flask session
   * - false when the backend explicitly reports authenticated: false
   * - null for transient transport/server failures so cached state is preserved
   */
  async checkAuthStatus(): Promise<boolean | null> {
    try {
      const res = await fetch(`${this.API_BASE}/api/auth/check`, {
        credentials: 'include',
      });

      if (!res.ok) return null;

      const data = await res.json();
      if (data.authenticated) {
        // Clean up ?auth=success query param left by the OAuth redirect,
        // preserving any other query parameters that may be present.
        if (window.location.search.includes('auth=success')) {
          const url = new URL(window.location.href);
          url.searchParams.delete('auth');
          window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
        }

        // Merge any existing guest data before replacing session
        const existingLocal = this.getLocalSession();

        const user: User = {
          id: data.user_id || data.email,
          email: data.email,
          name: data.name || 'Chef',
          picture: data.picture,
          isGuest: false,
          authProvider: 'google',
          savedRecipes: existingLocal?.savedRecipes || [],
          cookbooks: existingLocal?.cookbooks || [],
        };

        this.currentUser.set(user);
        this.saveLocalSession(user);

        // Clear guest marker if present
        if (existingLocal?.isGuest) {
          console.log('Merged guest session data into authenticated user.');
        }

        return true;
      }

      return false;
    } catch {
      return null;
    }
  }

  /**
   * Initiate Google OAuth login via Flask backend.
   * Redirects the browser to Google's consent page.
   */
  async login(): Promise<void> {
    const res = await fetch(`${this.API_BASE}/api/auth/login`, {
      credentials: 'include',
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(body.error || 'Failed to initiate login');
    }

    const data = await res.json();
    if (data.authorization_url) {
      // Redirect to Google OAuth consent screen
      window.location.href = data.authorization_url;
    } else {
      throw new Error('No authorization URL received');
    }
  }

  /**
   * Logout: clear Flask session and local state.
   */
  async logout(): Promise<void> {
    try {
      await fetch(`${this.API_BASE}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // If Flask is unreachable, still clear local state
    }

    this.currentUser.set(null);
    localStorage.removeItem(this.STORAGE_KEY_SESSION);
  }

  // ─── Guest Session ────────────────────────────────────────────

  /**
   * Ensure a guest session exists (for unauthenticated users).
   * Allows full use of the app without signing in.
   */
  ensureGuestSession() {
    if (!this.currentUser()) {
      const guestUser: User = {
        id: crypto.randomUUID(),
        name: 'Guest Chef',
        isGuest: true,
        authProvider: 'guest',
        savedRecipes: [],
        cookbooks: [],
      };
      this.currentUser.set(guestUser);
      this.saveLocalSession(guestUser);
    }
  }

  /**
   * Hydrate the authenticated user's recipes and cookbooks from the API.
   * Called by PersistenceService after loading data from Flask.
   * Merges with any recipes already in localStorage (guest data brought in on login).
   */
  hydrate(recipes: Recipe[], cookbooks: Cookbook[]) {
    const user = this.currentUser();
    if (!user) return;

    // Merge recipes: keep any localStorage recipes NOT already in the API response
    const apiIds = new Set(recipes.map((r) => r.id));
    const localOnly = user.savedRecipes.filter((r) => !apiIds.has(r.id));
<<<<<<< HEAD
    const merged = [...recipes, ...localOnly];
=======

    // Merge ai_image_url from localStorage into API recipes. The API may
    // not have the URL yet if Pub/Sub image generation hasn't completed;
    // localStorage has it from the optimistic update in triggerImageGeneration.
    const localMap = new Map(user.savedRecipes.map((r) => [r.id, r]));
    const mergedApi = recipes.map((apiRecipe) => {
      const local = localMap.get(apiRecipe.id);
      if (local?.ai_image_url && !apiRecipe.ai_image_url) {
        return { ...apiRecipe, ai_image_url: local.ai_image_url };
      }
      return apiRecipe;
    });

    const merged = [...mergedApi, ...localOnly];
>>>>>>> 45a31fb (fix: address review findings — restore skill routing, popstate guard, O(n) merge)

    // Merge cookbooks: keep any localStorage cookbooks NOT already in the API response
    const apiCookbookIds = new Set(cookbooks.map((c) => c.id));
    const localOnlyCookbooks = user.cookbooks.filter((c) => !apiCookbookIds.has(c.id));
    const mergedCookbooks = [...cookbooks, ...localOnlyCookbooks];

    const updated = { ...user, savedRecipes: merged, cookbooks: mergedCookbooks };
    this.currentUser.set(updated);
    this.saveLocalSession(updated);
  }

  // ─── Recipe Management (localStorage) ─────────────────────────

  saveRecipe(recipe: Recipe) {
    const user = this.currentUser();
    if (!user) return;

    // Check if already saved by ID
    if (user.savedRecipes.some((r) => r.id === recipe.id)) {
      const updatedRecipes = user.savedRecipes.map((r) => (r.id === recipe.id ? recipe : r));
      this.updateUserRecord({ ...user, savedRecipes: updatedRecipes });
      return;
    }

    const updatedUser = {
      ...user,
      savedRecipes: [...user.savedRecipes, recipe],
    };
    this.updateUserRecord(updatedUser);
  }

  /**
   * Update a single field on a saved recipe in localStorage only.
   * Used after image generation to set ai_image_url without
   * overwriting the full recipe via the API (which would lose ai_image_data).
   */
  updateRecipeField(recipeId: string, field: keyof Recipe, value: unknown) {
    const user = this.currentUser();
    if (!user) return;

    const idx = user.savedRecipes.findIndex((r) => r.id === recipeId);
    if (idx === -1) return;

    const updatedRecipes = [...user.savedRecipes];
    updatedRecipes[idx] = { ...updatedRecipes[idx], [field]: value };
    this.updateUserRecord({ ...user, savedRecipes: updatedRecipes });
  }

  deleteRecipe(recipeId: string) {
    const user = this.currentUser();
    if (!user) return;

    const recipe = user.savedRecipes.find((r) => r.id === recipeId);
    const deletedRecipes = [...(user.deletedRecipes || [])];
    if (recipe) {
      // Remember which cookbooks this recipe was in, so restore can re-add it
      const cookbookIds = user.cookbooks
        .filter((cb) => cb.recipeIds.includes(recipeId))
        .map((cb) => cb.id);
      deletedRecipes.push({ recipe, deletedAt: new Date().toISOString(), cookbookIds });
    }

    this.updateUserRecord({
      ...user,
      savedRecipes: user.savedRecipes.filter((r) => r.id !== recipeId),
      cookbooks: user.cookbooks.map((cb) => ({
        ...cb,
        recipeIds: cb.recipeIds.filter((id) => id !== recipeId),
      })),
      deletedRecipes,
    });
  }

  restoreRecipe(recipeId: string) {
    const user = this.currentUser();
    if (!user) return;

    const entry = (user.deletedRecipes || []).find((d) => d.recipe.id === recipeId);
    if (!entry) return;

    // Restore cookbook membership if it was saved
    const cookbooks = entry.cookbookIds?.length
      ? user.cookbooks.map((cb) => {
          if (entry.cookbookIds!.includes(cb.id) && !cb.recipeIds.includes(recipeId)) {
            return { ...cb, recipeIds: [...cb.recipeIds, recipeId] };
          }
          return cb;
        })
      : user.cookbooks;

    this.updateUserRecord({
      ...user,
      savedRecipes: [...user.savedRecipes, entry.recipe],
      cookbooks,
      deletedRecipes: (user.deletedRecipes || []).filter((d) => d.recipe.id !== recipeId),
    });
  }

  permanentlyDeleteRecipe(recipeId: string) {
    const user = this.currentUser();
    if (!user) return;
    this.updateUserRecord({
      ...user,
      deletedRecipes: (user.deletedRecipes || []).filter((d) => d.recipe.id !== recipeId),
    });
  }

  emptyRecycleBin() {
    const user = this.currentUser();
    if (!user) return;
    this.updateUserRecord({
      ...user,
      deletedRecipes: [],
    });
  }

  importRecipes(recipes: Recipe[], targetCookbookId?: string | null): number {
    const user = this.currentUser();
    if (!user) return 0;

    const currentRecipes = [...user.savedRecipes];
    const validRecipeIds: string[] = [];

    recipes.forEach((r) => {
      if (r.name && r.ingredients && r.instructions) {
        if (!r.id) r.id = crypto.randomUUID();
        if (!currentRecipes.some((existing) => existing.id === r.id)) {
          currentRecipes.push(r as Recipe);
        }
        validRecipeIds.push(r.id);
      }
    });

    let cookbooks = user.cookbooks;
    if (targetCookbookId && validRecipeIds.length > 0) {
      cookbooks = cookbooks.map((cb) => {
        if (cb.id === targetCookbookId) {
          const uniqueIds = Array.from(new Set([...cb.recipeIds, ...validRecipeIds]));
          let coverImage = cb.coverImage;
          if (!coverImage) {
            const firstWithImage = currentRecipes.find(
              (r) => validRecipeIds.includes(r.id) && (r.ai_image_url || r.stock_image_url)
            );
            if (firstWithImage) {
              coverImage = firstWithImage.ai_image_url || firstWithImage.stock_image_url;
            }
          }
          return { ...cb, recipeIds: uniqueIds, coverImage };
        }
        return cb;
      });
    }

    if (validRecipeIds.length > 0) {
      this.updateUserRecord({
        ...user,
        savedRecipes: currentRecipes,
        cookbooks,
      });
    }
    return validRecipeIds.length;
  }

  // ─── Cookbook Management (localStorage) ────────────────────────

  createCookbook(name: string, description: string = '') {
    const user = this.currentUser();
    if (!user) return;

    const newCookbook: Cookbook = {
      id: crypto.randomUUID(),
      name,
      description,
      recipeIds: [],
    };

    this.updateUserRecord({
      ...user,
      cookbooks: [...user.cookbooks, newCookbook],
    });
  }

  deleteCookbook(cookbookId: string) {
    const user = this.currentUser();
    if (!user) return;

    this.updateUserRecord({
      ...user,
      cookbooks: user.cookbooks.filter((cb) => cb.id !== cookbookId),
    });
  }

  addRecipeToCookbook(cookbookId: string, recipe: Recipe) {
    const user = this.currentUser();
    if (!user) return;

    // 1. Ensure recipe is in savedRecipes
    const savedRecipes = [...user.savedRecipes];
    let recipeId = recipe.id;

    const existingIndex = savedRecipes.findIndex(
      (r) => r.id === recipe.id || r.name === recipe.name
    );
    if (existingIndex === -1) {
      savedRecipes.push(recipe);
    } else {
      recipeId = savedRecipes[existingIndex].id;
    }

    // 2. Add to cookbook
    const cookbooks = user.cookbooks.map((cb) => {
      if (cb.id === cookbookId) {
        if (!cb.recipeIds.includes(recipeId)) {
          const coverImage = cb.coverImage || recipe.ai_image_url || recipe.stock_image_url;
          return { ...cb, recipeIds: [...cb.recipeIds, recipeId], coverImage };
        }
      }
      return cb;
    });

    this.updateUserRecord({ ...user, savedRecipes, cookbooks });
  }

  removeRecipeFromCookbook(cookbookId: string, recipeId: string) {
    const user = this.currentUser();
    if (!user) return;

    const cookbooks = user.cookbooks.map((cb) => {
      if (cb.id === cookbookId) {
        return {
          ...cb,
          recipeIds: cb.recipeIds.filter((id) => id !== recipeId),
        };
      }
      return cb;
    });

    this.updateUserRecord({ ...user, cookbooks });
  }

  // ─── Internal: localStorage persistence ───────────────────────

  private updateUserRecord(user: User) {
    this.currentUser.set(user);
    this.saveLocalSession(user);
  }

  private saveLocalSession(user: User) {
    const safeUser: User = {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      isGuest: user.isGuest,
      authProvider: user.authProvider,
      // Strip base64 image data from the localStorage cache to stay within
      // the ~5 MB quota. URL-based images (from Flask) are kept.
      savedRecipes: (user.savedRecipes || []).map((r) => ({
        ...r,
        ai_image_url: r.ai_image_url?.startsWith('data:') ? undefined : r.ai_image_url,
        image: r.image?.startsWith('data:') ? undefined : r.image,
      })),
      cookbooks: user.cookbooks || [],
      deletedRecipes: user.deletedRecipes || [],
    };
    try {
      localStorage.setItem(this.STORAGE_KEY_SESSION, JSON.stringify(safeUser));
    } catch (e) {
      console.warn('Failed to save local session to localStorage (quota exceeded?):', e);
      // The in-memory signal is already updated, and the backend DB will still receive the POST.
      // Next time the user refreshes, loadFromApi() will restore from the server.
    }
  }

  private loadLocalSession() {
    const session = localStorage.getItem(this.STORAGE_KEY_SESSION);
    if (session) {
      try {
        const user = JSON.parse(session) as User;
        if (!user.savedRecipes) user.savedRecipes = [];
        if (!user.cookbooks) user.cookbooks = [];
        if (!user.deletedRecipes) user.deletedRecipes = [];
        this.currentUser.set(user);
      } catch (e) {
        console.error('Failed to parse local session', e);
        localStorage.removeItem(this.STORAGE_KEY_SESSION);
      }
    }
  }

  private getLocalSession(): User | null {
    const session = localStorage.getItem(this.STORAGE_KEY_SESSION);
    if (!session) return null;
    try {
      const user = JSON.parse(session) as User;
      if (!user.savedRecipes) user.savedRecipes = [];
      if (!user.cookbooks) user.cookbooks = [];
      if (!user.deletedRecipes) user.deletedRecipes = [];
      return user;
    } catch {
      return null;
    }
  }
}
