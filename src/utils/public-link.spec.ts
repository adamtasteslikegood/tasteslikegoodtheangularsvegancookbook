import { describe, it, expect } from 'vitest';
import { isPublicViewable, publicSlugOf } from './public-link';

// KAN-119: the View link to /r/<slug> must not depend on auth state — a
// published recipe's public page is viewable by anyone, so the link renders
// from recipe data alone (guests and in-app-webview visitors included).
//
// Follow-up (adversarial review of #3195): guest-saved copies carry only
// sourceSlug (public-recipe.mapper.ts) — the link must resolve through it,
// or the fix never fires for actual guests.
describe('publicSlugOf', () => {
  it("resolves the recipe's own slug when it is published", () => {
    expect(publicSlugOf({ is_public: true, slug: 'vegan-cornbread' })).toBe('vegan-cornbread');
  });

  it('prefers the own published slug over sourceSlug', () => {
    expect(publicSlugOf({ is_public: true, slug: 'my-remix', sourceSlug: 'vegan-cornbread' })).toBe(
      'my-remix'
    );
  });

  it('falls back to sourceSlug for copies saved from a public page (guest case)', () => {
    // Exactly what buildSavedRecipeFromPublic produces: no is_public, no slug.
    expect(publicSlugOf({ sourceSlug: 'vegan-cornbread' })).toBe('vegan-cornbread');
    expect(publicSlugOf({ is_public: false, sourceSlug: 'vegan-cornbread' })).toBe(
      'vegan-cornbread'
    );
  });

  it('is null when there is no public page to link to', () => {
    expect(publicSlugOf({})).toBeNull();
    expect(publicSlugOf({ is_public: false, slug: 'draft' })).toBeNull();
    expect(publicSlugOf({ is_public: true })).toBeNull();
    expect(publicSlugOf({ is_public: true, slug: '' })).toBeNull();
    expect(publicSlugOf({ sourceSlug: '' })).toBeNull();
  });
});

describe('isPublicViewable', () => {
  it('is true for a published recipe with a slug', () => {
    expect(isPublicViewable({ is_public: true, slug: 'vegan-cornbread' })).toBe(true);
  });

  it('is true for a guest-saved copy carrying only sourceSlug', () => {
    expect(isPublicViewable({ sourceSlug: 'vegan-cornbread' })).toBe(true);
  });

  it('takes no auth input at all — visibility is a pure function of the recipe', () => {
    // Regression guard for KAN-119: the old template condition was
    // canPublish() && is_public, which hid the link from guests/webview users.
    expect(isPublicViewable.length).toBe(1);
  });

  it('is false when the recipe has no public page', () => {
    expect(isPublicViewable({ is_public: false, slug: 'vegan-cornbread' })).toBe(false);
    expect(isPublicViewable({ is_public: true })).toBe(false);
    expect(isPublicViewable({})).toBe(false);
  });
});
