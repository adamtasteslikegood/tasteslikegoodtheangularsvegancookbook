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
    alreadySaved?: boolean;
  }) => {
    const saveOutcome =
      opts.alreadySaved === true ? { ok: true, alreadySaved: true } : { ok: opts.synced ?? true };
    const saveRecipeDetailed = vi.fn().mockResolvedValue(saveOutcome);
    const saveRecipe = vi.fn().mockResolvedValue(saveOutcome.ok);
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
          useValue: {
            saveRecipe,
            saveRecipeDetailed,
            firstSyncSettled: opts.firstSyncSettled ?? Promise.resolve(),
          },
        },
        { provide: ToastService, useValue: { show: toastShow } },
      ],
    });
    if (opts.fetchResponse) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(opts.fetchResponse));
    }
    const service = runInInjectionContext(injector, () => new SsrEntryService());
    return { service, saveRecipe: saveRecipeDetailed };
  };

  // TAS-3056/RCP-79 (supersedes RCP-74 AC3): a copy already saved from this
  // public page — including one whose original author is a different user, the
  // case that only ever carries sourceSlug (never slug) — must surface the
  // "you already have this recipe" toast pointing at the existing copy. The row
  // is still deduped; only the previously-suppressed toast changes.
  it('shows the already-saved toast when a copy from this public page already exists', async () => {
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
    // TAS-3056/RCP-79: the server-side copy is still deduped (no fetch, no new
    // row — the KAN-139 point), but the user is now told they already have it,
    // linked to the server copy the first sync surfaced.
    expect(toastShow).toHaveBeenCalledWith(
      expect.stringMatching(/already have this recipe/i),
      expect.objectContaining({ id: 'server-copy' })
    );
  });

  // The one genuine duplicate case (RCP-74 AC3 keeps this toast): the original
  // row is already in the cookbook, so silence would read as a broken Save.
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

  // KAN-241: the server returns 409 RECIPE_ALREADY_SAVED — the client-side dedup
  // missed it (e.g. the copy has a different sourceSlug casing, or the first sync
  // hadn't settled yet) but the server caught the duplicate. The ghost must be
  // cleaned up and the user told they already have it.
  it('shows the already-saved toast when the server returns a duplicate 409', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'ghost-id' });

    const { service, saveRecipe } = createService({
      savedRecipes: [],
      alreadySaved: true,
      fetchResponse: {
        ok: true,
        json: async () => ({ name: 'Thai Peanut Noodles', slug: 'thai-peanut-noodles' }),
      },
    });

    await service.handleSave('thai-peanut-noodles');

    expect(saveRecipe).toHaveBeenCalledTimes(1);
    // Asserted as exactly `null`, not `expect.any(Object)`: `typeof null ===
    // 'object'`, so the looser matcher accepted null by accident and could not
    // tell "toast got the existing copy" from "toast got nothing". The service
    // deliberately passes null here — the ghost was just removed and the real
    // copy has not hydrated — so pin that contract rather than a matcher that
    // holds either way.
    expect(toastShow).toHaveBeenCalledWith(
      expect.stringMatching(/already have this recipe/i),
      null
    );
    // Must NOT show "saved to your cookbook" or "on this device"
    expect(toastShow.mock.calls[0][0]).not.toMatch(/saved to your cookbook/i);
    expect(toastShow.mock.calls[0][0]).not.toMatch(/on this device/i);
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
  // The charter's proving gate was "one user action emits exactly one toast".
  // The first two tests assert it for a single entry — the ordinary path and
  // the overlapping-guard mechanism KAN-156 documented (collapsed upstream by
  // inFlightSaves). The third covers a later, SEPARATE save of the same slug:
  // a second user action, so its own already-saved confirmation is expected
  // (TAS-3056/RCP-79), not a KAN-156 regression.
  describe('one user action emits exactly one toast (KAN-156 / KAN-198)', () => {
    // saveRecipe here PERSISTS into savedRecipes, the way the real
    // PersistenceService does. Without that the dedup check at the top of
    // handleSave can never observe the row the save just wrote, and the
    // duplicate toast this guards against becomes unreproducible.
    const createPersistingService = (savedRecipes: unknown[]) => {
      const saveRecipeDetailed = vi.fn().mockImplementation(async (recipe: unknown) => {
        savedRecipes.push(recipe);
        return { ok: true };
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
            useValue: { saveRecipeDetailed, firstSyncSettled: Promise.resolve() },
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
      return { service, saveRecipe: saveRecipeDetailed };
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

    // A later, separate save of the same slug is a genuine second user action
    // the service must still process — the in-flight dedup is scoped to
    // overlapping calls, not a permanent "handled" set.
    it('dedups a later save of the same slug — no duplicate row, but confirms it is already saved', async () => {
      vi.stubGlobal('crypto', { randomUUID: () => 'new-id' });
      const savedRecipes: unknown[] = [];
      const { service } = createPersistingService(savedRecipes);

      await service.handleSave('thai-peanut-noodles');
      expect(toastShow).toHaveBeenCalledTimes(1);
      expect(toastShow.mock.calls[0][0]).toMatch(/saved to your cookbook/i);

      // The row is now present. TAS-3056/RCP-79 supersedes RCP-74 AC3: re-saving
      // from the public page is a fresh user action, so it dedups the row (no
      // second entry) yet still surfaces the "you already have this recipe"
      // confirmation.
      await service.handleSave('thai-peanut-noodles');
      expect(savedRecipes).toHaveLength(1);
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
