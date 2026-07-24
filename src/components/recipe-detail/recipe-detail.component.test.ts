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

describe('RecipeDetailComponent.fetchRecipeFromApi error handling', () => {
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

  const createComponent = (opts: { isGuest?: boolean } = {}) => {
    const recipeState = runInInjectionContext(
      Injector.create({ providers: [] }),
      () => new RecipeStateService()
    );
    const persistenceSaveRecipe = vi.fn().mockResolvedValue(true);

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
            currentUser: () => ({ isGuest: opts.isGuest ?? true, savedRecipes: [] }),
            saveRecipe: vi.fn(),
          },
        },
        { provide: PersistenceService, useValue: { saveRecipe: persistenceSaveRecipe } },
        { provide: GeminiService, useValue: {} },
        { provide: RecipeStateService, useValue: recipeState },
        { provide: ToastService, useValue: { show: toastShow } },
        { provide: ModalService, useValue: { openAuth: vi.fn() } },
      ],
    });
    const component = runInInjectionContext(injector, () => new RecipeDetailComponent());
    return { component, persistenceSaveRecipe };
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

  it('shows "Recipe not found" toast on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    createComponent();
    emitId('missing-id');
    await vi.waitFor(() => expect(toastShow).toHaveBeenCalled());

    expect(toastShow).toHaveBeenCalledWith('Recipe not found');
    expect(routerNavigate).toHaveBeenCalledWith(['/kitchen'], { replaceUrl: true });
  });

  it('shows server error toast on 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    createComponent();
    emitId('broken-id');
    await vi.waitFor(() => expect(toastShow).toHaveBeenCalled());

    expect(toastShow).toHaveBeenCalledWith('Failed to load recipe. Please try again.');
    expect(routerNavigate).toHaveBeenCalledWith(['/kitchen'], { replaceUrl: true });
  });

  it('shows connection error toast on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    createComponent();
    emitId('unreachable-id');
    await vi.waitFor(() => expect(toastShow).toHaveBeenCalled());

    expect(toastShow).toHaveBeenCalledWith('Connection error. Check your network and try again.');
    expect(routerNavigate).toHaveBeenCalledWith(['/kitchen'], { replaceUrl: true });
  });

  // KAN-137 confirm-guard: first publish of a copy saved from a public recipe
  // must be an informed choice — and "no" must leave the recipe untouched.
  describe('togglePublic confirm-guard', () => {
    const savedCopy = () =>
      ({
        id: 'copy-1',
        name: 'Vegan Cornbread',
        ingredients: { wet: [], dry: [], other: [] },
        instructions: [],
        sourceSlug: 'vegan-cornbread',
      }) as never;

    it('prompts before first publish of a sourceSlug copy and aborts on "no"', async () => {
      const confirmMock = vi.fn().mockReturnValue(false);
      vi.stubGlobal('confirm', confirmMock);
      const { component, persistenceSaveRecipe } = createComponent({ isGuest: false });

      const recipe = savedCopy() as { is_public?: boolean; sourceSlug: string };
      await component.togglePublic(recipe as never);

      expect(confirmMock).toHaveBeenCalledOnce();
      expect(confirmMock.mock.calls[0][0]).toContain('/r/vegan-cornbread');
      expect(recipe.is_public).toBeFalsy();
      expect(persistenceSaveRecipe).not.toHaveBeenCalled();
    });

    it('publishes the copy when confirmed', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
      const { component, persistenceSaveRecipe } = createComponent({ isGuest: false });

      const recipe = savedCopy() as { is_public?: boolean };
      await component.togglePublic(recipe as never);

      expect(recipe.is_public).toBe(true);
      expect(persistenceSaveRecipe).toHaveBeenCalledOnce();
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
      expect(recipe.is_public).toBe(true);
      expect(persistenceSaveRecipe).toHaveBeenCalledOnce();
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
      expect(recipe.is_public).toBe(false);
      expect(persistenceSaveRecipe).toHaveBeenCalledOnce();
    });
  });
});
