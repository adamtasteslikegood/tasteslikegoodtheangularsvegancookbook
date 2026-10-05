import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { GeminiService } from '../../services/gemini.service';
import { PersistenceService } from '../../services/persistence.service';
import { RecipeStateService } from '../../services/recipe-state.service';
import { ModalService } from '../../services/modal.service';
import { hasEverBeenPublished } from '../../utils/recipe-row';
import type { Recipe } from '../../recipe.types';
import { DialogFocusDirective } from '../shared/dialog-focus.directive';
import { BreadcrumbComponent } from '../shared/breadcrumb.component';
import { kitchenTrail } from '../../utils/breadcrumbs';

/**
 * KAN-289 — which confirmation the delete button opens.
 *
 * 'published' — live on the site. Deleting is refused outright (the server
 *               answers 409 too). The dialog only says to unpublish first:
 *               no link or shortcut to do it, by design (Adam, 2026-09-28).
 * 'retiring'  — unpublished, but it once had a public page, or its slug is
 *               reserved (KAN-291: a KAN-288 owner marker). Deleting retires
 *               that /r/<slug> for good (410, never reused), so the user types
 *               the slug to confirm.
 * 'bin'       — never published: the ordinary recycle-bin confirmation.
 */
export type DeleteMode = 'published' | 'retiring' | 'bin';

export function deleteModeFor(recipe: Recipe): DeleteMode {
  if (recipe.is_public) return 'published';
  return hasEverBeenPublished(recipe) || recipe.slug_reserved ? 'retiring' : 'bin';
}

/** What the user must type to confirm a 'retiring' delete. */
export function retiringConfirmationText(recipe: Recipe): string {
  return recipe.slug || recipe.name;
}

/** KAN-298: the Kitchen's sort orders. Saved recipes carry no date, so there is no "newest". */
export type KitchenSort = 'saved' | 'name' | 'quickest';

const KITCHEN_SORT_OPTIONS: readonly { value: KitchenSort; label: string }[] = [
  { value: 'saved', label: 'Order saved' },
  { value: 'name', label: 'Name A to Z' },
  { value: 'quickest', label: 'Quickest first' },
];

/**
 * Prep plus cook time; a recipe with no usable time sorts last. Imported JSON
 * may lack either field, so each is read on its own.
 */
function totalMinutes(recipe: Recipe): number {
  const minutes = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return minutes(recipe.prepTime) + minutes(recipe.cookTime) || Number.POSITIVE_INFINITY;
}

@Component({
  selector: 'app-kitchen',
  standalone: true,
  imports: [CommonModule, DialogFocusDirective, BreadcrumbComponent],
  templateUrl: './kitchen.component.html',
})
export class KitchenComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly authService = inject(AuthService);
  private readonly geminiService = inject(GeminiService);
  private readonly persistenceService = inject(PersistenceService);
  private readonly recipeState = inject(RecipeStateService);
  readonly modalService = inject(ModalService);

  /**
   * KAN-243: the tile `src`. `ai_image_url` is the canonical URL, so after a
   * regenerate the browser would re-serve the pre-regen bytes — for public
   * recipes the API sends `Cache-Control: public, max-age=86400`, so for up to
   * 24 h. Routing through the state service applies the display-only `_t`
   * marker for recipes regenerated this session.
   */
  imageSrc(r: { id: string; ai_image_url?: string | null }): string | null {
    return this.recipeState.imageDisplayUrl(r.id, r.ai_image_url);
  }

  private destroyed = false;

  constructor() {
    // Entering the recipe list ends the prior detail-page analytics view.
    // Keep the cached recipe for fast return navigation, but allow selecting
    // the same recipe again to count as a new view.
    this.recipeState.leaveRecipeView();
    this.authService.ensureGuestSession();

    // Mirror the awaited-after-destroy guard so applyRouteCookbook cannot
    // navigate the user away from a different page they moved to while
    // firstSyncSettled was still in flight.
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
    });

    // KAN-321: the selected cookbook lives in the URL (/kitchen/<id>), so
    // back/forward, reload and deep links all land on the same view.
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      void this.applyRouteCookbook(params.get('cookbookId'));
    });
  }

  /**
   * Select the route's cookbook. An id that is not one of this user's (or
   * guest's) cookbooks falls back to /kitchen, replacing the dead entry.
   *
   * Not on first sight: the signed-in user's cookbooks are seeded from
   * localStorage and merged from the API afterwards, so a cookbook made on
   * another device is absent until the first sync settles. Bouncing before
   * then would throw away a legitimate deep link.
   */
  private async applyRouteCookbook(id: string | null) {
    this.activeCookbookId.set(id);
    if (!id) return;
    this.showRecycleBin.set(false);
    if (this.ownsCookbook(id)) return;
    try {
      await this.authService.ready;
      await this.persistenceService.firstSyncSettled;
    } catch {
      // Fall through and judge by whatever state we have.
    }
    // The user may have moved on while we waited — including off the Kitchen
    // entirely. Firing router.navigate in that case replaces the user's
    // current page with /kitchen.
    if (this.destroyed) return;
    if (this.activeCookbookId() !== id || this.ownsCookbook(id)) return;
    void this.router.navigate(['/kitchen'], { replaceUrl: true });
  }

  private ownsCookbook(id: string): boolean {
    return !!this.authService.currentUser()?.cookbooks.some((cb) => cb.id === id);
  }

  activeCookbookId = signal<string | null>(null);
  showRecycleBin = signal(false);
  showDeleteConfirmation = signal(false);
  recipeToDelete = signal<Recipe | null>(null);
  deleteMode = computed<DeleteMode | null>(() => {
    const r = this.recipeToDelete();
    return r ? deleteModeFor(r) : null;
  });
  retiringText = computed(() => {
    const r = this.recipeToDelete();
    return r ? retiringConfirmationText(r) : '';
  });
  deleteConfirmationTyped = signal('');
  deleteInFlight = signal(false);
  /** Why the last delete attempt was refused; shown inside the dialog. */
  deleteError = signal<string | null>(null);
  canConfirmDelete = computed(() => {
    const r = this.recipeToDelete();
    if (!r || this.deleteInFlight()) return false;
    switch (this.deleteMode()) {
      case 'bin':
        return true;
      case 'retiring':
        return this.deleteConfirmationTyped().trim() === retiringConfirmationText(r);
      default:
        return false;
    }
  });
  showEmptyBinConfirmation = signal(false);

  recycleBinRecipes = computed(() => this.authService.currentUser()?.deletedRecipes || []);
  recycleBinCount = computed(() => this.recycleBinRecipes().length);

  activeCookbook = computed(() => {
    const id = this.activeCookbookId();
    if (!id) return null;
    return this.authService.currentUser()?.cookbooks.find((cb) => cb.id === id) || null;
  });

  /** KAN-295: the visible trail; a selected cookbook is its last crumb. */
  breadcrumbs = computed(() => kitchenTrail(this.activeCookbook()));

  /** KAN-298: what the list is narrowed to and ordered by; both stay client-side. */
  kitchenFilter = signal('');
  kitchenSort = signal<KitchenSort>('saved');
  readonly kitchenSortOptions = KITCHEN_SORT_OPTIONS;

  /** The open cookbook's recipes, or every saved recipe, before filter and sort. */
  cookbookRecipes = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return [];
    const cookbook = this.activeCookbook();
    if (cookbook) {
      return user.savedRecipes.filter((r) => cookbook.recipeIds.includes(r.id));
    }
    return user.savedRecipes;
  });

  /**
   * KAN-298: `cookbookRecipes` narrowed by the filter text, then sorted. Every
   * word typed must appear in the recipe's name or one of its tags, in any
   * order and any case. `saved` keeps the order the recipes were saved in.
   */
  displayedKitchenRecipes = computed(() => {
    const words = this.kitchenFilter().toLowerCase().split(/\s+/).filter(Boolean);
    const matching = words.length
      ? this.cookbookRecipes().filter((r) => {
          const tags = Array.isArray(r.tags) ? r.tags : [];
          const haystack = [r.name, ...tags].join(' ').toLowerCase();
          return words.every((word) => haystack.includes(word));
        })
      : this.cookbookRecipes();
    const sort = this.kitchenSort();
    if (sort === 'name') {
      return [...matching].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );
    }
    if (sort === 'quickest') {
      return [...matching].sort((a, b) => totalMinutes(a) - totalMinutes(b));
    }
    return matching;
  });

  setKitchenSort(value: string) {
    if (KITCHEN_SORT_OPTIONS.some((option) => option.value === value)) {
      this.kitchenSort.set(value as KitchenSort);
    }
  }

  /**
   * KAN-321: selecting is navigating; the route handler applies it. The bin
   * closes here because "All Recipes" from the bin at /kitchen is a same-URL
   * navigation, which the router ignores.
   */
  selectCookbook(id: string | null) {
    this.showRecycleBin.set(false);
    void this.router.navigate(id ? ['/kitchen', id] : ['/kitchen']);
  }

  switchView(view: 'generator' | 'kitchen') {
    this.router.navigate([view === 'kitchen' ? '/kitchen' : '/generate']);
  }

  viewRecipe(r: Recipe) {
    // Stage the fast-path state now; RecipeDetailComponent records the view
    // only after the detail route actually activates.
    this.recipeState.stageRecipeForNavigation(r);
    // KAN-321: carry the cookbook so the recipe's trail and "Back to Kitchen"
    // return to it. The recipe page checks membership before trusting it.
    const cookbookId = this.activeCookbookId();
    this.router.navigate(
      ['/recipe', r.id],
      cookbookId ? { queryParams: { cookbook: cookbookId } } : undefined
    );
  }

  async deleteCookbook(id: string, event: Event) {
    event.stopPropagation();
    if (
      confirm('Are you sure you want to delete this cookbook? Recipes will remain in "All Saved".')
    ) {
      const wasOpen = this.activeCookbookId() === id;
      try {
        await this.persistenceService.deleteCookbook(id);
      } finally {
        // The cookbook leaves local state before the DELETE is sent, so even a
        // failed request leaves /kitchen/<id> pointing at nothing: replace it.
        // Mirror the applyRouteCookbook destroy guard — if the user moved off
        // Kitchen while the DELETE was in flight, firing navigate() replaces
        // their current page with /kitchen.
        if (!this.destroyed && wasOpen && this.activeCookbookId() === id) {
          void this.router.navigate(['/kitchen'], { replaceUrl: true });
        }
      }
    }
  }

  toggleRecycleBin() {
    this.showRecycleBin.update((v) => !v);
    // The bin is a view of /kitchen, not of a cookbook (KAN-321). Push, don't
    // replace: the /kitchen/<id> entry is still a live view (unlike after
    // deleteCookbook), so Back from the bin returns to that cookbook, and the
    // route handler closes the bin when it lands.
    if (this.activeCookbookId()) void this.router.navigate(['/kitchen']);
  }

  promptDeleteRecipe(recipe: Recipe, event: Event) {
    event.stopPropagation();
    // KAN-139: canonical recipes are server-locked (DELETE returns 400);
    // the template disables the button — this backstops it.
    if (recipe.is_canonical) return;
    this.recipeToDelete.set(recipe);
    this.deleteConfirmationTyped.set('');
    this.deleteError.set(null);
    this.showDeleteConfirmation.set(true);
  }

  async confirmDeleteRecipe() {
    const r = this.recipeToDelete();
    if (!r || !this.canConfirmDelete()) return;
    this.deleteInFlight.set(true);
    this.deleteError.set(null);
    try {
      // KAN-289: the recipe leaves the kitchen only once the server agrees.
      const outcome = await this.persistenceService.deleteRecipe(r.id);
      if (!outcome.ok) {
        this.deleteError.set(outcome.message);
        return;
      }
      if (this.recipeState.currentRecipe()?.id === r.id) {
        this.recipeState.clearRecipe();
      }
      this.closeDeleteDialog();
    } finally {
      this.deleteInFlight.set(false);
    }
  }

  cancelDeleteRecipe() {
    // Once DELETE has reached the server, closing the dialog cannot cancel it.
    // Keep the operation visible until its outcome is known so Cancel never
    // promises something the client can no longer deliver.
    if (this.deleteInFlight()) return;
    this.closeDeleteDialog();
  }

  private closeDeleteDialog() {
    this.showDeleteConfirmation.set(false);
    this.recipeToDelete.set(null);
    this.deleteConfirmationTyped.set('');
    this.deleteError.set(null);
  }

  async restoreRecipe(recipeId: string) {
    await this.persistenceService.restoreRecipe(recipeId);
  }

  async permanentlyDeleteRecipe(recipeId: string) {
    await this.persistenceService.permanentlyDeleteRecipe(recipeId);
  }

  promptEmptyRecycleBin() {
    this.showEmptyBinConfirmation.set(true);
  }

  async confirmEmptyRecycleBin() {
    await this.persistenceService.emptyRecycleBin();
    this.showEmptyBinConfirmation.set(false);
  }

  cancelEmptyRecycleBin() {
    this.showEmptyBinConfirmation.set(false);
  }

  exportRecipe() {
    const dataToExport = this.authService.currentUser()?.savedRecipes || [];
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], {
      type: 'application/json',
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my_vegan_cookbook.json';
    a.click();
    window.URL.revokeObjectURL(url);
  }

  onImportFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e: ProgressEvent<FileReader>) => {
      try {
        const result = e.target?.result;
        if (typeof result !== 'string') return;
        const json = JSON.parse(result);
        const recipes = Array.isArray(json) ? json : [json];

        const cleanedRecipes: Recipe[] = recipes.map((r: Record<string, unknown>) => {
          const cleaned = { ...r };
          delete cleaned['ai_image_data'];
          return cleaned as unknown as Recipe;
        });

        const count = this.authService.importRecipes(cleanedRecipes, this.activeCookbookId());
        const recipesNeedingImages: Recipe[] = [];
        for (const r of cleanedRecipes) {
          if (r.name && r.ingredients && r.instructions) {
            await this.persistenceService.saveRecipe(r);
            if (!r.ai_image_url || r.ai_image_url.startsWith('data:')) {
              recipesNeedingImages.push(r);
            }
          }
        }

        if (recipesNeedingImages.length > 0) {
          alert(
            `Imported ${count} recipes! Generating images for ${recipesNeedingImages.length} recipe(s)...`
          );
          this.generateMissingImages(recipesNeedingImages);
        } else {
          alert(`Successfully imported ${count} recipes!`);
        }
      } catch (err) {
        console.error('Failed to parse recipe import file:', err);
        alert('Failed to parse recipe file. Please ensure it is valid JSON.');
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  private async generateMissingImages(recipes: Recipe[]) {
    let generated = 0;
    for (const recipe of recipes) {
      try {
        const imageUrl = await this.geminiService.generateImage(recipe.id);
        if (imageUrl) {
          recipe.ai_image_url = imageUrl;
          this.authService.saveRecipe(recipe);
          generated++;
        }
      } catch (err) {
        console.warn(`[Import] Failed to generate image for "${recipe.name}":`, err);
      }
    }
    if (generated > 0) {
      console.log(`[Import] Generated ${generated}/${recipes.length} images`);
    }
  }
}
