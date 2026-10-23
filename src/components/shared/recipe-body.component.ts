import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { IngredientGroup, InstructionStep, Recipe } from '../../recipe.types';
import { formatIngredientAmount, formatInstructionText } from './recipe-publish-state';

/**
 * Shared recipe content grid (scaled ingredients, numbered method instructions,
 * and the read-only / private Chef's Notes editor) rendered by both
 * `GeneratorComponent` and `RecipeDetailComponent`.
 */
@Component({
  selector: 'app-recipe-body',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <!-- Ingredients Column -->
      <div class="lg:col-span-5 space-y-8">
        @if (scaledIngredients(); as ingredients) {
          <div class="bg-white p-6 rounded-2xl shadow-sm border border-stone-200 sticky top-4">
            <h3 class="text-2xl font-bold text-stone-800 mb-6 flex items-center gap-2 serif">
              Ingredients
            </h3>

            <div class="space-y-6">
              @if (ingredients.wet && ingredients.wet.length) {
                <div>
                  <h4 class="text-sm font-bold text-stone-400 uppercase tracking-wider mb-3">
                    Wet
                  </h4>
                  <ul class="space-y-3">
                    @for (ing of ingredients.wet; track ing.name) {
                      <li
                        class="flex items-start gap-3 pb-3 border-b border-stone-100 last:border-0"
                      >
                        <span
                          class="font-bold text-green-700 min-w-[4.5rem] text-right whitespace-nowrap shrink-0"
                        >
                          {{ formatAmount(ing.amount) }} {{ ing.units }}
                        </span>
                        <div class="flex-1">
                          <span class="text-stone-800">{{ ing.name }}</span>
                          @if (ing.notes) {
                            <span class="text-stone-400 text-sm italic"> ({{ ing.notes }})</span>
                          }
                        </div>
                      </li>
                    }
                  </ul>
                </div>
              }

              @if (ingredients.dry && ingredients.dry.length) {
                <div>
                  <h4 class="text-sm font-bold text-stone-400 uppercase tracking-wider mb-3">
                    Dry
                  </h4>
                  <ul class="space-y-3">
                    @for (ing of ingredients.dry; track ing.name) {
                      <li
                        class="flex items-start gap-3 pb-3 border-b border-stone-100 last:border-0"
                      >
                        <span
                          class="font-bold text-green-700 min-w-[4.5rem] text-right whitespace-nowrap shrink-0"
                        >
                          {{ formatAmount(ing.amount) }} {{ ing.units }}
                        </span>
                        <div class="flex-1">
                          <span class="text-stone-800">{{ ing.name }}</span>
                          @if (ing.notes) {
                            <span class="text-stone-400 text-sm italic"> ({{ ing.notes }})</span>
                          }
                        </div>
                      </li>
                    }
                  </ul>
                </div>
              }

              @if (ingredients.other && ingredients.other.length) {
                <div>
                  <h4 class="text-sm font-bold text-stone-400 uppercase tracking-wider mb-3">
                    Other
                  </h4>
                  <ul class="space-y-3">
                    @for (ing of ingredients.other; track ing.name) {
                      <li
                        class="flex items-start gap-3 pb-3 border-b border-stone-100 last:border-0"
                      >
                        <span
                          class="font-bold text-green-700 min-w-[4.5rem] text-right whitespace-nowrap shrink-0"
                        >
                          {{ formatAmount(ing.amount) }} {{ ing.units }}
                        </span>
                        <div class="flex-1">
                          <span class="text-stone-800">{{ ing.name }}</span>
                          @if (ing.notes) {
                            <span class="text-stone-400 text-sm italic"> ({{ ing.notes }})</span>
                          }
                        </div>
                      </li>
                    }
                  </ul>
                </div>
              }
            </div>
          </div>
        }
      </div>

      <!-- Instructions Column -->
      <div class="lg:col-span-7 space-y-8">
        <div class="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-stone-200">
          <h3 class="text-2xl font-bold text-stone-800 mb-6 serif">Method</h3>
          <div class="space-y-8">
            @for (inst of recipe().instructions; track $index) {
              <div class="flex gap-4 group">
                <div
                  class="flex-shrink-0 w-8 h-8 rounded-full bg-green-100 text-green-700 font-bold flex items-center justify-center text-sm group-hover:bg-green-600 group-hover:text-white transition-colors"
                >
                  {{ $index + 1 }}
                </div>
                <div class="flex-1 pt-1">
                  <p class="text-stone-700 leading-relaxed text-lg">
                    {{ instructionText(inst) }}
                  </p>
                </div>
              </div>
            }
          </div>
        </div>

        <!-- Chef's Notes Section -->
        <div class="bg-yellow-50 p-6 rounded-xl border border-yellow-100 relative group">
          <div class="flex justify-between items-start mb-2">
            <h4 class="text-yellow-800 font-bold flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fill-rule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clip-rule="evenodd"
                />
              </svg>
              Chef's Notes
            </h4>
            <!-- KAN-140: generated notes are read-only (they render on the
                 public page); the pencil edits the private personalNotes
                 field, which the public payload allowlist never exposes. -->
            @if (!isEditingNotes()) {
              <button
                type="button"
                (click)="startEditNotes.emit()"
                class="text-yellow-700 hover:text-yellow-900 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Edit my private notes"
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
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                  />
                </svg>
              </button>
            }
          </div>

          @if (isEditingNotes()) {
            <!-- Only real generated notes render here: the "No notes added
                 yet." fallback above an empty personal-notes textarea reads
                 as the textarea's own empty state (review of #3252). -->
            @if (recipe().notes) {
              <p class="text-yellow-900 italic whitespace-pre-wrap">
                {{ recipe().notes }}
              </p>
            }
            <div class="mt-3">
              <label
                for="personal-notes-editor"
                class="block text-xs font-bold text-yellow-800 mb-1"
                >My notes (private — never published)</label
              >
              <textarea
                id="personal-notes-editor"
                [ngModel]="editedNotes()"
                (ngModelChange)="editedNotesChange.emit($event)"
                rows="4"
                class="w-full p-3 rounded-lg border border-yellow-200 bg-white text-stone-800 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 mb-3"
              ></textarea>
              <div class="flex justify-end gap-2">
                <button
                  type="button"
                  (click)="cancelEditNotes.emit()"
                  class="px-3 py-1.5 bg-white text-stone-500 text-xs font-bold rounded-lg hover:bg-stone-50 border border-stone-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  (click)="saveNotes.emit()"
                  class="px-3 py-1.5 bg-yellow-600 text-white text-xs font-bold rounded-lg hover:bg-yellow-700"
                >
                  Save
                </button>
              </div>
            </div>
          } @else {
            <!-- GH #3256 (KAN-144): "No notes added yet." directly above the
                 user's own notes reads as a contradiction — a migrated manual
                 recipe has no generated notes but plenty of personal ones. -->
            @if (recipe().notes || !recipe().personalNotes) {
              <p class="text-yellow-900 italic whitespace-pre-wrap">
                {{ recipe().notes || 'No notes added yet.' }}
              </p>
            }
            @if (recipe().personalNotes) {
              <p
                class="mt-3 pt-3 border-t border-yellow-100 text-yellow-900/80 italic whitespace-pre-wrap text-sm"
              >
                <span class="font-bold not-italic">My notes (private): </span
                >{{ recipe().personalNotes }}
              </p>
            }
          }
        </div>
      </div>
    </div>
  `,
})
export class RecipeBodyComponent {
  readonly recipe = input.required<Recipe>();
  readonly scaledIngredients = input<IngredientGroup | null>(null);
  readonly isEditingNotes = input<boolean>(false);
  readonly editedNotes = input<string>('');
  readonly editedNotesChange = output<string>();
  readonly startEditNotes = output<void>();
  readonly cancelEditNotes = output<void>();
  readonly saveNotes = output<void>();

  formatAmount(amount: number | number[]): string {
    return formatIngredientAmount(amount);
  }

  instructionText(step: string | InstructionStep): string {
    return formatInstructionText(step);
  }
}
