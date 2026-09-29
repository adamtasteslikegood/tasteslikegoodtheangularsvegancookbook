/**
 * Consent gate for Datadog RUM (KAN-292 / RCP-101): "zero RUM requests before
 * consent", proven against the real public/rum/consent.js.
 *
 * The script is a classic browser script shared by the SPA and the SSR pages,
 * so it is executed here in a vm context with a minimal fake DOM (the repo has
 * no jsdom). Every network-shaped effect the script can have is observable:
 * `fetch` calls, and <script> elements appended to the document. The Datadog
 * SDK is modelled as a fake `DD_RUM` global that only appears when the SDK
 * <script> "loads", which is exactly how the real bundle behaves.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SOURCE = readFileSync(
  fileURLToPath(new URL('../public/rum/consent.js', import.meta.url)),
  'utf8'
);

const ENABLED = {
  enabled: true,
  applicationId: 'app-123',
  clientToken: 'pub-token',
  sessionSampleRate: 40,
  env: 'production',
  service: 'tasteslikegood-web',
  version: '9.9.9',
};

class FakeStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

class FaultyStorage extends FakeStorage {
  failReads = false;
  failWrites = false;
  failRemovals = false;

  override getItem(k: string) {
    if (this.failReads) throw new Error('storage read blocked');
    return super.getItem(k);
  }
  override setItem(k: string, v: string) {
    if (this.failWrites) throw new Error('storage write blocked');
    super.setItem(k, v);
  }
  override removeItem(k: string) {
    if (this.failRemovals) throw new Error('storage removal blocked');
    super.removeItem(k);
  }
}

interface FakeEl {
  tagName: string;
  attrs: Record<string, string>;
  children: FakeEl[];
  parentNode: FakeEl | null;
  style: { cssText: string };
  textContent: string;
  focused: boolean;
  src?: string;
  onload?: () => void;
  onerror?: () => void;
  listeners: Record<string, Array<(e: unknown) => void>>;
  setAttribute(k: string, v: string): void;
  appendChild(c: FakeEl | { text: string }): void;
  removeChild(c: FakeEl): void;
  addEventListener(t: string, fn: (e: unknown) => void): void;
  querySelector(sel: string): FakeEl | null;
  closest(sel: string): FakeEl | null;
  focus(): void;
  click(): void;
}

function makeEl(tagName: string): FakeEl {
  const el: FakeEl = {
    tagName: tagName.toUpperCase(),
    attrs: {},
    children: [],
    parentNode: null,
    style: { cssText: '' },
    textContent: '',
    focused: false,
    listeners: {},
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    appendChild(c) {
      if ('tagName' in c) {
        c.parentNode = this;
        this.children.push(c);
      }
    },
    removeChild(c) {
      this.children = this.children.filter((x) => x !== c);
      c.parentNode = null;
    },
    addEventListener(t, fn) {
      (this.listeners[t] ??= []).push(fn);
    },
    querySelector(sel) {
      const tag = sel.toUpperCase();
      const walk = (n: FakeEl): FakeEl | null => {
        for (const c of n.children) {
          if (c.tagName === tag) return c;
          const hit = walk(c);
          if (hit) return hit;
        }
        return null;
      };
      return walk(this);
    },
    closest(sel) {
      const attr = sel.replace(/^\[|\]$/g, '');
      const up = (n: FakeEl | null): FakeEl | null =>
        !n ? null : attr in n.attrs ? n : up(n.parentNode);
      return up(el);
    },
    focus() {
      this.focused = true;
    },
    click() {
      for (const fn of this.listeners.click ?? []) fn({ target: this });
    },
  };
  return el;
}

interface Harness {
  win: Record<string, unknown> & { tlgAnalytics: { action: (n: string, c?: unknown) => void } };
  head: FakeEl;
  body: FakeEl;
  localStorage: FakeStorage;
  sessionStorage: FakeStorage;
  fetchMock: ReturnType<typeof vi.fn>;
  rum: {
    init: ReturnType<typeof vi.fn>;
    addAction: ReturnType<typeof vi.fn>;
    setGlobalContextProperty: ReturnType<typeof vi.fn>;
    stopSession: ReturnType<typeof vi.fn>;
  };
  reload: ReturnType<typeof vi.fn>;
  docClick(target: FakeEl): void;
  sdkScripts(): FakeEl[];
  loadSdk(): void;
  banner(): FakeEl | undefined;
  buttonByLabel(label: string): FakeEl;
}

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

async function run(opts: {
  config?: unknown;
  consent?: string | null;
  path?: string;
  search?: string;
  referrer?: string;
  localStorage?: FakeStorage;
  sessionStorage?: FakeStorage;
  throwOnStorageAccess?: boolean;
}): Promise<Harness> {
  const head = makeEl('head');
  const body = makeEl('body');
  const localStorage = opts.localStorage ?? new FakeStorage();
  const sessionStorage = opts.sessionStorage ?? new FakeStorage();
  if (opts.consent) localStorage.setItem('tlg.analytics-consent', opts.consent);
  const docListeners: Array<(e: unknown) => void> = [];
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/rum/config') {
      return { ok: true, json: async () => opts.config ?? ENABLED };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  const rum = {
    init: vi.fn(),
    addAction: vi.fn(),
    setGlobalContextProperty: vi.fn(),
    stopSession: vi.fn(),
  };
  const reload = vi.fn();
  const win: Record<string, unknown> = {
    fetch: fetchMock,
    location: {
      pathname: opts.path ?? '/',
      search: opts.search ?? '',
      host: 'www.tasteslikegood.org',
      origin: 'https://www.tasteslikegood.org',
      reload,
    },
  };
  if (opts.throwOnStorageAccess) {
    Object.defineProperties(win, {
      localStorage: {
        get() {
          throw new Error('localStorage property blocked');
        },
      },
      sessionStorage: {
        get() {
          throw new Error('sessionStorage property blocked');
        },
      },
    });
  } else {
    win.localStorage = localStorage;
    win.sessionStorage = sessionStorage;
  }
  const document = {
    referrer: opts.referrer ?? '',
    head,
    body,
    createElement: (t: string) => makeEl(t),
    createTextNode: (text: string) => ({ text }),
    addEventListener: (t: string, fn: (e: unknown) => void) => {
      if (t === 'click') docListeners.push(fn);
    },
  };
  win.window = win;
  win.document = document;
  win.URL = URL;
  win.URLSearchParams = URLSearchParams;
  win.JSON = JSON;
  vm.runInNewContext(SOURCE, win);
  await settle();

  const h: Harness = {
    win: win as Harness['win'],
    head,
    body,
    localStorage,
    sessionStorage,
    fetchMock,
    rum,
    reload,
    docClick(target) {
      for (const fn of docListeners) fn({ target, preventDefault() {} });
    },
    sdkScripts: () => head.children.filter((c) => c.tagName === 'SCRIPT'),
    loadSdk() {
      win.DD_RUM = rum;
      for (const s of h.sdkScripts()) s.onload?.();
    },
    banner: () => body.children.find((c) => 'data-analytics-banner' in c.attrs),
    buttonByLabel(label) {
      const b = h.banner();
      const walk = (n: FakeEl): FakeEl | null => {
        for (const c of n.children) {
          if (c.tagName === 'BUTTON' && c.textContent === label) return c;
          const hit = walk(c);
          if (hit) return hit;
        }
        return null;
      };
      const hit = b ? walk(b) : null;
      if (!hit) throw new Error(`no button ${label}`);
      return hit;
    },
  };
  return h;
}

/** Everything that could be RUM traffic: SDK script loads and non-config fetches. */
function rumTraffic(h: Harness) {
  return {
    sdkScripts: h.sdkScripts().map((s) => s.src),
    fetches: h.fetchMock.mock.calls.map((c) => c[0]).filter((u) => u !== '/rum/config'),
  };
}

describe('RUM consent gate — before consent', () => {
  it('makes zero RUM requests and never initialises the SDK; it shows the banner', async () => {
    const h = await run({ path: '/r/vegan-cornbread' });
    // Raised by the SSR page view and an SPA action — both must be swallowed.
    h.win.tlgAnalytics.action('recipe_saved', { source: 'public_page' });

    expect(rumTraffic(h)).toEqual({ sdkScripts: [], fetches: [] });
    expect(h.win.DD_RUM).toBeUndefined();
    expect(h.rum.init).not.toHaveBeenCalled();
    expect(h.banner()).toBeDefined();
    expect(h.banner()!.attrs.role).toBe('region');
    // Referrer/UTM attribution is not persisted before opt-in.
    expect(h.sessionStorage.getItem('tlg.analytics-landing')).toBeNull();
    // The hidden "Analytics choice" controls are revealed once RUM is available.
    expect(h.head.children.filter((c) => c.tagName === 'STYLE')).toHaveLength(1);
  });

  it('still shows the choice when storage properties themselves throw', async () => {
    const h = await run({ throwOnStorageAccess: true, path: '/r/vegan-cornbread' });

    expect(h.banner()).toBeDefined();
    expect(h.win.tlgAnalytics).toBeDefined();
    expect(rumTraffic(h)).toEqual({ sdkScripts: [], fetches: [] });

    h.buttonByLabel('Allow analytics').click();
    expect(rumTraffic(h).sdkScripts).toEqual(['/rum/datadog-rum-slim.js']);
  });

  it('shows no banner and loads nothing when the server has RUM disabled', async () => {
    const h = await run({ config: { enabled: false } });
    expect(h.banner()).toBeUndefined();
    expect(rumTraffic(h)).toEqual({ sdkScripts: [], fetches: [] });
    // ...and the "Analytics choice" controls stay hidden: nothing to choose.
    expect(h.head.children).toHaveLength(0);
  });

  it('loads nothing after "No thanks", and remembers it', async () => {
    const h = await run({});
    h.buttonByLabel('No thanks').click();
    expect(h.localStorage.getItem('tlg.analytics-consent')).toBe('denied');
    expect(h.banner()).toBeUndefined();
    expect(rumTraffic(h)).toEqual({ sdkScripts: [], fetches: [] });

    const next = await run({ localStorage: h.localStorage });
    expect(next.banner()).toBeUndefined();
    expect(rumTraffic(next)).toEqual({ sdkScripts: [], fetches: [] });
  });
});

describe('RUM consent gate — after consent', () => {
  it('loads the same-origin SDK and inits RUM Measure on us5 via the proxy', async () => {
    const h = await run({});
    h.buttonByLabel('Allow analytics').click();

    expect(h.localStorage.getItem('tlg.analytics-consent')).toBe('granted');
    expect(h.sessionStorage.getItem('tlg.analytics-landing')).not.toBeNull();
    expect(rumTraffic(h).sdkScripts).toEqual(['/rum/datadog-rum-slim.js']);
    h.loadSdk();
    expect(h.rum.init).toHaveBeenCalledOnce();
    expect(h.rum.init.mock.calls[0][0]).toMatchObject({
      applicationId: 'app-123',
      clientToken: 'pub-token',
      site: 'us5.datadoghq.com',
      proxy: 'https://www.tasteslikegood.org/rum/intake',
      sessionSampleRate: 40,
      sessionReplaySampleRate: 0,
      sessionPersistence: 'local-storage',
    });
  });

  it('a stored grant (made on the SPA or an SSR page) loads RUM on the next page', async () => {
    const h = await run({ consent: 'granted', path: '/r/vegan-cornbread' });
    expect(h.banner()).toBeUndefined();
    h.loadSdk();
    expect(h.rum.init).toHaveBeenCalledOnce();
    // SSR recipe view is a custom action, queued until the SDK is ready.
    expect(h.rum.addAction).toHaveBeenCalledWith('recipe_view', {
      surface: 'ssr',
      slug: 'vegan-cornbread',
    });
  });

  it('does not duplicate an SSR view when an existing grant is reconfirmed', async () => {
    const h = await run({ consent: 'granted', path: '/r/vegan-cornbread' });
    h.loadSdk();
    expect(h.rum.addAction).toHaveBeenCalledTimes(1);

    const settings = makeEl('button');
    settings.setAttribute('data-analytics-settings', '');
    h.docClick(settings);
    h.buttonByLabel('Allow analytics').click();

    expect(h.rum.addAction).toHaveBeenCalledTimes(1);
  });

  it('attaches launch-referral attribution (external referrer + UTM) as global context', async () => {
    const h = await run({
      consent: 'granted',
      path: '/r/vegan-cornbread',
      search: '?utm_source=reddit&utm_campaign=launch&save=x',
      referrer: 'https://old.reddit.com/r/vegan/comments/abc?share=1',
    });
    h.loadSdk();
    expect(h.rum.setGlobalContextProperty).toHaveBeenCalledWith('launch', {
      landing_path: '/r/vegan-cornbread',
      referrer: 'https://old.reddit.com/r/vegan/comments/abc',
      utm_source: 'reddit',
      utm_campaign: 'launch',
    });
  });

  it('keeps the landing attribution for the session, not the latest internal page', async () => {
    const first = await run({
      consent: 'granted',
      search: '?utm_source=hn',
      referrer: 'https://news.ycombinator.com/',
    });
    const second = await run({
      consent: 'granted',
      path: '/browse',
      referrer: 'https://www.tasteslikegood.org/',
      sessionStorage: first.sessionStorage,
    });
    second.loadSdk();
    expect(second.rum.setGlobalContextProperty).toHaveBeenCalledWith('launch', {
      landing_path: '/',
      referrer: 'https://news.ycombinator.com/',
      utm_source: 'hn',
    });
  });

  it('records the SSR save-CTA click as the start of the view -> save funnel', async () => {
    const h = await run({ consent: 'granted', path: '/r/vegan-cornbread' });
    h.loadSdk();
    const cta = makeEl('a');
    cta.setAttribute('data-save-recipe', '');
    h.docClick(cta);
    expect(h.rum.addAction).toHaveBeenCalledWith('recipe_save_click', {
      surface: 'ssr',
      slug: 'vegan-cornbread',
    });
  });
});

describe('RUM consent gate — withdrawal', () => {
  it('[data-analytics-settings] reopens the choice; "No thanks" stops the session and reloads', async () => {
    const h = await run({ consent: 'granted' });
    h.loadSdk();
    expect(h.banner()).toBeUndefined();

    const settings = makeEl('button');
    settings.setAttribute('data-analytics-settings', '');
    h.docClick(settings);
    expect(h.banner()).toBeDefined();
    expect(settings.focused).toBe(false);

    h.buttonByLabel('No thanks').click();
    expect(settings.focused).toBe(true);
    expect(h.localStorage.getItem('tlg.analytics-consent')).toBe('denied');
    expect(h.sessionStorage.getItem('tlg.analytics-landing')).toBeNull();
    expect(h.rum.stopSession).toHaveBeenCalledOnce();
    expect(h.reload).toHaveBeenCalledOnce();

    h.rum.addAction.mockClear();
    h.win.tlgAnalytics.action('recipe_saved', {});
    expect(h.rum.addAction).not.toHaveBeenCalled();
  });

  it('queues the first SSR view and can withdraw when localStorage writes are blocked', async () => {
    const storage = new FaultyStorage();
    storage.failWrites = true;
    const h = await run({ localStorage: storage, path: '/r/vegan-cornbread' });

    h.buttonByLabel('Allow analytics').click();
    expect(storage.getItem('tlg.analytics-consent')).toBeNull();
    h.loadSdk();
    expect(h.rum.addAction).toHaveBeenCalledWith('recipe_view', {
      surface: 'ssr',
      slug: 'vegan-cornbread',
    });

    const settings = makeEl('button');
    settings.setAttribute('data-analytics-settings', '');
    h.docClick(settings);
    h.buttonByLabel('No thanks').click();

    expect(h.rum.stopSession).toHaveBeenCalledOnce();
    expect(h.reload).toHaveBeenCalledOnce();
  });

  it('removes a stale grant and stops RUM when consent reads and writes are blocked', async () => {
    const storage = new FaultyStorage();
    storage.setItem('tlg.analytics-consent', 'granted');
    const h = await run({ localStorage: storage });
    h.loadSdk();

    const settings = makeEl('button');
    settings.setAttribute('data-analytics-settings', '');
    h.docClick(settings);

    storage.failReads = true;
    storage.failWrites = true;
    h.buttonByLabel('No thanks').click();

    expect(h.rum.stopSession).toHaveBeenCalledOnce();
    expect(h.reload).toHaveBeenCalledOnce();
    expect(h.rum.addAction).not.toHaveBeenCalled();

    storage.failReads = false;
    expect(storage.getItem('tlg.analytics-consent')).toBeNull();
  });

  it('stays stopped without reloading when neither denial nor removal can persist', async () => {
    const storage = new FaultyStorage();
    storage.setItem('tlg.analytics-consent', 'granted');
    const h = await run({ localStorage: storage });
    h.loadSdk();

    const settings = makeEl('button');
    settings.setAttribute('data-analytics-settings', '');
    h.docClick(settings);

    storage.failReads = true;
    storage.failWrites = true;
    storage.failRemovals = true;
    h.buttonByLabel('No thanks').click();

    expect(h.rum.stopSession).toHaveBeenCalledOnce();
    expect(h.reload).not.toHaveBeenCalled();

    h.rum.addAction.mockClear();
    h.win.tlgAnalytics.action('recipe_saved', {});
    expect(h.rum.addAction).not.toHaveBeenCalled();
  });
});
