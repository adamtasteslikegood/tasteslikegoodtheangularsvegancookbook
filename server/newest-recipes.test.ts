import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  NEWEST_RECIPES_HEADING,
  NEWEST_RECIPES_LIMIT,
  SLUG_RE,
  createFailureLogGate,
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

describe('createFailureLogGate', () => {
  it('allows one warning per interval and allows another after the interval', () => {
    let clock = 0;
    const shouldLog = createFailureLogGate(60_000, () => clock);

    expect(shouldLog()).toBe(true);
    expect(shouldLog()).toBe(false);
    clock = 59_999;
    expect(shouldLog()).toBe(false);
    clock = 60_000;
    expect(shouldLog()).toBe(true);
  });
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
        { slug: 'too-long', name: 'x'.repeat(201) },
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

describe('the SPA copy of the parsing rules', () => {
  // src/ cannot import from server/, so the landing page's fallback fetch
  // keeps its own slug pattern, row limit and length caps. This fails when
  // one side changes without the other.
  const spa = repoFile('src/components/generator/newest-recipes.ts');

  it('uses the same slug pattern and row limit as the server', () => {
    expect(spa).toContain(`const SLUG_RE = ${String(SLUG_RE)};`);
    expect(spa).toContain(`const NEWEST_RECIPES_LIMIT = ${NEWEST_RECIPES_LIMIT};`);
  });

  it('uses the same 200-character caps on slug and name', () => {
    const server = repoFile('server/newest-recipes.ts');
    for (const source of [spa, server]) {
      expect(source).toContain('slug.length > 200');
      expect(source).toMatch(/\.length > 200\) continue;/);
    }
  });
});

describe('createNewestRecipesSource', () => {
  const TTL = 1_000;
  const RETRY = 100;
  const setup = (fetchImpl: typeof fetch) => {
    let clock = 0;
    const source = createNewestRecipesSource({
      flaskUrl: 'http://flask.test',
      ttlMs: TTL,
      retryMs: RETRY,
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

  it('drops the list when Flask fails, then retries behind requests without holding them up', async () => {
    let releaseRetry: (response: Response) => void = () => undefined;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(list('old')))
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            releaseRetry = resolve;
          })
      );
    const { source, advance } = setup(fetchImpl as unknown as typeof fetch);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    try {
      await source.get();
      advance(2 * TTL);
      // A good list aged out: this one request waits, and the fetch fails.
      expect(await source.get()).toEqual([]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalled();

      // Inside the retry interval: no new attempt.
      advance(RETRY - 1);
      expect(await source.get()).toEqual([]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);

      // Past it: one attempt per interval, started behind the request.
      advance(1);
      expect(await source.get()).toEqual([]);
      await settle();
      expect(fetchImpl).toHaveBeenCalledTimes(3);

      // The next attempt hangs; the request is answered without it.
      advance(RETRY);
      expect(await source.get()).toEqual([]);
      await settle();
      expect(fetchImpl).toHaveBeenCalledTimes(4);
      expect(await source.get()).toEqual([]);
      releaseRetry(jsonResponse(list('back')));
      await settle();
      expect((await source.get()).map((r) => r.slug)).toEqual(['back']);
      expect(fetchImpl).toHaveBeenCalledTimes(4);
    } finally {
      warn.mockRestore();
    }
  });

  it('after a failed startup fetch, serves the shell at once and recovers on the retry', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('cold backend'))
      .mockResolvedValueOnce(jsonResponse(list('a')));
    const { source, advance } = setup(fetchImpl as unknown as typeof fetch);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await source.refresh(); // what the server does before it listens
      expect(await source.get()).toEqual([]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      advance(RETRY);
      expect(await source.get()).toEqual([]);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect((await source.get()).map((r) => r.slug)).toEqual(['a']);
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

  it('bounds the whole refresh when the service credential stalls', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => jsonResponse(list('a')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const source = createNewestRecipesSource({
        flaskUrl: 'https://flask.test',
        timeoutMs: 50,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        authHeader: () => new Promise<string | null>(() => undefined),
      });
      const settled = vi.fn();
      void source.get().then(settled);

      await vi.advanceTimersByTimeAsync(50);

      expect(settled).toHaveBeenCalledWith([]);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});
