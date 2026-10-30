import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { PersistenceService } from './persistence.service';
import { ToastService } from './toast.service';
import { buildSavedRecipeFromPublic } from './public-recipe.mapper';
import type { Recipe } from '../recipe.types';
import { saveOutcomeForAnalytics, trackRecipeSaved } from '../utils/analytics';
import {
  isSignedIn,
  normalizeFeedbackSlug,
  storeFeedbackIntent,
  takeFeedbackIntent,
} from './feedback.service';

/**
 * Predicate matching a saved recipe's `sourceSlug` or `slug` against an
 * already-normalized slug, normalizing the stored side too.
 *
 * Exported for unit testing.
 */
export function matchesSlug(
  normalizedSlug: string,
  field: 'sourceSlug' | 'slug'
): (recipe: Recipe) => boolean {
  return (recipe: Recipe) => {
    const value = recipe[field];
    return typeof value === 'string' && value.trim().toLowerCase() === normalizedSlug;
  };
}

@Injectable({ providedIn: 'root' })
export class SsrEntryService {
  private readonly auth = inject(AuthService);
  private readonly persistence = inject(PersistenceService);
  private readonly toast = inject(ToastService);
  // Optional so the save-only unit tests can build the service without a router.
  private readonly router = inject(Router, { optional: true });

  // KAN-156/KAN-198: ssrEntryGuard calls handleSave fire-and-forget and returns
  // a redirect immediately, so a guard that runs more than once for the same
  // ?save=<slug> entry starts overlapping saves. Without this map both pass the
  // dedup check below while savedRecipes is still empty, and BOTH persist —
  // whichever finishes second then re-reads the row the first just wrote and
  // emits the bogus "you already have this recipe" toast. KAN-156 was triaged as
  // cosmetic; the duplicate row is the part that was missed.
  //
  // Scoped to in-flight calls only, deliberately not a permanent handled-set: a
  // user who saves, deletes, and saves again is making a genuine second request
  // and must get a response rather than silence.
  private readonly inFlightSaves = new Map<string, Promise<Recipe | null>>();

  async handleSave(slug: string): Promise<void> {
    await this.saveOrFind(slug);
  }

  /**
   * Save the public recipe, or find the copy (or own recipe) already in the
   * cookbook. Resolves to that recipe, or null when nothing was kept.
   */
  private saveOrFind(slug: string, quiet = false): Promise<Recipe | null> {
    const normalizedSlug = slug.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(normalizedSlug)) {
      console.warn(`Ignoring save request for invalid recipe slug: "${slug}"`);
      return Promise.resolve(null);
    }

    const inFlight = this.inFlightSaves.get(normalizedSlug);
    if (inFlight) return inFlight;

    const save = this.runSave(normalizedSlug, quiet).finally(() => {
      this.inFlightSaves.delete(normalizedSlug);
    });
    this.inFlightSaves.set(normalizedSlug, save);
    return save;
  }

  private async runSave(normalizedSlug: string, quiet = false): Promise<Recipe | null> {
    // `quiet`: the caller opens the recipe itself, so a toast pointing at it
    // would only repeat what the page now shows. Failures still toast.
    const say = (message: string, recipe: Recipe | null = null) => {
      if (!quiet || !recipe) this.toast.show(message, recipe);
    };
    try {
      await this.auth.ready;
      this.auth.ensureGuestSession();
    } catch (err) {
      console.error('Failed to initialize session for SSR save:', err);
      this.toast.show('Something went wrong saving this recipe.');
      return null;
    }

    // KAN-139: the dedup check below must see the server's rows, not just
    // whatever localStorage happens to hold — a copy saved on another
    // device (or one whose local blob predates the slug-column sync) is
    // otherwise invisible and gets saved again. Bounded so a hanging API
    // degrades to the old local-only check instead of blocking the save.
    await Promise.race([
      this.persistence.firstSyncSettled,
      new Promise<void>((resolve) => setTimeout(resolve, 8_000)),
    ]);

    const saved = this.auth.currentUser()?.savedRecipes ?? [];

    // The recipe is already in the cookbook when either a copy saved earlier
    // from this public page matches (sourceSlug — the only marker a copy of
    // ANOTHER user's recipe carries, since such copies are never publishable
    // and so never gain a slug) or the user's own published original matches
    // (slug). Either way re-saving adds no row; tell the user and link them to
    // the copy they already have. Prefer the sourceSlug copy when both exist.
    //
    // TAS-3056/RCP-79 supersedes RCP-74 AC3, which suppressed this toast for the
    // sourceSlug case — so the confirmation fired only when the saver was the
    // original author (the slug branch). Both cases now surface it consistently.
    // The KAN-156 "one entry, one toast" guarantee is unaffected: overlapping
    // saves of the same entry are collapsed upstream by inFlightSaves and never
    // reach here twice, and the guard redirects off ?save= so no entry re-fires.
    //
    // Both lookups normalize the STORED value too. `normalizedSlug` is
    // lowercased at the top of save(), but persisted sourceSlug/slug come from
    // localStorage and the API, not from that guard. Comparing them raw means a
    // mixed-case stored value misses, and the miss is silent: the user is told
    // they already have the recipe while the View button loses its target.
    // Backend slug generation lowercases (utils/slug_utils.py), so this is
    // defensive against legacy or hand-edited local rows rather than a path
    // reachable from today's server — but it costs nothing to be exact.
    const alreadySaved =
      saved.find(matchesSlug(normalizedSlug, 'sourceSlug')) ??
      saved.find(matchesSlug(normalizedSlug, 'slug'));
    if (alreadySaved) {
      trackRecipeSaved('public_page', 'already_saved', normalizedSlug);
      say('Good news — you already have this recipe.', alreadySaved);
      return alreadySaved;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`/api/recipes/public/${encodeURIComponent(normalizedSlug)}`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        console.warn(`Could not fetch recipe for slug "${normalizedSlug}": ${response.status}`);
        this.toast.show('Could not save this recipe. Please try again.');
        return null;
      }
      const recipeData = await response.json();

      // KAN-356 (O6): a copy whose source was renamed since it was saved
      // carries the old sourceSlug, so the slug lookup above misses it. The
      // public recipe's id does not change; match on it before saving again.
      const sourceId = typeof recipeData?.id === 'string' ? recipeData.id : null;
      const byId = sourceId
        ? (this.auth.currentUser()?.savedRecipes ?? []).find(
            (r) => r.sourceRecipeId === sourceId || r.id === sourceId
          )
        : undefined;
      if (byId) {
        trackRecipeSaved('public_page', 'already_saved', normalizedSlug);
        say('Good news — you already have this recipe.', byId);
        return byId;
      }

      const recipe: Recipe = buildSavedRecipeFromPublic(recipeData);
      const outcome = await this.persistence.saveRecipeDetailed(recipe);
      const analyticsOutcome = saveOutcomeForAnalytics(outcome);

      if (outcome.alreadySaved) {
        // KAN-241: the server already has this recipe — the ghost was cleaned
        // up by saveRecipeDetailed. Re-read auth state to find the existing
        // copy (it carries the server-assigned ID, not the fresh UUID).
        const existing =
          (this.auth.currentUser()?.savedRecipes ?? []).find(
            matchesSlug(normalizedSlug, 'sourceSlug')
          ) ??
          (this.auth.currentUser()?.savedRecipes ?? []).find(matchesSlug(normalizedSlug, 'slug'));
        // Pass null when the existing copy isn't in local state yet (KAN-241):
        // the ghost was just removed, so `recipe` points at a dead object whose
        // View button would navigate to a recipe no longer in savedRecipes.
        // The real copy surfaces on the next hydrate/sync cycle.
        trackRecipeSaved('public_page', 'already_saved', normalizedSlug);
        say('Good news — you already have this recipe.', existing ?? null);
        return existing ?? null;
      } else if (analyticsOutcome === 'saved') {
        trackRecipeSaved('public_page', 'saved', normalizedSlug);
        say('Saved to your cookbook.', recipe);
        return recipe;
      } else if (analyticsOutcome === 'saved_offline') {
        // Only a sync failure kept the recipe locally; an ownership or
        // duplicate refusal kept nothing and must not count as a keep.
        trackRecipeSaved('public_page', 'saved_offline', normalizedSlug);
        this.toast.show("Saved on this device — we'll sync it when you're back online.", recipe);
        return recipe;
      } else {
        this.toast.show('Could not save this recipe. Please try again.');
        return null;
      }
    } catch (err) {
      console.error('Failed to save recipe from SSR CTA:', err);
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.toast.show('Save timed out. Check your connection and try again.');
      } else {
        this.toast.show('Something went wrong saving this recipe.');
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * KAN-356 (R8, R15): "Cooked this? Add your feedback" on the public page
   * links to `/?feedback=<slug>`. Signed in: save the recipe (or find the copy,
   * or the author's own recipe) and open it at the form. Otherwise keep the
   * intent in sessionStorage and start Google sign-in; the return trip reads
   * it once (`handleAuth`, `handleAuthCancelled`).
   */
  async handleFeedback(slug: string): Promise<void> {
    const normalized = normalizeFeedbackSlug(slug);
    if (!normalized) {
      console.warn(`Ignoring feedback request for invalid recipe slug: "${slug}"`);
      return;
    }
    try {
      await this.auth.ready;
    } catch {
      // Judge by whatever auth state there is.
    }
    if (isSignedIn(this.auth.currentUser())) {
      await this.openAtFeedback(normalized);
      return;
    }
    await this.startFeedbackSignIn(normalized);
  }

  /** Back from Google with `?auth=success`: honour a pending feedback intent once. */
  async handleAuth(): Promise<void> {
    await this.auth.ready;
    const slug = takeFeedbackIntent();
    if (slug && isSignedIn(this.auth.currentUser())) await this.openAtFeedback(slug);
  }

  /**
   * Back from Google with `?auth=cancelled` (E2). With a pending intent, save
   * as a guest, as the Save button does, and offer sign-in once more (R8).
   */
  async handleAuthCancelled(): Promise<void> {
    const slug = takeFeedbackIntent();
    if (!slug) return;
    const saved = await this.saveOrFind(slug, true);
    if (!saved) return;
    this.toast.show('Saved to your cookbook. Sign in to add your feedback.', null, 12_000, undefined, {
      label: 'Sign in',
      // O8: the second chance re-arms the intent, so it lands on the form too.
      run: () => void this.startFeedbackSignIn(slug),
    });
  }

  private async startFeedbackSignIn(slug: string): Promise<void> {
    storeFeedbackIntent(slug);
    try {
      await this.auth.login();
    } catch (err) {
      console.error('Could not start sign-in for feedback:', err);
      takeFeedbackIntent();
      this.toast.show('Could not start sign-in. Please try again.');
    }
  }

  private async openAtFeedback(slug: string): Promise<void> {
    const recipe = await this.saveOrFind(slug, true);
    if (!recipe || !this.router) return;
    await this.router.navigate(['/recipe', recipe.id], { fragment: 'feedback' });
  }
}
