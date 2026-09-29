import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAnalyticsForTest, trackRecipeSaved, trackRecipeView } from './analytics';

const g = globalThis as { tlgAnalytics?: unknown };

describe('SPA RUM custom actions (KAN-292)', () => {
  let action: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetAnalyticsForTest();
    action = vi.fn();
    g.tlgAnalytics = { action };
  });

  afterEach(() => {
    delete g.tlgAnalytics;
  });

  it('is a silent no-op when the consent loader is absent', () => {
    delete g.tlgAnalytics;
    expect(() => trackRecipeView({ id: 'a' }, true)).not.toThrow();
    expect(() => trackRecipeSaved('generated', 'saved')).not.toThrow();
  });

  it('never lets an analytics failure reach the app', () => {
    g.tlgAnalytics = {
      action: () => {
        throw new Error('boom');
      },
    };
    expect(() => trackRecipeSaved('public_page', 'saved', 'x')).not.toThrow();
  });

  it('sends recipe_view once per distinct recipe in a row', () => {
    trackRecipeView({ id: 'a', slug: 'vegan-cornbread' }, false);
    trackRecipeView({ id: 'a', slug: 'vegan-cornbread' }, false);
    trackRecipeView({ id: 'b' }, true);
    expect(action.mock.calls).toEqual([
      ['recipe_view', { surface: 'spa', saved: false, slug: 'vegan-cornbread' }],
      ['recipe_view', { surface: 'spa', saved: true, slug: null }],
    ]);
  });

  it('replays the latest visible recipe once when consent is granted', () => {
    let consent: string | null = null;
    let grant = () => {};
    const unsubscribe = vi.fn();
    g.tlgAnalytics = {
      action,
      consent: () => consent,
      onConsentGranted: (listener: () => void) => {
        grant = listener;
        return unsubscribe;
      },
    };

    trackRecipeView({ id: 'a', slug: 'first' }, false);
    trackRecipeView({ id: 'b', slug: 'visible' }, true);
    expect(action).not.toHaveBeenCalled();

    consent = 'granted';
    grant();

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(action.mock.calls).toEqual([
      ['recipe_view', { surface: 'spa', saved: true, slug: 'visible' }],
    ]);

    // The grant replay establishes the normal same-recipe deduplication boundary.
    trackRecipeView({ id: 'b', slug: 'visible' }, true);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('drops a pending consent replay after leaving recipe state', () => {
    let grant = () => {};
    g.tlgAnalytics = {
      action,
      consent: () => null,
      onConsentGranted: (listener: () => void) => {
        grant = listener;
        return vi.fn();
      },
    };

    trackRecipeView({ id: 'a' }, false);
    resetAnalyticsForTest();
    grant();

    expect(action).not.toHaveBeenCalled();
  });

  it('sends recipe_saved with source and outcome', () => {
    trackRecipeSaved('public_page', 'already_saved', 'vegan-cornbread');
    expect(action).toHaveBeenCalledWith('recipe_saved', {
      surface: 'spa',
      source: 'public_page',
      outcome: 'already_saved',
      slug: 'vegan-cornbread',
    });
  });
});
