/**
 * Custom RUM actions from the SPA (KAN-292 / RCP-101).
 *
 * A thin facade over `window.tlgAnalytics`, which public/rum/consent.js
 * defines. That script owns consent: `action()` is a no-op until the visitor
 * has allowed analytics, so nothing here checks consent itself, and the
 * Datadog SDK is never imported into the Angular bundle. Plain functions
 * rather than an injectable: there is no state worth injecting, and the call
 * sites include services that tests construct with `new`.
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
}

function analyticsGlobal(): TlgAnalytics | undefined {
  const candidate = (globalThis as { tlgAnalytics?: unknown }).tlgAnalytics;
  if (candidate && typeof (candidate as TlgAnalytics).action === 'function') {
    return candidate as TlgAnalytics;
  }
  return undefined;
}

function send(name: string, context: Record<string, unknown>): void {
  try {
    analyticsGlobal()?.action(name, context);
  } catch {
    // Analytics must never break the app.
  }
}

let lastViewedId: string | null = null;

export function trackRecipeView(
  recipe: { id: string; slug?: string | null },
  saved: boolean
): void {
  // The same recipe can be re-selected on a re-render; one view per distinct
  // recipe in a row is what the view -> save funnel should count.
  if (recipe.id === lastViewedId) return;
  lastViewedId = recipe.id;
  send('recipe_view', { surface: 'spa', saved, slug: recipe.slug ?? null });
}

export function trackRecipeSaved(
  source: RecipeSaveSource,
  outcome: RecipeSaveOutcome,
  slug?: string | null
): void {
  send('recipe_saved', { surface: 'spa', source, outcome, slug: slug ?? null });
}

/** Test-only: forget the last viewed recipe. */
export function resetAnalyticsForTest(): void {
  lastViewedId = null;
}
