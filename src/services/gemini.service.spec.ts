import { afterEach, describe, expect, it, vi } from 'vitest';

import { GeminiService } from './gemini.service';
import { publishToggleKind } from '../utils/public-link';

// /api/generate_image validates recipe_id as a UUID at the Express
// boundary, so the mocked flows use a realistic id.
const RECIPE_ID = '3f9a2c4e-8b1d-4e6f-9a3c-5d7e2f8b4a1c';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GeminiService.generateRecipe', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // KAN-330: the SPA no longer labels a generated recipe. The label arrives
  // in the worker-written blob the status poll returns, and the poll must
  // hand that blob over whole — a narrower merge would leave a freshly
  // generated recipe looking unpublishable until some later save.
  it('returns the polled blob whole, so the server-written origin reaches the toggle', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ recipe_id: RECIPE_ID, status: 'generating' }, 202))
      .mockResolvedValueOnce(jsonResponse({ status: 'generating', recipe: { id: RECIPE_ID } }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'ready',
          recipe: {
            id: RECIPE_ID,
            name: 'Smoky Lentil Stew',
            origin: 'generated',
            is_public: false,
            ingredients: [],
            instructions: [],
          },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = new GeminiService().generateRecipe('a hearty winter stew');
    await vi.advanceTimersByTimeAsync(4000);

    const recipe = await result;
    expect(recipe.origin).toBe('generated');
    expect(publishToggleKind(recipe)).toBe('normal');
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/recipes/${RECIPE_ID}/status`);
  });
});

describe('GeminiService.generateImage', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits for ready before resolving an existing URL during regeneration', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'generating_image' }, 202))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'generating_image',
          recipe: { ai_image_url: `/api/recipes/${RECIPE_ID}/image` },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'ready',
          recipe: {
            ai_image_url: `/api/recipes/${RECIPE_ID}/image`,
            ai_metadata: { image_generation: { success: true } },
          },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = new GeminiService().generateImage(RECIPE_ID, true);
    let settled = false;
    void result.finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toBe(`/api/recipes/${RECIPE_ID}/image`);
  });

  it('rejects a completed failed regeneration even when an old URL remains', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'generating_image' }, 202))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'ready',
          recipe: {
            ai_image_url: `/api/recipes/${RECIPE_ID}/image`,
            ai_metadata: { image_generation: { success: false } },
          },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = new GeminiService().generateImage(RECIPE_ID, true);
    const rejection = expect(result).rejects.toThrow(
      'Image generation failed during async processing'
    );

    await vi.advanceTimersByTimeAsync(2000);
    await rejection;
  });
});
