import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GeminiService } from '../../services/gemini.service';
import { AuthService } from '../../services/auth.service';
import { PersistenceService } from '../../services/persistence.service';
import { RecipeStateService } from '../../services/recipe-state.service';
import { ModalService } from '../../services/modal.service';
import { isPublicViewable, publicSlugOf } from '../../utils/public-link';
import { slugFromTitle } from '../../utils/slug';
import type { Ingredient, IngredientGroup, InstructionStep, Recipe } from '../../recipe.types';

@Component({
  selector: 'app-generator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './generator.component.html',
})
export class GeneratorComponent {
  private readonly geminiService = inject(GeminiService);
  private readonly persistenceService = inject(PersistenceService);
  readonly authService = inject(AuthService);
  private readonly recipeState = inject(RecipeStateService);
  private readonly modalService = inject(ModalService);

  readonly recipe = this.recipeState.currentRecipe;
  readonly generatedImageUrl = this.recipeState.generatedImageUrl;
  readonly isSaved = this.recipeState.isSaved;

  prompt = signal('');
  isRecipeLoading = signal(false);
  isImageLoading = signal(false);
  error = signal<string | null>(null);
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

  async onGenerate() {
    if (!this.prompt().trim()) return;

    this.authService.ensureGuestSession();

    this.isRecipeLoading.set(true);
    this.isImageLoading.set(false);
    this.error.set(null);
    this.recipeState.clearRecipe();
    this.servingsMultiplier.set(1);

    try {
      const generatedRecipe = await this.geminiService.generateRecipe(this.prompt());
      this.recipe.set(generatedRecipe);
      this.isSaved.set(true);
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
    const targetId = recipe.id;
    this.isImageLoading.set(true);
    try {
      const imageUrl = await this.geminiService.generateImage(targetId);
      if (this.recipe()?.id === targetId) {
        this.generatedImageUrl.set(imageUrl);
        this.recipe.update((r) => (r ? { ...r, ai_image_url: imageUrl } : null));
      }
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

  openAddToCookbookModal() {
    const r = this.recipe();
    if (r) this.modalService.openAddToCookbook(r);
  }

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

  async togglePublic(recipe: Recipe) {
    if (!this.canPublish()) {
      this.modalService.openAuth();
      return;
    }
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

  instructionText(step: string | InstructionStep): string {
    return typeof step === 'string' ? step : step.description;
  }

  openAuthModal() {
    this.modalService.openAuth();
  }
}
