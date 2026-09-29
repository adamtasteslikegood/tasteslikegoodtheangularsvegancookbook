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
