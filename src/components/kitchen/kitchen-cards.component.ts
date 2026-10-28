import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { DeletedRecipe } from '../../auth.types';
import type { Recipe } from '../../recipe.types';

@Component({
  selector: 'app-kitchen-recipe-card',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="bg-white rounded-xl shadow-sm border border-stone-200 overflow-hidden hover:shadow-md transition-shadow group cursor-pointer"
      (click)="selectRecipe.emit(recipe())"
      (keydown.enter)="selectRecipe.emit(recipe()); $event.preventDefault()"
      (keydown.space)="selectRecipe.emit(recipe()); $event.preventDefault()"
      tabindex="0"
      role="button"
    >
      <div class="h-28 sm:h-48 bg-stone-200 relative overflow-hidden">
        @if (recipe().ai_image_url) {
          @if (imageVariant(); as v) {
            <img
              [src]="v.src"
              [attr.srcset]="v.srcset"
              sizes="(min-width: 1024px) 400px, 50vw"
              class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              alt="{{ recipe().name }}"
              loading="lazy"
            />
          } @else {
            <img
              [src]="fallbackImageSrc()"
              class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              alt="{{ recipe().name }}"
              loading="lazy"
            />
          }
        } @else if (imagePending()) {
          <div
            class="w-full h-full flex flex-col items-center justify-center text-stone-400 bg-stone-100"
            data-testid="kitchen-image-pending"
          >
            <div
              class="w-8 h-8 sm:w-12 sm:h-12 border-4 border-green-200 border-t-green-600 rounded-full animate-spin mb-2 sm:mb-4"
            ></div>
            <p class="text-xs sm:text-sm font-medium animate-pulse">Styling your dish...</p>
          </div>
        } @else {
          <div class="w-full h-full flex items-center justify-center text-stone-400">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-12 w-12"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
        }
        <div class="absolute top-2 right-2 flex gap-1">
          <button
            (click)="$event.stopPropagation(); addToCookbook.emit(recipe())"
            class="p-1.5 bg-white/90 rounded-full text-stone-600 hover:text-green-700 shadow-sm backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity"
            title="Add to Cookbook"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 6v6m0 0v6m0-6h6m-6 0H6"
              />
            </svg>
          </button>
          <!-- KAN-139: canonical recipes are server-locked — DELETE returns 400. -->
          <button
            (click)="deleteRecipe.emit({ recipe: recipe(), event: $event })"
            [disabled]="recipe().is_canonical"
            class="p-1.5 bg-white/90 rounded-full text-stone-600 shadow-sm backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity"
            [class.hover:text-red-600]="!recipe().is_canonical"
            [class.cursor-not-allowed]="recipe().is_canonical"
            [title]="
              recipe().is_canonical ? 'Canonical recipe — cannot be deleted' : 'Delete Recipe'
            "
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fill-rule="evenodd"
                d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                clip-rule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>
      <div class="p-3 sm:p-4">
        <h3
          class="font-bold text-stone-800 text-base sm:text-lg mb-1 leading-snug line-clamp-2 break-words"
        >
          {{ recipe().name }}
        </h3>
        <div class="flex items-center text-xs text-stone-500 gap-3 mt-3">
          <span class="flex items-center gap-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            {{ recipe().cookTime + recipe().prepTime }}m
          </span>
          <span class="flex items-center gap-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            {{ recipe().servings }}
          </span>
        </div>
      </div>
    </div>
  `,
})
export class KitchenRecipeCardComponent {
  recipe = input.required<Recipe>();
  imageVariant = input<{ src: string; srcset: string } | null | undefined>(null);
  fallbackImageSrc = input<string | null>(null);
  imagePending = input<boolean>(false);

  selectRecipe = output<Recipe>();
  addToCookbook = output<Recipe>();
  deleteRecipe = output<{ recipe: Recipe; event: Event }>();
}

@Component({
  selector: 'app-kitchen-recycle-card',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="bg-white rounded-xl shadow-sm border border-stone-200 overflow-hidden opacity-75 hover:opacity-100 transition-opacity"
    >
      <div class="h-24 sm:h-32 bg-stone-200 relative overflow-hidden">
        @if (item().recipe.ai_image_url) {
          <img
            [src]="imageSrc()"
            class="w-full h-full object-cover grayscale"
            alt="{{ item().recipe.name }}"
            loading="lazy"
          />
        } @else {
          <div class="w-full h-full flex items-center justify-center text-stone-400">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-10 w-10"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
        }
      </div>
      <div class="p-3 sm:p-4">
        <h3 class="font-bold text-stone-800 text-base sm:text-lg mb-1 line-clamp-2 break-words">
          {{ item().recipe.name }}
        </h3>
        <p class="text-xs text-stone-400 mb-3">Deleted {{ item().deletedAt | date: 'medium' }}</p>
        <div class="flex flex-col sm:flex-row gap-2">
          <button
            (click)="restore.emit(item().recipe.id)"
            class="flex-1 py-2 bg-green-100 text-green-700 font-bold rounded-lg hover:bg-green-200 text-sm"
          >
            Restore
          </button>
          <button
            (click)="permanentlyDelete.emit(item().recipe.id)"
            class="flex-1 py-2 bg-red-100 text-red-600 font-bold rounded-lg hover:bg-red-200 text-sm"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  `,
})
export class KitchenRecycleCardComponent {
  item = input.required<DeletedRecipe>();
  imageSrc = input<string | null>(null);

  restore = output<string>();
  permanentlyDelete = output<string>();
}

@Component({
  selector: 'app-kitchen-empty-bin-modal',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        class="absolute inset-0 bg-stone-900/50 backdrop-blur-sm"
        (click)="cancelEmpty.emit()"
        aria-label="Close empty recycle bin dialog"
        tabindex="-1"
      ></button>
      <div
        class="relative bg-white w-full max-w-sm rounded-3xl shadow-2xl p-6 animate-[fadeIn_0.3s_ease-out]"
      >
        <div class="text-center mb-4">
          <div
            class="mx-auto w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-3"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-6 w-6 text-red-600"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fill-rule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clip-rule="evenodd"
              />
            </svg>
          </div>
          <h3 class="text-xl font-bold text-stone-800 serif">Empty Recycle Bin?</h3>
          <p class="text-stone-500 mt-2 text-sm">
            This will permanently delete <strong>{{ count() }}</strong> recipe(s). This cannot be
            undone.
          </p>
        </div>
        <div class="flex gap-3">
          <button
            (click)="cancelEmpty.emit()"
            class="flex-1 py-3 bg-stone-100 text-stone-600 font-bold rounded-xl hover:bg-stone-200"
          >
            Cancel
          </button>
          <button
            (click)="confirmEmpty.emit()"
            class="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-lg shadow-red-600/20"
          >
            Permanently Delete
          </button>
        </div>
      </div>
    </div>
  `,
})
export class KitchenEmptyBinModalComponent {
  count = input.required<number>();
  cancelEmpty = output<void>();
  confirmEmpty = output<void>();
}
