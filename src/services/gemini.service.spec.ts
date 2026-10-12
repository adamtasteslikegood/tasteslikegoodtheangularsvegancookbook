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

// KAN-379 / KAN-380: the wait for the text. The worker finishes the recipe
// whether or not the browser can reach the status endpoint, so the wait must
// outlast a bad request and must not outlast a dead generation.
describe('GeminiService.generateRecipe wait', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const ready = () => jsonResponse({ status: 'ready', recipe: { id: RECIPE_ID, name: 'Stew' } });
  const queued = () => jsonResponse({ recipe_id: RECIPE_ID, status: 'generating' }, 202);

  it('keeps waiting through a network error, a 502 and a 429 (KAN-379)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(queued())
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ error: 'bad gateway' }, 502))
      .mockResolvedValueOnce(jsonResponse({ error: 'slow down' }, 429))
      .mockResolvedValueOnce(ready());
    vi.stubGlobal('fetch', fetchMock);

    const result = new GeminiService().generateRecipe('a hearty winter stew');
    await vi.advanceTimersByTimeAsync(8000);

    await expect(result).resolves.toMatchObject({ id: RECIPE_ID });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('gives up after five failed status requests in a row (KAN-379)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(queued());
    vi.stubGlobal('fetch', fetchMock);

    const result = new GeminiService().generateRecipe('a hearty winter stew');
    const rejection = expect(result).rejects.toThrow('Failed to get recipe status');
    await vi.advanceTimersByTimeAsync(10000);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('counts failures in a row only: a good answer resets the run (KAN-379)', async () => {
    vi.useFakeTimers();
    const cooking = () => jsonResponse({ status: 'processing', recipe: { id: RECIPE_ID } });
    const fetchMock = vi.fn().mockResolvedValueOnce(queued());
    for (let round = 0; round < 3; round++) {
      for (let miss = 0; miss < 4; miss++) fetchMock.mockRejectedValueOnce(new TypeError('x'));
      fetchMock.mockResolvedValueOnce(cooking());
    }
    fetchMock.mockResolvedValueOnce(ready());
    vi.stubGlobal('fetch', fetchMock);

    const result = new GeminiService().generateRecipe('a hearty winter stew');
    await vi.advanceTimersByTimeAsync(32000);

    await expect(result).resolves.toMatchObject({ id: RECIPE_ID });
  });

  it('stops at once when the recipe is gone (404), without retrying', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(queued())
      .mockResolvedValue(jsonResponse({ error: 'Recipe not found' }, 404));
    vi.stubGlobal('fetch', fetchMock);

    const result = new GeminiService().generateRecipe('a hearty winter stew');
    const rejection = expect(result).rejects.toThrow('Failed to get recipe status');
    await vi.advanceTimersByTimeAsync(2000);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects when the worker reports an error', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(queued())
      .mockResolvedValueOnce(jsonResponse({ status: 'error', recipe: { id: RECIPE_ID } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = new GeminiService().generateRecipe('a hearty winter stew');
    const rejection = expect(result).rejects.toThrow(
      'Recipe generation failed during async processing'
    );
    await vi.advanceTimersByTimeAsync(2000);
    await rejection;
  });

  it('gives up on a generation that never finishes (KAN-380)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockImplementation(async (url: string) =>
        url === '/api/generate'
          ? queued()
          : jsonResponse({ status: 'generating', recipe: { id: RECIPE_ID } })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = new GeminiService().generateRecipe('a hearty winter stew');
    let outcome: unknown = 'pending';
    void result.then(
      () => (outcome = 'resolved'),
      (error: Error) => (outcome = error.message)
    );

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    expect(outcome).toBe('pending');

    await vi.advanceTimersByTimeAsync(61 * 1000);
    expect(outcome).toBe('Recipe generation timed out after 5 minutes. Please try again.');
    const callsAtTimeout = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(callsAtTimeout);
  });

  it('asks one status request at a time, however slow the answer (KAN-380)', async () => {
    vi.useFakeTimers();
    let open = 0;
    let mostOpen = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/generate') return queued();
      open += 1;
      mostOpen = Math.max(mostOpen, open);
      await new Promise((resolve) => setTimeout(resolve, 7000));
      open -= 1;
      return fetchMock.mock.calls.length > 3
        ? ready()
        : jsonResponse({ status: 'generating', recipe: { id: RECIPE_ID } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = new GeminiService().generateRecipe('a hearty winter stew');
    await vi.advanceTimersByTimeAsync(40000);

    await expect(result).resolves.toMatchObject({ id: RECIPE_ID });
    expect(mostOpen).toBe(1);
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

  it('keeps waiting for the image through a failed status request (KAN-379)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'generating_image' }, 202))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'ready',
          recipe: { ai_image_url: `/api/recipes/${RECIPE_ID}/image` },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = new GeminiService().generateImage(RECIPE_ID);
    await vi.advanceTimersByTimeAsync(4000);

    await expect(result).resolves.toBe(`/api/recipes/${RECIPE_ID}/image`);
  });
});
