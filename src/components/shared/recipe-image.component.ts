import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Shared recipe photo frame + AI badge + spinner + regenerate button overlay
 * rendered by both `GeneratorComponent` and `RecipeDetailComponent`.
 */
@Component({
  selector: 'app-recipe-image',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block relative rounded-2xl overflow-hidden aspect-[4/3] bg-stone-200 shadow-xl group',
  },
  template: `
    @if (imageUrl()) {
      <img
        [src]="imageUrl()"
        [alt]="recipeName()"
        loading="lazy"
        class="w-full h-full object-cover animate-[fadeIn_1s_ease-out]"
      />
      <div
        class="absolute bottom-3 right-3 bg-black/60 text-white text-xs px-2 py-1 rounded backdrop-blur-sm"
      >
        AI Generated
      </div>
    } @else if (isLoading()) {
      <div
        class="absolute inset-0 flex flex-col items-center justify-center text-stone-400 bg-stone-100"
      >
        <div
          class="w-12 h-12 border-4 border-green-200 border-t-green-600 rounded-full animate-spin mb-4"
        ></div>
        <p class="text-sm font-medium animate-pulse">Styling your dish...</p>
      </div>
    } @else {
      <div class="absolute inset-0 flex items-center justify-center text-stone-400 bg-stone-100">
        <span class="text-sm">Image not available</span>
      </div>
    }

    <!-- Regenerate Button Overlay -->
    @if (!isLoading()) {
      <button
        type="button"
        (click)="regenerate.emit()"
        class="absolute top-3 right-3 p-2 bg-white/90 hover:bg-white text-stone-700 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-all transform hover:scale-105"
        title="Regenerate Image"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </button>
    }
  `,
})
export class RecipeImageComponent {
  readonly recipeName = input.required<string>();
  readonly imageUrl = input<string | null>(null);
  readonly isLoading = input<boolean>(false);
  readonly regenerate = output<void>();
}
