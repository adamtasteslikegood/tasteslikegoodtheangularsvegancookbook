import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  NEWEST_RECIPES_HEADING,
  NEWEST_RECIPES_LIMIT,
  createNewestRecipesSource,
  hasNewestRecipesMarker,
  injectNewestRecipes,
  parseNewestRecipes,
  renderNewestRecipes,
} from './newest-recipes.js';

// KAN-348: the home page's newest-recipes row. Express writes it into the
// home shell from Flask's list; these pin what is safe to link, what the row
// looks like, and how long a list is served.

const repoFile = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8');

const SHELL =
  '<body><app-root><nav>hubs</nav><div id="tlg-newest-recipes"></div></app-root></body>';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const list = (...slugs: string[]) => ({
  recipes: slugs.map((slug) => ({ slug, name: `Name ${slug}`, first_published_at: 'x' })),
});

describe('parseNewestRecipes', () => {
  it('keeps slug and name, in order', () => {
    expect(parseNewestRecipes(list('a', 'b-2'))).toEqual([
      { slug: 'a', name: 'Name a' },
      { slug: 'b-2', name: 'Name b-2' },
    ]);
  });

  it('drops rows that are not safe to link instead of repairing them', () => {
    const payload = {
      recipes: [
        { slug: '../admin', name: 'Traversal' },
        { slug: 'Upper-Case', name: 'Not the public alphabet' },
        { slug: 'a"onmouseover="x', name: 'Attribute break' },
        { slug: 'no-name', name: '   ' },
        { slug: 7, name: 'Numeric slug' },
        null,
        'row',
        { slug: 'good-one', name: '  Good one  ' },
      ],
    };
    expect(parseNewestRecipes(payload)).toEqual([{ slug: 'good-one', name: 'Good one' }]);
  });

  it('answers an empty list for anything that is not the expected shape', () => {
    for (const payload of [null, undefined, 'text', [], {}, { recipes: 'nope' }]) {
      expect(parseNewestRecipes(payload)).toEqual([]);
    }
  });

  it('never returns more than the row holds', () => {
    const slugs = Array.from({ length: NEWEST_RECIPES_LIMIT + 5 }, (_, i) => `r-${i}`);
    expect(parseNewestRecipes(list(...slugs))).toHaveLength(NEWEST_RECIPES_LIMIT);
  });
});

describe('renderNewestRecipes / injectNewestRecipes', () => {
  it('renders a labelled nav of /r/<slug> links with escaped names', () => {
    const html = renderNewestRecipes([{ slug: 'mac', name: 'Mac & "Cheese" <b>' }]);
    expect(html).toContain('<nav aria-labelledby="landing-newest-title">');
    expect(html).toContain(`>${NEWEST_RECIPES_HEADING}</h2>`);
    expect(html).toContain('href="/r/mac"');
    expect(html).toContain('Mac &amp; &quot;Cheese&quot; &lt;b&gt;');
    expect(html).not.toContain('<b>');
  });

  it('writes the row over the marker and leaves the rest of the shell alone', () => {
    const out = injectNewestRecipes(SHELL, [{ slug: 'stew', name: 'Stew' }]);
    expect(out).not.toContain('tlg-newest-recipes');
    expect(out).toContain('<nav>hubs</nav><nav aria-labelledby="landing-newest-title">');
    expect(out.endsWith('</nav></app-root></body>')).toBe(true);
  });

  it('does not read "$" in a recipe name as a replacement pattern', () => {
    const out = injectNewestRecipes(SHELL, [{ slug: 'cheap', name: "$& $1 $' chili" }]);
    expect(out).toContain('$&amp; $1 $&#39; chili');
  });

  it('returns the shell untouched with no list, or with no marker', () => {
    expect(injectNewestRecipes(SHELL, [])).toBe(SHELL);
    const bare = '<body><app-root></app-root></body>';
    expect(injectNewestRecipes(bare, [{ slug: 'stew', name: 'Stew' }])).toBe(bare);
  });
});

describe('the marker', () => {
  it('is recognised however the build minifies it', () => {
    for (const marker of [
      '<div id="tlg-newest-recipes"></div>',
      "<div id='tlg-newest-recipes'></div>",
      '<div id=tlg-newest-recipes></div>',
      '<div class="x" id="tlg-newest-recipes">\n  </div>',
    ]) {
      expect(hasNewestRecipesMarker(`<app-root>${marker}</app-root>`)).toBe(true);
    }
    expect(hasNewestRecipesMarker('<div id="tlg-newest-recipes-2"></div>')).toBe(false);
    expect(hasNewestRecipesMarker('<!-- tlg-newest-recipes -->')).toBe(false);
  });

  it('is in the source index.html, inside <app-root>', () => {
    const html = repoFile('index.html');
    expect(hasNewestRecipesMarker(html)).toBe(true);
    const marker = html.indexOf('id="tlg-newest-recipes"');
    expect(html.indexOf('<app-root')).toBeLessThan(marker);
    expect(marker).toBeLessThan(html.indexOf('</app-root>'));
  });

  it('shares its heading with the Angular landing page', () => {
    expect(repoFile('src/components/generator/landing-copy.ts')).toContain(
      `LANDING_NEWEST_HEADING = '${NEWEST_RECIPES_HEADING}'`
    );
  });
});

describe('createNewestRecipesSource', () => {
  const TTL = 1_000;
  const setup = (fetchImpl: typeof fetch) => {
    let clock = 0;
    const source = createNewestRecipesSource({
      flaskUrl: 'http://flask.test',
      ttlMs: TTL,
      now: () => clock,
      fetchImpl,
      authHeader: async () => 'Bearer token',
    });
    return {
      source,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  };

  it('asks Flask once, with the service credential, and serves the list while it is fresh', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(list('a', 'b')));
    const { source, advance } = setup(fetchImpl as unknown as typeof fetch);

    expect((await source.get()).map((r) => r.slug)).toEqual(['a', 'b']);
    advance(TTL - 1);
    expect((await source.get()).map((r) => r.slug)).toEqual(['a', 'b']);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(
      `http://flask.test/api/public/newest-recipes?limit=${NEWEST_RECIPES_LIMIT}`
    );
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token');
  });

  it('serves the old list between one and two TTLs while a refresh runs behind it', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(list('old')))
      .mockResolvedValueOnce(jsonResponse(list('new')));
    const { source, advance } = setup(fetchImpl as unknown as typeof fetch);

    await source.get();
    advance(TTL + 1);
    expect((await source.get()).map((r) => r.slug)).toEqual(['old']);
    await source.refresh();
    expect((await source.get()).map((r) => r.slug)).toEqual(['new']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('never serves a list older than two TTLs: it waits for a new one', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(list('old')))
      .mockResolvedValueOnce(jsonResponse(list('new')));
    const { source, advance } = setup(fetchImpl as unknown as typeof fetch);

    await source.get();
    advance(2 * TTL);
    expect((await source.get()).map((r) => r.slug)).toEqual(['new']);
  });

  it('drops the list when Flask fails, and retries once per TTL, not per request', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(list('old')))
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
      .mockResolvedValueOnce(jsonResponse(list('back')));
    const { source, advance } = setup(fetchImpl as unknown as typeof fetch);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await source.get();
      advance(2 * TTL);
      expect(await source.get()).toEqual([]);
      expect(await source.get()).toEqual([]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);

      advance(2 * TTL);
      expect(await source.get()).toEqual([]);
      advance(2 * TTL);
      expect((await source.get()).map((r) => r.slug)).toEqual(['back']);
      expect(fetchImpl).toHaveBeenCalledTimes(4);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('joins concurrent first requests into one fetch', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(list('a')));
    const { source } = setup(fetchImpl as unknown as typeof fetch);
    const [first, second] = await Promise.all([source.get(), source.get()]);
    expect(first).toEqual(second);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
