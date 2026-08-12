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

  const createHost = (opts: { isGuest?: boolean; publishStateSync?: string } = {}) => {
    const recipeState = runInInjectionContext(
      Injector.create({ providers: [] }),
      () => new RecipeStateService()
    );
    // One spy behind both save entry points: saveNotes uses saveRecipe,
    // togglePublic uses saveRecipeDetailed (KAN-155). `{ ok: true }` satisfies
    // both — it is the SaveOutcome the detailed caller reads, and truthy for the
    // boolean one.
    const persistenceSaveRecipe = vi.fn().mockResolvedValue({ ok: true });
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
          useValue: {
            saveRecipe: persistenceSaveRecipe,
            saveRecipeDetailed: persistenceSaveRecipe,
            publishStateSync: () => opts.publishStateSync ?? 'synced',
          },
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

  // GH #3255 (KAN-143): the reason a toggle is unavailable used to live only in
  // a `title` on a `disabled` button, which neither surfaces a tooltip reliably
  // nor is reachable by keyboard — so the explanation could never appear.
  // Activating an unavailable toggle now says why out loud.
  it('says why a canonical recipe cannot be unpublished', async () => {
    const { host, persistenceSaveRecipe } = createHost();

    await host.togglePublic({
      id: 'r1',
      name: 'Vegan Cornbread',
      is_canonical: true,
      is_public: true,
    } as never);

    expect(toastShow).toHaveBeenCalledWith(expect.stringMatching(/locked/i));
    expect(persistenceSaveRecipe).not.toHaveBeenCalled();
  });

  it('says why the toggle is inert while the publish state is still syncing', async () => {
    const { host, persistenceSaveRecipe } = createHost({ publishStateSync: 'pending' });

    await host.togglePublic({ id: 'r1', name: 'Vegan Cornbread' } as never);

    expect(toastShow).toHaveBeenCalledWith(expect.stringMatching(/checking publish state/i));
    expect(persistenceSaveRecipe).not.toHaveBeenCalled();
  });

  // RCP-74 poison pill, owed since the "publishes the copy when confirmed"
  // test was removed with the KAN-137 confirm flow: no test would otherwise
  // fail if the guard were relaxed and a saved copy published again. confirm
  // is stubbed to ACCEPT, so resurrecting any confirm-then-publish path
  // reaches the save and fails here.
  it('refuses to publish a saved copy — guard path, no confirm, nothing saved', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const { host, persistenceSaveRecipe } = createHost({ isGuest: false });
    const recipe = {
      id: 'copy-1',
      name: 'Vegan Cornbread',
      sourceSlug: 'vegan-cornbread',
    } as unknown as { is_public?: boolean };
    host.recipe.set(recipe as never);

    await host.togglePublic(recipe as never);

    expect(persistenceSaveRecipe).not.toHaveBeenCalled();
    expect((host.recipe() as { is_public?: boolean } | null)?.is_public).toBeFalsy();
    // The D1 refusal: a redirect to the live page, not a plain scold.
    expect(toastShow).toHaveBeenCalledWith(expect.stringMatching(/already live/i), null, 6000, {
      url: '/r/vegan-cornbread',
      label: 'here',
    });
  });

  // GH #3256 (KAN-144): manual entry wrote the user's own notes into `notes`,
  // the generated-content field the editor treats as read-only — so those notes
  // were frozen and the pencil opened an empty box. Manual recipes are never
  // published, so nothing public depends on their `notes`: adopt the text.
  it('seeds the editor from the legacy notes of a manually entered recipe', () => {
    const { host } = createHost();
    host.recipe.set({
      id: 'r1',
      name: 'Grandma Cornbread',
      origin: 'manual',
      notes: 'skillet must be screaming hot',
    } as never);

    host.startEditNotes();

    expect(host.editedNotes()).toBe('skillet must be screaming hot');
  });

  it('migrates legacy manual notes into personalNotes and clears the legacy field', async () => {
    const { host, persistenceSaveRecipe } = createHost();
    host.recipe.set({
      id: 'r1',
      name: 'Grandma Cornbread',
      origin: 'manual',
      notes: 'skillet must be screaming hot',
    } as never);

    host.startEditNotes();
    host.editedNotes.set('skillet must be screaming hot — and use bacon fat');
    await host.saveNotes();

    const saved = host.recipe() as { notes?: string; personalNotes?: string } | null;
    expect(saved?.personalNotes).toBe('skillet must be screaming hot — and use bacon fat');
    expect(saved?.notes).toBe('');
    expect(persistenceSaveRecipe).toHaveBeenCalledWith(expect.objectContaining({ notes: '' }));
  });

  it('never adopts the generated notes of a generated recipe', async () => {
    const { host } = createHost();
    host.recipe.set({
      id: 'r1',
      name: 'Vegan Cornbread',
      origin: 'generated',
      notes: 'generated public notes',
    } as never);

    host.startEditNotes();
    expect(host.editedNotes()).toBe('');

    host.editedNotes.set('my private tweaks');
    await host.saveNotes();

    const saved = host.recipe() as { notes?: string; personalNotes?: string } | null;
    expect(saved?.notes).toBe('generated public notes');
    expect(saved?.personalNotes).toBe('my private tweaks');
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
