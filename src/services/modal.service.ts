import { Injectable, signal } from '@angular/core';
import type { Recipe } from '../recipe.types';

@Injectable({ providedIn: 'root' })
export class ModalService {
  readonly authModalOpen = signal(false);
  readonly createCookbookModalOpen = signal(false);
  readonly manualEntryModalOpen = signal(false);
  readonly addToCookbookRecipe = signal<Recipe | null>(null);

  openAuth() {
    this.authModalOpen.set(true);
  }

  openCreateCookbook() {
    this.createCookbookModalOpen.set(true);
  }

  openManualEntry() {
    this.manualEntryModalOpen.set(true);
  }

  openAddToCookbook(recipe: Recipe) {
    this.addToCookbookRecipe.set(recipe);
  }
}
