import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import * as newestRecipes from './newest-recipes';

// KAN-348: Express writes the newest-recipes row into <app-root>; the landing
// page reads it back before Angular replaces <app-root>, and renders the same
// links.

const anchor = (href: string | null, text: string | null) => ({
  getAttribute: (name: string) => (name === 'href' ? href : null),
  textContent: text,
});

const docWith = (anchors: unknown[]) => {
  const selectors: string[] = [];
  return {
    selectors,
    doc: {
      querySelectorAll: (selector: string) => {
        selectors.push(selector);
        return anchors;
      },
    } as unknown as Pick<Document, 'querySelectorAll'>,
  };
};

describe('readNewestRecipes', () => {
  it('reads the links the server wrote, in order', () => {
    const { doc, selectors } = docWith([
      anchor('/r/chili', ' Smoky Bean Chili '),
      anchor('/r/mac', 'Mac & Cheeze'),
    ]);
    expect(newestRecipes.readNewestRecipes(doc)).toEqual([
      { href: '/r/chili', label: 'Smoky Bean Chili' },
      { href: '/r/mac', label: 'Mac & Cheeze' },
    ]);
    // Only recipe links inside the row Express writes (server/newest-recipes.ts).
    expect(selectors).toEqual(['nav[aria-labelledby="landing-newest-title"] a[href^="/r/"]']);
  });

  it('skips links with no href or no text, and answers [] when the row is absent', () => {
    expect(
      newestRecipes.readNewestRecipes(
        docWith([anchor(null, 'x'), anchor('/r/a', '  '), anchor('/r/a', null)]).doc
      )
    ).toEqual([]);
    expect(newestRecipes.readNewestRecipes(docWith([]).doc)).toEqual([]);
  });

  it('fetches a safe fallback after an SPA entry on a non-home shell', async () => {
    const module = newestRecipes as typeof newestRecipes & {
      fetchNewestRecipes?: (fetchImpl: typeof fetch) => Promise<unknown>;
      needsNewestRecipesFallback?: (
        initialPath: string,
        links: unknown[],
        now?: number,
        capturedAt?: number
      ) => boolean;
    };
    expect(module.fetchNewestRecipes).toBeTypeOf('function');
    expect(module.needsNewestRecipesFallback).toBeTypeOf('function');

    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            recipes: [
              { slug: 'smoky-chili', name: ' Smoky Chili ' },
              { slug: '../admin', name: 'Unsafe' },
              { slug: 'too-long', name: 'x'.repeat(201) },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    );
    await expect(module.fetchNewestRecipes!(fetchImpl as unknown as typeof fetch)).resolves.toEqual(
      [{ href: '/r/smoky-chili', label: 'Smoky Chili' }]
    );
    expect(fetchImpl).toHaveBeenCalledWith('/api/public/newest-recipes?limit=8', {
      headers: { accept: 'application/json' },
      signal: expect.any(AbortSignal),
    });

    expect(module.needsNewestRecipesFallback!('/kitchen', [])).toBe(true);
    expect(module.needsNewestRecipesFallback!('/', [])).toBe(false);
    expect(
      module.needsNewestRecipesFallback!('/kitchen', [
        { href: '/r/already-there', label: 'Already there' },
      ])
    ).toBe(false);
    expect(
      module.needsNewestRecipesFallback!(
        '/',
        [{ href: '/r/server-rendered', label: 'Server rendered' }],
        6 * 60_000 - 1,
        0
      )
    ).toBe(false);
    expect(
      module.needsNewestRecipesFallback!(
        '/',
        [{ href: '/r/server-rendered', label: 'Server rendered' }],
        6 * 60_000,
        0
      )
    ).toBe(true);
  });
});

describe('landing template', () => {
  const template = readFileSync(
    fileURLToPath(new URL('./generator.component.html', import.meta.url)),
    'utf8'
  );

  it('renders the row only when the server wrote one, under the same landmark id', () => {
    expect(template).toMatch(
      /@if \(landing\.newest\(\)\.length\) \{\s*<nav aria-labelledby="landing-newest-title">/
    );
    expect(template).toContain('{{ landing.newestHeading }}');
    expect(template).toMatch(/@for \(recipe of landing\.newest\(\); track recipe\.href\)/);
  });
});

describe('fetchNewestRecipes timeout', () => {
  it('gives up on a backend that never answers, and answers []', async () => {
    const { fetchNewestRecipes } = await import('./newest-recipes');
    let aborted = false;
    // Like the real fetch: pending until the signal aborts, then rejects.
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(init.signal?.reason);
        });
      })) as unknown as typeof fetch;

    await expect(fetchNewestRecipes(fetchImpl, 20)).resolves.toEqual([]);
    expect(aborted).toBe(true);
  });
});
