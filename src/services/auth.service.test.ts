import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../auth.types';
import { AuthService } from './auth.service';

type MockStorage = Storage & {
  clear: () => void;
};

function createLocalStorageMock(): MockStorage {
  let store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store = new Map<string, string>();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function createAuthenticatedUser(): User {
  return {
    id: 'user-123',
    email: 'chef@example.com',
    name: 'Chef',
    isGuest: false,
    authProvider: 'google',
    savedRecipes: [
      {
        id: 'recipe-1',
        name: 'Cached curry',
        description: 'Saved offline',
        prepTime: 10,
        cookTime: 20,
        servings: 2,
        ingredients: {},
        instructions: [],
      },
    ],
    cookbooks: [],
    deletedRecipes: [],
  };
}

async function waitForAuthInit(authService: AuthService) {
  await vi.waitFor(
    () => {
      expect(authService.authLoading()).toBe(false);
    },
    { timeout: 1000 }
  );
}

describe('AuthService auth-check startup behavior', () => {
  const localStorageMock = createLocalStorageMock();

  beforeEach(() => {
    vi.restoreAllMocks();

    vi.stubGlobal('localStorage', localStorageMock);

    vi.stubGlobal('window', {
      location: {
        href: 'http://localhost/',
        search: '',
        hash: '',
        pathname: '/',
      },
      history: {
        replaceState: vi.fn(),
      },
    });

    vi.stubGlobal('document', {
      title: 'Vegangenius Chef',
    });

    localStorageMock.clear();
  });

  afterEach(() => {
    localStorageMock.clear();
    vi.unstubAllGlobals();
  });

  it('clears cached authenticated session when backend returns authenticated: false', async () => {
    const cachedUser = createAuthenticatedUser();
    localStorage.setItem(AuthService.SESSION_STORAGE_KEY, JSON.stringify(cachedUser));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ authenticated: false }),
      })
    );

    const authService = new AuthService();
    await waitForAuthInit(authService);

    expect(authService.currentUser()).toBeNull();
    expect(localStorage.getItem(AuthService.SESSION_STORAGE_KEY)).toBeNull();
  });

  it('preserves cached authenticated state when auth-check returns a server error', async () => {
    const cachedUser = createAuthenticatedUser();
    localStorage.setItem(AuthService.SESSION_STORAGE_KEY, JSON.stringify(cachedUser));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
      })
    );

    const authService = new AuthService();
    await waitForAuthInit(authService);

    expect(authService.currentUser()).toEqual(cachedUser);
    expect(JSON.parse(localStorage.getItem(AuthService.SESSION_STORAGE_KEY) || '{}')).toEqual(
      cachedUser
    );
  });

  it('ensureGuestSession does not restore a cached authenticated session while the auth check is pending', async () => {
    const cachedUser = createAuthenticatedUser();
    localStorage.setItem(AuthService.SESSION_STORAGE_KEY, JSON.stringify(cachedUser));

    // Auth check never resolves within the test — simulates the in-flight window
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));

    const authService = new AuthService();
    authService.ensureGuestSession();

    // Must neither render the possibly-stale user nor clobber their cache
    expect(authService.currentUser()).toBeNull();
    expect(JSON.parse(localStorage.getItem(AuthService.SESSION_STORAGE_KEY) || '{}')).toEqual(
      cachedUser
    );
  });

  it('ensureGuestSession restores a cached guest session while the auth check is pending', async () => {
    const guestUser: User = {
      id: 'guest-1',
      name: 'Guest Chef',
      isGuest: true,
      authProvider: 'guest',
      savedRecipes: [],
      cookbooks: [],
      deletedRecipes: [],
    };
    localStorage.setItem(AuthService.SESSION_STORAGE_KEY, JSON.stringify(guestUser));

    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));

    const authService = new AuthService();
    authService.ensureGuestSession();

    expect(authService.currentUser()).toEqual(guestUser);
  });

  it('creates a guest after an unauthenticated check when ensureGuestSession was deferred mid-check', async () => {
    const cachedUser = createAuthenticatedUser();
    localStorage.setItem(AuthService.SESSION_STORAGE_KEY, JSON.stringify(cachedUser));

    let resolveCheck!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise((resolve) => (resolveCheck = resolve)))
    );

    const authService = new AuthService();
    // Deferred: cached session is authenticated and the check is in flight
    authService.ensureGuestSession();
    expect(authService.currentUser()).toBeNull();

    resolveCheck({
      ok: true,
      json: vi.fn().mockResolvedValue({ authenticated: false }),
    });
    await authService.ready;

    // The stale session was wiped; the deferred request must not strand the
    // caller with no session — a fresh guest is created instead.
    const user = authService.currentUser();
    expect(user).not.toBeNull();
    expect(user?.isGuest).toBe(true);
  });

  it('exposes a ready promise that resolves once the auth check completes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ authenticated: false }),
      })
    );

    const authService = new AuthService();
    await authService.ready;

    expect(authService.authLoading()).toBe(false);
  });

  it('preserves cached authenticated state when auth-check fails with a transport error', async () => {
    const cachedUser = createAuthenticatedUser();
    localStorage.setItem(AuthService.SESSION_STORAGE_KEY, JSON.stringify(cachedUser));

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network blip')));

    const authService = new AuthService();
    await waitForAuthInit(authService);

    expect(authService.currentUser()).toEqual(cachedUser);
    expect(JSON.parse(localStorage.getItem(AuthService.SESSION_STORAGE_KEY) || '{}')).toEqual(
      cachedUser
    );
  });

  // KAN-241: removeRecipeById undoes the optimistic write without soft-deleting.
  describe('removeRecipeById (KAN-241)', () => {
    it('removes a recipe from savedRecipes by ID', async () => {
      const cachedUser = createAuthenticatedUser();
      localStorage.setItem(AuthService.SESSION_STORAGE_KEY, JSON.stringify(cachedUser));

      // ok: false preserves the cached authenticated user (server-error path).
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

      const authService = new AuthService();
      await waitForAuthInit(authService);

      expect(authService.currentUser()?.savedRecipes).toHaveLength(1);

      authService.removeRecipeById('recipe-1');

      expect(authService.currentUser()?.savedRecipes).toHaveLength(0);
    });

    it('does not move the removed recipe to the recycle bin', async () => {
      const cachedUser = createAuthenticatedUser();
      localStorage.setItem(AuthService.SESSION_STORAGE_KEY, JSON.stringify(cachedUser));

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

      const authService = new AuthService();
      await waitForAuthInit(authService);

      authService.removeRecipeById('recipe-1');

      expect(authService.currentUser()?.deletedRecipes).toHaveLength(0);
    });

    it('is a no-op when the recipe ID does not exist', async () => {
      const cachedUser = createAuthenticatedUser();
      localStorage.setItem(AuthService.SESSION_STORAGE_KEY, JSON.stringify(cachedUser));

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

      const authService = new AuthService();
      await waitForAuthInit(authService);

      authService.removeRecipeById('nonexistent-id');

      expect(authService.currentUser()?.savedRecipes).toHaveLength(1);
    });

    // deleteRecipe strips the id from every cookbook; removeRecipeById did not.
    // Dropping the row while leaving the cookbook entry behind leaves a
    // dangling reference that renders as a missing entry in that cookbook.
    it('also strips the id from every cookbook, as deleteRecipe does', async () => {
      const cachedUser = createAuthenticatedUser();
      cachedUser.cookbooks = [
        { id: 'cb-1', name: 'Weeknights', recipeIds: ['recipe-1', 'recipe-2'] },
        { id: 'cb-2', name: 'Empty', recipeIds: [] },
      ] as User['cookbooks'];
      localStorage.setItem(AuthService.SESSION_STORAGE_KEY, JSON.stringify(cachedUser));

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

      const authService = new AuthService();
      await waitForAuthInit(authService);

      authService.removeRecipeById('recipe-1');

      const cookbooks = authService.currentUser()?.cookbooks ?? [];
      expect(cookbooks[0].recipeIds).toEqual(['recipe-2']);
      expect(cookbooks[1].recipeIds).toEqual([]);
    });
  });
});

describe('AuthService.hydrate cookbook deduplication (KAN-242)', () => {
  const localStorageMock = createLocalStorageMock();

  const cbA = { id: 'cb-A', name: 'Favorites', description: '', recipeIds: ['r1'] };
  const cbX = { id: 'cb-X', name: 'Session Recipes', description: '', recipeIds: ['r2'] };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('window', {
      location: { href: 'http://localhost/', search: '', hash: '', pathname: '/' },
      history: { replaceState: vi.fn() },
    });
    vi.stubGlobal('document', { title: 'Vegangenius Chef' });
    localStorageMock.clear();
  });

  afterEach(() => {
    localStorageMock.clear();
    vi.unstubAllGlobals();
  });

  it('removes duplicate cookbook ids when the cookbooks parameter contains repeats', async () => {
    const user = createAuthenticatedUser();
    user.cookbooks = [cbA, cbX];
    localStorageMock.setItem(AuthService.SESSION_STORAGE_KEY, JSON.stringify(user));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ authenticated: false }),
      })
    );

    const authService = new AuthService();
    await waitForAuthInit(authService);
    // Seed the user so hydrate has someone to update
    authService.ensureGuestSession();
    const guest = authService.currentUser()!;
    // Give the guest the two cookbooks
    authService['currentUser'].set({ ...guest, cookbooks: [cbA, cbX] });

    // Hydrate with duplicates in the incoming cookbooks array — simulates the
    // race between loadFromApi and createCookbook (KAN-242).
    authService.hydrate([], [cbA, cbX, cbX]);

    const result = authService.currentUser()!;
    expect(result.cookbooks).toHaveLength(2);
    expect(result.cookbooks.map((c) => c.id)).toEqual(['cb-A', 'cb-X']);
  });

  it('drops localStorage recipes whose sourceSlug matches an API recipe (KAN-265)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ authenticated: false }),
      })
    );

    const authService = new AuthService();
    await waitForAuthInit(authService);
    authService.ensureGuestSession();
    const guest = authService.currentUser()!;

    // Simulate: guest saved a public recipe (fresh UUID, sourceSlug set).
    // On login, the server-side merge deleted the guest copy (already owned).
    // But localStorage still has it with the guest-assigned id.
    const guestCopy = {
      id: 'guest-uuid-1',
      name: 'Delicious Cookies',
      sourceSlug: 'delicious-cookies',
      description: '',
      prepTime: 10,
      cookTime: 20,
      servings: 4,
      ingredients: {},
      instructions: [],
    };
    authService['currentUser'].set({ ...guest, savedRecipes: [guestCopy] });

    // API returns the user's own recipe with the same sourceSlug but a different id.
    const ownedRecipe = {
      id: 'owned-uuid-2',
      name: 'Delicious Cookies',
      sourceSlug: 'delicious-cookies',
      description: '',
      prepTime: 10,
      cookTime: 20,
      servings: 4,
      ingredients: {},
      instructions: [],
    };
    authService.hydrate([ownedRecipe], []);

    const result = authService.currentUser()!;
    expect(result.savedRecipes).toHaveLength(1);
    expect(result.savedRecipes[0].id).toBe('owned-uuid-2');
  });

  it('drops localStorage recipes whose slug matches an API recipe slug (KAN-265)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ authenticated: false }),
      })
    );

    const authService = new AuthService();
    await waitForAuthInit(authService);
    authService.ensureGuestSession();
    const guest = authService.currentUser()!;

    const guestCopy = {
      id: 'guest-uuid-3',
      name: 'My Pasta',
      slug: 'my-pasta',
      description: '',
      prepTime: 5,
      cookTime: 15,
      servings: 2,
      ingredients: {},
      instructions: [],
    };
    authService['currentUser'].set({ ...guest, savedRecipes: [guestCopy] });

    const ownedRecipe = {
      id: 'owned-uuid-4',
      name: 'My Pasta',
      slug: 'my-pasta',
      description: '',
      prepTime: 5,
      cookTime: 15,
      servings: 2,
      ingredients: {},
      instructions: [],
    };
    authService.hydrate([ownedRecipe], []);

    const result = authService.currentUser()!;
    expect(result.savedRecipes).toHaveLength(1);
    expect(result.savedRecipes[0].id).toBe('owned-uuid-4');
  });

  it('keeps genuinely local-only recipes that do not match any API identity (KAN-265)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ authenticated: false }),
      })
    );

    const authService = new AuthService();
    await waitForAuthInit(authService);
    authService.ensureGuestSession();
    const guest = authService.currentUser()!;

    const localRecipe = {
      id: 'local-only-5',
      name: 'Offline Draft',
      description: '',
      prepTime: 10,
      cookTime: 10,
      servings: 1,
      ingredients: {},
      instructions: [],
    };
    authService['currentUser'].set({ ...guest, savedRecipes: [localRecipe] });

    authService.hydrate([], []);

    const result = authService.currentUser()!;
    expect(result.savedRecipes).toHaveLength(1);
    expect(result.savedRecipes[0].id).toBe('local-only-5');
  });

  it('prefers the API cookbook over a local duplicate with the same id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ authenticated: false }),
      })
    );

    const authService = new AuthService();
    await waitForAuthInit(authService);
    authService.ensureGuestSession();
    const guest = authService.currentUser()!;

    const localCopy = { ...cbA, name: 'Old Local Name' };
    authService['currentUser'].set({ ...guest, cookbooks: [localCopy] });

    const apiCopy = { ...cbA, name: 'Server Name' };
    authService.hydrate([], [apiCopy]);

    const result = authService.currentUser()!;
    expect(result.cookbooks).toHaveLength(1);
    expect(result.cookbooks[0].name).toBe('Server Name');
  });
});
