import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { RecipeViewBase } from '../shared/recipe-view.base';
import { UnpublishConfirmComponent } from '../shared/unpublish-confirm.component';
import type { Recipe } from '../../recipe.types';
import { trackRecipeSaveOutcome } from '../../utils/analytics';
import {
  LANDING_FAQ,
  LANDING_H1,
  LANDING_INTRO,
  LANDING_LEAD,
  LANDING_STEPS,
} from './landing-copy';

@Component({
  selector: 'app-generator',
  standalone: true,
  imports: [CommonModule, FormsModule, UnpublishConfirmComponent],
  templateUrl: './generator.component.html',
})
export class GeneratorComponent extends RecipeViewBase {
  /** Landing copy (KAN-272); mirrored into index.html — see landing-copy.ts. */
  readonly landing = {
    h1: LANDING_H1,
    lead: LANDING_LEAD,
    intro: LANDING_INTRO,
    steps: LANDING_STEPS,
    faq: LANDING_FAQ,
  };

  /**
   * False on /generate (KAN-287): the Generator tab is just the input box.
   * Optional so the component still renders (as the landing) outside a route.
   */
  readonly showLanding =
    inject(ActivatedRoute, { optional: true })?.snapshot.data['landing'] !== false;

  prompt = signal('');
  isRecipeLoading = signal(false);
  error = signal<string | null>(null);

  /**
   * KAN-256 — the generator resets on ROUTE ENTRY, not on submit.
   *
   * `clearRecipe()` used to fire only inside `onGenerate()`, which is
   * submit-time. The generated recipe lives on `RecipeStateService`, a
   * root-scoped singleton that outlives this component, so navigating away and
   * back re-rendered the *previous* recipe under an empty prompt box — the
   * "why is my old recipe still here" report.
   *
   * The constructor is the right hook because route entry is exactly when
   * Angular creates this component: navigating to `/` from another route
   * destroys and recreates it, while staying on `/` reuses the instance and so
   * does not clear a result the user is still reading.
   *
   * This deliberately does NOT cancel an in-flight image generation. That is
   * tracked on the service by recipe id, so the spinner keeps running on
   * recipe-detail and the KAN-255 metadata reconcile still lands — the
   * generator just is not the surface showing it any more.
   */
  constructor() {
    super();
    this.recipeState.clearRecipe();
  }

  /**
   * A guest activating the publish toggle gets the sign-in modal here, where
   * recipe-detail stays silent (its template renders a dedicated "Sign in to
   * publish" button instead — #3211).
   */
  protected override onPublishDenied(): void {
    this.modalService.openAuth();
  }

  async onGenerate() {
    if (!this.prompt().trim()) return;

    this.authService.ensureGuestSession();

    this.isRecipeLoading.set(true);
    this.error.set(null);
    this.recipeState.clearRecipe();
    this.servingsMultiplier.set(1);

    try {
      const generatedRecipe: Recipe = {
        ...(await this.geminiService.generateRecipe(this.prompt())),
        // KAN-140: provenance label; lets the server distinguish
        // AI-mediated content from manual entry.
        origin: 'generated',
      };
      // Route the generated result through the shared view boundary so its
      // recipe_view action and display state match every other SPA recipe.
      this.recipeState.viewRecipe(generatedRecipe);
      const outcome = await this.persistenceService.saveRecipeDetailed(generatedRecipe);
      // KAN-292: already_saved / saved / saved_offline from the detailed
      // outcome; ownership and duplicate refusals keep nothing and emit nothing.
      trackRecipeSaveOutcome('generated', outcome);
      // Fire-and-forget: the image takes far longer than the recipe text, and
      // the user must be able to read (and leave) the recipe while it renders.
      void this.runImageGeneration(generatedRecipe.id, { regenerate: false });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to generate recipe. Please try again.';
      this.error.set(message);
    } finally {
      this.isRecipeLoading.set(false);
    }
  }

  async onSaveRecipe() {
    const currentRecipe = this.recipe();
    if (!currentRecipe) return;
    const outcome = await this.persistenceService.saveRecipeDetailed(currentRecipe);
    this.isSaved.set(true);
    trackRecipeSaveOutcome('generator_save', outcome);
  }

  openAddToCookbookModal() {
    const r = this.recipe();
    if (r) this.modalService.openAddToCookbook(r);
  }

  isString(val: unknown): boolean {
    return typeof val === 'string';
  }
}
