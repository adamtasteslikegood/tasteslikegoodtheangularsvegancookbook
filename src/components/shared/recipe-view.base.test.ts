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
import { recipeFromRow, type RecipeRow } from '../../utils/recipe-row';

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

  const createHost = (
    opts: {
      isGuest?: boolean;
      publishStateSync?: string;
      generateImage?: (id: string, force: boolean) => Promise<string>;
      refreshRecipeFromApi?: (id: string) => Promise<unknown>;
      savedRecipes?: unknown[];
    } = {}
  ) => {
    const recipeState = runInInjectionContext(
      Injector.create({ providers: [] }),
      () => new RecipeStateService()
    );
    // One spy behind both save entry points: saveNotes uses saveRecipe,
    // togglePublic uses saveRecipeDetailed (KAN-155). `{ ok: true }` satisfies
    // both — it is the SaveOutcome the detailed caller reads, and truthy for the
    // boolean one.
    const persistenceSaveRecipe = vi.fn().mockResolvedValue({ ok: true });
    // KAN-255: the post-image reconcile. Default null = "the row could not be
    // read", the branch that must leave the optimistic local write standing.
    const refreshRecipeFromApi = vi.fn(opts.refreshRecipeFromApi ?? (async () => null));
    const authUser = {
      isGuest: opts.isGuest ?? false,
      savedRecipes: (opts.savedRecipes ?? []) as unknown[],
    };

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
            refreshRecipeFromApi,
            publishStateSync: () => opts.publishStateSync ?? 'synced',
          },
        },
        {
          provide: GeminiService,
          useValue: { generateImage: opts.generateImage ?? vi.fn() },
        },
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
    const authService = injector.get(AuthService);
    return { host, persistenceSaveRecipe, refreshRecipeFromApi, recipeState, authService };
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

  // KAN-243 (review finding on #3433): `withCacheBuster` produces a *display*
  // marker. #3420's follow-up 61f8e6e persisted that busted URL into
  // `savedRecipes` so nav-away-and-back would not re-serve pre-regen bytes —
  // which meant a later full save (saveNotes POSTs the whole recipe) wrote the
  // client-only `?_t=<epoch>` marker back as the canonical `ai_image_url`.
  //
  // The marker now lives in RecipeStateService, keyed by recipe id, and is
  // applied only when building a display URL. Persisted state stays canonical
  // AND the buster still survives navigation.
  describe('image regeneration cache-buster (KAN-243)', () => {
    const CANONICAL = '/api/recipes/r1/image.jpg';

    it('persists the canonical image URL, not the cache-busted display URL', async () => {
      const { host, authService } = createHost({
        generateImage: vi.fn().mockResolvedValue(CANONICAL),
      });
      host.recipe.set({ id: 'r1', name: 'Vegan Cornbread' } as never);

      await host.regenerateImage();

      expect(authService.updateRecipeField).toHaveBeenCalledWith('r1', 'ai_image_url', CANONICAL);
      const persisted = (authService.updateRecipeField as Mock).mock.calls[0][2] as string;
      expect(persisted).not.toContain('_t=');
      // the in-memory domain object is canonical too
      expect((host.recipe() as { ai_image_url?: string }).ai_image_url).toBe(CANONICAL);
    });

    it('still shows a cache-busted URL for display after regenerating', async () => {
      const { host } = createHost({ generateImage: vi.fn().mockResolvedValue(CANONICAL) });
      host.recipe.set({ id: 'r1', name: 'Vegan Cornbread' } as never);

      await host.regenerateImage();

      expect(host.generatedImageUrl()).toMatch(/_t=\d+/);
    });

    it('regenerate -> navigate away and back -> save notes never POSTs a _t marker', async () => {
      const { host, recipeState, persistenceSaveRecipe, authService } = createHost({
        generateImage: vi.fn().mockResolvedValue(CANONICAL),
      });
      host.recipe.set({ id: 'r1', name: 'Vegan Cornbread', origin: 'generated' } as never);

      await host.regenerateImage();

      // Nav away, then back: the recipe rehydrates from persisted state, which
      // is what `updateRecipeField` wrote.
      const persisted = (authService.updateRecipeField as Mock).mock.calls[0][2] as string;
      recipeState.clearRecipe();
      recipeState.viewRecipe({
        id: 'r1',
        name: 'Vegan Cornbread',
        origin: 'generated',
        ai_image_url: persisted,
      } as never);

      // the buster survives navigation for display...
      expect(recipeState.generatedImageUrl()).toMatch(/_t=\d+/);

      host.startEditNotes();
      host.editedNotes.set('more paprika');
      await host.saveNotes();

      // ...but never reaches the API payload.
      const payload = persistenceSaveRecipe.mock.calls.at(-1)?.[0] as { ai_image_url?: string };
      expect(payload.ai_image_url).toBe(CANONICAL);
      expect(payload.ai_image_url).not.toContain('_t=');
    });
  });

  // KAN-255: the image pipeline finishes SERVER-side. The worker writes
  // `ai_image_gcs`, `ai_metadata.image_generation`, and flips
  // `ai_metadata.image_request.status` / `image_enqueue.status` from `pending`
  // to `complete`. The client wrote back only `ai_image_url`, so the copy it
  // held — and exported as JSON — still read `pending` with no GCS URI.
  describe('server image metadata reconcile (KAN-255)', () => {
    const CANONICAL = '/api/recipes/r1/image';
    // The row the worker leaves behind, as GET /api/recipes/:id returns it.
    const SERVER_ROW = {
      id: 'r1',
      data: {
        id: 'r1',
        name: 'Vegan Cornbread',
        origin: 'generated',
        ai_image_url: CANONICAL,
        ai_image_gcs: 'gs://tasteslikegood-recipe-images/r1/claim-abc.png',
        ai_metadata: {
          image_generation: { success: true, user_display_name: 'Background Worker' },
          image_enqueue: { status: 'complete' },
          image_request: { id: 'req-1', status: 'complete', force_regenerate: false },
        },
      },
      is_canonical: false,
      is_public: false,
      slug: null,
      source_slug: null,
      origin: 'generated',
    };

    const pendingRecipe = () =>
      ({
        id: 'r1',
        name: 'Vegan Cornbread',
        origin: 'generated',
        ai_metadata: {
          image_enqueue: { status: 'pending' },
          image_request: { id: 'req-1', status: 'pending', force_regenerate: false },
        },
      }) as never;

    it('re-reads the row and adopts the worker-written fields', async () => {
      const { host, refreshRecipeFromApi } = createHost({
        generateImage: vi.fn().mockResolvedValue(CANONICAL),
        refreshRecipeFromApi: async () => recipeFromRow(SERVER_ROW as unknown as RecipeRow),
      });
      host.recipe.set(pendingRecipe());

      await host.regenerateImage();

      expect(refreshRecipeFromApi).toHaveBeenCalledWith('r1');
      const adopted = host.recipe() as unknown as typeof SERVER_ROW.data;
      // The exact fields that read pending/null before the fix.
      expect(adopted.ai_image_gcs).toBe(SERVER_ROW.data.ai_image_gcs);
      expect(adopted.ai_metadata.image_request.status).toBe('complete');
      expect(adopted.ai_metadata.image_enqueue.status).toBe('complete');
      expect(adopted.ai_metadata.image_generation).toBeDefined();
    });

    it('exports JSON that matches the API row after the reconcile', async () => {
      const { host } = createHost({
        generateImage: vi.fn().mockResolvedValue(CANONICAL),
        refreshRecipeFromApi: async () => recipeFromRow(SERVER_ROW as unknown as RecipeRow),
      });
      host.recipe.set(pendingRecipe());

      await host.regenerateImage();

      // exportRecipe stringifies the viewed recipe verbatim; comparing the
      // serialized form is the same comparison the AC's repro makes by hand.
      expect(JSON.parse(JSON.stringify(host.recipe()))).toEqual(SERVER_ROW.data);
    });

    it('keeps the display URL when the refreshed row omits ai_image_url', async () => {
      const partialRow = structuredClone(SERVER_ROW);
      delete (partialRow.data as Record<string, unknown>)['ai_image_url'];
      const { host } = createHost({
        generateImage: vi.fn().mockResolvedValue(CANONICAL),
        refreshRecipeFromApi: async () => recipeFromRow(partialRow as unknown as RecipeRow),
      });
      host.recipe.set(pendingRecipe());

      await host.regenerateImage();

      expect((host.recipe() as { ai_image_url?: string }).ai_image_url).toBe(CANONICAL);
      expect(host.generatedImageUrl()).toMatch(/^\/api\/recipes\/r1\/image\?_t=\d+$/);
    });

    // The reconcile GET reads a row that predates anything the user changed
    // during the 30-60s image window. Adopting it wholesale reverted that edit
    // on screen and in localStorage; only the pipeline fields may be adopted.
    it('keeps a notes edit made while the image was still generating', async () => {
      const { host } = createHost({
        generateImage: vi.fn().mockResolvedValue(CANONICAL),
        refreshRecipeFromApi: async () => recipeFromRow(SERVER_ROW as unknown as RecipeRow),
      });
      host.recipe.set({
        ...(pendingRecipe() as unknown as Record<string, unknown>),
        personalNotes: 'typed during generation',
      } as never);

      await host.regenerateImage();

      const adopted = host.recipe() as unknown as Record<string, unknown>;
      expect(adopted['personalNotes']).toBe('typed during generation');
      // ...while the worker-written fields still land.
      expect(adopted['ai_image_gcs']).toBe(SERVER_ROW.data.ai_image_gcs);
    });

    it('leaves the optimistic local write standing when the row cannot be read', async () => {
      const { host, authService } = createHost({
        generateImage: vi.fn().mockResolvedValue(CANONICAL),
        refreshRecipeFromApi: async () => null,
      });
      host.recipe.set(pendingRecipe());

      await host.regenerateImage();

      expect(authService.updateRecipeField).toHaveBeenCalledWith('r1', 'ai_image_url', CANONICAL);
      expect((host.recipe() as { ai_image_url?: string }).ai_image_url).toBe(CANONICAL);
    });

    it('does not overwrite the viewed recipe when the user has navigated to another one', async () => {
      const { host } = createHost({
        generateImage: vi.fn().mockResolvedValue(CANONICAL),
        refreshRecipeFromApi: async () => recipeFromRow(SERVER_ROW as unknown as RecipeRow),
      });
      host.recipe.set(pendingRecipe());

      const inFlight = host.regenerateImage();
      // Nav to a different recipe while the generation is still detached.
      host.recipe.set({ id: 'r2', name: 'Chili' } as never);
      await inFlight;

      expect(host.recipe()?.id).toBe('r2');
    });

    it('reconciles even after the recipe is no longer the one being viewed', async () => {
      // The nav-away repro: the component is gone, the promise is not. The
      // local write and the API re-read must BOTH still happen — that is what
      // makes the cookbook row correct on return.
      const { host, refreshRecipeFromApi, authService } = createHost({
        generateImage: vi.fn().mockResolvedValue(CANONICAL),
        refreshRecipeFromApi: async () => recipeFromRow(SERVER_ROW as unknown as RecipeRow),
      });
      host.recipe.set(pendingRecipe());

      const inFlight = host.regenerateImage();
      host.recipe.set(null);
      await inFlight;

      expect(authService.updateRecipeField).toHaveBeenCalledWith('r1', 'ai_image_url', CANONICAL);
      expect(refreshRecipeFromApi).toHaveBeenCalledWith('r1');
    });

    it('does not reconcile when generation fails', async () => {
      const { host, refreshRecipeFromApi } = createHost({
        generateImage: vi.fn().mockRejectedValue(new Error('timed out')),
      });
      host.recipe.set(pendingRecipe());

      await host.regenerateImage();

      expect(refreshRecipeFromApi).not.toHaveBeenCalled();
      expect(toastShow).toHaveBeenCalledWith("Couldn't regenerate the image. Please try again.");
    });
  });
});
