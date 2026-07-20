import { describe, it, expect } from 'vitest';
import { isPublicViewable } from './public-link';

// KAN-119: the View link to /r/<slug> must not depend on auth state — a
// published recipe's public page is viewable by anyone, so the link renders
// from recipe data alone (guests and in-app-webview visitors included).
describe('isPublicViewable', () => {
  it('is true for a published recipe with a slug', () => {
    expect(isPublicViewable({ is_public: true, slug: 'vegan-cornbread' })).toBe(true);
  });

  it('takes no auth input at all — visibility is a pure function of the recipe', () => {
    // Regression guard for KAN-119: the old template condition was
    // canPublish() && is_public, which hid the link from guests/webview users.
    expect(isPublicViewable.length).toBe(1);
  });

  it('is false when the recipe is not public', () => {
    expect(isPublicViewable({ is_public: false, slug: 'vegan-cornbread' })).toBe(false);
    expect(isPublicViewable({ slug: 'vegan-cornbread' })).toBe(false);
  });

  it('is false without a slug — never renders href="/r/undefined"', () => {
    expect(isPublicViewable({ is_public: true })).toBe(false);
    expect(isPublicViewable({ is_public: true, slug: '' })).toBe(false);
  });
});
