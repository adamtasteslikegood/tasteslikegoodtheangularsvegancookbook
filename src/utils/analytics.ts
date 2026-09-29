/**
 * Custom RUM actions from the SPA (KAN-292 / RCP-101).
 *
 * A thin facade over `window.tlgAnalytics`, which public/rum/consent.js
 * defines. That script owns consent and notifies this facade when an opt-in
 * happens while a recipe is already visible. The Datadog SDK is never
 * imported into the Angular bundle. Plain functions rather than an injectable:
 * call sites include services that tests construct with `new`.
 *
 * The two actions are the S11 readout numerators:
 *   recipe_view   — a recipe rendered in the SPA (the SSR /r/<slug> view is
 *                   raised by consent.js itself, with surface 'ssr')
 *   recipe_saved  — a recipe kept in the Kitchen, and where it came from
 */
export type RecipeSaveSource = 'public_page' | 'generated' | 'generator_save';
export type RecipeSaveOutcome = 'saved' | 'saved_offline' | 'already_saved';

interface TlgAnalytics {
  action(name: string, context?: Record<string, unknown>): void;
  consent?(): string | null;
  onConsentGranted?(listener: () => void): () => void;
}

interface PendingRecipeView {
  id: string;
  context: Record<string, unknown>;
}

function analyticsGlobal(): TlgAnalytics | undefined {
  const candidate = (globalThis as { tlgAnalytics?: unknown }).tlgAnalytics;
  if (candidate && typeof (candidate as TlgAnalytics).action === 'function') {
    return candidate as TlgAnalytics;
  }
  return undefined;
}

function send(name: string, context: Record<string, unknown>, analytics = analyticsGlobal()): void {
  try {
    analytics?.action(name, context);
  } catch {
    // Analytics must never break the app.
  }
}

let lastViewedId: string | null = null;
let pendingRecipeView: PendingRecipeView | null = null;
let stopConsentListener: (() => void) | null = null;

function stopWaitingForConsent(): void {
  const stop = stopConsentListener;
  stopConsentListener = null;
  try {
    stop?.();
  } catch {
    // Analytics listener cleanup must never break the app.
  }
}

function waitForConsent(analytics: TlgAnalytics): void {
  if (stopConsentListener || !analytics.onConsentGranted) return;
  try {
    stopConsentListener = analytics.onConsentGranted(() => {
      stopWaitingForConsent();
      const pending = pendingRecipeView;
      pendingRecipeView = null;
      if (!pending) return;
      lastViewedId = pending.id;
      send('recipe_view', pending.context, analytics);
    });
  } catch {
    // A broken consent hook must never break recipe rendering.
  }
}

export function trackRecipeView(
  recipe: { id: string; slug?: string | null; sourceSlug?: string | null },
  saved: boolean
): void {
  // A copy saved from a public page carries that page's slug in sourceSlug
  // (public-recipe.mapper.ts), not slug. Fall back to it so the SPA view joins
  // the SSR view and save actions of the same public recipe.
  const context = { surface: 'spa', saved, slug: recipe.slug ?? recipe.sourceSlug ?? null };
  const analytics = analyticsGlobal();

  // A recipe can render before the visitor decides. Keep only the latest
  // visible recipe in page memory and replay it once on the first grant. Do
  // not commit the deduplication boundary until the action can be accepted.
  if (!analytics || (analytics.consent && analytics.consent() !== 'granted')) {
    pendingRecipeView = { id: recipe.id, context };
    if (analytics) waitForConsent(analytics);
    return;
  }

  pendingRecipeView = null;
  stopWaitingForConsent();

  // The same recipe can be re-selected on a re-render; one view per distinct
  // recipe in a row is what the view -> save funnel should count.
  if (recipe.id === lastViewedId) return;
  lastViewedId = recipe.id;
  send('recipe_view', context, analytics);
}

/** The persistence outcome fields the recipes-kept numerator depends on. */
export interface SaveOutcomeLike {
  ok: boolean;
  refusal?: string;
  alreadySaved?: boolean;
  noSession?: boolean;
}

/**
 * Map a detailed persistence outcome to the recipe_saved outcome, or null
 * when no recipe was kept (KAN-292, recipes-kept numerator):
 *   alreadySaved          -> already_saved  (a no-op, not a new keep)
 *   ok                    -> saved
 *   refusal 'sync'        -> saved_offline  (kept locally; sync will retry)
 *   any other refusal     -> null           (ownership/duplicate: a retry
 *                                            will not fix it, nothing kept)
 */
export function saveOutcomeForAnalytics(outcome: SaveOutcomeLike): RecipeSaveOutcome | null {
  // No session: nothing was saved anywhere, whatever `ok` says.
  if (outcome.noSession) return null;
  if (outcome.alreadySaved) return 'already_saved';
  if (outcome.ok) return 'saved';
  if (outcome.refusal === undefined || outcome.refusal === 'sync') return 'saved_offline';
  return null;
}

/** trackRecipeSaved from a detailed outcome; sends nothing for real refusals. */
export function trackRecipeSaveOutcome(
  source: RecipeSaveSource,
  outcome: SaveOutcomeLike,
  slug?: string | null
): void {
  const mapped = saveOutcomeForAnalytics(outcome);
  if (mapped) trackRecipeSaved(source, mapped, slug);
}

export function trackRecipeSaved(
  source: RecipeSaveSource,
  outcome: RecipeSaveOutcome,
  slug?: string | null
): void {
  send('recipe_saved', { surface: 'spa', source, outcome, slug: slug ?? null });
}

/** Forget the current view boundary and any pre-consent replay after leaving recipe state. */
export function resetRecipeViewTracking(): void {
  lastViewedId = null;
  pendingRecipeView = null;
  stopWaitingForConsent();
}

/** Test-only: reset module state between cases. */
export function resetAnalyticsForTest(): void {
  resetRecipeViewTracking();
}
