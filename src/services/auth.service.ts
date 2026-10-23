import { Injectable, signal, WritableSignal } from '@angular/core';
import { Cookbook, User } from '../auth.types';
import { Recipe } from '../recipe.types';
import { environment } from '../environments/environment';
import { resetRecipeViewTracking } from '../utils/analytics';
import {
  addRecipeToUserCookbook,
  appendCookbook,
  buildAuthenticatedUserFromCheck,
  cleanOAuthSuccessUrl,
  clearDeletedRecipes,
  createGuestUser,
  hydrateUserLibrary,
  permanentlyDeleteSavedRecipe,
  readSessionFromStorage,
  removeCookbook,
  removeRecipeFromUserCookbook,
  removeSavedRecipeById,
  resolveCookbookRecipeId,
  resolveGuestSessionEnsure,
  restoreDeletedRecipe,
  saveSessionToStorage,
  SESSION_STORAGE_KEY,
  setUserCookbookMembership,
  shouldClearStaleAuthenticatedSession,
  softDeleteSavedRecipe,
  updateSavedRecipeField,
  upsertSavedRecipe,
} from './user-library.store';

export * from './user-library.store';

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
  static readonly SESSION_STORAGE_KEY = SESSION_STORAGE_KEY;

  currentUser: WritableSignal<User | null> = signal(null);

  /** True while we're checking auth status on startup */
  authLoading: WritableSignal<boolean> = signal(true);

  private readonly STORAGE_KEY_SESSION = AuthService.SESSION_STORAGE_KEY;
  private readonly API_BASE = environment.flaskApiUrl; // '' = relative (proxied)

  /** Resolves once the startup auth check has completed and local state is reconciled. */
  readonly ready: Promise<void>;

  /** True when ensureGuestSession() was called during the auth check but had
   *  to defer (cached non-guest session) — honored once init() reconciles. */
  private pendingGuestEnsure = false;

  constructor() {
    this.ready = this.init();
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
      // A caller asked for a session while the check was in flight but was
      // deferred because the cached session wasn't a guest. If reconciliation
      // wiped that session, honor the request now so the caller isn't
      // stranded with no session at all (saves would silently no-op).
      if (this.pendingGuestEnsure) {
        this.pendingGuestEnsure = false;
        if (!this.currentUser()) {
          this.ensureGuestSession();
        }
      }
    }
  }

  /**
   * Drop a cached Google-authed session when Flask reports no active session
   * (see `shouldClearStaleAuthenticatedSession` in `user-library.store.ts`).
   */
  private clearStaleAuthenticatedSession(reason: string) {
    if (shouldClearStaleAuthenticatedSession(this.currentUser())) {
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
        cleanOAuthSuccessUrl();
        const user = buildAuthenticatedUserFromCheck(data, this.getLocalSession());
        this.currentUser.set(user);
        this.saveLocalSession(user);
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
  async login(opts: { selectAccount?: boolean } = {}): Promise<void> {
    // KAN-344: without this Google reuses the browser's current account.
    const query = opts.selectAccount ? '?prompt=select_account' : '';
    const res = await fetch(`${this.API_BASE}/api/auth/login${query}`, {
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
    resetRecipeViewTracking();
  }

  /**
   * Switch user (KAN-344): log out, then sign in through Google's account
   * chooser. Log Out alone cannot switch accounts, because the next sign-in
   * lands on the Google account the browser is already signed into.
   */
  async switchUser(): Promise<void> {
    await this.logout();
    await this.login({ selectAccount: true });
  }

  // ─── Guest Session ────────────────────────────────────────────

  /**
   * Ensure a guest session exists (for unauthenticated users).
   * Allows full use of the app without signing in.
   */
  ensureGuestSession() {
    if (this.currentUser()) return;

    const existing = this.getLocalSession();
    const action = resolveGuestSessionEnsure(existing, this.authLoading());
    if (action === 'restore' && existing) {
      this.currentUser.set(existing);
      return;
    }
    if (action === 'defer') {
      this.pendingGuestEnsure = true;
      return;
    }

    const guestUser = createGuestUser();
    this.currentUser.set(guestUser);
    this.saveLocalSession(guestUser);
  }

  /**
   * Hydrate the authenticated user's recipes and cookbooks from the API.
   * Called by PersistenceService after loading data from Flask.
   * Merges with any recipes already in localStorage (guest data brought in on login).
   */
  hydrate(recipes: Recipe[], cookbooks: Cookbook[]) {
    const user = this.currentUser();
    if (!user) return;
    this.updateUserRecord(hydrateUserLibrary(user, recipes, cookbooks));
  }

  // ─── Recipe Management (localStorage) ─────────────────────────

  saveRecipe(recipe: Recipe) {
    const user = this.currentUser();
    if (!user) return;
    this.updateUserRecord(upsertSavedRecipe(user, recipe));
  }

  /**
   * KAN-241: remove a recipe from localStorage by ID without soft-deleting it.
   *
   * Used to undo the optimistic write when the server says the recipe is a
   * duplicate. `deleteRecipe` is wrong here — it moves the ghost to the
   * recycle bin, where `restoreRecipe` would re-POST it and get another 409.
   */
  removeRecipeById(recipeId: string) {
    const user = this.currentUser();
    if (!user) return;
    const updated = removeSavedRecipeById(user, recipeId);
    if (updated) this.updateUserRecord(updated);
  }

  /**
   * Update a single field on a saved recipe in localStorage only.
   * Used after image generation to set ai_image_url without
   * overwriting the full recipe via the API (which would lose ai_image_data).
   */
  updateRecipeField(recipeId: string, field: keyof Recipe, value: unknown) {
    const user = this.currentUser();
    if (!user) return;
    const updated = updateSavedRecipeField(user, recipeId, field, value);
    if (updated) this.updateUserRecord(updated);
  }

  deleteRecipe(recipeId: string) {
    const user = this.currentUser();
    if (!user) return;
    this.updateUserRecord(softDeleteSavedRecipe(user, recipeId));
  }

  restoreRecipe(recipeId: string) {
    const user = this.currentUser();
    if (!user) return;
    const updated = restoreDeletedRecipe(user, recipeId);
    if (updated) this.updateUserRecord(updated);
  }

  permanentlyDeleteRecipe(recipeId: string) {
    const user = this.currentUser();
    if (!user) return;
    this.updateUserRecord(permanentlyDeleteSavedRecipe(user, recipeId));
  }

  emptyRecycleBin() {
    const user = this.currentUser();
    if (!user) return;
    this.updateUserRecord(clearDeletedRecipes(user));
  }

  // ─── Cookbook Management (localStorage) ────────────────────────

  createCookbook(name: string, description: string = '', id?: string): Cookbook | undefined {
    const user = this.currentUser();
    if (!user) return undefined;
    const { user: updatedUser, cookbook } = appendCookbook(user, name, description, id);
    this.updateUserRecord(updatedUser);
    return cookbook;
  }

  deleteCookbook(cookbookId: string) {
    const user = this.currentUser();
    if (!user) return;
    this.updateUserRecord(removeCookbook(user, cookbookId));
  }

  /**
   * The id addRecipeToCookbook puts in a cookbook for this recipe: its own,
   * or that of a saved recipe it matches by id or name. KAN-333: an undo of a
   * failed add has to remove this id, not necessarily recipe.id.
   */
  cookbookRecipeIdFor(recipe: Recipe): string {
    return resolveCookbookRecipeId(this.currentUser(), recipe);
  }

  addRecipeToCookbook(cookbookId: string, recipe: Recipe) {
    const user = this.currentUser();
    if (!user) return;
    this.updateUserRecord(addRecipeToUserCookbook(user, cookbookId, recipe));
  }

  removeRecipeFromCookbook(cookbookId: string, recipeId: string) {
    const user = this.currentUser();
    if (!user) return;
    this.updateUserRecord(removeRecipeFromUserCookbook(user, cookbookId, recipeId));
  }

  /**
   * KAN-333: set whether one recipe is in one cookbook, touching nothing
   * else. Used to undo an optimistic change the server did not take, so the
   * dialog shows the account's state and saving again sends the request.
   */
  setCookbookMembership(cookbookId: string, recipeId: string, present: boolean) {
    const user = this.currentUser();
    if (!user) return;
    this.updateUserRecord(setUserCookbookMembership(user, cookbookId, recipeId, present));
  }

  // ─── Internal: localStorage persistence ───────────────────────

  private updateUserRecord(user: User) {
    this.currentUser.set(user);
    this.saveLocalSession(user);
  }

  private saveLocalSession(user: User) {
    saveSessionToStorage(this.STORAGE_KEY_SESSION, user);
  }

  private loadLocalSession() {
    const user = readSessionFromStorage(this.STORAGE_KEY_SESSION, true);
    if (user) {
      this.currentUser.set(user);
    }
  }

  private getLocalSession(): User | null {
    return readSessionFromStorage(this.STORAGE_KEY_SESSION, false);
  }
}
