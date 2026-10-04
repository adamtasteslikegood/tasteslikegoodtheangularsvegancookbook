/**
 * KAN-321 — routable cookbooks.
 *
 * The selected cookbook lives in the URL (/kitchen/<cookbookId>), so the
 * recipe page's cookbook crumb has somewhere in-app to point, and back/forward,
 * reload and deep links land on the same view. Vitest runs in node with no
 * DOM renderer, so the component is constructed in an injection context with
 * the router and route stubbed, the way recipe-detail.component.test.ts does.
 */
import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { ActivatedRoute, Router, UrlSegment } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KitchenComponent } from './kitchen.component';
import { kitchenMatcher, routes } from '../../app.routes';
import { AuthService } from '../../services/auth.service';
import { GeminiService } from '../../services/gemini.service';
import { PersistenceService } from '../../services/persistence.service';
import { RecipeStateService } from '../../services/recipe-state.service';
import { ModalService } from '../../services/modal.service';
import type { Cookbook, User } from '../../auth.types';
import type { Recipe } from '../../recipe.types';

const asParamMap = (params: Record<string, string>) =>
  ({
    keys: Object.keys(params),
    has: (k: string) => k in params,
    get: (k: string) => params[k] ?? null,
    getAll: (k: string) => (k in params ? [params[k]] : []),
  }) as unknown as Map<string, string>;

const cookbook = (id: string, name: string, recipeIds: string[] = []): Cookbook => ({
  id,
  name,
  description: '',
  recipeIds,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('KitchenComponent routable cookbooks (KAN-321)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createKitchen = (
    opts: {
      cookbookId?: string;
      cookbooks?: Cookbook[];
      firstSyncSettled?: Promise<void>;
    } = {}
  ) => {
    const params = new BehaviorSubject(
      asParamMap(opts.cookbookId ? { cookbookId: opts.cookbookId } : {})
    );
    const navigate = vi.fn().mockResolvedValue(true);
    const user = signal<User | null>({
      id: 'guest-1',
      name: 'Guest Chef',
      isGuest: true,
      authProvider: 'guest',
      savedRecipes: [],
      cookbooks: opts.cookbooks ?? [cookbook('cb-1', 'Weeknights', ['r-1'])],
    });
    const stageRecipeForNavigation = vi.fn();
    const injector = Injector.create({
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
        { provide: Router, useValue: { navigate } },
        {
          provide: AuthService,
          useValue: {
            currentUser: user,
            ensureGuestSession: vi.fn(),
            ready: Promise.resolve(),
          },
        },
        {
          provide: PersistenceService,
          useValue: {
            firstSyncSettled: opts.firstSyncSettled ?? Promise.resolve(),
            deleteCookbook: vi.fn().mockResolvedValue(undefined),
          },
        },
        { provide: GeminiService, useValue: {} },
        {
          provide: RecipeStateService,
          useValue: {
            leaveRecipeView: vi.fn(),
            stageRecipeForNavigation,
            imageDisplayUrl: () => null,
          },
        },
        { provide: ModalService, useValue: {} },
      ],
    });
    const kitchen = runInInjectionContext(injector, () => new KitchenComponent());
    const emitCookbook = (id: string | null) =>
      params.next(asParamMap(id ? { cookbookId: id } : {}));
    return { kitchen, navigate, user, emitCookbook, stageRecipeForNavigation, injector };
  };

  it('routes /kitchen and /kitchen/<id> through one config, so the view is reused', () => {
    const seg = (...paths: string[]) => paths.map((p) => new UrlSegment(p, {}));
    expect(kitchenMatcher(seg('kitchen'))?.posParams).toEqual({});
    expect(kitchenMatcher(seg('kitchen', 'cb-1'))?.posParams?.['cookbookId'].path).toBe('cb-1');
    expect(kitchenMatcher(seg('kitchen', 'cb-1', 'x'))).toBeNull();
    expect(kitchenMatcher(seg('recipe', 'r-1'))).toBeNull();
    const kitchenRoutes = routes.filter((r) => r.matcher === kitchenMatcher);
    expect(kitchenRoutes).toHaveLength(1);
    expect(routes.some((r) => r.path === 'kitchen' || r.path?.startsWith('kitchen/'))).toBe(false);
  });

  it('selects the cookbook from the route on load', () => {
    const { kitchen, navigate } = createKitchen({ cookbookId: 'cb-1' });
    expect(kitchen.activeCookbookId()).toBe('cb-1');
    expect(kitchen.activeCookbook()?.name).toBe('Weeknights');
    expect(kitchen.breadcrumbs()).toEqual([
      { name: 'My Kitchen', url: '/kitchen' },
      { name: 'Weeknights', url: '/kitchen/cb-1' },
    ]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('follows a param change on the same instance (back/forward)', () => {
    const { kitchen, emitCookbook } = createKitchen({
      cookbooks: [cookbook('cb-1', 'Weeknights'), cookbook('cb-2', 'Desserts')],
    });
    expect(kitchen.activeCookbookId()).toBeNull();
    expect(kitchen.breadcrumbs()).toEqual([{ name: 'My Kitchen', url: '/kitchen' }]);

    emitCookbook('cb-2');
    expect(kitchen.activeCookbook()?.name).toBe('Desserts');
    emitCookbook(null);
    expect(kitchen.activeCookbookId()).toBeNull();
  });

  it('navigates when a cookbook or All Recipes is selected (click, enter and space alike)', () => {
    const { kitchen, navigate } = createKitchen();
    kitchen.selectCookbook('cb-1');
    expect(navigate).toHaveBeenLastCalledWith(['/kitchen', 'cb-1']);
    kitchen.selectCookbook(null);
    expect(navigate).toHaveBeenLastCalledWith(['/kitchen']);
  });

  it('keeps the keyboard handlers on the cookbook rows wired to selectCookbook', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(new URL('./kitchen.component.html', import.meta.url), 'utf8');
    expect(html).toContain('(keydown.enter)="selectCookbook(cb.id); $event.preventDefault()"');
    expect(html).toContain('(keydown.space)="selectCookbook(cb.id); $event.preventDefault()"');
  });

  it('falls back to /kitchen, replacing the entry, for an unknown cookbook id', async () => {
    const { navigate } = createKitchen({ cookbookId: 'nope' });
    await flush();
    expect(navigate).toHaveBeenCalledWith(['/kitchen'], { replaceUrl: true });
  });

  it('waits for the first API sync before calling a cookbook unknown', async () => {
    let settle: () => void = () => {};
    const firstSyncSettled = new Promise<void>((resolve) => (settle = resolve));
    const { kitchen, navigate, user } = createKitchen({
      cookbookId: 'cb-remote',
      cookbooks: [],
      firstSyncSettled,
    });
    await flush();
    expect(navigate).not.toHaveBeenCalled();

    // Made on another device: arrives with the API merge.
    user.update((u) => (u ? { ...u, cookbooks: [cookbook('cb-remote', 'Remote')] } : u));
    settle();
    await flush();
    expect(navigate).not.toHaveBeenCalled();
    expect(kitchen.activeCookbook()?.name).toBe('Remote');
  });

  it('does not bounce a route the user has already left', async () => {
    let settle: () => void = () => {};
    const firstSyncSettled = new Promise<void>((resolve) => (settle = resolve));
    const { navigate, emitCookbook } = createKitchen({ cookbookId: 'nope', firstSyncSettled });
    emitCookbook('cb-1');
    settle();
    await flush();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not navigate after the Kitchen is destroyed mid-wait', async () => {
    let settle: () => void = () => {};
    const firstSyncSettled = new Promise<void>((resolve) => (settle = resolve));
    const { navigate, injector } = createKitchen({ cookbookId: 'nope', firstSyncSettled });
    (injector as unknown as { destroy(): void }).destroy(); // the user left the Kitchen
    settle();
    await flush();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('carries the cookbook to the recipe page, and nothing from All Recipes', () => {
    const recipe = { id: 'r-1', name: 'Tofu Scramble' } as Recipe;
    const { kitchen, navigate, emitCookbook } = createKitchen({ cookbookId: 'cb-1' });
    kitchen.viewRecipe(recipe);
    expect(navigate).toHaveBeenLastCalledWith(['/recipe', 'r-1'], {
      queryParams: { cookbook: 'cb-1' },
    });

    emitCookbook(null);
    kitchen.viewRecipe(recipe);
    expect(navigate).toHaveBeenLastCalledWith(['/recipe', 'r-1'], undefined);
  });

  it('opens the Recycle Bin from a cookbook on /kitchen and keeps it open', () => {
    const { kitchen, navigate, emitCookbook } = createKitchen({ cookbookId: 'cb-1' });
    kitchen.toggleRecycleBin();
    expect(kitchen.showRecycleBin()).toBe(true);
    // A push, not a replace: /kitchen/cb-1 stays in history as a live view.
    expect(navigate).toHaveBeenLastCalledWith(['/kitchen']);
    emitCookbook(null); // the navigation lands
    expect(kitchen.showRecycleBin()).toBe(true);

    // Browser Back to /kitchen/cb-1 returns to the cookbook and closes the bin.
    emitCookbook('cb-1');
    expect(kitchen.activeCookbookId()).toBe('cb-1');
    expect(kitchen.showRecycleBin()).toBe(false);
    emitCookbook(null);
    kitchen.toggleRecycleBin();

    // "All Recipes" from the bin is a same-URL navigation: close it directly.
    kitchen.selectCookbook(null);
    expect(kitchen.showRecycleBin()).toBe(false);
  });

  it('replaces /kitchen/<id> even when the DELETE request fails', async () => {
    vi.stubGlobal('confirm', () => true);
    const { kitchen, navigate, injector } = createKitchen({ cookbookId: 'cb-1' });
    const persistence = injector.get(PersistenceService) as unknown as {
      deleteCookbook: ReturnType<typeof vi.fn>;
    };
    persistence.deleteCookbook.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(kitchen.deleteCookbook('cb-1', new Event('click'))).rejects.toThrow();
    expect(navigate).toHaveBeenCalledWith(['/kitchen'], { replaceUrl: true });
    vi.unstubAllGlobals();
  });

  it('replaces /kitchen/<id> when the open cookbook is deleted', async () => {
    vi.stubGlobal('confirm', () => true);
    const { kitchen, navigate } = createKitchen({ cookbookId: 'cb-1' });
    await kitchen.deleteCookbook('cb-1', new Event('click'));
    expect(navigate).toHaveBeenCalledWith(['/kitchen'], { replaceUrl: true });
    vi.unstubAllGlobals();
  });

  it('does not navigate after the Kitchen is destroyed mid-delete', async () => {
    vi.stubGlobal('confirm', () => true);
    let settle: () => void = () => {};
    const pending = new Promise<void>((resolve) => (settle = resolve));
    const { kitchen, navigate, injector } = createKitchen({ cookbookId: 'cb-1' });
    const persistence = injector.get(PersistenceService) as unknown as {
      deleteCookbook: ReturnType<typeof vi.fn>;
    };
    persistence.deleteCookbook.mockReturnValueOnce(pending);
    const inFlight = kitchen.deleteCookbook('cb-1', new Event('click'));
    (injector as unknown as { destroy(): void }).destroy(); // user left Kitchen
    settle();
    await inFlight;
    expect(navigate).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('Kitchen recipe grids on phones (KAN-297)', () => {
  it('start at two cards per row, with no single-column base', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(new URL('./kitchen.component.html', import.meta.url), 'utf8');
    const cardGrids = [...html.matchAll(/class="(grid [^"]*lg:grid-cols-3[^"]*)"/g)];
    expect(cardGrids).toHaveLength(2);
    for (const [, classes] of cardGrids) {
      // Whole tokens: `sm:grid-cols-2` alone would leave phones on one column.
      const tokens = classes.split(/\s+/);
      expect(tokens).toContain('grid-cols-2');
      expect(tokens).not.toContain('grid-cols-1');
    }
  });
});
