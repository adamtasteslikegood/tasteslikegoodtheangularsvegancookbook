import {Component, computed, inject, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {GeminiService} from './services/gemini.service';
import {AuthService} from './services/auth.service';
import {PersistenceService} from './services/persistence.service';
import {Ingredient, IngredientGroup, Recipe} from './recipe.types';

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './app.component.html',
    styleUrls: [],
})
export class AppComponent {
    private geminiService = inject(GeminiService);
    private persistenceService = inject(PersistenceService);
    authService = inject(AuthService);

    // Navigation
    activeView = signal<'generator' | 'kitchen'>('generator');

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

    // Auth UI State
    showAuthModal = signal<boolean>(false);
    authError = signal<string | null>(null);
    authLoginLoading = signal<boolean>(false);

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

            return {...ing, amount: newAmount};
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
        }
    }

    selectCookbook(id: string | null) {
        this.activeCookbookId.set(id);
    }

    // Kitchen Methods
    openCreateCookbookModal() {
        this.newCookbookName.set('');
        this.newCookbookDesc.set('');
        this.showCreateCookbookModal.set(true);
    }

    closeCreateCookbookModal() {
        this.showCreateCookbookModal.set(false);
    }

    async createCookbook() {
        if (!this.newCookbookName().trim()) return;
        await this.persistenceService.createCookbook(this.newCookbookName(), this.newCookbookDesc());
        this.closeCreateCookbookModal();
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

        this.manualIngredients.update((list) => [...list, {...ing}]);
        this.newIngredient.set({name: '', amount: 1, units: '', type: 'dry'});
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
                    const cleaned = {...r};
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
                console.error(err);
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

    async onLogout() {
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
        this.isImageLoading.set(true);
        try {
            const imageUrl = await this.geminiService.generateImage(recipe.id);
            this.generatedImageUrl.set(imageUrl);
            this.recipe.update((r) => (r ? {...r, ai_image_url: imageUrl} : null));

            // If recipe is already saved, update local state too
            if (this.isSaved()) {
                await this.persistenceService.saveRecipe(this.recipe()!);
            }
        } catch (err) {
            console.error('Image generation failed', err);
        } finally {
            this.isImageLoading.set(false);
        }
    }

    async regenerateImage() {
        const currentRecipe = this.recipe();
        if (!currentRecipe) return;
        this.isImageLoading.set(true);
        try {
            const imageUrl = await this.geminiService.generateImage(currentRecipe.id, true);
            this.generatedImageUrl.set(imageUrl);
            this.recipe.update((r) => (r ? {...r, ai_image_url: imageUrl} : null));
        } catch (err) {
            console.error('Image regeneration failed', err);
        } finally {
            this.isImageLoading.set(false);
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
            const updatedRecipe = {...r, notes: this.editedNotes()};
            this.recipe.set(updatedRecipe);
            await this.persistenceService.saveRecipe(updatedRecipe);
            this.isEditingNotes.set(false);
        }
    }

    openAddToCookbookModal(recipe: Recipe | null = null) {
        const r = recipe || this.recipe();
        if (!r) return;
        this.recipeToAdd.set(r);
        this.showAddToCookbookModal.set(true);
    }

    closeAddToCookbookModal() {
        this.showAddToCookbookModal.set(false);
        this.recipeToAdd.set(null);
    }

    async addToCookbook(cookbookId: string) {
        const r = this.recipeToAdd();
        if (!r) return;
        await this.persistenceService.addRecipeToCookbook(cookbookId, r);
        // If we are currently viewing the generated recipe, mark as saved
        if (this.recipe()?.id === r.id) {
            this.isSaved.set(true);
        }
        this.closeAddToCookbookModal();
    }

    // Kitchen actions
    viewRecipe(r: Recipe) {
        this.recipe.set(r);
        this.generatedImageUrl.set(r.ai_image_url || null);
        this.isSaved.set(true);
        this.activeView.set('generator');
        this.isEditingNotes.set(false); // Reset edit state when switching recipes
    }

    updatePortions(multiplier: number) {
        this.servingsMultiplier.set(multiplier);
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
