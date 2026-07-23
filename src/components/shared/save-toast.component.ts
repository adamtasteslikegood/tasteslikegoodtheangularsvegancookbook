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
