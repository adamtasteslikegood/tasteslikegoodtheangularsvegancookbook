import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RecipeViewBase } from '../shared/recipe-view.base';
import type { Recipe } from '../../recipe.types';

@Component({
  selector: 'app-generator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './generator.component.html',
})
export class GeneratorComponent extends RecipeViewBase {
  prompt = signal('');
  isRecipeLoading = signal(false);
  error = signal<string | null>(null);

  /**
   * A guest activating the publish toggle gets the sign-in modal here, where
   * recipe-detail stays silent (its template renders a dedicated "Sign in to
   * publish" button instead — #3211).
   */
  protected override onPublishDenied(): void {
    this.modalService.openAuth();
  }

  async onGenerate() {
    if (!this.prompt().trim()) return;

    this.authService.ensureGuestSession();

    this.isRecipeLoading.set(true);
    this.error.set(null);
    this.recipeState.clearRecipe();
    this.servingsMultiplier.set(1);

    try {
      const generatedRecipe: Recipe = {
        ...(await this.geminiService.generateRecipe(this.prompt())),
        // KAN-140: provenance label; lets the server distinguish
        // AI-mediated content from manual entry.
        origin: 'generated',
      };
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
    const imagePromise = this.geminiService.generateImage(targetId);
    this.recipeState.trackImageGeneration(targetId, imagePromise);
    try {
      const imageUrl = await imagePromise;
      if (this.recipe()?.id === targetId) {
        this.generatedImageUrl.set(imageUrl);
        this.recipe.update((r) => (r ? { ...r, ai_image_url: imageUrl } : null));
      }
      this.authService.updateRecipeField(targetId, 'ai_image_url', imageUrl);
    } catch (err) {
      console.error('Image generation failed', err);
    }
  }

  async onSaveRecipe() {
    const currentRecipe = this.recipe();
    if (!currentRecipe) return;
    await this.persistenceService.saveRecipe(currentRecipe);
    this.isSaved.set(true);
  }

  openAddToCookbookModal() {
    const r = this.recipe();
    if (r) this.modalService.openAddToCookbook(r);
  }

  isString(val: unknown): boolean {
    return typeof val === 'string';
  }
}
