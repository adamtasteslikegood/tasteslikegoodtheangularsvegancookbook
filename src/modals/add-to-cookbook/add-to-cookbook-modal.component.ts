import { Component, inject, model, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { PersistenceService, type SaveOutcome } from '../../services/persistence.service';
import { RecipeStateService } from '../../services/recipe-state.service';
import { ToastService } from '../../services/toast.service';
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
  private readonly toastService = inject(ToastService);

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
    let failed: SaveOutcome | null = null;

    for (const cb of user.cookbooks) {
      const wasIn = cb.recipeIds.includes(r.id);
      const shouldBeIn = pending.has(cb.id);

      let outcome: SaveOutcome | null = null;
      if (!wasIn && shouldBeIn) {
        outcome = await this.persistenceService.addRecipeToCookbook(cb.id, r);
      } else if (wasIn && !shouldBeIn) {
        outcome = await this.persistenceService.removeRecipeFromCookbook(cb.id, r.id);
      }
      if (outcome && !outcome.ok && !failed) failed = outcome;
    }

    // KAN-333: the local cookbooks already show the change, but the next
    // hydrate replaces them with the server's, so a change that did not land
    // is lost there. Say so instead of closing as if it stuck.
    if (failed) this.toastService.show(cookbookUnsyncedMessage(failed));

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

/**
 * KAN-333: what to tell the user when a cookbook change did not reach the
 * server. The change is undone on screen (PersistenceService), so trying
 * again from the dialog sends it again.
 */
function cookbookUnsyncedMessage(outcome: SaveOutcome): string {
  if (outcome.refusal === 'paused') {
    return 'Your cookbook change was not saved: recipes are read-only for a few minutes while we finish some maintenance. Try again in a few minutes.';
  }
  if (outcome.refusal === 'duplicate') {
    return 'Your cookbook change was not saved: your account already has this recipe as another copy. Reload, then add that copy.';
  }
  return 'Your cookbook change was not saved to your account. Check your connection and try again.';
}
