import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorComponent } from './generator.component';
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
    expect(persistenceSaveRecipe).toHaveBeenCalledOnce();

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
});
