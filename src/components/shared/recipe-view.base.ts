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
import { adoptImagePipelineFields } from '../../utils/recipe-row';
import type { Recipe } from '../../recipe.types';
import {
  NOT_GENERATED_PUBLISH_REFUSAL,
  PublishSyncError,
  applyPersonalNotesEdit,
  checkPublishPreconditions,
  downloadRecipeJson,
  formatIngredientAmount,
  formatInstructionText,
  initialPersonalNotesEditorValue,
  notesSaveFailureMessage,
  publishFailureMessage,
  publishToggleTitleFor,
  scaleRecipeIngredients,
  unpublishSuccessMessage,
} from './recipe-publish-state';

export { NOT_GENERATED_PUBLISH_REFUSAL, PublishSyncError, publishFailureMessage };

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

  /**
   * KAN-243: image loading state is now derived from RecipeStateService's
   * pending-generation tracking. Before this it was a per-component-instance
   * writable signal — navigating away destroyed the signal while the async
   * generation continued, so recipe-detail showed neither image nor spinner.
   */
  readonly isImageLoading = this.recipeState.isImageGenerating;
  servingsMultiplier = signal(1);
  isEditingNotes = signal(false);
  editedNotes = signal('');

  canPublish = computed(() => {
    const user = this.authService.currentUser();
    return !!user && user.isGuest === false;
  });

  scaledIngredients = computed(() =>
    scaleRecipeIngredients(this.recipe(), this.servingsMultiplier())
  );

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

  /**
   * KAN-255 — the ONE image-generation path.
   *
   * This was two near-identical copies: `GeneratorComponent.triggerImageGeneration`
   * for the first render and `regenerateImage` here for a redo. They differed
   * only in the `force_regenerate` flag and one toast string, so every fix had
   * to land twice — and the server-metadata reconcile below is exactly the
   * class of fix that gets applied to one copy and silently missed on the other.
   *
   *   generator onGenerate ─┐                          ┌─ generator "Regenerate"
   *                         ├──> runImageGeneration ───┤
   *   (first render)        │           │              └─ recipe-detail "Regenerate"
   *                         ┘           │
   *      recipeState.trackImageGeneration(id, promise)   spinner survives
   *                                     │                component destruction
   *                          await promise  (DETACHED — by the time this
   *                                     │    resolves the component that
   *                            ┌────────┴────────┐   started it may be gone)
   *                        resolved           rejected
   *                            │                 │
   *          markImageRegenerated (redo only)  toast, only while still
   *          local write: ai_image_url         viewing this recipe
   *          API re-read: the fields only
   *          the worker writes  ── KAN-255
   *
   * Everything after the `await` is deliberately safe to run against a
   * destroyed component: `authService` / `persistenceService` / `recipeState`
   * are root singletons, and every write to the *viewed* recipe is gated on
   * `this.recipe()?.id === recipeId`.
   */
  protected async runImageGeneration(
    recipeId: string,
    opts: { regenerate: boolean; after?: Promise<unknown> }
  ) {
    // `after` delays the request, not the spinner: the pending state is tracked
    // from now (KAN-459). A failed `after` does not cancel the image; the
    // recipe already exists server-side.
    const imagePromise = (opts.after ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.geminiService.generateImage(recipeId, opts.regenerate));
    this.recipeState.trackImageGeneration(recipeId, imagePromise);
    try {
      const imageUrl = await imagePromise;
      // Cache-bust: re-generate returns the same canonical URL, so a bare
      // signal.set() is a no-op and the browser serves stale bytes. The
      // marker is recorded on RecipeStateService and applied only when
      // building a display URL, so it survives nav-away (the service is a
      // root singleton) without ever entering persisted state. First-time
      // generation needs no marker — there are no stale bytes to beat.
      if (opts.regenerate) this.recipeState.markImageRegenerated(recipeId);
      if (this.recipe()?.id === recipeId) {
        this.generatedImageUrl.set(this.recipeState.imageDisplayUrl(recipeId, imageUrl));
        this.recipe.update((r) => (r ? { ...r, ai_image_url: imageUrl } : null));
      }
      // Persist the CANONICAL url. Writing the busted one here put a
      // client-only `?_t=` marker into savedRecipes, and saveNotes POSTs the
      // whole recipe — so it came back as the canonical ai_image_url.
      this.authService.updateRecipeField(recipeId, 'ai_image_url', imageUrl);
      // ...then reconcile with the row the worker actually wrote (KAN-255).
      await this.syncImageMetadata(recipeId);
    } catch (err) {
      console.error(opts.regenerate ? 'Image regeneration failed' : 'Image generation failed', err);
      // The 5-min timeout in gemini.service now rejects rather than hanging.
      // Without a toast the spinner just vanishes and the user is left with
      // an "Image not available" placeholder and no explanation.
      if (this.recipe()?.id === recipeId) {
        this.toastService.show(
          opts.regenerate
            ? "Couldn't regenerate the image. Please try again."
            : "Couldn't generate the image. You can retry from the recipe page."
        );
      }
    }
  }

  /**
   * KAN-255 — adopt the server row once the image lands.
   *
   * `updateRecipeField(id, 'ai_image_url', url)` above covers exactly one of
   * the fields the image pipeline produces. The rest (`ai_image_gcs`,
   * `ai_metadata.image_generation`, and the `pending` -> `complete` flip on
   * `ai_metadata.image_request` / `image_enqueue`) are written by the Pub/Sub
   * worker and were never read back, so an export of the client's copy
   * disagreed with the API's row for the lifetime of the session.
   *
   * A failed reconcile is not an error the user needs to see: the image itself
   * already rendered, and the next `loadFromApi` will pick the row up.
   *
   * Only the pipeline-owned fields are adopted — see `adoptImagePipelineFields`.
   * The row read here predates any edit the user made during the image window.
   */
  private async syncImageMetadata(recipeId: string) {
    const fresh = await this.persistenceService.refreshRecipeFromApi(recipeId);
    const current = this.recipe();
    if (!fresh || current?.id !== recipeId) return;
    // Adopt the pipeline's fields onto what is on screen rather than replacing
    // it. The user may have edited notes or hit publish while the image was
    // generating, and the row this GET read predates that write.
    const merged = adoptImagePipelineFields(current, fresh);
    this.recipe.set(merged);
    // Rebuild from the merged URL: a partial server row must not blank the
    // optimistic canonical URL already stored locally. The `_t` display
    // marker lives on the service, keyed by id.
    this.generatedImageUrl.set(this.recipeState.imageDisplayUrl(recipeId, merged.ai_image_url));
  }

  async regenerateImage() {
    const currentRecipe = this.recipe();
    if (!currentRecipe) return;
    await this.runImageGeneration(currentRecipe.id, { regenerate: true });
  }

  startEditNotes() {
    const r = this.recipe();
    if (!r) return;
    this.editedNotes.set(initialPersonalNotesEditorValue(r));
    this.isEditingNotes.set(true);
  }

  cancelEditNotes() {
    this.isEditingNotes.set(false);
    this.editedNotes.set('');
  }

  async saveNotes() {
    const r = this.recipe();
    if (!r) return;
    const updatedRecipe = applyPersonalNotesEdit(r, this.editedNotes());
    this.recipe.set(updatedRecipe);
    const outcome = await this.persistenceService.saveRecipeDetailed(updatedRecipe);
    this.isEditingNotes.set(false);
    if (!outcome.ok) {
      this.toastService.show(notesSaveFailureMessage(outcome.refusal));
    }
  }

  updatePortions(multiplier: number) {
    this.servingsMultiplier.set(multiplier);
  }

  /**
   * KAN-289 — the recipe waiting on the unpublish confirmation, or null. The
   * templates render `<app-unpublish-confirm>` while it is set.
   */
  readonly unpublishCandidate = signal<Recipe | null>(null);

  async confirmUnpublish() {
    const recipe = this.unpublishCandidate();
    this.unpublishCandidate.set(null);
    if (recipe) await this.togglePublic(recipe, true);
  }

  cancelUnpublish() {
    this.unpublishCandidate.set(null);
  }

  /**
   * @param confirmed KAN-289: unpublishing needs the explicit confirmation
   *   dialog first. The toggle calls this without it, which opens the dialog;
   *   the dialog's confirm calls back in with `true`.
   */
  async togglePublic(recipe: Recipe, confirmed = false) {
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

    // KAN-289: taking a page offline is never a single tap.
    if (!nextState && !confirmed) {
      this.unpublishCandidate.set(recipe);
      return;
    }

    if (nextState) {
      const check = checkPublishPreconditions(recipe, (name) => this.slugFromTitle(name));
      if (!check.allowed) {
        if (check.action) {
          this.toastService.show(check.message, null, check.duration, check.action);
        } else {
          this.toastService.show(check.message);
        }
        return;
      }
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
      const outcome = await this.persistenceService.saveRecipeDetailed(updated);
      if (!outcome.ok) {
        throw new PublishSyncError(outcome.refusal ?? 'sync');
      }
      // Adopt the server-authoritative row (slug included) into the viewed
      // signal — auth state was just updated by the save's mirror-back.
      const fresh = this.authService.currentUser()?.savedRecipes.find((r) => r.id === recipe.id);
      if (fresh && this.recipe()?.id === recipe.id) {
        this.recipe.set(fresh);
      }
      if (!nextState) {
        this.toastService.show(unpublishSuccessMessage(recipe.slug));
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
        publishFailureMessage(err instanceof PublishSyncError ? err.refusal : 'sync', nextState)
      );
    }
  }

  readonly isPublicViewable = isPublicViewable;
  readonly publicSlugOf = publicSlugOf;
  readonly publicLinkKind = publicLinkKind;
  readonly publishToggleKind = publishToggleKind;
  readonly exportRecipe = downloadRecipeJson;
  readonly formatAmount = formatIngredientAmount;
  readonly instructionText = formatInstructionText;

  publishTogglePending(): boolean {
    return this.persistenceService.publishStateSync() === 'pending';
  }

  publishToggleTitle(recipe: Recipe): string {
    return publishToggleTitleFor(recipe, this.publishTogglePending());
  }

  openAuthModal() {
    this.modalService.openAuth();
  }
}
