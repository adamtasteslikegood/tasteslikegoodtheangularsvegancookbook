import { Component, inject, model, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { PersistenceService } from '../../services/persistence.service';
import { RecipeStateService } from '../../services/recipe-state.service';
import type { Recipe } from '../../recipe.types';

@Component({
  selector: 'app-add-to-cookbook-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './add-to-cookbook-modal.component.html',
})
export class AddToCookbookModalComponent {
  readonly authService = inject(AuthService);
  private readonly persistenceService = inject(PersistenceService);
  private readonly recipeState = inject(RecipeStateService);

  isOpen = model<boolean>(false);
  readonly createCookbookRequested = output<void>();
  readonly closed = output<void>();

  recipeToAdd = signal<Recipe | null>(null);
  pendingCookbookIds = signal<Set<string>>(new Set());
  showRemoveConfirmation = signal<boolean>(false);
  cookbooksBeingRemoved = signal<string[]>([]);

  open(recipe: Recipe) {
    this.recipeToAdd.set(recipe);
    const user = this.authService.currentUser();
    const currentIds = new Set<string>();
    if (user) {
      for (const cb of user.cookbooks) {
        if (cb.recipeIds.includes(recipe.id)) {
          currentIds.add(cb.id);
        }
      }
    }
    this.pendingCookbookIds.set(currentIds);
    this.isOpen.set(true);
  }

  close() {
    this.isOpen.set(false);
    this.recipeToAdd.set(null);
    this.pendingCookbookIds.set(new Set());
    this.showRemoveConfirmation.set(false);
    this.cookbooksBeingRemoved.set([]);
    this.closed.emit();
  }

  selectCookbook(id: string) {
    this.pendingCookbookIds.update((ids) => {
      const next = new Set(ids);
      next.add(id);
      return next;
    });
  }

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

  isCookbookSelected(cookbookId: string): boolean {
    return this.pendingCookbookIds().has(cookbookId);
  }

  confirmCookbookChanges() {
    const r = this.recipeToAdd();
    if (!r) return;
    const user = this.authService.currentUser();
    if (!user) return;

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

    if (this.recipeState.currentRecipe()?.id === r.id) {
      this.recipeState.isSaved.set(true);
    }

    this.close();
  }

  cancelRemoveConfirmation() {
    this.showRemoveConfirmation.set(false);
    this.cookbooksBeingRemoved.set([]);
  }
}
