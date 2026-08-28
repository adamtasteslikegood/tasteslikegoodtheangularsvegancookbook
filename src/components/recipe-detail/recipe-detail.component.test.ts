import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecipeDetailComponent } from './recipe-detail.component';
import { AuthService } from '../../services/auth.service';
import { PersistenceService } from '../../services/persistence.service';
import { GeminiService } from '../../services/gemini.service';
import { RecipeStateService } from '../../services/recipe-state.service';
import { ToastService } from '../../services/toast.service';
import { ModalService } from '../../services/modal.service';

describe('RecipeDetailComponent route load states (KAN-257)', () => {
  let toastShow: ReturnType<typeof vi.fn>;
  let routerNavigate: ReturnType<typeof vi.fn>;
  let paramSubject: Subject<Map<string, string>>;

  beforeEach(() => {
    toastShow = vi.fn();
    routerNavigate = vi.fn().mockResolvedValue(true);
    paramSubject = new Subject();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const createComponent = (
    opts: {
      isGuest?: boolean;
      authReady?: Promise<void>;
      generateImage?: () => Promise<string>;
    } = {}
  ) => {
    const recipeState = runInInjectionContext(
      Injector.create({ providers: [] }),
      () => new RecipeStateService()
    );
    const persistenceSaveRecipe = vi.fn().mockResolvedValue({ ok: true });
    // Mutable so tests can emulate the persistence mirror-back writing the
    // server-minted slug into auth state mid-save (KAN-149 / #3262).
    const authUser = { isGuest: opts.isGuest ?? true, savedRecipes: [] as unknown[] };

    const injector = Injector.create({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { paramMap: paramSubject.asObservable() },
        },
        { provide: Router, useValue: { navigate: routerNavigate } },
        {
          provide: AuthService,
          useValue: {
            currentUser: () => authUser,
            saveRecipe: vi.fn(),
            // KAN-257: the route waits for the startup auth check before it
            // will believe a 404 — the row is session-scoped server-side.
            ready: opts.authReady ?? Promise.resolve(),
          },
        },
        {
          provide: PersistenceService,
          useValue: {
            saveRecipe: persistenceSaveRecipe,
            saveRecipeDetailed: persistenceSaveRecipe,
            publishStateSync: () => 'synced',
          },
        },
        {
          provide: GeminiService,
          useValue: { generateImage: vi.fn(opts.generateImage ?? (async () => '')) },
        },
        { provide: RecipeStateService, useValue: recipeState },
        { provide: ToastService, useValue: { show: toastShow } },
        { provide: ModalService, useValue: { openAuth: vi.fn() } },
      ],
    });
    const component = runInInjectionContext(injector, () => new RecipeDetailComponent());
    const geminiService = injector.get(GeminiService);
    return { component, persistenceSaveRecipe, authUser, recipeState, geminiService };
  };

  const emitId = (id: string) => {
    const params = new Map([['id', id]]);
    const paramMap = {
      keys: ['id'],
      has: (k: string) => params.has(k),
      get: (k: string) => params.get(k) ?? null,
      getAll: (k: string) => (params.has(k) ? [params.get(k)!] : []),
    };
    paramSubject.next(paramMap as unknown as Map<string, string>);
  };

  // KAN-257: every one of these used to end in
  // `router.navigate(['/kitchen'], { replaceUrl: true })`. That erased the
  // `/recipe/:id` history entry (Back stopped meaning what the user pressed it
  // for) AND discarded the only thing needed to retry a transient failure.
  // Dropping `replaceUrl` alone is not the fix either: history becomes
  // [/kitchen, /recipe/bad, /kitchen] and Back re-enters the bad route,
  // re-fails, redirects again — an infinite bounce. So: no navigation at all.
  // The route renders the outcome in place.
  //
  // These assertions are poison pills. Any reintroduced redirect fails them.
  it('shows a not-found state in place on 404, without navigating', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const { component } = createComponent();
    emitId('missing-id');
    await vi.waitFor(() => expect(component.loadState()).toBe('not-found'));

    expect(component.isNotFound()).toBe(true);
    expect(routerNavigate).not.toHaveBeenCalled();
  });

  it('shows a retryable load-error state on 500, without navigating', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const { component } = createComponent();
    emitId('broken-id');
    await vi.waitFor(() => expect(component.loadState()).toBe('load-error'));

    expect(component.isLoadError()).toBe(true);
    expect(routerNavigate).not.toHaveBeenCalled();
  });

  it('treats a literal null 200 body as a retryable load-error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => null,
      })
    );

    const { component } = createComponent();
    emitId('null-row-id');
    await vi.waitFor(() => expect(component.loadState()).toBe('load-error'));

    expect(component.isLoadError()).toBe(true);
    expect(routerNavigate).not.toHaveBeenCalled();
  });

  it('keeps the route on a network failure so a tab-resume blip is recoverable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const { component } = createComponent();
    emitId('unreachable-id');
    await vi.waitFor(() => expect(component.loadState()).toBe('load-error'));

    expect(routerNavigate).not.toHaveBeenCalled();
  });

  it('recovers the recipe when Retry is pressed after a transient failure', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'r-1',
          status: 'ready',
          is_canonical: false,
          data: { id: 'r-1', name: 'Vegan Cornbread', ingredients: {}, instructions: [] },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { component } = createComponent();
    emitId('r-1');
    await vi.waitFor(() => expect(component.loadState()).toBe('load-error'));

    component.retryLoad();
    await vi.waitFor(() => expect(component.loadState()).toBe('ready'));

    expect(component.recipe()?.id).toBe('r-1');
    expect(routerNavigate).not.toHaveBeenCalled();
  });

  // KAN-257: the row is scoped server-side to the session's user/guest id, so a
  // read issued before the startup auth check resolves 404s for a recipe the
  // user genuinely owns. That false 404 is what bounced cold deep links.
  it('waits for the auth check before treating a miss as not-found', async () => {
    let releaseAuth: () => void = () => {};
    const authReady = new Promise<void>((resolve) => {
      releaseAuth = resolve;
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'r-1',
        status: 'ready',
        is_canonical: false,
        data: { id: 'r-1', name: 'Vegan Cornbread', ingredients: {}, instructions: [] },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { component } = createComponent({ authReady });
    emitId('r-1');
    await Promise.resolve();

    // Nothing has been asked of the API yet — the session is not established.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(component.loadState()).toBe('loading');

    releaseAuth();
    await vi.waitFor(() => expect(component.loadState()).toBe('ready'));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  // KAN-257 AC1: a recipe whose TEXT is still being written. The row comes back
  // 200 with `{"name": "Generating...", ...}` and no ingredients
  // (generation_api_bp:78), so rendering it raw produced a blank page under a
  // placeholder title. It now shows a spinner on its own URL and fills in.
  it('shows a pending state for a still-generating recipe, then fills in', async () => {
    vi.useFakeTimers();
    try {
      const pendingRow = {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'r-1',
          status: 'generating',
          is_canonical: false,
          data: { id: 'r-1', name: 'Generating...' },
        }),
      };
      const readyRow = {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'r-1',
          status: 'ready',
          is_canonical: false,
          data: { id: 'r-1', name: 'Vegan Cornbread', ingredients: {}, instructions: ['bake'] },
        }),
      };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(pendingRow)
        .mockResolvedValueOnce(pendingRow)
        .mockResolvedValue(readyRow);
      vi.stubGlobal('fetch', fetchMock);

      const { component } = createComponent();
      emitId('r-1');

      // Flush the awaits in the load path (auth.ready, fetch, json) without
      // moving the clock — the poll delay must still be pending here.
      await vi.advanceTimersByTimeAsync(0);
      expect(component.loadState()).toBe('pending');
      expect(routerNavigate).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);

      expect(component.loadState()).toBe('ready');
      expect(component.recipe()?.name).toBe('Vegan Cornbread');
    } finally {
      vi.useRealTimers();
    }
  });

  // KAN-257 regression: the constructor fast-path (`recipe.id === id` already
  // in state) used to return without cancelling an in-flight `load(otherId)`
  // from a previous nav. That load's late `viewRecipe(otherId)` then wrote
  // the wrong recipe under the URL the user was actually on. Repro: land on
  // A → nav to B (starts fetch(B)) → nav back to A before B resolves → B's
  // fetch resolves and the page shows B on URL /recipe/A.
  it('does not let an in-flight load clobber the fast-path adopted recipe', async () => {
    let releaseFetchB: (value: Response) => void = () => {};
    const readyRow = (name: string) => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: name,
        status: 'ready',
        is_canonical: false,
        data: { id: name, name, ingredients: {}, instructions: [] },
      }),
    });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/A')) return Promise.resolve(readyRow('A'));
      if (url.includes('/B'))
        return new Promise<Response>((resolve) => {
          releaseFetchB = resolve;
        });
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { component, recipeState } = createComponent();

    // 1. Land on A, wait for it to render.
    emitId('A');
    await vi.waitFor(() => expect(component.recipe()?.id).toBe('A'));

    // 2. Nav to B — fetch(B) is pending (never resolved yet).
    emitId('B');
    await Promise.resolve();

    // 3. Nav back to A while B is still loading. Fast path adopts A from state.
    emitId('A');
    await Promise.resolve();
    expect(component.recipe()?.id).toBe('A');

    // 4. B's fetch finally resolves. Without the fix, this write clobbers A.
    releaseFetchB(readyRow('B') as unknown as Response);
    await Promise.resolve();
    await Promise.resolve();

    expect(component.recipe()?.id).toBe('A');
    // The route the user is on still points at A — the singleton must match.
    expect(recipeState.currentRecipe()?.id).toBe('A');
  });

  it('surfaces a failed generation instead of an empty recipe page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'r-1',
          status: 'error',
          is_canonical: false,
          data: { id: 'r-1', name: 'Generating...' },
        }),
      })
    );

    const { component } = createComponent();
    emitId('r-1');
    await vi.waitFor(() => expect(component.loadState()).toBe('generation-failed'));

    expect(routerNavigate).not.toHaveBeenCalled();
  });

  // KAN-243 tracks in-flight image generation, but only for requests THIS
  // session issued. Landing on a `generating_image` row from a deep link or a
  // refresh left nothing tracking it, so the page showed the "no image"
  // placeholder while the worker was still running.
  it('renders a generating_image recipe and joins the in-flight image request', async () => {
    let settleImage: (url: string) => void = () => {};
    const { component, recipeState, geminiService } = (() => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'r-1',
            status: 'generating_image',
            is_canonical: false,
            data: { id: 'r-1', name: 'Vegan Cornbread', ingredients: {}, instructions: ['bake'] },
          }),
        })
      );
      return createComponent({
        generateImage: () =>
          new Promise<string>((resolve) => {
            settleImage = resolve;
          }),
      });
    })();

    emitId('r-1');
    await vi.waitFor(() => expect(component.loadState()).toBe('ready'));

    // The recipe text renders...
    expect(component.recipe()?.name).toBe('Vegan Cornbread');
    // ...and the photo slot spins rather than showing the empty placeholder.
    expect(recipeState.isImageGenerating()).toBe(true);
    // Joined, not re-queued: force_regenerate must be false.
    expect(geminiService.generateImage).toHaveBeenCalledWith('r-1', false);

    settleImage('/api/recipes/r-1/image');
    await vi.waitFor(() => expect(recipeState.isImageGenerating()).toBe(false));
    expect((component.recipe() as { ai_image_url?: string }).ai_image_url).toBe(
      '/api/recipes/r-1/image'
    );
  });

  // GH #3263 (KAN-149): GET /api/recipes/:id returns the row shape
  // ({…columns, data: {…blob}}) — rendering it raw left ingredients and
  // instructions undefined and blanked the page on refresh.
  it('normalizes the API row shape before viewing (cold deep link)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'row-1',
          name: 'Vegan Zucchini Poppers',
          slug: 'vegan-zucchini-poppers-2',
          is_public: true,
          is_canonical: false,
          origin: 'generated',
          data: {
            id: 'row-1',
            name: 'Vegan Zucchini Poppers',
            servings: 4,
            ingredients: { wet: [], dry: [], other: [] },
            instructions: ['fry'],
            slug: 'stale-blob-slug',
          },
        }),
      })
    );

    const { component } = createComponent();
    emitId('row-1');
    await vi.waitFor(() => expect(component.recipe()).not.toBeNull());

    const r = component.recipe() as {
      ingredients?: unknown;
      instructions?: unknown;
      slug?: string;
    } | null;
    expect(r?.ingredients).toEqual({ wet: [], dry: [], other: [] });
    expect(r?.instructions).toEqual(['fry']);
    // Column beats the lagging blob copy (KAN-139 merge).
    expect(r?.slug).toBe('vegan-zucchini-poppers-2');
    // Cold deep link — Save stays enabled (#3210).
    expect(component.isSaved()).toBe(false);
  });

  // KAN-137 confirm-guard: first publish of a copy saved from a public recipe
  // must be an informed choice — and "no" must leave the recipe untouched.
  // KAN-140: generated notes render live on /r/<slug> unmoderated, so the
  // editor only ever touches the private personalNotes field.
  describe('notes editor edits personalNotes only', () => {
    it('opens with personalNotes, not the generated notes', () => {
      const { component } = createComponent({ isGuest: false });
      component.recipe.set({
        id: 'pub-1',
        name: 'Vegan Cornbread',
        is_public: true,
        slug: 'vegan-cornbread',
        notes: 'generated public notes',
        personalNotes: 'my private tweaks',
      } as never);

      component.startEditNotes();

      expect(component.isEditingNotes()).toBe(true);
      expect(component.editedNotes()).toBe('my private tweaks');
    });

    it('saveNotes writes personalNotes and leaves the generated notes untouched', async () => {
      const { component, persistenceSaveRecipe } = createComponent({ isGuest: false });
      component.recipe.set({
        id: 'pub-1',
        name: 'Vegan Cornbread',
        is_public: true,
        slug: 'vegan-cornbread',
        notes: 'generated public notes',
      } as never);

      component.startEditNotes();
      component.editedNotes.set('do not tell the internet');
      await component.saveNotes();

      const saved = component.recipe() as {
        notes?: string;
        personalNotes?: string;
      } | null;
      expect(saved?.notes).toBe('generated public notes');
      expect(saved?.personalNotes).toBe('do not tell the internet');
      expect(persistenceSaveRecipe).toHaveBeenCalledOnce();
    });
  });

  describe('togglePublic confirm-guard', () => {
    const savedCopy = () =>
      ({
        id: 'copy-1',
        name: 'Vegan Cornbread',
        ingredients: { wet: [], dry: [], other: [] },
        instructions: [],
        sourceSlug: 'vegan-cornbread',
      }) as never;

    // RCP-74: saved copies cannot be published. The toggle is disabled and
    // togglePublic() refuses with the D1 redirect toast — "already live at
    // [here]" linking the source's public page. confirm is stubbed to ACCEPT
    // so a reintroduced confirm flow would publish and fail this test.
    it('blocks publishing a saved copy with the already-live link toast (RCP-74)', async () => {
      const confirmMock = vi.fn().mockReturnValue(true);
      vi.stubGlobal('confirm', confirmMock);
      const { component, persistenceSaveRecipe } = createComponent({ isGuest: false });

      const recipe = savedCopy() as { is_public?: boolean; sourceSlug: string };
      await component.togglePublic(recipe as never);

      expect(confirmMock).not.toHaveBeenCalled();
      expect(toastShow).toHaveBeenCalledWith(
        expect.stringMatching(/already live/i),
        null,
        expect.any(Number),
        { url: '/r/vegan-cornbread', label: 'here' }
      );
      expect(recipe.is_public).toBeFalsy();
      expect(persistenceSaveRecipe).not.toHaveBeenCalled();
    });

    it('does not prompt when publishing an own recipe (no sourceSlug)', async () => {
      const confirmMock = vi.fn();
      vi.stubGlobal('confirm', confirmMock);
      const { component, persistenceSaveRecipe } = createComponent({ isGuest: false });

      const recipe = { ...(savedCopy() as object), sourceSlug: undefined } as {
        is_public?: boolean;
      };
      await component.togglePublic(recipe as never);

      expect(confirmMock).not.toHaveBeenCalled();
      expect(persistenceSaveRecipe).toHaveBeenCalledOnce();
      expect(persistenceSaveRecipe).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'copy-1', is_public: true })
      );
    });

    // GH #3262 (KAN-149): the server owns slug minting — the client no longer
    // predicts one, and adopts the server's answer once the sync resolves.
    it('sends no client-derived slug and adopts the server-minted slug after sync', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
      const { component, persistenceSaveRecipe, authUser } = createComponent({ isGuest: false });

      const recipe = { ...(savedCopy() as object), sourceSlug: undefined } as unknown as {
        id: string;
        is_public?: boolean;
        slug?: string;
      };
      component.recipe.set(recipe as never);
      // Emulate the persistence mirror-back: the server minted a -2 slug on
      // name collision and auth state was updated before saveRecipe resolved.
      persistenceSaveRecipe.mockImplementation(async (saved: { slug?: string }) => {
        expect(saved.slug).toBeUndefined();
        authUser.savedRecipes = [{ ...recipe, is_public: true, slug: 'vegan-cornbread-2' }];
        return { ok: true };
      });

      await component.togglePublic(recipe as never);

      const viewed = component.recipe() as { is_public?: boolean; slug?: string } | null;
      expect(viewed?.is_public).toBe(true);
      expect(viewed?.slug).toBe('vegan-cornbread-2');
    });

    // KAN-104 (#3146): empty-slug titles are pre-checked client-side with an
    // explanatory toast instead of a silent server 400.
    it('blocks publishing a title that derives an empty slug and says why', async () => {
      const confirmMock = vi.fn();
      vi.stubGlobal('confirm', confirmMock);
      const { component, persistenceSaveRecipe } = createComponent({ isGuest: false });

      const recipe = {
        ...(savedCopy() as object),
        name: '🌮🌮🌮',
        sourceSlug: undefined,
      } as { is_public?: boolean };
      await component.togglePublic(recipe as never);

      expect(toastShow).toHaveBeenCalledWith(expect.stringMatching(/can't be published/i));
      expect(confirmMock).not.toHaveBeenCalled();
      expect(recipe.is_public).toBeFalsy();
      expect(persistenceSaveRecipe).not.toHaveBeenCalled();
    });

    it('reverts and surfaces a toast when the publish fails to sync', async () => {
      const { component, persistenceSaveRecipe } = createComponent({ isGuest: false });
      persistenceSaveRecipe.mockResolvedValue(false);
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Use a non-saved recipe (no sourceSlug) to test the sync failure path.
      // RCP-74 blocks saved copies before reaching sync.
      const recipe = {
        ...(savedCopy() as object),
        sourceSlug: undefined,
      } as { is_public?: boolean };
      component.recipe.set(recipe as never);
      await component.togglePublic(recipe as never);

      // The viewed signal flips optimistically, then reverts to the original
      // object on sync failure (KAN-149: signal-driven, not in-place).
      const viewed = component.recipe() as { is_public?: boolean } | null;
      expect(viewed?.is_public).toBeFalsy();
      expect(toastShow).toHaveBeenCalledWith(expect.stringMatching(/publishing failed to sync/i));
      expect(consoleError).toHaveBeenCalled();
    });

    // KAN-140: manually entered recipes cannot be published.
    it('blocks publishing a manually entered recipe with a toast', async () => {
      const confirmMock = vi.fn();
      vi.stubGlobal('confirm', confirmMock);
      const { component, persistenceSaveRecipe } = createComponent({ isGuest: false });

      const recipe = {
        ...(savedCopy() as object),
        sourceSlug: undefined,
        origin: 'manual',
      } as { is_public?: boolean };
      await component.togglePublic(recipe as never);

      expect(toastShow).toHaveBeenCalledWith(expect.stringMatching(/manually entered/i));
      expect(recipe.is_public).toBeFalsy();
      expect(persistenceSaveRecipe).not.toHaveBeenCalled();
    });

    // KAN-139: canonical recipes are server-locked — the toggle must be inert.
    it('ignores toggle attempts on a canonical recipe', async () => {
      const confirmMock = vi.fn();
      vi.stubGlobal('confirm', confirmMock);
      const { component, persistenceSaveRecipe } = createComponent({ isGuest: false });

      const recipe = {
        ...(savedCopy() as object),
        sourceSlug: undefined,
        is_canonical: true,
        is_public: true,
        slug: 'vegan-cornbread',
      } as { is_public?: boolean };
      await component.togglePublic(recipe as never);

      expect(confirmMock).not.toHaveBeenCalled();
      expect(recipe.is_public).toBe(true);
      expect(persistenceSaveRecipe).not.toHaveBeenCalled();
    });

    it('does not prompt on unpublish', async () => {
      const confirmMock = vi.fn();
      vi.stubGlobal('confirm', confirmMock);
      const { component, persistenceSaveRecipe } = createComponent({ isGuest: false });

      const recipe = {
        ...(savedCopy() as object),
        is_public: true,
        slug: 'vegan-cornbread-2',
      } as { is_public?: boolean };
      await component.togglePublic(recipe as never);

      expect(confirmMock).not.toHaveBeenCalled();
      expect(persistenceSaveRecipe).toHaveBeenCalledOnce();
      // Unpublish keeps the slug (KAN-139: unpublished rows retain slugs).
      expect(persistenceSaveRecipe).toHaveBeenCalledWith(
        expect.objectContaining({ is_public: false, slug: 'vegan-cornbread-2' })
      );
    });
  });
});
