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

  const createComponent = () => {
    const recipeState = runInInjectionContext(
      Injector.create({ providers: [] }),
      () => new RecipeStateService()
    );

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
            currentUser: () => ({ isGuest: true, savedRecipes: [] }),
          },
        },
        { provide: PersistenceService, useValue: { saveRecipe: vi.fn() } },
        { provide: GeminiService, useValue: {} },
        { provide: RecipeStateService, useValue: recipeState },
        { provide: ToastService, useValue: { show: toastShow } },
        { provide: ModalService, useValue: { openAuth: vi.fn() } },
      ],
    });
    const component = runInInjectionContext(injector, () => new RecipeDetailComponent());
    return component;
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
});
