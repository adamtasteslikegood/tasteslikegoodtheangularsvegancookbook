import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddToCookbookModalComponent } from './add-to-cookbook-modal.component';
import { AuthService } from '../../services/auth.service';
import { PersistenceService } from '../../services/persistence.service';
import { RecipeStateService } from '../../services/recipe-state.service';
import { ToastService } from '../../services/toast.service';

// KAN-333: adding a recipe to a cookbook, or removing it, closed the modal as
// if the change had stuck even when the server refused or never saw it. The
// local cookbook is replaced by the server's on the next hydrate, so an unsaid
// failure is a change that silently disappears.
describe('AddToCookbookModalComponent (KAN-333)', () => {
  let addRecipeToCookbook: ReturnType<typeof vi.fn>;
  let removeRecipeFromCookbook: ReturnType<typeof vi.fn>;
  let toastShow: ReturnType<typeof vi.fn>;
  let isSavedSet: ReturnType<typeof vi.fn>;
  let currentRecipe: unknown;

  const recipe = { id: 'r1', name: 'Vegan Cornbread' } as never;
  const user = {
    cookbooks: [
      { id: 'cb-in', name: 'Brunch', recipeIds: ['r1'] },
      { id: 'cb-out', name: 'Weeknights', recipeIds: [] as string[] },
    ],
  };

  beforeEach(() => {
    addRecipeToCookbook = vi.fn().mockResolvedValue({ ok: true });
    removeRecipeFromCookbook = vi.fn().mockResolvedValue({ ok: true });
    toastShow = vi.fn();
    isSavedSet = vi.fn();
    currentRecipe = null;
  });

  const createComponent = () => {
    const injector = Injector.create({
      providers: [
        { provide: AuthService, useValue: { currentUser: () => user } },
        {
          provide: PersistenceService,
          useValue: { addRecipeToCookbook, removeRecipeFromCookbook },
        },
        {
          provide: RecipeStateService,
          useValue: { currentRecipe: () => currentRecipe, isSaved: { set: isSavedSet } },
        },
        { provide: ToastService, useValue: { show: toastShow } },
      ],
    });
    const component = runInInjectionContext(injector, () => new AddToCookbookModalComponent());
    component.open(recipe);
    return component;
  };

  const addToWeeknights = async () => {
    const component = createComponent();
    component.toggleCookbookSelection('cb-out');
    await component.applyCookbookChanges();
    return component;
  };

  it('says nothing when the change lands', async () => {
    const component = await addToWeeknights();

    expect(addRecipeToCookbook).toHaveBeenCalledWith('cb-out', recipe);
    expect(toastShow).not.toHaveBeenCalled();
    expect(component.isOpen()).toBe(false);
  });

  it('says an add was not saved while recipe writes are paused', async () => {
    addRecipeToCookbook.mockResolvedValue({ ok: false, refusal: 'paused' });

    await addToWeeknights();

    expect(toastShow).toHaveBeenCalledOnce();
    const message = toastShow.mock.calls[0][0] as string;
    expect(message).toMatch(/not saved/i);
    expect(message).toMatch(/maintenance|few minutes/i);
  });

  it('says an add was not saved when the sync fails', async () => {
    addRecipeToCookbook.mockResolvedValue({ ok: false, refusal: 'sync' });

    await addToWeeknights();

    expect(toastShow).toHaveBeenCalledOnce();
    expect(toastShow.mock.calls[0][0]).toMatch(/not saved/i);
    expect(toastShow.mock.calls[0][0]).toMatch(/connection/i);
  });

  it('says what happened when the account already holds the recipe as another copy', async () => {
    addRecipeToCookbook.mockResolvedValue({ ok: false, refusal: 'duplicate' });

    await addToWeeknights();

    expect(toastShow).toHaveBeenCalledOnce();
    expect(toastShow.mock.calls[0][0]).toMatch(/already has this recipe/i);
  });

  it('says a removal was not saved when the sync fails', async () => {
    removeRecipeFromCookbook.mockResolvedValue({ ok: false, refusal: 'sync' });
    const component = createComponent();
    component.toggleCookbookSelection('cb-in');

    await component.applyCookbookChanges();

    expect(removeRecipeFromCookbook).toHaveBeenCalledWith('cb-in', 'r1');
    expect(toastShow).toHaveBeenCalledOnce();
    expect(toastShow.mock.calls[0][0]).toMatch(/not saved/i);
  });

  // The saved mark and the toast must agree: no mark when every change failed.
  it('marks the recipe on screen saved only when a change landed', async () => {
    currentRecipe = recipe;
    addRecipeToCookbook.mockResolvedValue({ ok: false, refusal: 'sync' });
    await addToWeeknights();
    expect(isSavedSet).not.toHaveBeenCalled();

    addRecipeToCookbook.mockResolvedValue({ ok: true });
    await addToWeeknights();
    expect(isSavedSet).toHaveBeenCalledWith(true);
  });
});
