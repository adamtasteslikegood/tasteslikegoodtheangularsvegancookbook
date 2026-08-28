import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { RecipeViewBase } from '../shared/recipe-view.base';
import { recipeFromRow, type RecipeRow } from '../../utils/recipe-row';

/**
 * What the route is showing right now (KAN-257).
 *
 *   loading            first read of the row
 *   pending            the row exists, the recipe TEXT is still generating
 *   ready              render the recipe
 *   generation-failed  the row's status is `error` — generation gave up
 *   not-found          the API says this recipe does not exist
 *   load-error         the API was unreachable or 5xx'd — RETRYABLE
 */
export type RecipeLoadState =
  'loading' | 'pending' | 'ready' | 'generation-failed' | 'not-found' | 'load-error';

/**
 * Row statuses where the recipe text is not renderable yet. `generating_image`
 * is deliberately absent: the text is complete by then, only the photo is
 * outstanding, and the page shows the recipe with a spinner over the image.
 * Mirrors Backend `db_recipe_repository._ACTIVE_RECIPE_STATUSES` minus that one.
 */
const TEXT_PENDING_STATUSES = new Set(['generating', 'processing']);

/** Matches the poll cadence and ceiling GeminiService already uses. */
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

@Component({
  selector: 'app-recipe-detail',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './recipe-detail.component.html',
})
export class RecipeDetailComponent extends RecipeViewBase {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /**
   * KAN-257 — this route no longer navigates away when a load goes wrong.
   *
   * It used to `router.navigate(['/kitchen'], { replaceUrl: true })` on every
   * non-200, which cost three things at once:
   *
   *  - `replaceUrl` overwrites the `/recipe/:id` history entry, so Back landed
   *    on whatever preceded it. From /kitchen that reads as "Back does
   *    nothing"; from an external deep link it leaves the app entirely.
   *  - A transient failure (offline tab resume, a 502, an auth blip) threw the
   *    URL away, so there was nothing left to retry — the user had to find the
   *    recipe again.
   *  - Simply dropping `replaceUrl` does NOT fix it: history becomes
   *    [/kitchen, /recipe/bad, /kitchen] and Back re-enters the bad route,
   *    re-fails, and redirects again. Back "works" and bounces forever.
   *
   * So the route keeps the URL and renders the outcome in place. Every failure
   * state is reachable, nameable, and (where it makes sense) retryable, and
   * Back always means what the user pressed it for.
   */
  readonly loadState = signal<RecipeLoadState>('loading');

  /** The template's existing full-page spinner gate. */
  readonly isLoading = computed(() => this.loadState() === 'loading');
  readonly isPending = computed(() => this.loadState() === 'pending');
  readonly isNotFound = computed(() => this.loadState() === 'not-found');
  readonly isLoadError = computed(() => this.loadState() === 'load-error');
  readonly isGenerationFailed = computed(() => this.loadState() === 'generation-failed');

  /**
   * Bumped on every new load and on destroy. Every await in the load/poll path
   * re-checks it, so a superseded route change (or a destroyed component)
   * cannot write state for a recipe the user has already left.
   */
  private requestSeq = 0;
  private currentId: string | null = null;

  constructor() {
    super();
    inject(DestroyRef).onDestroy(() => {
      this.requestSeq++;
    });

    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (!id) return;
      this.currentId = id;
      if (this.recipe()?.id === id && this.loadState() === 'ready') return;
      void this.load(id);
    });
  }

  /** The Retry affordance on the load-error state. */
  retryLoad() {
    if (this.currentId) void this.load(this.currentId);
  }

  goBack() {
    this.router.navigate(['/kitchen']);
  }

  private async load(id: string) {
    const seq = ++this.requestSeq;

    // Fast path: it is already in the cookbook, so render it now rather than
    // making the user wait on the startup auth check.
    if (this.adoptSaved(id)) return;

    this.loadState.set('loading');

    // KAN-257: the Flask row is scoped to the session's user / guest id, so a
    // read issued before the startup auth check resolves can come back 404 for
    // a recipe the user genuinely owns. That false 404 is what used to bounce
    // a cold deep link to /kitchen. Waiting here makes a miss mean "missing".
    try {
      await this.authService.ready;
    } catch {
      // A failed session init is not proof the recipe is gone — fall through
      // and let the API answer.
    }
    if (seq !== this.requestSeq) return;

    // The auth check may have hydrated the cookbook while we waited.
    if (this.adoptSaved(id)) return;

    await this.pollUntilRenderable(id, seq);
  }

  private adoptSaved(id: string): boolean {
    const saved = this.authService.currentUser()?.savedRecipes.find((r) => r.id === id);
    if (!saved) return false;
    this.recipeState.viewRecipe(saved);
    this.loadState.set('ready');
    return true;
  }

  /**
   * Read the row, and keep reading while the recipe text is still being
   * generated.
   *
   *   GET /api/recipes/:id
   *        │
   *        ├─ 404 ─────────────────> not-found      (keep the URL, offer Kitchen)
   *        ├─ 5xx / throw ─────────> load-error     (keep the URL, offer Retry)
   *        └─ 200
   *             ├─ status=error ───> generation-failed
   *             ├─ status in
   *             │  {generating,
   *             │   processing} ──> pending, wait 2s, read again (≤5 min)
   *             └─ otherwise ─────> ready
   *                                   └─ status=generating_image:
   *                                      join the in-flight image request so
   *                                      the photo slot shows a spinner
   */
  private async pollUntilRenderable(id: string, seq: number) {
    const startedAt = Date.now();

    for (;;) {
      let row: (RecipeRow & { status?: string }) | null;
      try {
        const resp = await fetch(`/api/recipes/${encodeURIComponent(id)}`, {
          credentials: 'include',
        });
        if (seq !== this.requestSeq) return;

        if (resp.status === 404) {
          this.loadState.set('not-found');
          return;
        }
        if (!resp.ok) {
          // 5xx, 401, a proxy hiccup: the URL is still meaningful, so keep the
          // route and let the user retry instead of discarding it (KAN-257).
          this.loadState.set('load-error');
          return;
        }
        row = await resp.json();
      } catch {
        if (seq !== this.requestSeq) return;
        this.loadState.set('load-error');
        return;
      }
      if (seq !== this.requestSeq) return;

      const status = typeof row?.status === 'string' ? row.status : 'ready';

      if (status === 'error') {
        this.loadState.set('generation-failed');
        return;
      }

      if (TEXT_PENDING_STATUSES.has(status)) {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          // Treat a stalled worker as retryable rather than as a missing
          // recipe: the row exists, it just never finished.
          this.loadState.set('load-error');
          return;
        }
        this.loadState.set('pending');
        await delay(POLL_INTERVAL_MS);
        if (seq !== this.requestSeq) return;
        continue;
      }

      // A 200 carrying a literal `null` body parses cleanly — only an empty
      // body throws into the catch above — so `row` can still be null here.
      // Treat it as a load failure rather than casting the null away: this is
      // the same "keep the route, let the user retry" path as !resp.ok, which
      // is the whole point of KAN-257.
      if (!row) {
        this.loadState.set('load-error');
        return;
      }

      // GET /api/recipes/:id returns the row shape, not the Recipe blob —
      // rendering it raw left ingredients/instructions undefined and blanked
      // the page on refresh (#3263). Same column-over-blob merge as
      // PersistenceService.loadFromApi.
      const recipe = recipeFromRow(row);
      // Not in the user's cookbook (cold deep link) — keep Save enabled (#3210).
      this.recipeState.viewRecipe(recipe, false);
      this.loadState.set('ready');

      if (status === 'generating_image') this.joinPendingImage(id);
      return;
    }
  }

  /**
   * KAN-257 — show a spinner for an image this session did not start.
   *
   * KAN-243 tracks in-flight image generation on RecipeStateService, but only
   * for requests THIS session issued. Arriving on a `generating_image` row from
   * a deep link, a refresh, or another tab means nothing is tracking it, so the
   * page rendered the "no image" placeholder while the worker was still busy.
   *
   * `force_regenerate: false` makes this a join, not a second request: the
   * Backend recovers the existing owner-scoped image request rather than
   * queueing another (`db_recipe_repository.queue_image_generation`), returns
   * 202, and the service polls until the URL appears.
   */
  private joinPendingImage(recipeId: string) {
    const pending = this.geminiService.generateImage(recipeId, false);
    this.recipeState.trackImageGeneration(recipeId, pending);
    pending
      .then((imageUrl) => {
        if (this.recipe()?.id !== recipeId) return;
        this.generatedImageUrl.set(this.recipeState.imageDisplayUrl(recipeId, imageUrl));
        this.recipe.update((r) => (r ? { ...r, ai_image_url: imageUrl } : null));
      })
      .catch(() => {
        // The placeholder is the fallback and the spinner clears either way.
        // No toast: the user did not ask for this image, they just opened a
        // page while someone else's request was mid-flight.
      });
  }
}
