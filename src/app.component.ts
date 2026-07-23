import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, NavigationEnd, RouterOutlet } from '@angular/router';
import { GeminiService } from './services/gemini.service';
import { AuthService } from './services/auth.service';
import { PersistenceService } from './services/persistence.service';
import { ToastService } from './services/toast.service';
import { RecipeStateService } from './services/recipe-state.service';
import { HeaderComponent } from './components/header/header.component';
import { FooterComponent } from './components/footer/footer.component';
import { GeneratorComponent } from './components/generator/generator.component';
import { Ingredient, IngredientGroup, Recipe } from './recipe.types';
import { isInAppBrowserEnvironment } from './utils/in-app-browser';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet, HeaderComponent, FooterComponent, GeneratorComponent],
  templateUrl: './app.component.html',
  styleUrls: [],
})
export class AppComponent {
  private readonly router = inject(Router);
  private readonly geminiService = inject(GeminiService);
  private readonly persistenceService = inject(PersistenceService);
  readonly authService = inject(AuthService);
  private readonly toastService = inject(ToastService);
  readonly recipeState = inject(RecipeStateService);

  // Navigation — derived from Router events
  activeView = signal<'generator' | 'kitchen'>('generator');

  saveToast = computed(() => {
    const toasts = this.toastService.toasts();
    return toasts.length > 0 ? { message: toasts[0].message, recipe: toasts[0].recipe } : null;
  });

  constructor() {
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) {
        if (e.urlAfterRedirects.startsWith('/kitchen')) {
          this.authService.ensureGuestSession();
          this.activeView.set('kitchen');
        } else {
          this.activeView.set('generator');
        }
      }
    });
  }

  // Kitchen State
  activeCookbookId = signal<string | null>(null); // null means "All Recipes"
  showCreateCookbookModal = signal<boolean>(false);
  newCookbookName = signal('');
  newCookbookDesc = signal('');
  isCreatingCookbook = signal<boolean>(false); // in-flight guard: prevents duplicate cookbooks from rapid double-clicks

  // Manual Recipe Entry State
  showManualEntryModal = signal<boolean>(false);
  manualStep = signal<number>(1); // 1: Info, 2: Ingredients, 3: Instructions
  // Temporary form data
  manualRecipe = signal<{
    name: string;
    description: string;
    prepTime: number;
    cookTime: number;
    servings: number;
    notes: string;
    tags: string;
  }>({
    name: '',
    description: '',
    prepTime: 15,
    cookTime: 30,
    servings: 4,
    notes: '',
    tags: '',
  });

  manualIngredients = signal<
    {
      name: string;
      amount: number;
      units: string;
      type: 'wet' | 'dry' | 'other';
    }[]
  >([]);
  newIngredient = signal({
    name: '',
    amount: 1,
    units: '',
    type: 'dry' as 'wet' | 'dry' | 'other',
  });

  manualInstructions = signal<string[]>([]);
  newInstruction = signal('');

  // Add to Cookbook UI State
  showAddToCookbookModal = signal<boolean>(false);
  recipeToAdd = signal<Recipe | null>(null);
  /** Tracks which cookbook IDs the recipe should belong to (pending, uncommitted). */
  pendingCookbookIds = signal<Set<string>>(new Set());
  showRemoveConfirmation = signal<boolean>(false);
  cookbooksBeingRemoved = signal<string[]>([]);

  // Delete / Recycle Bin State
  showDeleteConfirmation = signal<boolean>(false);
  recipeToDelete = signal<Recipe | null>(null);
  showRecycleBin = signal<boolean>(false);
  showEmptyBinConfirmation = signal<boolean>(false);

  recycleBinRecipes = computed(() => this.authService.currentUser()?.deletedRecipes || []);
  recycleBinCount = computed(() => this.recycleBinRecipes().length);

  // Auth UI State
  showAuthModal = signal<boolean>(false);
  authError = signal<string | null>(null);
  authLoginLoading = signal<boolean>(false);

  /**
   * True when we're running inside a third-party in-app browser (Pinterest,
   * Instagram, Facebook, …) where Google OAuth returns
   * `Error 403: disallowed_useragent`. When true the auth modal swaps the
   * doomed "Sign in with Google" button for an "Open in your browser" fallback.
   * Computed once from the User-Agent — it can't change without a reload.
   */
  readonly isInAppBrowser = signal<boolean>(isInAppBrowserEnvironment());

  /** Transient confirmation after the user copies the page link in the fallback. */
  copiedShareLink = signal<boolean>(false);

  // Shared recipe state (used by kitchen view + modals)
  readonly recipe = this.recipeState.currentRecipe;
  readonly isSaved = this.recipeState.isSaved;
  readonly generatedImageUrl = this.recipeState.generatedImageUrl;

  // Portion Control
  // Computed Properties for Kitchen
  activeCookbook = computed(() => {
    const id = this.activeCookbookId();
    if (!id) return null;
    return this.authService.currentUser()?.cookbooks.find((cb) => cb.id === id) || null;
  });

  displayedKitchenRecipes = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return [];

    const cookbook = this.activeCookbook();
    if (cookbook) {
      // Filter user.savedRecipes by IDs in cookbook
      return user.savedRecipes.filter((r) => cookbook.recipeIds.includes(r.id));
    }
    // Default to all saved recipes
    return user.savedRecipes;
  });

  // Navigation Methods
  switchView(view: 'generator' | 'kitchen') {
    this.router.navigate([view === 'kitchen' ? '/kitchen' : '/']);
  }

  openSaveToastRecipe() {
    const toasts = this.toastService.toasts();
    if (toasts.length > 0 && toasts[0].recipe) {
      this.viewRecipe(toasts[0].recipe);
    }
    this.dismissSaveToast();
  }

  dismissSaveToast() {
    const toasts = this.toastService.toasts();
    if (toasts.length > 0) this.toastService.dismiss(toasts[0].id);
  }

  selectCookbook(id: string | null) {
    this.activeCookbookId.set(id);
    this.showRecycleBin.set(false);
  }

  // Kitchen Methods
  // Track whether "New Cookbook" was launched from "Add to Cookbook" flow
  private _creatingFromAddFlow = false;

  openCreateCookbookModal() {
    // If the Add to Cookbook modal is open, remember we came from there
    this._creatingFromAddFlow = this.showAddToCookbookModal();
    this.newCookbookName.set('');
    this.newCookbookDesc.set('');
    this.showCreateCookbookModal.set(true);
  }

  closeCreateCookbookModal() {
    this.showCreateCookbookModal.set(false);
    this._creatingFromAddFlow = false;
  }

  async createCookbook() {
    if (!this.newCookbookName().trim()) return;
    // Guard against a second submit while the first request is in flight —
    // without it, rapid clicks each fire a POST and create duplicate cookbooks.
    if (this.isCreatingCookbook()) return;
    this.isCreatingCookbook.set(true);
    try {
      const cookbookId = await this.persistenceService.createCookbook(
        this.newCookbookName(),
        this.newCookbookDesc()
      );
      // Creation was rejected outright (not a 409/network/5xx path, all of
      // which resolve to an id) — keep the modal open so the user can see
      // the failed state and retry instead of silently losing their input.
      if (!cookbookId) return;

      // Auto-select the new cookbook if creating from the "Add to Cookbook" flow
      if (this._creatingFromAddFlow) {
        this.pendingCookbookIds.update((ids) => {
          const next = new Set(ids);
          next.add(cookbookId);
          return next;
        });
        this._creatingFromAddFlow = false;
      }

      this.showCreateCookbookModal.set(false);
    } finally {
      this.isCreatingCookbook.set(false);
    }
  }

  async deleteCookbook(id: string, event: Event) {
    event.stopPropagation();
    if (
      confirm('Are you sure you want to delete this cookbook? Recipes will remain in "All Saved".')
    ) {
      await this.persistenceService.deleteCookbook(id);
      if (this.activeCookbookId() === id) {
        this.activeCookbookId.set(null);
      }
    }
  }

  // Manual Entry Methods
  private resetManualEntryDrafts() {
    this.newIngredient.set({ name: '', amount: 1, units: '', type: 'dry' });
    this.newInstruction.set('');
  }

  openManualEntryModal() {
    this.manualStep.set(1);
    this.manualRecipe.set({
      name: '',
      description: '',
      prepTime: 15,
      cookTime: 30,
      servings: 4,
      notes: '',
      tags: '',
    });
    this.manualIngredients.set([]);
    this.manualInstructions.set([]);
    this.resetManualEntryDrafts();
    this.showManualEntryModal.set(true);
  }

  closeManualEntryModal() {
    this.resetManualEntryDrafts();
    this.showManualEntryModal.set(false);
  }

  nextManualStep() {
    // Commit a typed-but-unadded ingredient row so leaving the step doesn't
    // silently discard it (addManualIngredient no-ops on an empty name).
    if (this.manualStep() === 2) {
      this.addManualIngredient();
    }
    this.manualStep.update((s) => s + 1);
  }

  prevManualStep() {
    this.manualStep.update((s) => s - 1);
  }

  addManualIngredient() {
    const ing = this.newIngredient();
    if (!ing.name.trim()) return;

    this.manualIngredients.update((list) => [...list, { ...ing }]);
    this.newIngredient.set({ name: '', amount: 1, units: '', type: 'dry' });
  }

  removeManualIngredient(index: number) {
    this.manualIngredients.update((list) => list.filter((_, i) => i !== index));
  }

  addManualInstruction() {
    const txt = this.newInstruction();
    if (!txt.trim()) return;

    this.manualInstructions.update((list) => [...list, txt]);
    this.newInstruction.set('');
  }

  removeManualInstruction(index: number) {
    this.manualInstructions.update((list) => list.filter((_, i) => i !== index));
  }

  async saveManualRecipe() {
    // Commit any typed-but-unadded ingredient/instruction rows so saving
    // doesn't silently discard them (both add methods no-op on empty input).
    this.addManualIngredient();
    this.addManualInstruction();

    const info = this.manualRecipe();

    // Group Ingredients
    const ingredients: IngredientGroup = {
      wet: [],
      dry: [],
      other: [],
    };

    this.manualIngredients().forEach((ing) => {
      const formatted: Ingredient = {
        name: ing.name,
        amount: ing.amount,
        units: ing.units,
      };
      if (ing.type === 'wet') ingredients.wet!.push(formatted);
      else if (ing.type === 'dry') ingredients.dry!.push(formatted);
      else ingredients.other!.push(formatted);
    });

    const newRecipe: Recipe = {
      id: crypto.randomUUID(),
      name: info.name,
      description: info.description,
      prepTime: info.prepTime,
      cookTime: info.cookTime,
      servings: info.servings,
      ingredients: ingredients,
      instructions: this.manualInstructions(),
      notes: info.notes,
      tags: info.tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t),
      image_keywords: [info.name, 'homemade'],
    };

    await this.persistenceService.saveRecipe(newRecipe);
    this.closeManualEntryModal();
  }

  // Import / Export
  exportRecipe(recipe?: Recipe) {
    const dataToExport = recipe ? recipe : this.authService.currentUser()?.savedRecipes || [];
    const fileName = recipe ? `${recipe.name.replace(/\s+/g, '_')}.json` : 'my_vegan_cookbook.json';

    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], {
      type: 'application/json',
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  onImportFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e: ProgressEvent<FileReader>) => {
      try {
        const result = e.target?.result;
        if (typeof result !== 'string') return;
        const json = JSON.parse(result);
        const recipes = Array.isArray(json) ? json : [json];

        // Strip any inline base64 image data before importing
        // (images are served via /api/recipes/<id>/image, not inline)
        const cleanedRecipes: Recipe[] = recipes.map((r: Record<string, unknown>) => {
          const cleaned = { ...r };
          delete cleaned['ai_image_data'];
          return cleaned as unknown as Recipe;
        });

        const count = this.authService.importRecipes(cleanedRecipes, this.activeCookbookId());
        // Sync imported recipes to Flask backend
        const recipesNeedingImages: Recipe[] = [];
        for (const r of cleanedRecipes) {
          if (r.name && r.ingredients && r.instructions) {
            await this.persistenceService.saveRecipe(r);
            if (!r.ai_image_url || r.ai_image_url.startsWith('data:')) {
              recipesNeedingImages.push(r);
            }
          }
        }

        if (recipesNeedingImages.length > 0) {
          alert(
            `Imported ${count} recipes! Generating images for ${recipesNeedingImages.length} recipe(s)...`
          );
          // Generate images in the background (non-blocking)
          this.generateMissingImages(recipesNeedingImages);
        } else {
          alert(`Successfully imported ${count} recipes!`);
        }
      } catch (err) {
        console.error('Failed to parse recipe import file:', err);
        alert('Failed to parse recipe file. Please ensure it is valid JSON.');
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  /**
   * Generate AI images for recipes that are missing them.
   * Runs in the background — does not block the UI.
   */
  private async generateMissingImages(recipes: Recipe[]) {
    let generated = 0;
    for (const recipe of recipes) {
      try {
        const imageUrl = await this.geminiService.generateImage(recipe.id);
        if (imageUrl) {
          recipe.ai_image_url = imageUrl;
          this.authService.saveRecipe(recipe);
          generated++;
        }
      } catch (err) {
        console.warn(`[Import] Failed to generate image for "${recipe.name}":`, err);
      }
    }
    if (generated > 0) {
      console.log(`[Import] Generated ${generated}/${recipes.length} images`);
    }
  }

  // Auth Methods
  openAuthModal() {
    this.showAuthModal.set(true);
    this.authError.set(null);
  }

  closeAuthModal() {
    this.showAuthModal.set(false);
  }

  async onGoogleLogin() {
    // Google refuses OAuth inside embedded webviews (Error 403:
    // disallowed_useragent). Firing login() here would bounce the user to a
    // dead-end consent screen, so short-circuit to the "open in your browser"
    // fallback instead.
    if (this.isInAppBrowser()) {
      this.authError.set(null);
      return;
    }

    this.authError.set(null);
    this.authLoginLoading.set(true);

    try {
      await this.authService.login();
      // login() redirects the browser to Google — we won't reach here
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start Google login';
      this.authError.set(message);
      this.authLoginLoading.set(false);
    }
  }

  /**
   * Copy the current page URL so the user can paste it into a real browser
   * (Safari/Chrome) where Google sign-in works. Fallback path for in-app
   * browsers — see {@link isInAppBrowser}. Best-effort: on clipboard failure
   * the user has to copy from the address bar or the share menu (per the
   * tip shown next to the button).
   */
  async copyShareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      this.copiedShareLink.set(true);
      setTimeout(() => this.copiedShareLink.set(false), 2500);
    } catch {
      // Clipboard API unavailable/blocked in some webviews — no-op; the
      // adjacent "share menu" tip is the manual fallback.
    }
  }

  async onLogout() {
    await this.authService.logout();
    this.recipeState.clearRecipe();
    this.router.navigate(['/']);
  }

  openAddToCookbookModal(recipe: Recipe | null = null) {
    const r = recipe || this.recipe();
    if (!r) return;
    this.recipeToAdd.set(r);

    // Initialize pending state from current cookbook membership
    const user = this.authService.currentUser();
    const currentIds = new Set<string>();
    if (user) {
      for (const cb of user.cookbooks) {
        if (cb.recipeIds.includes(r.id)) {
          currentIds.add(cb.id);
        }
      }
    }
    this.pendingCookbookIds.set(currentIds);
    this.showAddToCookbookModal.set(true);
  }

  closeAddToCookbookModal() {
    this.showAddToCookbookModal.set(false);
    this.recipeToAdd.set(null);
    this.pendingCookbookIds.set(new Set());
    this.showRemoveConfirmation.set(false);
    this.cookbooksBeingRemoved.set([]);
  }

  /** Toggle a cookbook in the pending selection. */
  toggleCookbookSelection(cookbookId: string) {
    this.pendingCookbookIds.update((ids) => {
      const next = new Set(ids);
      if (next.has(cookbookId)) {
        next.delete(cookbookId);
      } else {
        next.add(cookbookId);
      }
      return next;
    });
  }

  /** Check if a cookbook is in the pending selection. */
  isCookbookSelected(cookbookId: string): boolean {
    return this.pendingCookbookIds().has(cookbookId);
  }

  /** Confirm cookbook changes — shows removal confirmation if needed. */
  confirmCookbookChanges() {
    const r = this.recipeToAdd();
    if (!r) return;
    const user = this.authService.currentUser();
    if (!user) return;

    // Find cookbooks being removed
    const removals: string[] = [];
    for (const cb of user.cookbooks) {
      const wasIn = cb.recipeIds.includes(r.id);
      const stillIn = this.pendingCookbookIds().has(cb.id);
      if (wasIn && !stillIn) {
        removals.push(cb.name);
      }
    }

    if (removals.length > 0) {
      this.cookbooksBeingRemoved.set(removals);
      this.showRemoveConfirmation.set(true);
    } else {
      this.applyCookbookChanges();
    }
  }

  /** Apply all pending cookbook adds/removes. */
  async applyCookbookChanges() {
    const r = this.recipeToAdd();
    if (!r) return;
    const user = this.authService.currentUser();
    if (!user) return;

    const pending = this.pendingCookbookIds();

    for (const cb of user.cookbooks) {
      const wasIn = cb.recipeIds.includes(r.id);
      const shouldBeIn = pending.has(cb.id);

      if (!wasIn && shouldBeIn) {
        await this.persistenceService.addRecipeToCookbook(cb.id, r);
      } else if (wasIn && !shouldBeIn) {
        await this.persistenceService.removeRecipeFromCookbook(cb.id, r.id);
      }
    }

    // If we are currently viewing the generated recipe, mark as saved
    if (this.recipe()?.id === r.id) {
      this.isSaved.set(true);
    }

    this.closeAddToCookbookModal();
  }

  /** Cancel the removal confirmation and go back to the selection. */
  cancelRemoveConfirmation() {
    this.showRemoveConfirmation.set(false);
    this.cookbooksBeingRemoved.set([]);
  }

  // Kitchen actions
  viewRecipe(r: Recipe) {
    this.recipeState.viewRecipe(r);
    this.router.navigate(['/recipe', r.id]);
  }

  // ─── Delete / Recycle Bin ────────────────────────────────────

  /** Open delete confirmation for a recipe from the kitchen card. */
  promptDeleteRecipe(recipe: Recipe, event: Event) {
    event.stopPropagation();
    this.recipeToDelete.set(recipe);
    this.showDeleteConfirmation.set(true);
  }

  /** Confirm soft-delete: move recipe to Recycle Bin. */
  async confirmDeleteRecipe() {
    const r = this.recipeToDelete();
    if (!r) return;
    await this.persistenceService.deleteRecipe(r.id);

    // If this recipe was being viewed, clear it
    if (this.recipe()?.id === r.id) {
      this.recipe.set(null);
      this.generatedImageUrl.set(null);
    }

    this.showDeleteConfirmation.set(false);
    this.recipeToDelete.set(null);
  }

  cancelDeleteRecipe() {
    this.showDeleteConfirmation.set(false);
    this.recipeToDelete.set(null);
  }

  /** Restore a recipe from the Recycle Bin. */
  async restoreRecipe(recipeId: string) {
    await this.persistenceService.restoreRecipe(recipeId);
  }

  /** Permanently delete a single recipe from the Recycle Bin. */
  async permanentlyDeleteRecipe(recipeId: string) {
    await this.persistenceService.permanentlyDeleteRecipe(recipeId);
  }

  /** Show empty-bin confirmation. */
  promptEmptyRecycleBin() {
    this.showEmptyBinConfirmation.set(true);
  }

  /** Confirm: permanently delete all recipes in the bin. */
  async confirmEmptyRecycleBin() {
    await this.persistenceService.emptyRecycleBin();
    this.showEmptyBinConfirmation.set(false);
  }

  cancelEmptyRecycleBin() {
    this.showEmptyBinConfirmation.set(false);
  }

  /** Toggle Recycle Bin view in the kitchen sidebar. */
  toggleRecycleBin() {
    this.showRecycleBin.update((v) => !v);
    this.activeCookbookId.set(null);
  }

}
