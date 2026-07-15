import { afterEach, describe, expect, it, vi } from 'vitest';

import { GeminiService } from './gemini.service';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

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
          recipe: { ai_image_url: '/api/recipes/recipe-1/image' },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'ready',
          recipe: {
            ai_image_url: '/api/recipes/recipe-1/image',
            ai_metadata: { image_generation: { success: true } },
          },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = new GeminiService().generateImage('recipe-1', true);
    let settled = false;
    void result.finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toBe('/api/recipes/recipe-1/image');
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
            ai_image_url: '/api/recipes/recipe-1/image',
            ai_metadata: { image_generation: { success: false } },
          },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = new GeminiService().generateImage('recipe-1', true);
    const rejection = expect(result).rejects.toThrow(
      'Image generation failed during async processing'
    );

    await vi.advanceTimersByTimeAsync(2000);
    await rejection;
  });
});
