import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../auth.types';
import { AuthService } from './auth.service';

const STORAGE_KEY_SESSION = 'vegan_genius_session';

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
  await vi.waitFor(() => {
    expect(authService.authLoading()).toBe(false);
  });
}

describe('AuthService auth-check startup behavior', () => {
  const localStorageMock = createLocalStorageMock();

  beforeEach(() => {
    vi.restoreAllMocks();

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          href: 'http://localhost/',
          search: '',
          hash: '',
          pathname: '/',
        },
        history: {
          replaceState: vi.fn(),
        },
      },
      configurable: true,
      writable: true,
    });

    Object.defineProperty(globalThis, 'document', {
      value: {
        title: 'Vegangenius Chef',
      },
      configurable: true,
      writable: true,
    });

    localStorageMock.clear();
  });

  afterEach(() => {
    localStorageMock.clear();
  });

  it('downgrades a cached authenticated session only when the backend explicitly reports unauthenticated', async () => {
    const cachedUser = createAuthenticatedUser();
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(cachedUser));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ authenticated: false }),
      })
    );

    const authService = new AuthService();
    await waitForAuthInit(authService);

    expect(authService.currentUser()).toMatchObject({
      id: cachedUser.id,
      isGuest: true,
      authProvider: 'guest',
      savedRecipes: cachedUser.savedRecipes,
    });

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY_SESSION) || '{}')).toMatchObject({
      id: cachedUser.id,
      isGuest: true,
      authProvider: 'guest',
      savedRecipes: cachedUser.savedRecipes,
    });
  });

  it('preserves cached authenticated state when auth-check returns a server error', async () => {
    const cachedUser = createAuthenticatedUser();
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(cachedUser));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
      })
    );

    const authService = new AuthService();
    await waitForAuthInit(authService);

    expect(authService.currentUser()).toEqual(cachedUser);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY_SESSION) || '{}')).toEqual(cachedUser);
  });

  it('preserves cached authenticated state when auth-check fails with a transport error', async () => {
    const cachedUser = createAuthenticatedUser();
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(cachedUser));

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network blip')));

    const authService = new AuthService();
    await waitForAuthInit(authService);

    expect(authService.currentUser()).toEqual(cachedUser);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY_SESSION) || '{}')).toEqual(cachedUser);
  });
});
