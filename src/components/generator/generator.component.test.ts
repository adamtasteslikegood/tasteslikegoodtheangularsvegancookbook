import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorComponent, SAVE_SESSION_WAIT_MS } from './generator.component';
import { AuthService } from '../../services/auth.service';
import { PersistenceService } from '../../services/persistence.service';
import { GeminiService } from '../../services/gemini.service';
import { RecipeStateService } from '../../services/recipe-state.service';
import { ToastService } from '../../services/toast.service';
import { ModalService } from '../../services/modal.service';

// KAN-126 (#3209): GeneratorComponent carried ~13 methods byte-identical to
// RecipeDetailComponent but had no test file of its own, so the extraction
// into the shared base had no regression net on this side. These pin the
// shared behaviour *through the generator's surface* — above all the one
// branch where the two components legitimately differ (see the first test).
describe('GeneratorComponent shared recipe behaviour', () => {
  let toastShow: ReturnType<typeof vi.fn>;
  let openAuth: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    toastShow = vi.fn();
    openAuth = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const createComponent = (
    opts: {
      isGuest?: boolean;
      saveResult?: boolean;
      saveOutcome?: {
        ok: boolean;
        refusal?: string;
        alreadySaved?: boolean;
        noSession?: boolean;
      };
      /** AuthService.ready — pass a pending promise to hold the startup check open. */
      ready?: Promise<void>;
    } = {}
  ) => {
    const recipeState = runInInjectionContext(
      Injector.create({ providers: [] }),
      () => new RecipeStateService()
    );
    // One double for saveRecipe and saveRecipeDetailed (the publish tests
    // override it per case), resolving to a detailed SaveOutcome.
    const persistenceSaveRecipe = vi
      .fn()
      .mockResolvedValue(
        opts.saveOutcome ??
          (opts.saveResult === false ? { ok: false, refusal: 'sync' } : { ok: true })
      );
    const authUser = { isGuest: opts.isGuest ?? true, savedRecipes: [] as unknown[] };

    const injector = Injector.create({
      providers: [
        {
          provide: AuthService,
          useValue: {
            currentUser: () => authUser,
            saveRecipe: vi.fn(),
            updateRecipeField: vi.fn(),
            ensureGuestSession: vi.fn(),
            ready: opts.ready ?? Promise.resolve(),
          },
        },
        {
          provide: PersistenceService,
          useValue: {
            saveRecipe: persistenceSaveRecipe,
            saveRecipeDetailed: persistenceSaveRecipe,
            // KAN-255 post-image reconcile; null = row unreadable, the
            // branch that leaves the optimistic local write standing.
            refreshRecipeFromApi: vi.fn().mockResolvedValue(null),
            publishStateSync: () => 'synced',
          },
        },
        {
          provide: GeminiService,
          useValue: {
            generateRecipe: vi.fn().mockResolvedValue({
              id: 'gen-1',
              name: 'Vegan Cornbread',
              ingredients: { wet: [], dry: [], other: [] },
              instructions: [],
            }),
            generateImage: vi.fn().mockResolvedValue('/api/recipes/gen-1/image'),
          },
        },
        { provide: RecipeStateService, useValue: recipeState },
        { provide: ToastService, useValue: { show: toastShow } },
        { provide: ModalService, useValue: { openAuth, openAddToCookbook: vi.fn() } },
      ],
    });
    const component = runInInjectionContext(injector, () => new GeneratorComponent());
    return { component, persistenceSaveRecipe, authUser, recipeState, injector };
  };

  // The recipe as the status poll returns it once the worker's text has
  // landed: the `generated` label is the server's (KAN-330).
  const draftRecipe = (id = 'gen-1') =>
    ({
      id,
      name: 'Vegan Cornbread',
      ingredients: { wet: [], dry: [], other: [] },
      instructions: [],
      origin: 'generated',
    }) as never;

  // THE divergence from RecipeDetailComponent: the generator prompts a guest to
  // sign in, where recipe-detail returns silently (it renders a separate
  // "Sign in to publish" button instead). An extraction that collapses both
  // onto one implementation would silently drop this.
  it('opens the auth modal when a guest tries to publish, and saves nothing', async () => {
    const { component, persistenceSaveRecipe } = createComponent({ isGuest: true });

    await component.togglePublic(draftRecipe());

    expect(openAuth).toHaveBeenCalledOnce();
    expect(persistenceSaveRecipe).not.toHaveBeenCalled();
  });

  it('publishes immutably for a signed-in user and adopts the server-minted slug', async () => {
    const { component, persistenceSaveRecipe, authUser } = createComponent({ isGuest: false });
    const recipe = draftRecipe() as unknown as { id: string; is_public?: boolean; slug?: string };
    component.recipe.set(recipe as never);

    persistenceSaveRecipe.mockImplementation(async (saved: { slug?: string }) => {
      // The client must not predict a slug — the server mints it (#3262).
      expect(saved.slug).toBeUndefined();
      authUser.savedRecipes = [{ ...recipe, is_public: true, slug: 'vegan-cornbread-2' }];
      return { ok: true };
    });

    await component.togglePublic(recipe as never);

    expect(recipe.is_public).toBeFalsy(); // passed object never mutated
    const viewed = component.recipe() as { is_public?: boolean; slug?: string } | null;
    expect(viewed?.is_public).toBe(true);
    expect(viewed?.slug).toBe('vegan-cornbread-2');
  });

  it('blocks publishing a manually entered recipe with a toast', async () => {
    const { component, persistenceSaveRecipe } = createComponent({ isGuest: false });

    await component.togglePublic({ ...(draftRecipe() as object), origin: 'manual' } as never);

    expect(toastShow).toHaveBeenCalledWith(expect.stringMatching(/manually entered/i));
    expect(persistenceSaveRecipe).not.toHaveBeenCalled();
  });

  it('ignores toggle attempts on a canonical recipe', async () => {
    const { component, persistenceSaveRecipe } = createComponent({ isGuest: false });

    await component.togglePublic({
      ...(draftRecipe() as object),
      is_canonical: true,
      is_public: true,
      slug: 'vegan-cornbread',
    } as never);

    expect(persistenceSaveRecipe).not.toHaveBeenCalled();
  });

  it('blocks a title that derives an empty slug and says why', async () => {
    const { component, persistenceSaveRecipe } = createComponent({ isGuest: false });

    await component.togglePublic({ ...(draftRecipe() as object), name: '🌮🌮🌮' } as never);

    expect(toastShow).toHaveBeenCalledWith(expect.stringMatching(/can't be published/i));
    expect(persistenceSaveRecipe).not.toHaveBeenCalled();
  });

  // RCP-74: saved copies cannot be published. The guard refuses with the D1
  // redirect toast — "already live at [here]" linking the source's public
  // page. confirm is stubbed to ACCEPT so a reintroduced KAN-137-style
  // confirm flow would publish and fail this test (poison pill).
  it('blocks publishing a saved copy with the already-live link toast (RCP-74)', async () => {
    const confirmMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirmMock);
    const { component, persistenceSaveRecipe } = createComponent({ isGuest: false });

    await component.togglePublic({
      ...(draftRecipe() as object),
      sourceSlug: 'vegan-cornbread',
    } as never);

    expect(confirmMock).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledWith(
      expect.stringMatching(/already live/i),
      null,
      expect.any(Number),
      { url: '/r/vegan-cornbread', label: 'here' }
    );
    expect(persistenceSaveRecipe).not.toHaveBeenCalled();
  });

  it('reverts the viewed signal and toasts when the publish fails to sync', async () => {
    const { component, persistenceSaveRecipe } = createComponent({ isGuest: false });
    persistenceSaveRecipe.mockResolvedValue(false);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const recipe = draftRecipe() as unknown as { is_public?: boolean };
    component.recipe.set(recipe as never);
    await component.togglePublic(recipe as never);

    const viewed = component.recipe() as { is_public?: boolean } | null;
    expect(viewed?.is_public).toBeFalsy();
    expect(toastShow).toHaveBeenCalledWith(expect.stringMatching(/publishing failed to sync/i));
    expect(consoleError).toHaveBeenCalled();
  });

  // KAN-140: generated notes render live on /r/<slug>, so the editor only ever
  // touches the private personalNotes field.
  it('notes editor opens with personalNotes and never rewrites the generated notes', async () => {
    const { component } = createComponent({ isGuest: false });
    component.recipe.set({
      ...(draftRecipe() as object),
      notes: 'generated public notes',
      personalNotes: 'my private tweaks',
    } as never);

    component.startEditNotes();
    expect(component.editedNotes()).toBe('my private tweaks');

    component.editedNotes.set('do not tell the internet');
    await component.saveNotes();

    const saved = component.recipe() as { notes?: string; personalNotes?: string } | null;
    expect(saved?.notes).toBe('generated public notes');
    expect(saved?.personalNotes).toBe('do not tell the internet');
  });

  it('scales ingredient amounts and servings by the portion multiplier', () => {
    const { component } = createComponent({ isGuest: false });
    component.recipe.set({
      ...(draftRecipe() as object),
      servings: 4,
      ingredients: { dry: [{ name: 'flour', amount: 2, unit: 'cup' }] },
    } as never);

    component.updatePortions(2);

    expect(component.scaledServings()).toBe(8);
    expect(component.scaledIngredients()?.dry?.[0].amount).toBe(4);
  });

  it('formats common fractional amounts', () => {
    const { component } = createComponent();
    expect(component.formatAmount(0.25)).toBe('1/4');
    expect(component.formatAmount(0.5)).toBe('1/2');
    expect(component.formatAmount(2)).toBe('2');
    expect(component.formatAmount([1, 2])).toBe('1 - 2');
  });

  it('routes generated recipes through the shared view event and reports offline saves', async () => {
    const action = vi.fn();
    vi.stubGlobal('tlgAnalytics', { action });
    const { component, recipeState } = createComponent({ saveResult: false });
    component.prompt.set('vegan cornbread');

    await component.onGenerate();

    expect(recipeState.currentRecipe()?.id).toBe('gen-1');
    expect(action).toHaveBeenCalledWith('recipe_view', {
      surface: 'spa',
      saved: false,
      slug: null,
    });
    expect(action).toHaveBeenCalledWith('recipe_saved', {
      surface: 'spa',
      source: 'generated',
      outcome: 'saved_offline',
      slug: null,
    });
    expect(component.isSaved()).toBe(true);
  });

  it('records a generated view before persistence settles', async () => {
    const action = vi.fn();
    vi.stubGlobal('tlgAnalytics', { action });
    let resolveSave!: (outcome: { ok: boolean }) => void;
    const { component, persistenceSaveRecipe, recipeState } = createComponent();
    persistenceSaveRecipe.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      })
    );
    component.prompt.set('vegan cornbread');

    const generating = component.onGenerate();
    await vi.waitFor(() => expect(recipeState.currentRecipe()?.id).toBe('gen-1'));

    expect(action).toHaveBeenCalledWith('recipe_view', {
      surface: 'spa',
      saved: false,
      slug: null,
    });
    expect(component.isSaved()).toBe(false);

    resolveSave({ ok: true });
    await generating;
    expect(component.isSaved()).toBe(true);
  });

  it('blocks a manual save while the generated recipe save is still pending', async () => {
    const action = vi.fn();
    vi.stubGlobal('tlgAnalytics', { action });
    let resolveSave!: (outcome: { ok: boolean }) => void;
    const { component, persistenceSaveRecipe, recipeState } = createComponent();
    persistenceSaveRecipe.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      })
    );
    component.prompt.set('vegan cornbread');

    const generating = component.onGenerate();
    await vi.waitFor(() => expect(recipeState.currentRecipe()?.id).toBe('gen-1'));
    expect(component.isCurrentRecipeSaving()).toBe(true);

    await component.onSaveRecipe();
    expect(persistenceSaveRecipe).toHaveBeenCalledOnce();

    resolveSave({ ok: true });
    await generating;
    expect(component.isCurrentRecipeSaving()).toBe(false);
    expect(action.mock.calls.filter(([name]) => name === 'recipe_saved')).toHaveLength(1);
  });

  it('coalesces rapid repeated manual saves for the same recipe', async () => {
    const action = vi.fn();
    vi.stubGlobal('tlgAnalytics', { action });
    let resolveSave!: (outcome: { ok: boolean }) => void;
    const { component, persistenceSaveRecipe, recipeState } = createComponent();
    recipeState.stageRecipeForNavigation(draftRecipe(), false);
    persistenceSaveRecipe.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      })
    );

    const first = component.onSaveRecipe();
    const second = component.onSaveRecipe();
    await second;
    expect(component.isCurrentRecipeSaving()).toBe(true);
    // The first save reaches persistence after the auth-ready wait (KAN-306).
    await vi.waitFor(() => expect(persistenceSaveRecipe).toHaveBeenCalledOnce());

    resolveSave({ ok: true });
    await first;
    expect(component.isCurrentRecipeSaving()).toBe(false);
    expect(action.mock.calls.filter(([name]) => name === 'recipe_saved')).toHaveLength(1);
  });

  it('does not let a stale generated-save result update a newly selected recipe', async () => {
    const action = vi.fn();
    vi.stubGlobal('tlgAnalytics', { action });
    let resolveSave!: (outcome: { ok: boolean }) => void;
    const { component, persistenceSaveRecipe, recipeState } = createComponent();
    persistenceSaveRecipe.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      })
    );
    component.prompt.set('vegan cornbread');

    const generating = component.onGenerate();
    await vi.waitFor(() => expect(recipeState.currentRecipe()?.id).toBe('gen-1'));
    recipeState.stageRecipeForNavigation(draftRecipe('gen-2'), false);

    resolveSave({ ok: true });
    await generating;
    expect(component.recipe()?.id).toBe('gen-2');
    expect(component.isSaved()).toBe(false);
    expect(action).toHaveBeenCalledWith('recipe_saved', expect.anything());
  });

  it('does not let a stale manual-save result update a newly selected recipe', async () => {
    const action = vi.fn();
    vi.stubGlobal('tlgAnalytics', { action });
    let resolveSave!: (outcome: { ok: boolean }) => void;
    const { component, persistenceSaveRecipe, recipeState } = createComponent();
    recipeState.stageRecipeForNavigation(draftRecipe(), false);
    persistenceSaveRecipe.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      })
    );

    const saving = component.onSaveRecipe();
    recipeState.stageRecipeForNavigation(draftRecipe('gen-2'), false);
    resolveSave({ ok: true });
    await saving;

    expect(component.recipe()?.id).toBe('gen-2');
    expect(component.isSaved()).toBe(false);
    expect(action).toHaveBeenCalledWith('recipe_saved', expect.anything());
  });

  it('reports a manual generator save as offline when API sync fails', async () => {
    const action = vi.fn();
    vi.stubGlobal('tlgAnalytics', { action });
    const { component } = createComponent({ saveResult: false });
    component.recipe.set(draftRecipe());

    await component.onSaveRecipe();

    expect(action).toHaveBeenCalledWith('recipe_saved', {
      surface: 'spa',
      source: 'generator_save',
      outcome: 'saved_offline',
      slug: null,
    });
  });

  it.each([
    [{ ok: true, alreadySaved: true }, 'already_saved'],
    [{ ok: true }, 'saved'],
    [{ ok: false, refusal: 'sync' }, 'saved_offline'],
  ])('maps a manual save outcome %o to recipe_saved %s', async (saveOutcome, outcome) => {
    const action = vi.fn();
    vi.stubGlobal('tlgAnalytics', { action });
    const { component } = createComponent({ saveOutcome });
    component.recipe.set(draftRecipe());

    await component.onSaveRecipe();

    expect(action).toHaveBeenCalledWith('recipe_saved', {
      surface: 'spa',
      source: 'generator_save',
      outcome,
      slug: null,
    });
    expect(component.isSaved()).toBe(true);
  });

  it.each([
    { ok: true, noSession: true },
    { ok: false, refusal: 'ownership' },
    { ok: false, refusal: 'duplicate' },
  ])('keeps manual Save enabled when persistence is unconfirmed (%o)', async (saveOutcome) => {
    const action = vi.fn();
    vi.stubGlobal('tlgAnalytics', { action });
    const { component } = createComponent({ saveOutcome });
    component.recipe.set(draftRecipe());

    await component.onSaveRecipe();

    expect(component.isSaved()).toBe(false);
    expect(action).not.toHaveBeenCalledWith('recipe_saved', expect.anything());
  });

  it('emits no recipe_saved when there was no session, so nothing was saved', async () => {
    const action = vi.fn();
    vi.stubGlobal('tlgAnalytics', { action });
    const { component } = createComponent({ saveOutcome: { ok: true, noSession: true } });
    component.prompt.set('vegan cornbread');

    await component.onGenerate();

    expect(action).toHaveBeenCalledWith('recipe_view', {
      surface: 'spa',
      saved: false,
      slug: null,
    });
    expect(action).not.toHaveBeenCalledWith('recipe_saved', expect.anything());
    expect(component.isSaved()).toBe(false);
  });

  // KAN-306: a returning visitor with a cached signed-in session has no
  // session at all until the startup auth check settles (ensureGuestSession
  // defers). A save made in that window used to report ok and keep nothing.
  describe('save during the deferred startup auth check (KAN-306)', () => {
    const holdAuthOpen = () => {
      let release!: () => void;
      const ready = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { ready, release };
    };

    it('waits for the auth check before saving a generated recipe, then keeps it', async () => {
      const { ready, release } = holdAuthOpen();
      const { component, persistenceSaveRecipe, recipeState } = createComponent({ ready });
      component.prompt.set('vegan cornbread');

      const generating = component.onGenerate();
      await vi.waitFor(() => expect(recipeState.currentRecipe()?.id).toBe('gen-1'));
      // The recipe is generated, but the session is not settled: no save yet.
      expect(persistenceSaveRecipe).not.toHaveBeenCalled();

      release();
      await generating;

      expect(persistenceSaveRecipe).toHaveBeenCalledOnce();
      expect(persistenceSaveRecipe.mock.calls[0][0].id).toBe('gen-1');
      expect(component.isSaved()).toBe(true);
    });

    it('waits for the auth check before a manual generator save', async () => {
      const { ready, release } = holdAuthOpen();
      const { component, persistenceSaveRecipe } = createComponent({ ready });
      component.recipe.set(draftRecipe());

      const saving = component.onSaveRecipe();
      await Promise.resolve();
      expect(persistenceSaveRecipe).not.toHaveBeenCalled();

      release();
      await saving;

      expect(persistenceSaveRecipe).toHaveBeenCalledOnce();
      expect(component.isSaved()).toBe(true);
    });

    it('stops waiting on an auth check that never settles and still saves', async () => {
      vi.useFakeTimers();
      try {
        const { ready } = holdAuthOpen();
        const { component, persistenceSaveRecipe } = createComponent({ ready });
        component.recipe.set(draftRecipe());

        const saving = component.onSaveRecipe();
        await vi.advanceTimersByTimeAsync(SAVE_SESSION_WAIT_MS);
        await saving;

        expect(persistenceSaveRecipe).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    });

    it('saves after an auth check that fails instead of failing the generation', async () => {
      const ready = Promise.reject(new Error('auth check failed'));
      ready.catch(() => undefined);
      const { component, persistenceSaveRecipe, recipeState } = createComponent({ ready });
      component.prompt.set('vegan cornbread');

      await component.onGenerate();

      expect(persistenceSaveRecipe).toHaveBeenCalledOnce();
      expect(recipeState.currentRecipe()?.id).toBe('gen-1');
      expect(component.isSaved()).toBe(true);
    });
  });

  it.each(['duplicate', 'ownership', 'OWNERSHIP_OTHER_ACCOUNT'])(
    'emits no recipe_saved when a generated save is refused (%s)',
    async (refusal) => {
      const action = vi.fn();
      vi.stubGlobal('tlgAnalytics', { action });
      const { component } = createComponent({ saveOutcome: { ok: false, refusal } });
      component.prompt.set('vegan cornbread');

      await component.onGenerate();

      expect(action).toHaveBeenCalledWith('recipe_view', {
        surface: 'spa',
        saved: false,
        slug: null,
      });
      expect(action).not.toHaveBeenCalledWith('recipe_saved', expect.anything());
      expect(component.isSaved()).toBe(false);
    }
  );

  // KAN-256: `clearRecipe()` fired inside onGenerate() — submit-time, not
  // entry-time. The recipe lives on RecipeStateService (a root singleton) so
  // it outlived the component, and navigating back to the generator re-showed
  // the previous result under an empty prompt box. Route entry recreates the
  // component, so constructing a second one IS the repro.
  describe('route entry reset (KAN-256)', () => {
    it('shows an empty form when the generator is entered again', () => {
      const { component, recipeState, injector } = createComponent({ isGuest: false });
      recipeState.viewRecipe(draftRecipe());
      expect(component.recipe()).not.toBeNull();

      const reEntered = runInInjectionContext(injector, () => new GeneratorComponent());

      expect(reEntered.recipe()).toBeNull();
      expect(reEntered.prompt()).toBe('');
      expect(reEntered.error()).toBeNull();
      expect(reEntered.isSaved()).toBe(false);
    });

    it('does not cancel an in-flight image generation for the previous recipe', async () => {
      // The spinner and the KAN-255 reconcile are tracked by recipe id on the
      // service, so leaving the generator must not discard them — recipe-detail
      // still has to show the spinner for that recipe.
      const { recipeState, injector } = createComponent({ isGuest: false });
      let settle: (url: string) => void = () => {};
      recipeState.trackImageGeneration(
        'gen-1',
        new Promise<string>((resolve) => {
          settle = resolve;
        })
      );
      recipeState.viewRecipe(draftRecipe());
      expect(recipeState.isImageGenerating()).toBe(true);

      runInInjectionContext(injector, () => new GeneratorComponent());

      // Cleared here (nothing is being viewed)...
      expect(recipeState.currentRecipe()).toBeNull();
      // ...but still tracked, so the recipe's own page still spins.
      recipeState.viewRecipe(draftRecipe());
      expect(recipeState.isImageGenerating()).toBe(true);

      settle('/api/recipes/gen-1/image');
      await Promise.resolve();
      await Promise.resolve();
      expect(recipeState.isImageGenerating()).toBe(false);
    });
  });

  // The generation outlives the component that started it, so its state has
  // to as well. Constructing a second component from the same injector IS
  // leaving the generator and coming back (see KAN-256 above).
  describe('generation in flight (KAN-376, KAN-377, KAN-378)', () => {
    const pendingGeneration = (injector: Injector) => {
      let land!: (recipe: unknown) => void;
      let fail!: (error: Error) => void;
      const generateRecipe = vi.mocked(injector.get(GeminiService).generateRecipe);
      generateRecipe.mockReturnValue(
        new Promise((resolve, reject) => {
          land = resolve as (recipe: unknown) => void;
          fail = reject;
        }) as never
      );
      return { generateRecipe, land: (id = 'gen-1') => land(draftRecipe(id)), fail };
    };

    it('starts one generation however many times it is submitted (KAN-376)', async () => {
      const { component, injector } = createComponent();
      const { generateRecipe, land } = pendingGeneration(injector);
      component.prompt.set('vegan cornbread');

      const first = component.onGenerate();
      const second = component.onGenerate();
      await second;

      expect(generateRecipe).toHaveBeenCalledOnce();
      expect(component.isRecipeLoading()).toBe(true);

      land();
      await first;
      expect(component.isRecipeLoading()).toBe(false);
      expect(component.recipe()?.id).toBe('gen-1');
    });

    it('still shows it cooking after leaving and coming back, then shows the recipe (KAN-377)', async () => {
      const { component, injector, recipeState } = createComponent();
      const { generateRecipe, land } = pendingGeneration(injector);
      component.prompt.set('vegan cornbread');
      const generating = component.onGenerate();

      recipeState.leaveGenerator();
      const reEntered = runInInjectionContext(injector, () => new GeneratorComponent());

      expect(reEntered.isRecipeLoading()).toBe(true);
      reEntered.prompt.set('something else');
      await reEntered.onGenerate();
      expect(generateRecipe).toHaveBeenCalledOnce();

      land();
      await generating;
      expect(reEntered.isRecipeLoading()).toBe(false);
      expect(reEntered.recipe()?.id).toBe('gen-1');
      expect(toastShow).not.toHaveBeenCalled();
    });

    it('leaves another recipe on screen alone, and says the new one is ready (KAN-378)', async () => {
      const { component, injector, recipeState, persistenceSaveRecipe } = createComponent();
      const { land } = pendingGeneration(injector);
      const generateImage = vi.mocked(injector.get(GeminiService).generateImage);
      component.prompt.set('vegan cornbread');
      const generating = component.onGenerate();

      // The user opens another recipe while the text is still cooking.
      recipeState.leaveGenerator();
      recipeState.viewRecipe(draftRecipe('other-recipe'));

      land();
      await generating;

      expect(recipeState.currentRecipe()?.id).toBe('other-recipe');
      expect(recipeState.isSaved()).toBe(true);
      expect(persistenceSaveRecipe).toHaveBeenCalledWith(expect.objectContaining({ id: 'gen-1' }));
      expect(generateImage).toHaveBeenCalledWith('gen-1', false);
      expect(toastShow).toHaveBeenCalledWith('"Vegan Cornbread" is ready. Find it in My Kitchen.');
      expect(recipeState.isRecipeGenerating()).toBe(false);
    });

    it('says the recipe is ready when the user leaves while it is being saved', async () => {
      const { component, injector, recipeState, persistenceSaveRecipe } = createComponent();
      let finishSave!: (outcome: { ok: boolean }) => void;
      persistenceSaveRecipe.mockReturnValue(
        new Promise((resolve) => {
          finishSave = resolve;
        })
      );
      component.prompt.set('vegan cornbread');
      const generating = component.onGenerate();
      await vi.waitFor(() => expect(recipeState.currentRecipe()?.id).toBe('gen-1'));

      // Leaves and comes back while the save is still going: route entry
      // clears the generator (KAN-256), so nothing shows the new recipe.
      recipeState.leaveGenerator();
      runInInjectionContext(injector, () => new GeneratorComponent());
      finishSave({ ok: true });
      await generating;

      expect(toastShow).toHaveBeenCalledWith('"Vegan Cornbread" is ready. Find it in My Kitchen.');
    });

    it('says the recipe is ready when the user goes to My Kitchen while it is being saved', async () => {
      const { component, recipeState, persistenceSaveRecipe } = createComponent();
      let finishSave!: (outcome: { ok: boolean }) => void;
      persistenceSaveRecipe.mockReturnValue(
        new Promise((resolve) => {
          finishSave = resolve;
        })
      );
      component.prompt.set('vegan cornbread');
      const generating = component.onGenerate();
      await vi.waitFor(() => expect(recipeState.currentRecipe()?.id).toBe('gen-1'));

      // My Kitchen keeps currentRecipe as a navigation cache and shows none of it.
      recipeState.leaveGenerator();
      recipeState.leaveRecipeView();
      finishSave({ ok: true });
      await generating;

      expect(recipeState.currentRecipe()?.id).toBe('gen-1');
      expect(toastShow).toHaveBeenCalledWith('"Vegan Cornbread" is ready. Find it in My Kitchen.');
    });

    it('frees the generator when starting a generation throws', async () => {
      const { component, injector } = createComponent();
      const ensureGuestSession = vi.mocked(injector.get(AuthService).ensureGuestSession);
      ensureGuestSession.mockImplementationOnce(() => {
        throw new Error('The operation is insecure.');
      });
      component.prompt.set('vegan cornbread');

      await component.onGenerate();

      expect(component.isRecipeLoading()).toBe(false);
      expect(component.error()).toBe('The operation is insecure.');
      await component.onGenerate();
      expect(component.recipe()?.id).toBe('gen-1');
    });

    it('reports a failure on the generator, or as a toast when the user has left', async () => {
      const onScreen = createComponent();
      const first = pendingGeneration(onScreen.injector);
      onScreen.component.prompt.set('vegan cornbread');
      const shown = onScreen.component.onGenerate();
      first.fail(new Error('Recipe generation failed.'));
      await shown;
      expect(onScreen.component.error()).toBe('Recipe generation failed.');
      expect(onScreen.component.isRecipeLoading()).toBe(false);
      expect(toastShow).not.toHaveBeenCalled();

      const away = createComponent();
      const second = pendingGeneration(away.injector);
      away.component.prompt.set('vegan cornbread');
      const hidden = away.component.onGenerate();
      away.recipeState.leaveGenerator();
      second.fail(new Error('Recipe generation failed.'));
      await hidden;
      expect(away.component.error()).toBeNull();
      expect(toastShow).toHaveBeenCalledWith('Recipe generation failed.');
    });
  });
});
