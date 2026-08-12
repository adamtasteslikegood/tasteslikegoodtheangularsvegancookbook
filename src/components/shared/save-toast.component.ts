import { Component, computed, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../services/toast.service';
import type { Recipe } from '../../recipe.types';

@Component({
  selector: 'app-save-toast',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './save-toast.component.html',
})
export class SaveToastComponent {
  private readonly toastService = inject(ToastService);

  readonly viewRecipeRequested = output<Recipe>();

  toast = computed(() => {
    const t = this.toastService.toasts()[0];
    return t
      ? { message: t.message, recipe: t.recipe, linkUrl: t.linkUrl, linkLabel: t.linkLabel }
      : null;
  });

  onView() {
    const t = this.toastService.toasts()[0];
    if (t?.recipe) {
      this.viewRecipeRequested.emit(t.recipe);
    }
    if (t) this.toastService.dismiss(t.id);
  }

  dismiss() {
    const t = this.toastService.toasts()[0];
    if (t) this.toastService.dismiss(t.id);
  }
}
