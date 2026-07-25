import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { RecipeViewBase } from './recipe-view.base';
import { AuthService } from '../../services/auth.service';
import { PersistenceService } from '../../services/persistence.service';
import { GeminiService } from '../../services/gemini.service';
import { RecipeStateService } from '../../services/recipe-state.service';
import { ToastService } from '../../services/toast.service';
import { ModalService } from '../../services/modal.service';

// KAN-126 (#3209): the shared seam between GeneratorComponent and
// RecipeDetailComponent. The component test files cover the behaviour through
// each surface; this file pins the *contract of the abstraction itself* — above
// all onPublishDenied, the single hook where the two components legitimately
// diverge (generator opens the auth modal, recipe-detail stays silent).
describe('RecipeViewBase', () => {
  let toastShow: ReturnType<typeof vi.fn>;
  let denied: Mock<() => void>;

  beforeEach(() => {
    toastShow = vi.fn();
    denied = vi.fn<() => void>();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const createHost = (opts: { isGuest?: boolean } = {}) => {
    const recipeState = runInInjectionContext(
      Injector.create({ providers: [] }),
      () => new RecipeStateService()
    );
    const persistenceSaveRecipe = vi.fn().mockResolvedValue(true);
    const authUser = { isGuest: opts.isGuest ?? false, savedRecipes: [] as unknown[] };

    const injector = Injector.create({
      providers: [
        {
          provide: AuthService,
          useValue: {
            currentUser: () => authUser,
            saveRecipe: vi.fn(),
            updateRecipeField: vi.fn(),
          },
        },
        {
          provide: PersistenceService,
          useValue: { saveRecipe: persistenceSaveRecipe, publishStateSync: () => 'synced' },
        },
        { provide: GeminiService, useValue: {} },
        { provide: RecipeStateService, useValue: recipeState },
        { provide: ToastService, useValue: { show: toastShow } },
        { provide: ModalService, useValue: { openAuth: vi.fn() } },
      ],
    });

    class Host extends RecipeViewBase {
      protected override onPublishDenied(): void {
        denied();
      }
    }

    const host = runInInjectionContext(injector, () => new Host());
    return { host, persistenceSaveRecipe };
  };

  it('calls the onPublishDenied hook instead of saving when the user cannot publish', async () => {
    const { host, persistenceSaveRecipe } = createHost({ isGuest: true });

    await host.togglePublic({ id: 'r1', name: 'Vegan Cornbread' } as never);

    expect(denied).toHaveBeenCalledOnce();
    expect(persistenceSaveRecipe).not.toHaveBeenCalled();
  });

  it('does not call the hook when the user can publish', async () => {
    const { host, persistenceSaveRecipe } = createHost({ isGuest: false });

    await host.togglePublic({ id: 'r1', name: 'Vegan Cornbread' } as never);

    expect(denied).not.toHaveBeenCalled();
    expect(persistenceSaveRecipe).toHaveBeenCalledOnce();
  });

  it('flips publish state on a copy, never mutating the passed recipe', async () => {
    const { host, persistenceSaveRecipe } = createHost({ isGuest: false });
    const recipe = { id: 'r1', name: 'Vegan Cornbread' } as unknown as { is_public?: boolean };

    await host.togglePublic(recipe as never);

    expect(recipe.is_public).toBeFalsy();
    expect(persistenceSaveRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r1', is_public: true })
    );
  });

  it('formats fractional and ranged amounts', () => {
    const { host } = createHost();
    expect(host.formatAmount(0.33)).toBe('1/3');
    expect(host.formatAmount(0.75)).toBe('3/4');
    expect(host.formatAmount(3)).toBe('3');
    expect(host.formatAmount([1, 2])).toBe('1 - 2');
  });

  it('reads instruction text from both the string and step-object shapes', () => {
    const { host } = createHost();
    expect(host.instructionText('Preheat the oven')).toBe('Preheat the oven');
    expect(host.instructionText({ description: 'Fold the batter' } as never)).toBe(
      'Fold the batter'
    );
  });
});
