import { Injectable, signal, WritableSignal } from '@angular/core';
import { User, Cookbook } from '../auth.types';
import { Recipe } from '../recipe.types';

interface StoredUser extends User {
  passwordHash?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  currentUser: WritableSignal<User | null> = signal(null);
  private readonly STORAGE_KEY_USERS = 'vegan_genius_users';
  private readonly STORAGE_KEY_SESSION = 'vegan_genius_session';

  constructor() {
    this.loadSession();
  }

  private loadSession() {
    const session = localStorage.getItem(this.STORAGE_KEY_SESSION);
    if (session) {
      try {
        const user = JSON.parse(session);
        // Ensure arrays exist for backward compatibility
        if (!user.savedRecipes) user.savedRecipes = [];
        if (!user.cookbooks) user.cookbooks = [];
        this.currentUser.set(user);
      } catch (e) {
        console.error('Failed to parse session', e);
        localStorage.removeItem(this.STORAGE_KEY_SESSION);
      }
    }
  }

  ensureGuestSession() {
    if (!this.currentUser()) {
      const guestUser: User = {
        id: crypto.randomUUID(),
        name: 'Guest Chef',
        isGuest: true,
        savedRecipes: [],
        cookbooks: []
      };
      this.setSession(guestUser as StoredUser);
    }
  }

  async signup(name: string, email: string, password: string): Promise<void> {
    const users = this.getStoredUsers();
    if (users.some(u => u.email === email)) {
      throw new Error('User with this email already exists.');
    }

    const passwordHash = await this.hashPassword(password);
    const newUser: StoredUser = {
      id: crypto.randomUUID(),
      name,
      email,
      passwordHash,
      savedRecipes: [],
      cookbooks: []
    };

    users.push(newUser);
    this.saveUsers(users);
    this.setSession(newUser);
  }

  async login(email: string, password: string): Promise<void> {
    const users = this.getStoredUsers();
    const user = users.find(u => u.email === email);

    if (!user) {
      throw new Error('Invalid email or password.');
    }

    const passwordHash = await this.hashPassword(password);
    if (user.passwordHash !== passwordHash) {
      throw new Error('Invalid email or password.');
    }

    // Ensure cookbooks initialized on login if missing
    if (!user.cookbooks) user.cookbooks = [];

    this.setSession(user);
  }

  logout() {
    this.currentUser.set(null);
    localStorage.removeItem(this.STORAGE_KEY_SESSION);
  }

  saveRecipe(recipe: Recipe) {
    const user = this.currentUser();
    if (!user) return;

    // Check if already saved by ID
    if (user.savedRecipes.some(r => r.id === recipe.id)) {
        // Update existing
        const updatedRecipes = user.savedRecipes.map(r => r.id === recipe.id ? recipe : r);
        this.updateUserRecord({ ...user, savedRecipes: updatedRecipes });
        return;
    }

    const updatedUser = {
      ...user,
      savedRecipes: [...user.savedRecipes, recipe]
    };

    this.updateUserRecord(updatedUser);
  }

  importRecipes(recipes: any[], targetCookbookId?: string | null): number {
    const user = this.currentUser();
    if (!user) return 0;

    let currentRecipes = [...user.savedRecipes];
    const validRecipeIds: string[] = [];

    recipes.forEach(r => {
      // Basic validation
      if (r.name && r.ingredients && r.instructions) {
        // Ensure ID
        if (!r.id) r.id = crypto.randomUUID();
        
        // Avoid duplicates by ID in global storage
        if (!currentRecipes.some(existing => existing.id === r.id)) {
          currentRecipes.push(r as Recipe);
        }
        validRecipeIds.push(r.id);
      }
    });

    let cookbooks = user.cookbooks;
    if (targetCookbookId && validRecipeIds.length > 0) {
        cookbooks = cookbooks.map(cb => {
            if (cb.id === targetCookbookId) {
                // Add new IDs to the cookbook, utilizing Set for uniqueness
                const uniqueIds = Array.from(new Set([...cb.recipeIds, ...validRecipeIds]));
                
                // If the cookbook doesn't have a cover image, try to set one from the imported recipes
                let coverImage = cb.coverImage;
                if (!coverImage) {
                    const firstWithImage = currentRecipes.find(r => validRecipeIds.includes(r.id) && (r.ai_image_url || r.stock_image_url));
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
      this.updateUserRecord({ ...user, savedRecipes: currentRecipes, cookbooks });
    }
    return validRecipeIds.length;
  }

  // Cookbook Management

  createCookbook(name: string, description: string = '') {
    const user = this.currentUser();
    if (!user) return;

    const newCookbook: Cookbook = {
      id: crypto.randomUUID(),
      name,
      description,
      recipeIds: []
    };

    const updatedUser = {
      ...user,
      cookbooks: [...user.cookbooks, newCookbook]
    };

    this.updateUserRecord(updatedUser);
  }

  deleteCookbook(cookbookId: string) {
    const user = this.currentUser();
    if (!user) return;

    const updatedUser = {
      ...user,
      cookbooks: user.cookbooks.filter(cb => cb.id !== cookbookId)
    };

    this.updateUserRecord(updatedUser);
  }

  addRecipeToCookbook(cookbookId: string, recipe: Recipe) {
    const user = this.currentUser();
    if (!user) return;

    // 1. Ensure recipe is in savedRecipes
    let savedRecipes = [...user.savedRecipes];
    let recipeId = recipe.id;
    
    const existingIndex = savedRecipes.findIndex(r => r.id === recipe.id || r.name === recipe.name);
    if (existingIndex === -1) {
      savedRecipes.push(recipe);
    } else {
      recipeId = savedRecipes[existingIndex].id;
    }

    // 2. Add to cookbook
    const cookbooks = user.cookbooks.map(cb => {
      if (cb.id === cookbookId) {
        if (!cb.recipeIds.includes(recipeId)) {
          // If this is the first recipe and it has an image, maybe set as cover?
          const coverImage = cb.coverImage || recipe.ai_image_url || recipe.stock_image_url;
          return { ...cb, recipeIds: [...cb.recipeIds, recipeId], coverImage };
        }
      }
      return cb;
    });

    const updatedUser = {
      ...user,
      savedRecipes,
      cookbooks
    };

    this.updateUserRecord(updatedUser);
  }

  removeRecipeFromCookbook(cookbookId: string, recipeId: string) {
    const user = this.currentUser();
    if (!user) return;

    const cookbooks = user.cookbooks.map(cb => {
      if (cb.id === cookbookId) {
        return { ...cb, recipeIds: cb.recipeIds.filter(id => id !== recipeId) };
      }
      return cb;
    });

    this.updateUserRecord({ ...user, cookbooks });
  }

  private updateUserRecord(user: User) {
    this.setSession(user as StoredUser);

    if (!user.isGuest && user.email) {
      const users = this.getStoredUsers();
      const index = users.findIndex(u => u.id === user.id);
      if (index !== -1) {
        const existing = users[index];
        users[index] = { ...user, passwordHash: existing.passwordHash };
        this.saveUsers(users);
      }
    }
  }

  private setSession(user: StoredUser) {
    const safeUser: User = {
      id: user.id,
      email: user.email,
      name: user.name,
      isGuest: user.isGuest,
      savedRecipes: user.savedRecipes || [],
      cookbooks: user.cookbooks || []
    };
    this.currentUser.set(safeUser);
    localStorage.setItem(this.STORAGE_KEY_SESSION, JSON.stringify(safeUser));
  }

  private getStoredUsers(): StoredUser[] {
    const stored = localStorage.getItem(this.STORAGE_KEY_USERS);
    return stored ? JSON.parse(stored) : [];
  }

  private saveUsers(users: StoredUser[]) {
    localStorage.setItem(this.STORAGE_KEY_USERS, JSON.stringify(users));
  }

  private async hashPassword(password: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
