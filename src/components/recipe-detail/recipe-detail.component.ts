import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { PersistenceService } from '../../services/persistence.service';
import { GeminiService } from '../../services/gemini.service';
import { RecipeStateService } from '../../services/recipe-state.service';
import { ToastService } from '../../services/toast.service';
import { isPublicViewable, publicSlugOf } from '../../utils/public-link';
import { slugFromTitle } from '../../utils/slug';
import type { Ingredient, IngredientGroup, InstructionStep, Recipe } from '../../recipe.types';

@Component({
  selector: 'app-recipe-detail',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './recipe-detail.component.html',
})
export class RecipeDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly authService = inject(AuthService);
  private readonly persistenceService = inject(PersistenceService);
  private readonly geminiService = inject(GeminiService);
  private readonly recipeState = inject(RecipeStateService);
  private readonly toastService = inject(ToastService);

  readonly recipe = this.recipeState.currentRecipe;
  readonly generatedImageUrl = this.recipeState.generatedImageUrl;
  readonly isSaved = this.recipeState.isSaved;

  isLoading = signal(false);
  isImageLoading = signal(false);
  servingsMultiplier = signal(1);
  isEditingNotes = signal(false);
  editedNotes = signal('');

  canPublish = computed(() => {
    const user = this.authService.currentUser();
    return !!user && user.isGuest === false;
  });

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

  constructor() {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (!id) return;

      if (this.recipe()?.id === id) return;

      const user = this.authService.currentUser();
      const saved = user?.savedRecipes.find((r) => r.id === id);
      if (saved) {
        this.recipeState.viewRecipe(saved);
        return;
      }

      this.fetchRecipeFromApi(id);
    });
  }

  private async fetchRecipeFromApi(id: string) {
    this.isLoading.set(true);
    try {
      const resp = await fetch(`/api/recipes/${encodeURIComponent(id)}`);
      if (!resp.ok) throw new Error(`Recipe not found (${resp.status})`);
      const recipe: Recipe = await resp.json();
      this.recipeState.viewRecipe(recipe);
    } catch {
      this.toastService.show('Recipe not found');
      this.router.navigate(['/kitchen'], { replaceUrl: true });
    } finally {
      this.isLoading.set(false);
    }
  }

  goBack() {
    this.router.navigate(['/kitchen']);
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
      this.authService.updateRecipeField(targetId, 'ai_image_url', imageUrl);
    } catch (err) {
      console.error('Image regeneration failed', err);
    } finally {
      if (this.recipe()?.id === targetId) {
        this.isImageLoading.set(false);
      }
    }
  }

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

  updatePortions(multiplier: number) {
    this.servingsMultiplier.set(multiplier);
  }

  async togglePublic(recipe: Recipe) {
    if (!this.canPublish()) return;
    const nextState = !recipe.is_public;
    recipe.is_public = nextState;

    if (nextState && !recipe.slug) {
      recipe.slug = this.slugFromTitle(recipe.name);
    }

    try {
      const synced = await this.persistenceService.saveRecipe(recipe);
      if (!synced) {
        throw new Error('Publish state failed to sync to the server');
      }
      this.authService.saveRecipe(recipe);
    } catch (err) {
      console.error('Failed to toggle public state:', err);
      recipe.is_public = !nextState;
      this.authService.saveRecipe(recipe);
    }
  }

  isPublicViewable(recipe: Recipe): boolean {
    return isPublicViewable(recipe);
  }

  publicSlugOf(recipe: Recipe): string | null {
    return publicSlugOf(recipe);
  }

  private slugFromTitle = slugFromTitle;

  exportRecipe(recipe: Recipe) {
    const fileName = `${recipe.name.replace(/\s+/g, '_')}.json`;
    const blob = new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    window.URL.revokeObjectURL(url);
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

  instructionText(step: string | InstructionStep): string {
    return typeof step === 'string' ? step : step.description;
  }
}
