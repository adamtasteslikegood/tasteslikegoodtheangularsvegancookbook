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
        { provide: PersistenceService, useValue: { saveRecipe } },
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
