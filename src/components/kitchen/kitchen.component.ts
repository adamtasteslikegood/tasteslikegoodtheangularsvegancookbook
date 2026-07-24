import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { GeminiService } from '../../services/gemini.service';
import { PersistenceService } from '../../services/persistence.service';
import { RecipeStateService } from '../../services/recipe-state.service';
import { ModalService } from '../../services/modal.service';
import type { Recipe } from '../../recipe.types';

@Component({
  selector: 'app-kitchen',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './kitchen.component.html',
})
export class KitchenComponent {
  private readonly router = inject(Router);
  readonly authService = inject(AuthService);
  private readonly geminiService = inject(GeminiService);
  private readonly persistenceService = inject(PersistenceService);
  private readonly recipeState = inject(RecipeStateService);
  readonly modalService = inject(ModalService);

  constructor() {
    this.authService.ensureGuestSession();
  }

  activeCookbookId = signal<string | null>(null);
  showRecycleBin = signal(false);
  showDeleteConfirmation = signal(false);
  recipeToDelete = signal<Recipe | null>(null);
  showEmptyBinConfirmation = signal(false);

  recycleBinRecipes = computed(() => this.authService.currentUser()?.deletedRecipes || []);
  recycleBinCount = computed(() => this.recycleBinRecipes().length);

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
      return user.savedRecipes.filter((r) => cookbook.recipeIds.includes(r.id));
    }
    return user.savedRecipes;
  });

  selectCookbook(id: string | null) {
    this.activeCookbookId.set(id);
    this.showRecycleBin.set(false);
  }

  switchView(view: 'generator' | 'kitchen') {
    this.router.navigate([view === 'kitchen' ? '/kitchen' : '/']);
  }

  viewRecipe(r: Recipe) {
    this.recipeState.viewRecipe(r);
    this.router.navigate(['/recipe', r.id]);
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

  toggleRecycleBin() {
    this.showRecycleBin.update((v) => !v);
    this.activeCookbookId.set(null);
  }

  promptDeleteRecipe(recipe: Recipe, event: Event) {
    event.stopPropagation();
    this.recipeToDelete.set(recipe);
    this.showDeleteConfirmation.set(true);
  }

  async confirmDeleteRecipe() {
    const r = this.recipeToDelete();
    if (!r) return;
    await this.persistenceService.deleteRecipe(r.id);
    if (this.recipeState.currentRecipe()?.id === r.id) {
      this.recipeState.clearRecipe();
    }
    this.showDeleteConfirmation.set(false);
    this.recipeToDelete.set(null);
  }

  cancelDeleteRecipe() {
    this.showDeleteConfirmation.set(false);
    this.recipeToDelete.set(null);
  }

  async restoreRecipe(recipeId: string) {
    await this.persistenceService.restoreRecipe(recipeId);
  }

  async permanentlyDeleteRecipe(recipeId: string) {
    await this.persistenceService.permanentlyDeleteRecipe(recipeId);
  }

  promptEmptyRecycleBin() {
    this.showEmptyBinConfirmation.set(true);
  }

  async confirmEmptyRecycleBin() {
    await this.persistenceService.emptyRecycleBin();
    this.showEmptyBinConfirmation.set(false);
  }

  cancelEmptyRecycleBin() {
    this.showEmptyBinConfirmation.set(false);
  }

  exportRecipe() {
    const dataToExport = this.authService.currentUser()?.savedRecipes || [];
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], {
      type: 'application/json',
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my_vegan_cookbook.json';
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

        const cleanedRecipes: Recipe[] = recipes.map((r: Record<string, unknown>) => {
          const cleaned = { ...r };
          delete cleaned['ai_image_data'];
          return cleaned as unknown as Recipe;
        });

        const count = this.authService.importRecipes(cleanedRecipes, this.activeCookbookId());
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
}
