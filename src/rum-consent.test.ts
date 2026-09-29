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
  getAttribute(k: string): string | null;
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
    getAttribute(k: string) {
      return k in this.attrs ? this.attrs[k] : null;
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
      const attr = sel.startsWith('[') ? sel.replace(/^\[|\]$/g, '') : null;
      const tag = sel.toUpperCase();
      const walk = (n: FakeEl): FakeEl | null => {
        for (const c of n.children) {
          if (attr ? attr in c.attrs : c.tagName === tag) return c;
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
  win: Record<string, unknown> & {
    tlgAnalytics: {
      action: (n: string, c?: unknown) => void;
      onConsentGranted: (listener: () => void) => () => void;
    };
  };
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
    setTrackingConsent: ReturnType<typeof vi.fn>;
  };
  /** Actions the fake SDK actually accepted (dropped while 'not-granted'). */
  accepted: Array<[string, unknown]>;
  /** Dispatch a cross-tab `storage` event, as another tab writing would. */
  storage(key: string | null, newValue: string | null): void;
  setActiveElement(el: FakeEl | null): void;
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
  configPromise?: Promise<unknown>;
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
      return {
        ok: true,
        json: async () =>
          opts.configPromise ? await opts.configPromise : (opts.config ?? ENABLED),
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  const accepted: Array<[string, unknown]> = [];
  let sdkConsent = 'granted';
  const rum = {
    init: vi.fn(),
    // Models the real SDK: actions are dropped while tracking consent is off.
    addAction: vi.fn((name: string, context: unknown) => {
      if (sdkConsent === 'granted') accepted.push([name, context]);
    }),
    setGlobalContextProperty: vi.fn(),
    stopSession: vi.fn(),
    setTrackingConsent: vi.fn((value: string) => {
      sdkConsent = value;
    }),
  };
  const winListeners: Record<string, Array<(e: unknown) => void>> = {};
  const reload = vi.fn();
  const win: Record<string, unknown> = {
    fetch: fetchMock,
    addEventListener: (t: string, fn: (e: unknown) => void) => {
      (winListeners[t] ??= []).push(fn);
    },
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
  const document: Record<string, unknown> = {
    activeElement: body,
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
    accepted,
    storage(key, newValue) {
      for (const fn of winListeners.storage ?? []) {
        fn({ key, newValue, storageArea: localStorage });
      }
    },
    setActiveElement(el) {
      document.activeElement = el ?? body;
    },
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
    // Referrer/UTM attribution and actions are not persisted before opt-in.
    expect(h.sessionStorage.getItem('tlg.analytics-landing')).toBeNull();
    expect(h.sessionStorage.getItem('tlg.analytics-pending-actions')).toBeNull();
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
      // No automatic click actions: their names come from element text,
      // which includes user-owned values (Copilot, PR #3544).
      trackUserInteractions: false,
      defaultPrivacyLevel: 'mask',
    });
  });

  it('beforeSend strips non-UTM query strings and fragments from built-in URL fields', async () => {
    const h = await run({ consent: 'granted' });
    h.loadSdk();
    const beforeSend = h.rum.init.mock.calls[0][0].beforeSend as (e: unknown) => boolean;
    const view = {
      type: 'view',
      view: {
        url: 'https://www.tasteslikegood.org/r/foo?utm_source=x&email=a%40b.c#frag',
        referrer: 'https://old.reddit.com/r/vegan/comments/abc?share=1&utm_source=y',
        performance: { lcp: { resource_url: '/api/recipes/1/image?token=secret' } },
      },
    };
    expect(beforeSend(view)).toBe(true);
    expect(view.view).toEqual({
      url: 'https://www.tasteslikegood.org/r/foo?utm_source=x',
      referrer: 'https://old.reddit.com/r/vegan/comments/abc',
      performance: {
        lcp: { resource_url: 'https://www.tasteslikegood.org/api/recipes/1/image' },
      },
    });
    const resource = {
      type: 'resource',
      view: { url: 'https://www.tasteslikegood.org/kitchen?auth=success', referrer: '' },
      resource: { url: 'https://www.tasteslikegood.org/api/recipes?user=42' },
    };
    beforeSend(resource);
    expect(resource.view.url).toBe('https://www.tasteslikegood.org/kitchen');
    expect(resource.view.referrer).toBe('');
    expect(resource.resource.url).toBe('https://www.tasteslikegood.org/api/recipes');
    const error = {
      type: 'error',
      view: { url: 'https://www.tasteslikegood.org/', referrer: '' },
      error: {
        resource: { url: 'https://images.unsplash.com/p.jpg?ixid=abc' },
        message: 'Failed to fetch https://www.tasteslikegood.org/?save=my-slug&utm_source=x',
        stack: 'Error\n    at f (https://www.tasteslikegood.org/main-ABCDEFGH.js?v=1#x:1:2)',
      },
    };
    beforeSend(error);
    expect(error.error.resource.url).toBe('https://images.unsplash.com/p.jpg');
    expect(error.error.message).toBe(
      'Failed to fetch https://www.tasteslikegood.org/?utm_source=x'
    );
    expect(error.error.stack).not.toContain('v=1');
    expect(error.error.stack).toContain('(https://www.tasteslikegood.org/main-ABCDEFGH.js)');

    // Parentheses inside a query value are stripped with the rest of it.
    const paren = {
      type: 'error',
      view: { url: 'https://www.tasteslikegood.org/', referrer: '' },
      error: {
        message:
          'boom https://www.tasteslikegood.org/r/foo?email=(alice@example.com) and ' +
          '(https://www.tasteslikegood.org/r/bar?x=(y)&utm_source=z)',
      },
    };
    beforeSend(paren);
    expect(paren.error.message).toBe(
      'boom https://www.tasteslikegood.org/r/foo and ' +
        '(https://www.tasteslikegood.org/r/bar?utm_source=z)'
    );
    expect(paren.error.message).not.toContain('alice');

    // Quoted query values are dropped whole; quotes that only WRAP the URL,
    // and trailing sentence punctuation, survive.
    const quoted = {
      type: 'error',
      view: { url: 'https://www.tasteslikegood.org/', referrer: '' },
      error: {
        message:
          "single https://www.tasteslikegood.org/r/foo?email='alice@example.com' then " +
          'double https://www.tasteslikegood.org/r/foo?email="bob@example.com" then ' +
          '"https://www.tasteslikegood.org/r/bar?email=\'carol@example.com\'" and ' +
          '\'https://www.tasteslikegood.org/r/baz?email="dan@example.com"&utm_source=z\'.',
      },
    };
    beforeSend(quoted);
    expect(quoted.error.message).toBe(
      'single https://www.tasteslikegood.org/r/foo then ' +
        'double https://www.tasteslikegood.org/r/foo then ' +
        '"https://www.tasteslikegood.org/r/bar" and ' +
        "'https://www.tasteslikegood.org/r/baz?utm_source=z'."
    );
    for (const who of ['alice', 'bob', 'carol', 'dan']) {
      expect(quoted.error.message).not.toContain(who);
    }
  });

  it('beforeSend drops non-HTTP URL payloads from built-in URL fields', async () => {
    const h = await run({ consent: 'granted' });
    h.loadSdk();
    const beforeSend = h.rum.init.mock.calls[0][0].beforeSend as (e: unknown) => boolean;
    const inlinePayload = 'private-recipe-photo';
    const event = {
      type: 'resource',
      view: {
        url: `data:text/html,${inlinePayload}`,
        referrer: `javascript:alert('${inlinePayload}')`,
        performance: {
          lcp: { resource_url: `blob:https://www.tasteslikegood.org/${inlinePayload}` },
        },
      },
      resource: { url: `data:image/svg+xml,${inlinePayload}` },
      error: { resource: { url: `data:text/plain,${inlinePayload}` } },
    };

    expect(beforeSend(event)).toBe(true);
    expect(event.view.url).toBe('');
    expect(event.view.referrer).toBe('');
    expect(event.view.performance.lcp.resource_url).toBe('');
    expect(event.resource.url).toBe('');
    expect(event.error.resource.url).toBe('');
    expect(JSON.stringify(event)).not.toContain(inlinePayload);
  });

  it('keeps only the five documented utm_* keys; unknown utm_* and other params are dropped', async () => {
    const all =
      'utm_source=reddit&utm_medium=social&utm_campaign=launch&utm_content=post&utm_term=vegan';
    const h = await run({
      consent: 'granted',
      search: `?${all}&utm_foo=leak&utm_id=launch-42&other=secret`,
    });
    h.loadSdk();

    expect(h.rum.setGlobalContextProperty).toHaveBeenCalledWith('launch', {
      landing_path: '/',
      referrer: null,
      utm_source: 'reddit',
      utm_medium: 'social',
      utm_campaign: 'launch',
      utm_content: 'post',
      utm_term: 'vegan',
    });

    const beforeSend = h.rum.init.mock.calls[0][0].beforeSend as (e: unknown) => boolean;
    const view = {
      type: 'view',
      view: {
        url: `https://www.tasteslikegood.org/?${all}&utm_foo=leak&other=secret`,
        referrer: '',
      },
    };
    beforeSend(view);
    expect(view.view.url).toBe(`https://www.tasteslikegood.org/?${all}`);
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

  it('carries consented SSR actions across navigation before the SDK loads', async () => {
    const first = await run({ consent: 'granted', path: '/r/vegan-cornbread' });
    const cta = makeEl('a');
    cta.setAttribute('data-save-recipe', '');
    first.docClick(cta);

    expect(first.rum.addAction).not.toHaveBeenCalled();
    expect(first.sessionStorage.getItem('tlg.analytics-pending-actions')).not.toBeNull();

    const next = await run({
      path: '/kitchen',
      localStorage: first.localStorage,
      sessionStorage: first.sessionStorage,
    });
    next.loadSdk();

    expect(next.rum.addAction.mock.calls).toEqual([
      ['recipe_view', { surface: 'ssr', slug: 'vegan-cornbread' }],
      ['recipe_save_click', { surface: 'ssr', slug: 'vegan-cornbread' }],
    ]);
    expect(next.sessionStorage.getItem('tlg.analytics-pending-actions')).toBeNull();
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
    // Fail-closed keyboard default: reopening focuses "No thanks".
    expect(h.buttonByLabel('No thanks').focused).toBe(true);
    expect(h.buttonByLabel('Allow analytics').focused).toBe(false);

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
    // No reload here, so the SDK stays on the page: collection itself must be
    // off, or the next interaction would start a new session (Copilot, #3544).
    expect(h.rum.setTrackingConsent).toHaveBeenCalledWith('not-granted');
    expect(h.rum.setTrackingConsent.mock.invocationCallOrder[0]).toBeLessThan(
      h.rum.stopSession.mock.invocationCallOrder[0]
    );

    h.rum.addAction.mockClear();
    h.win.tlgAnalytics.action('recipe_saved', {});
    expect(h.rum.addAction).not.toHaveBeenCalled();
  });
});

describe('RUM consent gate — withdrawal without reload', () => {
  it('re-allowing on the same page restores tracking consent', async () => {
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
    expect(h.rum.setTrackingConsent).toHaveBeenLastCalledWith('not-granted');
    expect(h.reload).not.toHaveBeenCalled();

    h.docClick(settings);
    h.buttonByLabel('Allow analytics').click();
    expect(h.rum.setTrackingConsent).toHaveBeenLastCalledWith('granted');
    // The SDK was not injected a second time.
    expect(h.sdkScripts()).toHaveLength(1);
  });
});

describe('RUM consent gate — cross-tab consent', () => {
  it('a withdrawal in another tab fails this active tab closed', async () => {
    const shared = new FakeStorage();
    const active = await run({
      consent: 'granted',
      localStorage: shared,
      path: '/r/vegan-cornbread',
    });
    active.loadSdk();
    expect(active.rum.init).toHaveBeenCalledOnce();

    // The other tab chooses "No thanks"; the browser fires `storage` here.
    const other = await run({ localStorage: shared });
    const settings = makeEl('button');
    settings.setAttribute('data-analytics-settings', '');
    other.docClick(settings);
    other.buttonByLabel('No thanks').click();
    expect(shared.getItem('tlg.analytics-consent')).toBe('denied');
    active.storage('tlg.analytics-consent', 'denied');

    expect(active.rum.setTrackingConsent).toHaveBeenCalledWith('not-granted');
    expect(active.rum.stopSession).toHaveBeenCalledOnce();
    expect(active.sessionStorage.getItem('tlg.analytics-landing')).toBeNull();
    expect(active.reload).not.toHaveBeenCalled();
    active.rum.addAction.mockClear();
    active.win.tlgAnalytics.action('recipe_saved', {});
    expect(active.rum.addAction).not.toHaveBeenCalled();
  });

  it('storage.clear() or key removal elsewhere also fails closed, even mid SDK load', async () => {
    const h = await run({ consent: 'granted' });
    expect(h.sdkScripts()).toHaveLength(1); // SDK requested, not yet loaded
    h.storage(null, null);
    h.loadSdk();
    expect(h.rum.init).not.toHaveBeenCalled();
  });

  it('a grant made in another tab (e.g. the policy tab) applies here with the original landing', async () => {
    const h = await run({
      path: '/r/vegan-cornbread',
      search: '?utm_source=reddit',
      referrer: 'https://old.reddit.com/r/vegan/',
    });
    expect(h.banner()).toBeDefined();
    expect(h.sessionStorage.getItem('tlg.analytics-landing')).toBeNull();
    h.localStorage.setItem('tlg.analytics-consent', 'granted');
    h.storage('tlg.analytics-consent', 'granted');
    expect(h.banner()).toBeUndefined();
    h.loadSdk();
    expect(h.rum.setGlobalContextProperty).toHaveBeenCalledWith('launch', {
      landing_path: '/r/vegan-cornbread',
      referrer: 'https://old.reddit.com/r/vegan/',
      utm_source: 'reddit',
    });
  });

  it('preserves landing and notifies SPA listeners when a cross-tab grant beats config', async () => {
    let resolveConfig!: (config: unknown) => void;
    const configPromise = new Promise<unknown>((resolve) => {
      resolveConfig = resolve;
    });
    const h = await run({
      configPromise,
      path: '/recipe/r1',
      search: '?utm_campaign=launch-42',
      referrer: 'https://example.com/campaign?private=x',
    });
    h.win.tlgAnalytics.onConsentGranted(() => {
      h.win.tlgAnalytics.action('recipe_view', { surface: 'spa', slug: null });
    });

    h.localStorage.setItem('tlg.analytics-consent', 'granted');
    h.storage('tlg.analytics-consent', 'granted');
    expect(h.sdkScripts()).toHaveLength(0);

    resolveConfig(ENABLED);
    await settle();

    expect(JSON.parse(h.sessionStorage.getItem('tlg.analytics-landing')!)).toEqual({
      landing_path: '/recipe/r1',
      referrer: 'https://example.com/campaign',
      utm_campaign: 'launch-42',
    });
    expect(h.sessionStorage.getItem('tlg.analytics-pending-actions')).not.toBeNull();
    h.loadSdk();
    expect(h.accepted).toContainEqual(['recipe_view', { surface: 'spa', slug: null }]);
  });

  it('a grant elsewhere does not override a denial made on this page', async () => {
    const h = await run({});
    h.buttonByLabel('No thanks').click();
    h.storage('tlg.analytics-consent', 'granted');
    expect(h.sdkScripts()).toHaveLength(0);
  });
});

describe('RUM consent gate — re-consent and banner accessibility', () => {
  it('re-allowing after a no-reload withdrawal restores SDK consent before the view is sent', async () => {
    const storage = new FaultyStorage();
    storage.setItem('tlg.analytics-consent', 'granted');
    const h = await run({ localStorage: storage, path: '/r/vegan-cornbread' });
    h.loadSdk();
    const settings = makeEl('button');
    settings.setAttribute('data-analytics-settings', '');
    h.docClick(settings);
    storage.failReads = true;
    storage.failWrites = true;
    storage.failRemovals = true;
    h.buttonByLabel('No thanks').click();
    expect(h.reload).not.toHaveBeenCalled();
    h.accepted.length = 0;

    h.docClick(settings);
    h.buttonByLabel('Allow analytics').click();
    expect(h.accepted).toContainEqual(['recipe_view', { surface: 'ssr', slug: 'vegan-cornbread' }]);
  });

  it('first display focuses "No thanks" and restores the prior focus on close', async () => {
    const h = await run({});
    expect(h.buttonByLabel('No thanks').focused).toBe(true);
    h.buttonByLabel('No thanks').click();
    expect(h.banner()).toBeUndefined();
  });

  it('the Details link opens in a new tab so this page keeps its landing', async () => {
    const h = await run({});
    const find = (n: FakeEl): FakeEl | null => {
      for (const c of n.children) {
        if (c.tagName === 'A') return c;
        const hit = find(c);
        if (hit) return hit;
      }
      return null;
    };
    const link = find(h.banner()!) as FakeEl & { target?: string; rel?: string; href?: string };
    expect(link.href).toBe('/privacy-policy#analytics');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener');
  });
});

describe('RUM consent gate — UTM across the pre-consent SSR save link', () => {
  it('carries only the arrival utm_* tags onto the save link without starting RUM', async () => {
    const h = await run({
      path: '/r/vegan-cornbread',
      search: '?utm_source=reddit&utm_campaign=launch&utm_foo=leak&other=x',
      referrer: 'https://old.reddit.com/r/vegan/',
    });
    const cta = makeEl('a');
    cta.setAttribute('data-save-recipe', '');
    cta.setAttribute('href', '/?save=vegan-cornbread#kitchen');
    h.docClick(cta);
    expect(cta.getAttribute('href')).toBe(
      '/?save=vegan-cornbread&utm_source=reddit&utm_campaign=launch#kitchen'
    );
    expect(h.sessionStorage.getItem('tlg.analytics-landing')).toBeNull();
    expect(rumTraffic(h)).toEqual({ sdkScripts: [], fetches: [] });

    // The SPA page it lands on re-captures the UTM tags as its landing.
    const spa = await run({
      consent: 'granted',
      path: '/',
      search: '?save=vegan-cornbread&utm_source=reddit&utm_campaign=launch',
      referrer: 'https://www.tasteslikegood.org/r/vegan-cornbread',
    });
    spa.loadSdk();
    expect(spa.rum.setGlobalContextProperty).toHaveBeenCalledWith('launch', {
      landing_path: '/',
      referrer: null,
      utm_source: 'reddit',
      utm_campaign: 'launch',
    });
  });

  it('leaves the save link alone after consent', async () => {
    const h = await run({ consent: 'granted', path: '/r/x', search: '?utm_source=reddit' });
    const cta = makeEl('a');
    cta.setAttribute('data-save-recipe', '');
    cta.setAttribute('href', '/?save=x#kitchen');
    h.docClick(cta);
    expect(cta.getAttribute('href')).toBe('/?save=x#kitchen');
  });
});
