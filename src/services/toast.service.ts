import { Injectable, signal } from '@angular/core';
import type { Recipe } from '../recipe.types';

export interface Toast {
  id: number;
  message: string;
  recipe: Recipe | null;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 0;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  readonly toasts = signal<Toast[]>([]);

  show(message: string, recipe: Recipe | null = null, durationMs = 6000): void {
    const id = this.nextId++;
    this.toasts.update((list) => [...list, { id, message, recipe }]);
    const timer = setTimeout(() => this.dismiss(id), durationMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    this.timers.set(id, timer);
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }
}
