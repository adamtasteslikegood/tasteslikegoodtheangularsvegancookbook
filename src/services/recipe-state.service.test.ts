import { describe, it, expect, beforeEach } from 'vitest';
import { RecipeStateService } from './recipe-state.service';
import type { Recipe } from '../recipe.types';

const recipe = (over: Partial<Recipe> = {}): Recipe =>
  ({
    id: 'r1',
    name: 'Vegan Cornbread',
    ingredients: { wet: [], dry: [], other: [] },
    instructions: [],
    prepTime: 5,
    cookTime: 20,
    servings: 8,
    description: '',
    tags: [],
    notes: '',
    ...over,
  }) as Recipe;

// GH #3210 / KAN-137: viewRecipe unconditionally set isSaved=true, so a
// recipe fetched via cold deep link (not in the user's cookbook) misreported
// as saved and disabled the Save button.
describe('RecipeStateService.viewRecipe', () => {
  let service: RecipeStateService;

  beforeEach(() => {
    // No deps — construct directly, same as recipe-detail.component.test.ts.
    service = new RecipeStateService();
  });

  it('marks the recipe saved by default (cookbook navigation path)', () => {
    service.viewRecipe(recipe());
    expect(service.isSaved()).toBe(true);
    expect(service.currentRecipe()?.id).toBe('r1');
  });

  it('leaves the recipe unsaved when told so (deep-link API fetch path)', () => {
    service.viewRecipe(recipe(), false);
    expect(service.isSaved()).toBe(false);
    expect(service.currentRecipe()?.id).toBe('r1');
  });

  it('clearRecipe resets the saved flag', () => {
    service.viewRecipe(recipe());
    service.clearRecipe();
    expect(service.isSaved()).toBe(false);
    expect(service.currentRecipe()).toBeNull();
  });
});

// KAN-243: image generation tracking survives component destruction.
describe('RecipeStateService.trackImageGeneration', () => {
  let service: RecipeStateService;

  beforeEach(() => {
    service = new RecipeStateService();
  });

  it('isImageGenerating is false when no recipe is viewed', () => {
    expect(service.isImageGenerating()).toBe(false);
  });

  it('isImageGenerating is false when viewed recipe has no pending generation', () => {
    service.viewRecipe(recipe());
    expect(service.isImageGenerating()).toBe(false);
  });

  it('isImageGenerating becomes true when tracking starts for the viewed recipe', () => {
    service.viewRecipe(recipe());
    const promise = new Promise<string>(() => {}); // never settles
    service.trackImageGeneration('r1', promise);
    expect(service.isImageGenerating()).toBe(true);
  });

  it('isImageGenerating is false for a different recipe than the pending one', () => {
    service.viewRecipe(recipe({ id: 'r2' }));
    const promise = new Promise<string>(() => {});
    service.trackImageGeneration('r1', promise);
    expect(service.isImageGenerating()).toBe(false);
  });

  it('isImageGenerating becomes true when navigating to a recipe with pending generation', () => {
    const promise = new Promise<string>(() => {});
    service.trackImageGeneration('r1', promise);
    // No recipe viewed yet — should be false.
    expect(service.isImageGenerating()).toBe(false);
    // Navigate to the recipe with pending generation.
    service.viewRecipe(recipe());
    expect(service.isImageGenerating()).toBe(true);
  });

  it('clears pending state when the promise resolves', async () => {
    service.viewRecipe(recipe());
    let resolve!: (v: string) => void;
    const promise = new Promise<string>((r) => {
      resolve = r;
    });
    service.trackImageGeneration('r1', promise);
    expect(service.isImageGenerating()).toBe(true);

    resolve('/api/recipes/r1/image');
    // Settlement callbacks are microtasks — flush them.
    await Promise.resolve();
    expect(service.isImageGenerating()).toBe(false);
  });

  it('clears pending state when the promise rejects', async () => {
    service.viewRecipe(recipe());
    let reject!: (e: Error) => void;
    const promise = new Promise<string>((_, r) => {
      reject = r;
    });
    service.trackImageGeneration('r1', promise);
    expect(service.isImageGenerating()).toBe(true);

    reject(new Error('timeout'));
    await Promise.resolve();
    expect(service.isImageGenerating()).toBe(false);
  });

  // Review finding on #3437: _pendingImageIds was a Set, so two overlapping
  // generations for one recipe collapsed — the first to settle cleared the id
  // and the spinner vanished while the second was still in flight.
  it('keeps reporting generation until the LAST concurrent one settles', async () => {
    service.viewRecipe(recipe());
    let resolveA!: (v: string) => void;
    let resolveB!: (v: string) => void;
    const a = new Promise<string>((r) => {
      resolveA = r;
    });
    const b = new Promise<string>((r) => {
      resolveB = r;
    });

    service.trackImageGeneration('r1', a);
    service.trackImageGeneration('r1', b);
    expect(service.isImageGenerating()).toBe(true);

    resolveA('/img-a');
    await Promise.resolve();
    // B is still in flight — the spinner must stay up.
    expect(service.isImageGenerating()).toBe(true);

    resolveB('/img-b');
    await Promise.resolve();
    expect(service.isImageGenerating()).toBe(false);
  });

  it('tracks multiple recipes independently', async () => {
    let resolveR1!: (v: string) => void;
    const p1 = new Promise<string>((r) => {
      resolveR1 = r;
    });
    const p2 = new Promise<string>(() => {}); // never settles

    service.trackImageGeneration('r1', p1);
    service.trackImageGeneration('r2', p2);

    service.viewRecipe(recipe({ id: 'r1' }));
    expect(service.isImageGenerating()).toBe(true);

    resolveR1('/img');
    await Promise.resolve();
    // r1 done, switch to r2 which is still pending.
    expect(service.isImageGenerating()).toBe(false);
    service.viewRecipe(recipe({ id: 'r2' }));
    expect(service.isImageGenerating()).toBe(true);
  });
});

// KAN-243 (review findings on #3433 / #3435): the `_t` cache-buster is a
// display-only value. It lives here, keyed by recipe id, so `ai_image_url`
// stays canonical in domain and persisted state while the marker still
// survives SPA navigation.
describe('RecipeStateService image cache-busting', () => {
  let service: RecipeStateService;

  beforeEach(() => {
    service = new RecipeStateService();
  });

  it('returns the canonical URL untouched when nothing was regenerated', () => {
    expect(service.imageDisplayUrl('r1', '/api/recipes/r1/image.jpg')).toBe(
      '/api/recipes/r1/image.jpg'
    );
  });

  it('applies a _t marker only to the recipe that was regenerated', () => {
    service.markImageRegenerated('r1', 1700000000000);

    expect(service.imageDisplayUrl('r1', '/api/recipes/r1/image.jpg')).toBe(
      '/api/recipes/r1/image.jpg?_t=1700000000000'
    );
    expect(service.imageDisplayUrl('r2', '/api/recipes/r2/image.jpg')).toBe(
      '/api/recipes/r2/image.jpg'
    );
  });

  it('replaces rather than stacks the marker on repeat regenerates', () => {
    service.markImageRegenerated('r1', 1);
    service.markImageRegenerated('r1', 2);

    const out = service.imageDisplayUrl('r1', '/api/recipes/r1/image.jpg') as string;
    expect(out).toBe('/api/recipes/r1/image.jpg?_t=2');
    expect(out.match(/_t=/g)).toHaveLength(1);
  });

  it('preserves existing query params and the fragment', () => {
    service.markImageRegenerated('r1', 5);
    expect(service.imageDisplayUrl('r1', '/img.jpg?w=200#top')).toBe('/img.jpg?w=200&_t=5#top');
  });

  it('handles absolute URLs without mangling the origin', () => {
    service.markImageRegenerated('r1', 5);
    expect(service.imageDisplayUrl('r1', 'https://cdn.test/img.jpg')).toBe(
      'https://cdn.test/img.jpg?_t=5'
    );
  });

  // The scheme test treats `data:` as relative, so reassembling from
  // pathname/search dropped the scheme and glued `?_t=` into the base64
  // payload — `data:image/png;base64,ABC` became `image/png;base64,ABC?_t=…`,
  // which renders as a broken <img>.
  it('leaves data: URIs completely untouched', () => {
    service.markImageRegenerated('r1', 123);
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    expect(service.imageDisplayUrl('r1', dataUri)).toBe(dataUri);
  });

  // Review findings on #3437: resolving relative URLs against a placeholder
  // base and reassembling from pathname/search/hash silently rewrote them.
  // Imported recipes (KitchenComponent.onImportFileSelected) carry arbitrary
  // ai_image_url values, so both forms below are reachable.
  it('preserves the host on protocol-relative URLs', () => {
    service.markImageRegenerated('r1', 99);
    expect(service.imageDisplayUrl('r1', '//cdn.example.com/img.jpg')).toBe(
      '//cdn.example.com/img.jpg?_t=99'
    );
  });

  it('keeps document-relative URLs document-relative', () => {
    service.markImageRegenerated('r1', 99);
    expect(service.imageDisplayUrl('r1', 'foo.jpg')).toBe('foo.jpg?_t=99');
    expect(service.imageDisplayUrl('r1', '../up/img.jpg')).toBe('../up/img.jpg?_t=99');
  });

  it('replaces an existing _t on a relative URL rather than stacking', () => {
    service.markImageRegenerated('r1', 7);
    expect(service.imageDisplayUrl('r1', '/img.jpg?_t=1&w=5')).toBe('/img.jpg?_t=7&w=5');
  });

  it('returns null for a missing image URL', () => {
    service.markImageRegenerated('r1', 1);
    expect(service.imageDisplayUrl('r1', null)).toBeNull();
    expect(service.imageDisplayUrl('r1', undefined)).toBeNull();
    expect(service.imageDisplayUrl('r1', '')).toBeNull();
  });

  it('viewRecipe seeds the display URL through the buster', () => {
    service.markImageRegenerated('r1', 77);
    service.viewRecipe(recipe({ ai_image_url: '/img.jpg' } as Partial<Recipe>));
    expect(service.generatedImageUrl()).toBe('/img.jpg?_t=77');
  });
});
