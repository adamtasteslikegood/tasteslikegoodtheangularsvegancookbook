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

  const createComponent = (opts: { isGuest?: boolean } = {}) => {
    const recipeState = runInInjectionContext(
      Injector.create({ providers: [] }),
      () => new RecipeStateService()
    );
    const persistenceSaveRecipe = vi.fn().mockResolvedValue(true);
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
          useValue: { saveRecipe: persistenceSaveRecipe, publishStateSync: () => 'synced' },
        },
        { provide: GeminiService, useValue: {} },
        { provide: RecipeStateService, useValue: recipeState },
        { provide: ToastService, useValue: { show: toastShow } },
        { provide: ModalService, useValue: { openAuth, openAddToCookbook: vi.fn() } },
      ],
    });
    const component = runInInjectionContext(injector, () => new GeneratorComponent());
    return { component, persistenceSaveRecipe, authUser };
  };

  const draftRecipe = () =>
    ({
      id: 'gen-1',
      name: 'Vegan Cornbread',
      ingredients: { wet: [], dry: [], other: [] },
      instructions: [],
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
      return true;
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

  it('prompts before first publish of a sourceSlug copy and aborts on "no"', async () => {
    const confirmMock = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirmMock);
    const { component, persistenceSaveRecipe } = createComponent({ isGuest: false });

    await component.togglePublic({
      ...(draftRecipe() as object),
      sourceSlug: 'vegan-cornbread',
    } as never);

    expect(confirmMock).toHaveBeenCalledOnce();
    expect(confirmMock.mock.calls[0][0]).toContain('/r/vegan-cornbread');
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
});
