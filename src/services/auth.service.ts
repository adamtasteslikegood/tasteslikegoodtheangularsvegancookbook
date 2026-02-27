import { Injectable, signal, WritableSignal } from "@angular/core";
import { User, Cookbook } from "../auth.types";
import { Recipe } from "../recipe.types";
import { environment } from "../environments/environment";

/**
 * Authentication service that orchestrates both:
 * - Flask backend (Google OAuth via /api/auth/*)
 * - localStorage (guest sessions, recipe/cookbook persistence)
 *
 * Phase 2: Replaces the old localStorage-only email/password auth
 * with real Google OAuth through the Flask backend.
 */
@Injectable({
  providedIn: "root",
})
export class AuthService {
  currentUser: WritableSignal<User | null> = signal(null);

  /** True while we're checking auth status on startup */
  authLoading: WritableSignal<boolean> = signal(true);

  private readonly STORAGE_KEY_SESSION = "vegan_genius_session";
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
      if (!authenticated) {
        // No Flask session — restore guest/local session if one exists
        this.loadLocalSession();
      }
    } catch {
      // Network error (Flask not running, etc.) — fall back to local
      this.loadLocalSession();
    } finally {
      this.authLoading.set(false);
    }
  }

  // ─── Flask Backend Auth (Google OAuth) ────────────────────────

  /**
   * Check if the user has a valid Flask session cookie.
   * Called on app init and after OAuth callback redirect.
   * Returns true if user is authenticated via Flask.
   */
  async checkAuthStatus(): Promise<boolean> {
    try {
      const res = await fetch(`${this.API_BASE}/api/auth/check`, {
        credentials: "include",
      });

      if (!res.ok) return false;

      const data = await res.json();
      if (data.authenticated) {
        // Merge any existing guest data before replacing session
        const existingLocal = this.getLocalSession();

        const user: User = {
          id: data.user_id || data.email,
          email: data.email,
          name: data.name || "Chef",
          picture: data.picture,
          isGuest: false,
          authProvider: "google",
          savedRecipes: existingLocal?.savedRecipes || [],
          cookbooks: existingLocal?.cookbooks || [],
        };

        this.currentUser.set(user);
        this.saveLocalSession(user);

        // Clear guest marker if present
        if (existingLocal?.isGuest) {
          console.log("Merged guest session data into authenticated user.");
        }

        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Initiate Google OAuth login via Flask backend.
   * Redirects the browser to Google's consent page.
   */
  async login(): Promise<void> {
    try {
      const res = await fetch(`${this.API_BASE}/api/auth/login`, {
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Login failed" }));
        throw new Error(err.error || "Failed to initiate login");
      }

      const data = await res.json();
      if (data.authorization_url) {
        // Redirect to Google OAuth consent screen
        window.location.href = data.authorization_url;
      } else {
        throw new Error("No authorization URL received");
      }
    } catch (err: any) {
      console.error("Login initiation failed:", err);
      throw err;
    }
  }

  /**
   * Logout: clear Flask session and local state.
   */
  async logout(): Promise<void> {
    try {
      await fetch(`${this.API_BASE}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
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
        name: "Guest Chef",
        isGuest: true,
        authProvider: "guest",
        savedRecipes: [],
        cookbooks: [],
      };
      this.currentUser.set(guestUser);
      this.saveLocalSession(guestUser);
    }
  }

  // ─── Recipe Management (localStorage) ─────────────────────────

  saveRecipe(recipe: Recipe) {
    const user = this.currentUser();
    if (!user) return;

    // Check if already saved by ID
    if (user.savedRecipes.some((r) => r.id === recipe.id)) {
      const updatedRecipes = user.savedRecipes.map((r) =>
        r.id === recipe.id ? recipe : r,
      );
      this.updateUserRecord({ ...user, savedRecipes: updatedRecipes });
      return;
    }

    const updatedUser = {
      ...user,
      savedRecipes: [...user.savedRecipes, recipe],
    };
    this.updateUserRecord(updatedUser);
  }

  importRecipes(recipes: any[], targetCookbookId?: string | null): number {
    const user = this.currentUser();
    if (!user) return 0;

    let currentRecipes = [...user.savedRecipes];
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
          const uniqueIds = Array.from(
            new Set([...cb.recipeIds, ...validRecipeIds]),
          );
          let coverImage = cb.coverImage;
          if (!coverImage) {
            const firstWithImage = currentRecipes.find(
              (r) =>
                validRecipeIds.includes(r.id) &&
                (r.ai_image_url || r.stock_image_url),
            );
            if (firstWithImage) {
              coverImage =
                firstWithImage.ai_image_url || firstWithImage.stock_image_url;
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

  createCookbook(name: string, description: string = "") {
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
    let savedRecipes = [...user.savedRecipes];
    let recipeId = recipe.id;

    const existingIndex = savedRecipes.findIndex(
      (r) => r.id === recipe.id || r.name === recipe.name,
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
          const coverImage =
            cb.coverImage || recipe.ai_image_url || recipe.stock_image_url;
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
      savedRecipes: user.savedRecipes || [],
      cookbooks: user.cookbooks || [],
    };
    localStorage.setItem(this.STORAGE_KEY_SESSION, JSON.stringify(safeUser));
  }

  private loadLocalSession() {
    const session = localStorage.getItem(this.STORAGE_KEY_SESSION);
    if (session) {
      try {
        const user = JSON.parse(session) as User;
        if (!user.savedRecipes) user.savedRecipes = [];
        if (!user.cookbooks) user.cookbooks = [];
        this.currentUser.set(user);
      } catch (e) {
        console.error("Failed to parse local session", e);
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
      return user;
    } catch {
      return null;
    }
  }
}
