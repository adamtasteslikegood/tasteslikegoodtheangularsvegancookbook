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
    const toasts = this.toastService.toasts();
    return toasts.length > 0 ? { message: toasts[0].message, recipe: toasts[0].recipe } : null;
  });

  onView() {
    const toasts = this.toastService.toasts();
    if (toasts.length > 0 && toasts[0].recipe) {
      this.viewRecipeRequested.emit(toasts[0].recipe);
    }
    this.dismiss();
  }

  dismiss() {
    const toasts = this.toastService.toasts();
    if (toasts.length > 0) this.toastService.dismiss(toasts[0].id);
  }
}
