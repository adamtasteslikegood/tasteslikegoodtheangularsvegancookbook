import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SsrEntryService } from './ssr-entry.service';
import { AuthService } from './auth.service';
import { PersistenceService } from './persistence.service';
import { ToastService } from './toast.service';

describe('SsrEntryService', () => {
  let toastShow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    toastShow = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const createService = (opts: {
    savedRecipes?: unknown[];
    synced?: boolean;
    fetchResponse?: { ok: boolean; json: () => Promise<unknown> };
    firstSyncSettled?: Promise<void>;
  }) => {
    const saveRecipe = vi.fn().mockResolvedValue(opts.synced ?? true);
    const injector = Injector.create({
      providers: [
        {
          provide: AuthService,
          useValue: {
            ready: Promise.resolve(),
            ensureGuestSession: vi.fn(),
            currentUser: () => ({
              isGuest: false,
              savedRecipes: opts.savedRecipes ?? [],
            }),
          },
        },
        {
          provide: PersistenceService,
          useValue: { saveRecipe, firstSyncSettled: opts.firstSyncSettled ?? Promise.resolve() },
        },
        { provide: ToastService, useValue: { show: toastShow } },
      ],
    });
    if (opts.fetchResponse) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(opts.fetchResponse));
    }
    const service = runInInjectionContext(injector, () => new SsrEntryService());
    return { service, saveRecipe };
  };

  it('does not add a duplicate when a copy from the same slug is already saved', async () => {
    const { service, saveRecipe } = createService({
      savedRecipes: [{ id: 'r1', name: 'Thai Peanut Noodles', sourceSlug: 'thai-peanut-noodles' }],
    });

    await service.handleSave('thai-peanut-noodles');

    expect(saveRecipe).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledWith(
      expect.stringMatching(/already have this recipe/i),
      expect.objectContaining({ id: 'r1' })
    );
  });

  it('waits for the first server sync so server-only copies are deduped (KAN-139)', async () => {
    // savedRecipes is empty until the sync settles — the matching copy only
    // exists server-side (another device, or a stale local blob).
    const savedRecipes: unknown[] = [];
    let settleSync!: () => void;
    const firstSyncSettled = new Promise<void>((resolve) => {
      settleSync = resolve;
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { service, saveRecipe } = createService({ savedRecipes, firstSyncSettled });

    const save = service.handleSave('thai-peanut-noodles');
    savedRecipes.push({ id: 'server-copy', sourceSlug: 'thai-peanut-noodles' });
    settleSync();
    await save;

    expect(fetchMock).not.toHaveBeenCalled();
    expect(saveRecipe).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledWith(
      expect.stringMatching(/already have this recipe/i),
      expect.objectContaining({ id: 'server-copy' })
    );
  });

  it("de-dupes against the user's own published recipe (matches its slug)", async () => {
    const { service, saveRecipe } = createService({
      savedRecipes: [{ id: 'mine', name: 'My Chili', slug: 'my-own-chili', is_public: true }],
    });

    await service.handleSave('my-own-chili');

    expect(saveRecipe).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledWith(
      expect.stringMatching(/already have this recipe/i),
      expect.objectContaining({ id: 'mine' })
    );
  });

  it('does not collapse two different recipes that share a title (keys on slug, not name)', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'copy-b' });

    const { service, saveRecipe } = createService({
      savedRecipes: [{ id: 'ff-1', name: 'French Fries', sourceSlug: 'french-fries' }],
      fetchResponse: {
        ok: true,
        json: async () => ({ name: 'French Fries', slug: 'french-fries-2' }),
      },
    });

    await service.handleSave('french-fries-2');

    expect(saveRecipe).toHaveBeenCalledTimes(1);
    expect(saveRecipe.mock.calls[0][0].sourceSlug).toBe('french-fries-2');
  });

  it('saves a new copy tagged with sourceSlug when nothing matches', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'new-id' });

    const { service, saveRecipe } = createService({
      savedRecipes: [],
      fetchResponse: {
        ok: true,
        json: async () => ({ name: 'Thai Peanut Noodles', slug: 'thai-peanut-noodles' }),
      },
    });

    await service.handleSave('thai-peanut-noodles');

    expect(saveRecipe).toHaveBeenCalledTimes(1);
    expect(saveRecipe.mock.calls[0][0].sourceSlug).toBe('thai-peanut-noodles');
    expect(toastShow).toHaveBeenCalledWith(
      expect.stringMatching(/saved to your cookbook/i),
      expect.objectContaining({ sourceSlug: 'thai-peanut-noodles' })
    );
  });

  it('tells the user when a fresh save only reached this device (API sync failed)', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'new-id' });

    const { service, saveRecipe } = createService({
      savedRecipes: [],
      synced: false,
      fetchResponse: {
        ok: true,
        json: async () => ({ name: 'Thai Peanut Noodles', slug: 'thai-peanut-noodles' }),
      },
    });

    await service.handleSave('thai-peanut-noodles');

    expect(saveRecipe).toHaveBeenCalledTimes(1);
    expect(toastShow).toHaveBeenCalledWith(
      expect.stringMatching(/on this device/i),
      expect.any(Object)
    );
    expect(toastShow.mock.calls[0][0]).not.toMatch(/saved to your cookbook/i);
  });

  it('rejects invalid slugs without making API calls', async () => {
    const { service, saveRecipe } = createService({});

    await service.handleSave('../../../etc/passwd');

    expect(saveRecipe).not.toHaveBeenCalled();
    expect(toastShow).not.toHaveBeenCalled();
  });

  it('shows error toast when API returns non-OK response', async () => {
    const { service, saveRecipe } = createService({
      savedRecipes: [],
      fetchResponse: { ok: false, json: async () => ({}) },
    });

    await service.handleSave('missing-recipe');

    expect(saveRecipe).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledWith(expect.stringMatching(/could not save/i));
  });

  it('shows timeout toast when fetch exceeds 10s', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    const { service, saveRecipe } = createService({ savedRecipes: [] });

    await service.handleSave('slow-recipe');

    expect(saveRecipe).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledWith(expect.stringMatching(/timed out/i));
  });

  it('shows generic error toast on network failure (non-abort)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const { service, saveRecipe } = createService({ savedRecipes: [] });

    await service.handleSave('unreachable-recipe');

    expect(saveRecipe).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledWith(expect.stringMatching(/something went wrong/i));
  });

  it('shows an error toast when auth initialization fails before the save', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const injector = Injector.create({
      providers: [
        {
          provide: AuthService,
          useValue: { ready: Promise.reject(new Error('auth init failed')) },
        },
        { provide: PersistenceService, useValue: { saveRecipe: vi.fn() } },
        { provide: ToastService, useValue: { show: toastShow } },
      ],
    });
    const service = runInInjectionContext(injector, () => new SsrEntryService());

    await service.handleSave('thai-peanut-noodles');

    expect(toastShow).toHaveBeenCalledWith(expect.stringMatching(/something went wrong/i));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });

  // ── KAN-198: the regression gate owed by KAN-156 ──────────────────────────
  // KAN-156 ("Good news — you already have this recipe" firing right after a
  // successful first-time save) was closed on a live walkthrough, with no test.
  // The charter's proving gate was "a first-time save emits exactly one toast".
  // These two assert it — the first for the ordinary path, the second for the
  // mechanism KAN-156 actually documented.
  describe('a first-time save emits exactly one toast (KAN-156 / KAN-198)', () => {
    // saveRecipe here PERSISTS into savedRecipes, the way the real
    // PersistenceService does. Without that the dedup check at the top of
    // handleSave can never observe the row the save just wrote, and the
    // duplicate toast this guards against becomes unreproducible.
    const createPersistingService = (savedRecipes: unknown[]) => {
      const saveRecipe = vi.fn().mockImplementation(async (recipe: unknown) => {
        savedRecipes.push(recipe);
        return true;
      });
      const injector = Injector.create({
        providers: [
          {
            provide: AuthService,
            useValue: {
              ready: Promise.resolve(),
              ensureGuestSession: vi.fn(),
              currentUser: () => ({ isGuest: false, savedRecipes }),
            },
          },
          {
            provide: PersistenceService,
            useValue: { saveRecipe, firstSyncSettled: Promise.resolve() },
          },
          { provide: ToastService, useValue: { show: toastShow } },
        ],
      });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ name: 'Thai Peanut Noodles', slug: 'thai-peanut-noodles' }),
        })
      );
      const service = runInInjectionContext(injector, () => new SsrEntryService());
      return { service, saveRecipe };
    };

    it('emits exactly one toast on the ordinary single-invocation path', async () => {
      vi.stubGlobal('crypto', { randomUUID: () => 'new-id' });
      const { service, saveRecipe } = createPersistingService([]);

      await service.handleSave('thai-peanut-noodles');

      expect(saveRecipe).toHaveBeenCalledTimes(1);
      expect(toastShow).toHaveBeenCalledTimes(1);
      expect(toastShow.mock.calls[0][0]).toMatch(/saved to your cookbook/i);
    });

    // The KAN-156 mechanism, verbatim from the ticket: ssrEntryGuard invokes
    // handleSave fire-and-forget and immediately returns a redirect, so when the
    // guard runs more than once for the same ?save=<slug> entry the invocations
    // overlap. Whichever loses the race reaches the dedup check after the winner
    // has persisted the copy, matches on sourceSlug, and emits the bogus second
    // toast — while ALSO having written a duplicate row.
    it('emits exactly one toast when the guard invokes handleSave twice for one entry', async () => {
      vi.stubGlobal('crypto', { randomUUID: () => 'new-id' });
      const savedRecipes: unknown[] = [];
      const { service, saveRecipe } = createPersistingService(savedRecipes);

      await Promise.all([
        service.handleSave('thai-peanut-noodles'),
        service.handleSave('thai-peanut-noodles'),
      ]);

      // One user action → one persisted recipe → one toast.
      expect(saveRecipe).toHaveBeenCalledTimes(1);
      expect(savedRecipes).toHaveLength(1);
      expect(toastShow).toHaveBeenCalledTimes(1);
      expect(toastShow.mock.calls[0][0]).toMatch(/saved to your cookbook/i);
      // The specific wrong toast from the bug report must never appear here.
      expect(toastShow.mock.calls.map((c) => c[0]).join(' ')).not.toMatch(
        /already have this recipe/i
      );
    });

    // The dedup must be scoped to an in-flight entry, not a permanent
    // "handled" set: a user who saves, deletes, and saves again is making a
    // genuine second request and must not be silently ignored.
    it('still handles a later save of the same slug once the first has settled', async () => {
      vi.stubGlobal('crypto', { randomUUID: () => 'new-id' });
      const savedRecipes: unknown[] = [];
      const { service } = createPersistingService(savedRecipes);

      await service.handleSave('thai-peanut-noodles');
      expect(toastShow).toHaveBeenCalledTimes(1);

      // The row is now present, so this is the legitimate "you already have it"
      // path — a response, not silence.
      await service.handleSave('thai-peanut-noodles');
      expect(toastShow).toHaveBeenCalledTimes(2);
      expect(toastShow.mock.calls[1][0]).toMatch(/already have this recipe/i);
    });
  });

  it('handleAuth waits for auth ready', async () => {
    let resolveReady!: () => void;
    const readyPromise = new Promise<void>((r) => {
      resolveReady = r;
    });
    const injector = Injector.create({
      providers: [
        { provide: AuthService, useValue: { ready: readyPromise } },
        { provide: PersistenceService, useValue: {} },
        { provide: ToastService, useValue: { show: vi.fn() } },
      ],
    });
    const service = runInInjectionContext(injector, () => new SsrEntryService());

    let resolved = false;
    const p = service.handleAuth().then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);

    resolveReady();
    await p;
    expect(resolved).toBe(true);
  });
});
