import { Component, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GeminiService } from './services/gemini.service';
import { AuthService } from './services/auth.service';
import { Recipe, Ingredient, IngredientGroup } from './recipe.types';
import { Cookbook } from './auth.types';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: [] 
})
export class AppComponent {
  private geminiService = inject(GeminiService);
  authService = inject(AuthService);

  // Navigation
  activeView = signal<'generator' | 'kitchen'>('generator');
  
  // Kitchen State
  activeCookbookId = signal<string | null>(null); // null means "All Recipes"
  showCreateCookbookModal = signal<boolean>(false);
  newCookbookName = signal('');
  newCookbookDesc = signal('');

  // Add to Cookbook UI State
  showAddToCookbookModal = signal<boolean>(false);
  recipeToAdd = signal<Recipe | null>(null);

  // Auth UI State
  showAuthModal = signal<boolean>(false);
  isLoginMode = signal<boolean>(true);
  authEmail = signal<string>('');
  authPassword = signal<string>('');
  authName = signal<string>('');
  authError = signal<string | null>(null);
  authLoading = signal<boolean>(false);

  // Recipe Gen State
  prompt = signal<string>('');
  recipe = signal<Recipe | null>(null);
  
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
    return this.authService.currentUser()?.cookbooks.find(cb => cb.id === id) || null;
  });

  displayedKitchenRecipes = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return [];
    
    const cookbook = this.activeCookbook();
    if (cookbook) {
      // Filter user.savedRecipes by IDs in cookbook
      return user.savedRecipes.filter(r => cookbook.recipeIds.includes(r.id));
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
        newAmount = ing.amount.map(val => Number((val * mult).toFixed(2)));
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

  createCookbook() {
    if (!this.newCookbookName().trim()) return;
    this.authService.createCookbook(this.newCookbookName(), this.newCookbookDesc());
    this.closeCreateCookbookModal();
  }

  deleteCookbook(id: string, event: Event) {
    event.stopPropagation();
    if (confirm('Are you sure you want to delete this cookbook? Recipes will remain in "All Saved".')) {
      this.authService.deleteCookbook(id);
      if (this.activeCookbookId() === id) {
        this.activeCookbookId.set(null);
      }
    }
  }

  // Auth Methods
  openAuthModal(mode: 'login' | 'signup') {
    this.isLoginMode.set(mode === 'login');
    this.showAuthModal.set(true);
    this.authError.set(null);
  }

  closeAuthModal() {
    this.showAuthModal.set(false);
  }

  toggleAuthMode() {
    this.isLoginMode.update(v => !v);
    this.authError.set(null);
  }

  async onAuthSubmit() {
    this.authError.set(null);
    this.authLoading.set(true);

    try {
      if (this.isLoginMode()) {
        await this.authService.login(this.authEmail(), this.authPassword());
      } else {
        if (!this.authName()) {
          throw new Error('Name is required.');
        }
        await this.authService.signup(this.authName(), this.authEmail(), this.authPassword());
      }
      this.closeAuthModal();
      this.authEmail.set('');
      this.authPassword.set('');
      this.authName.set('');
    } catch (err: any) {
      this.authError.set(err.message || 'Authentication failed');
    } finally {
      this.authLoading.set(false);
    }
  }

  onSocialLogin(provider: string) {
    // Mock social login
    console.log(`${provider} login clicked`);
    this.authError.set(`${provider} login is not configured in this demo.`);
  }

  onLogout() {
    this.authService.logout();
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
      const user = this.authService.currentUser();
      const userName = user && !user.isGuest ? user.name : null;
      const personalizedPrompt = userName 
        ? `For user ${userName}: ${this.prompt()}` 
        : this.prompt();

      const generatedRecipe = await this.geminiService.generateRecipe(personalizedPrompt);
      this.recipe.set(generatedRecipe);
      
      this.triggerImageGeneration(generatedRecipe);
      
    } catch (err: any) {
      this.error.set(err.message || 'Failed to generate recipe. Please try again.');
    } finally {
      this.isRecipeLoading.set(false);
    }
  }

  async triggerImageGeneration(recipe: Recipe) {
    if (!recipe.image_keywords || recipe.image_keywords.length === 0) return;
    
    this.isImageLoading.set(true);
    try {
      const imageUrl = await this.geminiService.generateImage(recipe.image_keywords, recipe.name);
      this.generatedImageUrl.set(imageUrl);
      this.recipe.update(r => r ? { ...r, ai_image_url: imageUrl } : null);
    } catch (err) {
      console.error('Image generation failed', err);
    } finally {
      this.isImageLoading.set(false);
    }
  }

  onSaveRecipe() {
    const currentRecipe = this.recipe();
    if (!currentRecipe) return;

    this.authService.saveRecipe(currentRecipe);
    this.isSaved.set(true);
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

  addToCookbook(cookbookId: string) {
    const r = this.recipeToAdd();
    if (!r) return;
    this.authService.addRecipeToCookbook(cookbookId, r);
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

  isString(val: any): boolean {
    return typeof val === 'string';
  }
}
