import { describe, it, expect } from 'vitest';
import { isPublicViewable, publicLinkKind, publicSlugOf } from './public-link';

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

// KAN-137: the public toggle must never read OFF while an undifferentiated
// View link is present. The link stays (guests need the sourceSlug fallback),
// but the UI must know WHICH public page it points at: the recipe's own
// published page ('own') or the original it was saved from ('source').
describe('publicLinkKind', () => {
  it("is 'own' for a published recipe with its own slug", () => {
    expect(publicLinkKind({ is_public: true, slug: 'vegan-cornbread' })).toBe('own');
  });

  it("is 'own' when both own slug and sourceSlug exist — own page wins", () => {
    expect(
      publicLinkKind({ is_public: true, slug: 'my-remix', sourceSlug: 'vegan-cornbread' })
    ).toBe('own');
  });

  it("is 'source' for a copy saved from a public page (no own publish state)", () => {
    expect(publicLinkKind({ sourceSlug: 'vegan-cornbread' })).toBe('source');
  });

  it("is 'source' after the copy is unpublished — own slug kept but toggle off", () => {
    // The unpublish leg of the KAN-137 cycle: is_public flips false, the row
    // keeps its slug, and the link must degrade to the differentiated
    // saved-from state instead of impersonating a live own page.
    expect(
      publicLinkKind({ is_public: false, slug: 'my-remix-2', sourceSlug: 'vegan-cornbread' })
    ).toBe('source');
  });

  it('is null when there is no public page at all', () => {
    expect(publicLinkKind({})).toBeNull();
    expect(publicLinkKind({ is_public: false, slug: 'draft' })).toBeNull();
    expect(publicLinkKind({ is_public: true })).toBeNull();
  });

  it('agrees with publicSlugOf/isPublicViewable on visibility', () => {
    const cases = [
      {},
      { is_public: true, slug: 'a' },
      { sourceSlug: 'b' },
      { is_public: false, slug: 'a', sourceSlug: 'b' },
    ];
    for (const r of cases) {
      expect(publicLinkKind(r) !== null).toBe(isPublicViewable(r));
    }
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
