import { Component, input, output, signal } from '@angular/core';
import type { Recipe } from '../../recipe.types';
import { DialogFocusDirective } from './dialog-focus.directive';

/**
 * KAN-289 — the unpublish confirmation (Adam, 2026-09-28): a popup with an
 * explicit "Unpublish this recipe anyway" checkbox, like accepting terms, so
 * taking a page offline is never a stray tap on the toggle.
 *
 * Unpublishing is reversible: the slug stays with the recipe, and publishing
 * again brings the same /r/<slug> back. It stops being reversible only if the
 * recipe is then deleted (KAN-288 retires the address), which is why the copy
 * says so. Shared by recipe-detail and the generator; RecipeViewBase owns the
 * open/confirm/cancel state.
 */
@Component({
  selector: 'app-unpublish-confirm',
  standalone: true,
  imports: [DialogFocusDirective],
  template: `
    <div class="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        class="absolute inset-0 bg-stone-900/50 backdrop-blur-sm"
        (click)="cancelled.emit()"
        aria-label="Close unpublish dialog"
        tabindex="-1"
      ></button>
      <div
        class="relative bg-white w-full max-w-sm rounded-3xl shadow-2xl p-6 animate-[fadeIn_0.3s_ease-out]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unpublish-title"
        appDialogFocus
        tabindex="-1"
      >
        <h3 id="unpublish-title" class="text-xl font-bold text-stone-800 serif text-center">
          Unpublish this recipe?
        </h3>
        <div class="text-stone-600 mt-3 text-sm space-y-2">
          <p>
            <strong>{{ recipe().name }}</strong> will come off the site.
            @if (recipe().slug) {
              Its page, <code class="text-stone-800">/r/{{ recipe().slug }}</code
              >, will show "not found" to anyone who follows a link, a bookmark, a search result or
              a pin.
            } @else {
              Its public page will show "not found" to anyone who follows a link to it.
            }
          </p>
          <p>
            You can publish it again later and it gets the same address back, as long as you don't
            delete the recipe.
          </p>
        </div>
        <label class="mt-4 flex items-start gap-3 rounded-xl bg-stone-50 p-3 cursor-pointer">
          <input
            type="checkbox"
            data-dialog-initial-focus
            class="mt-0.5 h-4 w-4 accent-red-600"
            [checked]="acknowledged()"
            (change)="acknowledged.set($any($event.target).checked)"
          />
          <span class="text-sm font-bold text-stone-800">Unpublish this recipe anyway</span>
        </label>
        <div class="mt-5 flex gap-3">
          <button
            type="button"
            (click)="cancelled.emit()"
            class="flex-1 py-3 bg-stone-100 text-stone-600 font-bold rounded-xl hover:bg-stone-200"
          >
            Keep it published
          </button>
          <button
            type="button"
            (click)="confirmed.emit()"
            [disabled]="!acknowledged()"
            class="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-lg shadow-red-600/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Unpublish
          </button>
        </div>
      </div>
    </div>
  `,
})
export class UnpublishConfirmComponent {
  readonly recipe = input.required<Recipe>();
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
  /** Fresh per dialog: the component is created by an @if each time it opens. */
  readonly acknowledged = signal(false);
}
