import { Injectable, computed, signal } from '@angular/core';
import type { Recipe } from '../recipe.types';

/**
 * Base used only to parse *relative* image URLs. `URL` needs some base to
 * resolve against; the result is reduced back to path + query + fragment, so
 * this host never appears in the returned value. A literal is used rather than
 * `window.location.origin` so the helper works anywhere (unit tests, SSR).
 */
const RELATIVE_URL_BASE = 'http://cache-buster.invalid';

/**
 * Set/replace a `_t=<epoch>` cache-buster on an image URL, preserving any
 * existing query params and fragment. `searchParams.set` means a repeat
 * regenerate replaces the marker instead of stacking `?_t=A&_t=B`.
 *
 * This produces a **display-only** value. It must never be persisted — see
 * `imageDisplayUrl` below. Deliberately module-local: building busted URLs
 * outside this service is how the persistence trap re-opens.
 */
function withCacheBuster(imageUrl: string, at: number): string {
  // A `data:` URI has no server round-trip, so busting it is meaningless — and
  // actively harmful: the scheme test below would treat it as relative, and
  // reassembling from pathname/search would drop the `data:` scheme and glue
  // `?_t=` into the base64 payload, rendering a broken <img>.
  if (imageUrl.startsWith('data:')) return imageUrl;
  const isAbsolute = /^https?:\/\//i.test(imageUrl);
  const url = new URL(imageUrl, isAbsolute ? undefined : RELATIVE_URL_BASE);
  url.searchParams.set('_t', String(at));
  return isAbsolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}

@Injectable({ providedIn: 'root' })
export class RecipeStateService {
  readonly currentRecipe = signal<Recipe | null>(null);
  readonly generatedImageUrl = signal<string | null>(null);
  readonly isSaved = signal(false);

  /**
   * KAN-243: recipe IDs with in-flight image generation.
   *
   * Tracked at the service level (root-scoped singleton) so the loading
   * state survives component destruction during SPA navigation. Before
   * this, `isImageLoading` was a per-component-instance signal — navigating
   * away from the generator destroyed the signal while the detached async
   * kept running, so recipe-detail showed neither image nor spinner.
   */
  private readonly _pendingImageIds = signal(new Set<string>());

  /** Whether the currently viewed recipe has an in-flight image generation. */
  readonly isImageGenerating = computed(() => {
    const recipe = this.currentRecipe();
    return recipe ? this._pendingImageIds().has(recipe.id) : false;
  });

  /**
   * Register an in-flight image generation. The promise's settlement
   * (resolve or reject) automatically clears the pending state.
   */
  trackImageGeneration(recipeId: string, completion: Promise<string>): void {
    this._pendingImageIds.update((ids) => new Set(ids).add(recipeId));
    const clear = () => {
      this._pendingImageIds.update((ids) => {
        const next = new Set(ids);
        next.delete(recipeId);
        return next;
      });
    };
    completion.then(clear, clear);
  }

  /**
   * KAN-243: epoch ms of the last successful image regeneration, per recipe id.
   *
   * The `_t` cache-buster is a *display* concern, so it lives here rather than
   * on the recipe. #3420's follow-up (61f8e6e) wrote the busted URL into
   * `savedRecipes` — the only way the marker then survived nav-away — but that
   * put a client-only value into persisted state, and `saveNotes` POSTs the
   * whole recipe, so it was written back as the canonical `ai_image_url`.
   *
   * Keying the timestamp by recipe id keeps `ai_image_url` canonical
   * everywhere while the buster still survives SPA navigation, because this
   * service is a root-scoped singleton and outlives the components.
   */
  private readonly _imageRegeneratedAt = signal<Record<string, number>>({});

  /** Record that a recipe's image was just regenerated. */
  markImageRegenerated(recipeId: string, at: number = Date.now()): void {
    this._imageRegeneratedAt.update((seen) => ({ ...seen, [recipeId]: at }));
  }

  /**
   * The URL to render for a recipe's image: the canonical URL, plus a `_t`
   * marker only when this session has regenerated that recipe's image (without
   * it the browser re-serves the pre-regen bytes). Never persist this value.
   */
  imageDisplayUrl(recipeId: string, canonicalUrl: string | null | undefined): string | null {
    if (!canonicalUrl) return null;
    const at = this._imageRegeneratedAt()[recipeId];
    return at ? withCacheBuster(canonicalUrl, at) : canonicalUrl;
  }

  // saved=false is the cold deep-link path (GH #3210): the recipe came from
  // the API, not the user's cookbook, so the Save button must stay live.
  viewRecipe(r: Recipe, saved = true) {
    this.currentRecipe.set(r);
    this.generatedImageUrl.set(this.imageDisplayUrl(r.id, r.ai_image_url));
    this.isSaved.set(saved);
  }

  clearRecipe() {
    this.currentRecipe.set(null);
    this.generatedImageUrl.set(null);
    this.isSaved.set(false);
  }
}
