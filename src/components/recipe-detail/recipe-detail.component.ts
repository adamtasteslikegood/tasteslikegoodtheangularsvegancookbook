import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { RecipeViewBase } from '../shared/recipe-view.base';
import { recipeFromRow } from '../../utils/recipe-row';

@Component({
  selector: 'app-recipe-detail',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './recipe-detail.component.html',
})
export class RecipeDetailComponent extends RecipeViewBase {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  isLoading = signal(false);

  constructor() {
    super();
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
      if (!resp.ok) {
        if (resp.status === 404) {
          this.toastService.show('Recipe not found');
        } else {
          this.toastService.show('Failed to load recipe. Please try again.');
        }
        this.router.navigate(['/kitchen'], { replaceUrl: true });
        return;
      }
      // GET /api/recipes/:id returns the row shape, not the Recipe blob —
      // rendering it raw left ingredients/instructions undefined and blanked
      // the page on refresh (#3263). Same column-over-blob merge as
      // PersistenceService.loadFromApi.
      const recipe = recipeFromRow(await resp.json());
      // Not in the user's cookbook (cold deep link) — keep Save enabled (#3210).
      this.recipeState.viewRecipe(recipe, false);
    } catch {
      this.toastService.show('Connection error. Check your network and try again.');
      this.router.navigate(['/kitchen'], { replaceUrl: true });
    } finally {
      this.isLoading.set(false);
    }
  }

  goBack() {
    this.router.navigate(['/kitchen']);
  }
}
