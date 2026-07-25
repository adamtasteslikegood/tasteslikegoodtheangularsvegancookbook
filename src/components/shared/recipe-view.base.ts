import { computed, inject, signal } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { PersistenceService } from '../../services/persistence.service';
import { GeminiService } from '../../services/gemini.service';
import { RecipeStateService } from '../../services/recipe-state.service';
import { ToastService } from '../../services/toast.service';
import { ModalService } from '../../services/modal.service';
import {
  isPublicViewable,
  publicLinkKind,
  publicSlugOf,
  publishToggleKind,
} from '../../utils/public-link';
import { slugFromTitle } from '../../utils/slug';
import type { Ingredient, IngredientGroup, InstructionStep, Recipe } from '../../recipe.types';

/**
 * State and behaviour shared by the two components that render a single recipe
 * (KAN-126 / #3209).
 *
 * `GeneratorComponent` and `RecipeDetailComponent` carried ~13 byte-identical
 * methods, so every fix had to be applied twice — the `togglePublic`
 * redundant-save bug (da445b3) and the KAN-149 immutability fix both had to
 * land in two places, and PR #3265 grew the duplication further.
 *
 * The components keep whatever is genuinely theirs: prompt/generation state on
 * the generator, routing and the cold deep-link fetch on recipe-detail.
 *
 * Uses `inject()` in field initialisers rather than constructor parameters, so
 * subclasses need no constructor boilerplate and no Angular decorator is
 * required here.
 */
export abstract class RecipeViewBase {
  readonly authService = inject(AuthService);
  protected readonly persistenceService = inject(PersistenceService);
  protected readonly geminiService = inject(GeminiService);
  protected readonly recipeState = inject(RecipeStateService);
  protected readonly toastService = inject(ToastService);
  protected readonly modalService = inject(ModalService);

  readonly recipe = this.recipeState.currentRecipe;
  readonly generatedImageUrl = this.recipeState.generatedImageUrl;
  readonly isSaved = this.recipeState.isSaved;

  isImageLoading = signal(false);
  servingsMultiplier = signal(1);
  isEditingNotes = signal(false);
  editedNotes = signal('');

  canPublish = computed(() => {
    const user = this.authService.currentUser();
    return !!user && user.isGuest === false;
  });

  scaledIngredients = computed(() => {
    const r = this.recipe();
    const mult = this.servingsMultiplier();
    if (!r) return null;

    const scaleIngredient = (ing: Ingredient): Ingredient => {
      let newAmount: number | number[];
      if (Array.isArray(ing.amount)) {
        newAmount = ing.amount.map((val) => Number((val * mult).toFixed(2)));
      } else {
        newAmount = Number((ing.amount * mult).toFixed(2));
      }
      return { ...ing, amount: newAmount };
    };

    const scaledGroup: IngredientGroup = {};
    if (r.ingredients.wet) scaledGroup.wet = r.ingredients.wet.map(scaleIngredient);
    if (r.ingredients.dry) scaledGroup.dry = r.ingredients.dry.map(scaleIngredient);
    if (r.ingredients.other) scaledGroup.other = r.ingredients.other.map(scaleIngredient);
    return scaledGroup;
  });

  scaledServings = computed(() => {
    const r = this.recipe();
    if (!r) return 0;
    return Math.round(r.servings * this.servingsMultiplier());
  });

  protected slugFromTitle = slugFromTitle;

  /**
   * What to do when a user who cannot publish activates the toggle.
   *
   * The one place the two components legitimately diverge: the generator
   * prompts the guest to sign in, while recipe-detail stays silent because its
   * template already renders a dedicated "Sign in to publish" button (#3211).
   * Default is the silent branch.
   */
  protected onPublishDenied(): void {}

  async regenerateImage() {
    const currentRecipe = this.recipe();
    if (!currentRecipe) return;
    const targetId = currentRecipe.id;
    this.isImageLoading.set(true);
    try {
      const imageUrl = await this.geminiService.generateImage(targetId, true);
      if (this.recipe()?.id === targetId) {
        this.generatedImageUrl.set(imageUrl);
        this.recipe.update((r) => (r ? { ...r, ai_image_url: imageUrl } : null));
      }
      this.authService.updateRecipeField(targetId, 'ai_image_url', imageUrl);
    } catch (err) {
      console.error('Image regeneration failed', err);
    } finally {
      if (this.recipe()?.id === targetId) {
        this.isImageLoading.set(false);
      }
    }
  }

  /**
   * GH #3256 (KAN-144): manual entry used to write the user's own "Chef's
   * Notes" into `notes` — the field KAN-140 froze as generated, publicly
   * rendered, read-only content. Those recipes were left with notes they
   * could no longer edit and a pencil that opened an empty box.
   *
   * A manual recipe can never be published, so nothing public depends on its
   * `notes`: on first edit, adopt the text into personalNotes instead.
   */
  private migratesLegacyNotes(r: Recipe): boolean {
    return r.origin === 'manual' && !r.personalNotes && !!r.notes;
  }

  startEditNotes() {
    const r = this.recipe();
    if (!r) return;
    // KAN-140: the editor only ever touches personalNotes — the generated
    // notes render on the public page and must not be user-writable.
    this.editedNotes.set(this.migratesLegacyNotes(r) ? (r.notes ?? '') : r.personalNotes || '');
    this.isEditingNotes.set(true);
  }

  cancelEditNotes() {
    this.isEditingNotes.set(false);
    this.editedNotes.set('');
  }

  async saveNotes() {
    const r = this.recipe();
    if (r) {
      const updatedRecipe: Recipe = { ...r, personalNotes: this.editedNotes() };
      // Clear the adopted legacy field so the same text doesn't render twice —
      // once read-only above the editor, once as "My notes (private)".
      if (this.migratesLegacyNotes(r)) updatedRecipe.notes = '';
      this.recipe.set(updatedRecipe);
      await this.persistenceService.saveRecipe(updatedRecipe);
      this.isEditingNotes.set(false);
    }
  }

  updatePortions(multiplier: number) {
    this.servingsMultiplier.set(multiplier);
  }

  async togglePublic(recipe: Recipe) {
    if (!this.canPublish()) {
      this.onPublishDenied();
      return;
    }
    // KAN-139: the server rejects publish-state changes on canonical recipes
    // (400), and while the initial sync is pending we don't yet know the
    // authoritative state.
    //
    // GH #3255 (KAN-143): say why rather than no-op. The template used to hide
    // the reason in a `title` on a `disabled` button — unreachable by keyboard
    // and unreliable on hover — so an unavailable toggle just sat there.
    if (recipe.is_canonical || this.publishTogglePending()) {
      this.toastService.show(this.publishToggleTitle(recipe));
      return;
    }
    const nextState = !recipe.is_public;

    // KAN-140: manually entered recipes cannot be published — the server
    // rejects with 400; the template disables the toggle, this backstops it.
    if (nextState && recipe.origin === 'manual') {
      this.toastService.show("Manually entered recipes can't be published.");
      return;
    }

    // KAN-104 (#3146): a title with no ASCII alphanumerics (all-emoji,
    // pure-CJK/Cyrillic) derives an empty slug, which the server rejects
    // with 400. Same derivation as the server (parity is spec-pinned), so
    // catch it before the round trip and say why instead of failing silently.
    if (nextState && !recipe.slug && !this.slugFromTitle(recipe.name)) {
      this.toastService.show(
        "This recipe can't be published: its title has no letters or numbers (a-z, 0-9) to build a public link from."
      );
      return;
    }

    // KAN-137: first publish of a copy saved from a public recipe would mint
    // a near-identical second public page (name collision → -N slug). Make
    // that an informed choice instead of a silent side effect.
    if (
      nextState &&
      !recipe.slug &&
      recipe.sourceSlug &&
      !confirm(
        `This recipe was saved from a public recipe that may still be live at /r/${recipe.sourceSlug}. Publish your copy as a separate public page?`
      )
    ) {
      return;
    }

    // KAN-149 (#3262): the flip is immutable and goes through the signal —
    // zoneless change detection never re-renders on in-place mutation, which
    // both hid the failure-revert below and froze the View link on a
    // client-predicted slug. The slug itself is server-minted (collision →
    // -N suffix), so no client-side guess: the View link appears once the
    // sync merges the server's answer back.
    const updated: Recipe = { ...recipe, is_public: nextState };
    if (this.recipe()?.id === recipe.id) {
      this.recipe.set(updated);
    }

    try {
      const synced = await this.persistenceService.saveRecipe(updated);
      if (!synced) {
        throw new Error('Publish state failed to sync to the server');
      }
      // Adopt the server-authoritative row (slug included) into the viewed
      // signal — auth state was just updated by the save's mirror-back.
      const fresh = this.authService.currentUser()?.savedRecipes.find((r) => r.id === recipe.id);
      if (fresh && this.recipe()?.id === recipe.id) {
        this.recipe.set(fresh);
      }
    } catch (err) {
      console.error('Failed to toggle public state:', err);
      this.authService.saveRecipe(recipe);
      if (this.recipe()?.id === recipe.id) {
        this.recipe.set(recipe);
      }
      // KAN-104 (#3146): the revert already worked; without a message the
      // user just sees the switch snap back with no explanation.
      this.toastService.show(
        nextState
          ? 'Publishing failed to sync to the server. Check your connection and try again.'
          : 'Unpublishing failed to sync to the server. Check your connection and try again.'
      );
    }
  }

  isPublicViewable(recipe: Recipe): boolean {
    return isPublicViewable(recipe);
  }

  publicSlugOf(recipe: Recipe): string | null {
    return publicSlugOf(recipe);
  }

  publicLinkKind(recipe: Recipe): 'own' | 'source' | null {
    return publicLinkKind(recipe);
  }

  publishToggleKind(recipe: Recipe): 'locked' | 'manual' | 'source' | 'normal' {
    return publishToggleKind(recipe);
  }

  publishTogglePending(): boolean {
    return this.persistenceService.publishStateSync() === 'pending';
  }

  publishToggleTitle(recipe: Recipe): string {
    if (this.publishTogglePending()) return 'Checking publish state…';
    const kind = publishToggleKind(recipe);
    if (kind === 'locked') return 'Canonical recipe — publish state is locked';
    if (kind === 'manual') return "Manually entered recipes can't be published.";
    if (kind === 'source') {
      return `This recipe was saved from a public recipe (/r/${recipe.sourceSlug}). Publishing creates your own separate public page.`;
    }
    return recipe.is_public ? 'Unpublish this recipe' : 'Publish this recipe';
  }

  exportRecipe(recipe: Recipe) {
    const fileName = `${recipe.name.replace(/\s+/g, '_')}.json`;
    const blob = new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  formatAmount(amount: number | number[]): string {
    if (Array.isArray(amount)) {
      return amount.join(' - ');
    }
    const decimal = amount;
    if (Math.abs(decimal - 0.25) < 0.01) return '1/4';
    if (Math.abs(decimal - 0.5) < 0.01) return '1/2';
    if (Math.abs(decimal - 0.75) < 0.01) return '3/4';
    if (Math.abs(decimal - 0.33) < 0.01) return '1/3';
    if (Math.abs(decimal - 0.66) < 0.01) return '2/3';
    return decimal.toString();
  }

  instructionText(step: string | InstructionStep): string {
    return typeof step === 'string' ? step : step.description;
  }

  openAuthModal() {
    this.modalService.openAuth();
  }
}
