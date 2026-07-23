import { Component, effect, inject, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from './services/auth.service';
import { RecipeStateService } from './services/recipe-state.service';
import { ModalService } from './services/modal.service';
import { HeaderComponent } from './components/header/header.component';
import { FooterComponent } from './components/footer/footer.component';
import { SaveToastComponent } from './components/shared/save-toast.component';
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
    SaveToastComponent,
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
  readonly recipeState = inject(RecipeStateService);
  readonly modalService = inject(ModalService);

  private readonly addToCookbookModal = viewChild(AddToCookbookModalComponent);

  private _creatingFromAddFlow = false;

  constructor() {
    effect(() => {
      const recipe = this.modalService.addToCookbookRecipe();
      if (recipe) {
        this.addToCookbookModal()?.open(recipe);
        this.modalService.addToCookbookRecipe.set(null);
      }
    });
  }

  openCreateCookbookFromAddFlow() {
    this._creatingFromAddFlow = true;
    this.modalService.openCreateCookbook();
  }

  onCookbookCreated(cookbookId: string) {
    if (this._creatingFromAddFlow) {
      this.addToCookbookModal()?.selectCookbook(cookbookId);
      this._creatingFromAddFlow = false;
    }
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
