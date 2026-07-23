import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd, RouterOutlet } from '@angular/router';
import { AuthService } from './services/auth.service';
import { ToastService } from './services/toast.service';
import { RecipeStateService } from './services/recipe-state.service';
import { HeaderComponent } from './components/header/header.component';
import { FooterComponent } from './components/footer/footer.component';
import { GeneratorComponent } from './components/generator/generator.component';
import { KitchenComponent } from './components/kitchen/kitchen.component';
import { AuthModalComponent } from './modals/auth/auth-modal.component';
import { CreateCookbookModalComponent } from './modals/create-cookbook/create-cookbook-modal.component';
import { ManualEntryModalComponent } from './modals/manual-entry/manual-entry-modal.component';
import { AddToCookbookModalComponent } from './modals/add-to-cookbook/add-to-cookbook-modal.component';
import type { Recipe } from './recipe.types';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    HeaderComponent,
    FooterComponent,
    GeneratorComponent,
    KitchenComponent,
    AuthModalComponent,
    CreateCookbookModalComponent,
    ManualEntryModalComponent,
    AddToCookbookModalComponent,
  ],
  templateUrl: './app.component.html',
  styleUrls: [],
})
export class AppComponent {
  private readonly router = inject(Router);
  readonly authService = inject(AuthService);
  private readonly toastService = inject(ToastService);
  readonly recipeState = inject(RecipeStateService);

  private readonly addToCookbookModal = viewChild(AddToCookbookModalComponent);

  activeView = signal<'generator' | 'kitchen' | 'recipe'>('generator');

  showAuthModal = signal<boolean>(false);
  showCreateCookbookModal = signal<boolean>(false);
  showManualEntryModal = signal<boolean>(false);
  showAddToCookbookModal = signal<boolean>(false);

  private _creatingFromAddFlow = false;

  saveToast = computed(() => {
    const toasts = this.toastService.toasts();
    return toasts.length > 0 ? { message: toasts[0].message, recipe: toasts[0].recipe } : null;
  });

  constructor() {
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) {
        const url = e.urlAfterRedirects;
        if (url.startsWith('/kitchen')) {
          this.authService.ensureGuestSession();
          this.activeView.set('kitchen');
        } else if (url.startsWith('/recipe/')) {
          this.activeView.set('recipe');
        } else {
          this.activeView.set('generator');
        }
      }
    });
  }

  openAuthModal() {
    this.showAuthModal.set(true);
  }

  openCreateCookbookModal() {
    this._creatingFromAddFlow = false;
    this.showCreateCookbookModal.set(true);
  }

  openCreateCookbookFromAddFlow() {
    this._creatingFromAddFlow = true;
    this.showCreateCookbookModal.set(true);
  }

  onCookbookCreated(cookbookId: string) {
    if (this._creatingFromAddFlow) {
      this.addToCookbookModal()?.selectCookbook(cookbookId);
      this._creatingFromAddFlow = false;
    }
  }

  openManualEntryModal() {
    this.showManualEntryModal.set(true);
  }

  openAddToCookbookModal(recipe: Recipe | null = null) {
    const r = recipe || this.recipeState.currentRecipe();
    if (!r) return;
    this.addToCookbookModal()?.open(r);
  }

  openSaveToastRecipe() {
    const toasts = this.toastService.toasts();
    if (toasts.length > 0 && toasts[0].recipe) {
      this.viewRecipe(toasts[0].recipe);
    }
    this.dismissSaveToast();
  }

  dismissSaveToast() {
    const toasts = this.toastService.toasts();
    if (toasts.length > 0) this.toastService.dismiss(toasts[0].id);
  }

  async onLogout() {
    await this.authService.logout();
    this.recipeState.clearRecipe();
    this.router.navigate(['/']);
  }

  viewRecipe(r: Recipe) {
    this.recipeState.viewRecipe(r);
    this.router.navigate(['/recipe', r.id]);
  }
}
