import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GeminiService } from './services/gemini.service';
import { AuthService } from './services/auth.service';
import { PersistenceService } from './services/persistence.service';
import { Ingredient, IngredientGroup, Recipe } from './recipe.types';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: [],
})
export class AppComponent {
  private readonly geminiService = inject(GeminiService);
  private readonly persistenceService = inject(PersistenceService);
  readonly authService = inject(AuthService);

  // Navigation
  activeView = signal<'generator' | 'kitchen'>('generator');

  constructor() {
    // Browser history: switchView() pushes { view: 'kitchen' } when entering
    // kitchen, so a popstate with that state means the user navigated forward
    // to kitchen; a null/missing state means they navigated back to generator.
    window.addEventListener('popstate', (event) => {
      const state = event.state;
      if (state?.view === 'kitchen') {
        this.authService.ensureGuestSession();
        this.activeView.set('kitchen');
      } else if (state?.view === 'recipe-detail') {
        // Restore kitchen view (cookbook context preserved)
        this.activeView.set('kitchen');
      } else {
        this.activeView.set('generator');
      }
    });
  }

  // Kitchen State
  activeCookbookId = signal<string | null>(null); // null means "All Recipes"
  showCreateCookbookModal = signal<boolean>(false);
  newCookbookName = signal('');
  newCookbookDesc = signal('');

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
  showUserProfileCard = signal<boolean>(false);

  // Recipe Gen State
  prompt = signal<string>('');
  recipe = signal<Recipe | null>(null);

  // Edit Notes State
  isEditingNotes = signal<boolean>(false);
  editedNotes = signal<string>('');

  // Status Signals
  isRecipeLoading = signal<boolean>(false);
  isImageLoading = signal<boolean>(false);
  error = signal<string | null>(null);
  isSaved = signal<boolean>(false);

  // Image Data
  generatedImageUrl = signal<string | null>(null);

  // Portion Control
  servingsMultiplier = signal<number>(1);

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

  // Computed Recipe Data with Scaling
  scaledIngredients = computed(() => {
    const r = this.recipe();
    const mult = this.servingsMultiplier();
    if (!r) return null;

    const scaleIngredient = (ing: Ingredient): Ingredient => {
      let newAmount: number | number[];

      if (Array.isArray(ing.amount)) {
        newAmount = ing.amount.map((val) => Number((val * mult).toFixed(2)));
      } else {
        newAmount = Number((ing.amount * mult).toFixed(2));
      }

      return { ...ing, amount: newAmount };
    };

    const scaledGroup: IngredientGroup = {};
    if (r.ingredients.wet) scaledGroup.wet = r.ingredients.wet.map(scaleIngredient);
    if (r.ingredients.dry) scaledGroup.dry = r.ingredients.dry.map(scaleIngredient);
    if (r.ingredients.other) scaledGroup.other = r.ingredients.other.map(scaleIngredient);

    return scaledGroup;
  });

  scaledServings = computed(() => {
    const r = this.recipe();
    if (!r) return 0;
    return Math.round(r.servings * this.servingsMultiplier());
  });

  // Navigation Methods
  switchView(view: 'generator' | 'kitchen') {
    this.activeView.set(view);
    if (view === 'kitchen') {
      this.authService.ensureGuestSession();
      // Push history state so browser back returns to generator
      window.history.pushState({ view: 'kitchen' }, '', window.location.href);
    }
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
    await this.persistenceService.createCookbook(this.newCookbookName(), this.newCookbookDesc());

    // Auto-select the new cookbook if creating from the "Add to Cookbook" flow
    if (this._creatingFromAddFlow) {
      const user = this.authService.currentUser();
      if (user) {
        const newest = user.cookbooks[user.cookbooks.length - 1];
        if (newest) {
          this.pendingCookbookIds.update((ids) => {
            const next = new Set(ids);
            next.add(newest.id);
            return next;
          });
        }
      }
      this._creatingFromAddFlow = false;
    }

    this.showCreateCookbookModal.set(false);
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
    this.showManualEntryModal.set(true);
  }

  closeManualEntryModal() {
    this.showManualEntryModal.set(false);
  }

  nextManualStep() {
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

  toggleUserProfileCard() {
    this.showUserProfileCard.update((v) => !v);
  }

  closeUserProfileCard() {
    this.showUserProfileCard.set(false);
  }

  /** Mask email for display: "adam@gmail.com" → "ad***@gmail.com" */
  maskedEmail(): string {
    const email = this.authService.currentUser()?.email;
    if (!email) return '';
    const [local, domain] = email.split('@');
    if (!domain || local.length <= 2) return email;
    return local.slice(0, 2) + '***@' + domain;
  }

  async onLogout() {
    this.showUserProfileCard.set(false);
    await this.authService.logout();
    this.recipe.set(null);
    this.generatedImageUrl.set(null);
    this.prompt.set('');
    this.activeView.set('generator');
  }

  // Recipe Generator Methods
  async onGenerate() {
    if (!this.prompt().trim()) return;

    this.authService.ensureGuestSession();
    this.activeView.set('generator'); // Ensure we are on generator view

    this.isRecipeLoading.set(true);
    this.isImageLoading.set(false);
    this.error.set(null);
    this.recipe.set(null);
    this.generatedImageUrl.set(null);
    this.servingsMultiplier.set(1);
    this.isSaved.set(false);

    try {
      const generatedRecipe = await this.geminiService.generateRecipe(this.prompt());
      this.recipe.set(generatedRecipe);
      this.isSaved.set(true); // Flask saves to DB during generation

      // Update local signal so My Kitchen shows the recipe immediately
      // (API save is idempotent — 409 conflict is ignored)
      await this.persistenceService.saveRecipe(generatedRecipe);

      this.triggerImageGeneration(generatedRecipe);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to generate recipe. Please try again.';
      this.error.set(message);
    } finally {
      this.isRecipeLoading.set(false);
    }
  }

  async triggerImageGeneration(recipe: Recipe) {
    const targetId = recipe.id; // Capture ID to guard against race conditions
    this.isImageLoading.set(true);
    try {
      const imageUrl = await this.geminiService.generateImage(targetId);

      // Only update UI if this recipe is still the active one
      if (this.recipe()?.id === targetId) {
        this.generatedImageUrl.set(imageUrl);
        this.recipe.update((r) => (r ? { ...r, ai_image_url: imageUrl } : null));
      }

      // Update localStorage only — backend already saved the image data.
      // Calling persistenceService.saveRecipe() would overwrite the DB
      // recipe with a version missing ai_image_data (stripped from API responses).
      this.authService.updateRecipeField(targetId, 'ai_image_url', imageUrl);
    } catch (err) {
      console.error('Image generation failed', err);
    } finally {
      if (this.recipe()?.id === targetId) {
        this.isImageLoading.set(false);
      }
    }
  }

  async regenerateImage() {
    const currentRecipe = this.recipe();
    if (!currentRecipe) return;
    const targetId = currentRecipe.id;
    this.isImageLoading.set(true);
    try {
      const imageUrl = await this.geminiService.generateImage(targetId, true);
      if (this.recipe()?.id === targetId) {
        this.generatedImageUrl.set(imageUrl);
        this.recipe.update((r) => (r ? { ...r, ai_image_url: imageUrl } : null));
      }

      // localStorage only — backend already saved the image data
      this.authService.updateRecipeField(targetId, 'ai_image_url', imageUrl);
    } catch (err) {
      console.error('Image regeneration failed', err);
    } finally {
      if (this.recipe()?.id === targetId) {
        this.isImageLoading.set(false);
      }
    }
  }

  async onSaveRecipe() {
    const currentRecipe = this.recipe();
    if (!currentRecipe) return;

    await this.persistenceService.saveRecipe(currentRecipe);
    this.isSaved.set(true);
  }

  // Notes Editing
  startEditNotes() {
    const r = this.recipe();
    if (r) {
      this.editedNotes.set(r.notes || '');
      this.isEditingNotes.set(true);
    }
  }

  cancelEditNotes() {
    this.isEditingNotes.set(false);
    this.editedNotes.set('');
  }

  async saveNotes() {
    const r = this.recipe();
    if (r) {
      const updatedRecipe = { ...r, notes: this.editedNotes() };
      this.recipe.set(updatedRecipe);
      await this.persistenceService.saveRecipe(updatedRecipe);
      this.isEditingNotes.set(false);
    }
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
    this.recipe.set(r);
    this.generatedImageUrl.set(r.ai_image_url || null);
    this.isSaved.set(true);
    this.activeView.set('generator');
    this.isEditingNotes.set(false);
    // Push history so browser back returns to the kitchen view
    window.history.pushState({ view: 'recipe-detail' }, '', window.location.href);
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

  updatePortions(multiplier: number) {
    this.servingsMultiplier.set(multiplier);
  }

  // ─── v0.2 Distribution Methods ────────────────────────────

  async togglePublic(recipe: Recipe) {
    const nextState = !recipe.is_public;
    recipe.is_public = nextState;

    // If making public and slug is missing, generate one
    if (nextState && !recipe.slug) {
      recipe.slug = recipe.name
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    try {
      await this.persistenceService.saveRecipe(recipe);
      this.authService.saveRecipe(recipe); // Update local state
    } catch (err) {
      console.error('Failed to toggle public state:', err);
      recipe.is_public = !nextState; // Revert on failure
    }
  }

  async updateSlug(recipe: Recipe) {
    if (!recipe.slug?.trim()) return;

    // Clean the slug
    recipe.slug = recipe.slug
      .toLowerCase()
      .trim()
      .replace(/[\s_-]+/g, '-')
      .replace(/[^\w-]/g, '');

    try {
      await this.persistenceService.saveRecipe(recipe);
      this.authService.saveRecipe(recipe); // Update local state
    } catch (err) {
      console.error('Failed to update slug:', err);
    }
  }

  formatAmount(amount: number | number[]): string {
    if (Array.isArray(amount)) {
      return amount.join(' - ');
    }
    const decimal = amount;
    if (Math.abs(decimal - 0.25) < 0.01) return '1/4';
    if (Math.abs(decimal - 0.5) < 0.01) return '1/2';
    if (Math.abs(decimal - 0.75) < 0.01) return '3/4';
    if (Math.abs(decimal - 0.33) < 0.01) return '1/3';
    if (Math.abs(decimal - 0.66) < 0.01) return '2/3';
    return decimal.toString();
  }

  isString(val: unknown): boolean {
    return typeof val === 'string';
  }
}
