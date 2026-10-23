import { Cookbook, User } from '../auth.types';
import { Recipe } from '../recipe.types';

export const SESSION_STORAGE_KEY = 'vegan_genius_session';

/**
 * Normalize a recipe slug or sourceRecipeId for case-insensitive identity matching (KAN-265).
 */
export function normalizeRecipeSlug(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized || undefined;
}

/**
 * Hydrate the authenticated user's recipes and cookbooks from the API.
 * Called by PersistenceService after loading data from Flask.
 * Merges with any recipes already in localStorage (guest data brought in on login).
 */
export function hydrateUserLibrary(user: User, recipes: Recipe[], cookbooks: Cookbook[]): User {
  // Merge recipes: keep any localStorage recipes NOT already in the API response.
  // KAN-265: also match by sourceRecipeId/sourceSlug/slug so that a guest-saved copy whose
  // server-side duplicate was deleted during merge doesn't survive as a zombie
  // in localStorage under a different id.
  const apiIds = new Set(recipes.map((r) => r.id));
  const apiSourceRecipeIds = new Set(
    recipes.map((r) => normalizeRecipeSlug(r.sourceRecipeId)).filter((id): id is string => !!id)
  );
  const apiSlugs = new Set<string>();
  for (const r of recipes) {
    const sourceSlug = normalizeRecipeSlug(r.sourceSlug);
    const slug = normalizeRecipeSlug(r.slug);
    if (sourceSlug) apiSlugs.add(sourceSlug);
    if (slug) apiSlugs.add(slug);
  }
  const localOnly = user.savedRecipes.filter((r) => {
    if (apiIds.has(r.id)) return false;
    const sourceRecipeId = normalizeRecipeSlug(r.sourceRecipeId);
    if (sourceRecipeId && apiSourceRecipeIds.has(sourceRecipeId)) return false;
    const sourceSlug = normalizeRecipeSlug(r.sourceSlug);
    const slug = normalizeRecipeSlug(r.slug);
    if (sourceSlug && apiSlugs.has(sourceSlug)) return false;
    if (slug && apiSlugs.has(slug)) return false;
    return true;
  });

  // Merge ai_image_url from localStorage into API recipes. The API may
  // not have the URL yet if Pub/Sub image generation hasn't completed;
  // localStorage has it from the optimistic update in
  // RecipeViewBase.runImageGeneration (was triggerImageGeneration, KAN-255).
  //
  // KAN-265: the localOnly filter above may now drop a local recipe whose
  // id doesn't match the API record but whose sourceSlug/slug does (the
  // "zombie after server-side merge" scenario). Look the local record up
  // by id first, then fall back to sourceSlug/slug — otherwise a freshly
  // generated ai_image_url cached on the guest copy is silently lost when
  // the API record (a different id) doesn't have it yet.
  const localById = new Map(user.savedRecipes.map((r) => [r.id, r]));
  const localBySourceRecipeId = new Map<string, Recipe>();
  const localBySlug = new Map<string, Recipe>();
  const rememberImageCandidate = (map: Map<string, Recipe>, key: string, recipe: Recipe) => {
    const existing = map.get(key);
    if (!existing || (!existing.ai_image_url && recipe.ai_image_url)) {
      map.set(key, recipe);
    }
  };
  for (const r of user.savedRecipes) {
    const sourceRecipeId = normalizeRecipeSlug(r.sourceRecipeId);
    const src = normalizeRecipeSlug(r.sourceSlug);
    const slg = normalizeRecipeSlug(r.slug);
    if (sourceRecipeId) rememberImageCandidate(localBySourceRecipeId, sourceRecipeId, r);
    if (src) rememberImageCandidate(localBySlug, src, r);
    if (slg) rememberImageCandidate(localBySlug, slg, r);
  }
  const findLocalForApi = (apiRecipe: Recipe): Recipe | undefined => {
    const byId = localById.get(apiRecipe.id);
    if (byId) return byId;
    const sourceRecipeId = normalizeRecipeSlug(apiRecipe.sourceRecipeId);
    if (sourceRecipeId) {
      const bySourceRecipeId = localBySourceRecipeId.get(sourceRecipeId);
      if (bySourceRecipeId) return bySourceRecipeId;
    }
    const src = normalizeRecipeSlug(apiRecipe.sourceSlug);
    if (src) {
      const bySrc = localBySlug.get(src);
      if (bySrc) return bySrc;
    }
    const slg = normalizeRecipeSlug(apiRecipe.slug);
    if (slg) return localBySlug.get(slg);
    return undefined;
  };
  const mergedApi = recipes.map((apiRecipe) => {
    const local = findLocalForApi(apiRecipe);
    if (local?.ai_image_url && !apiRecipe.ai_image_url) {
      return { ...apiRecipe, ai_image_url: local.ai_image_url };
    }
    return apiRecipe;
  });

  const merged = [...mergedApi, ...localOnly];

  // Merge cookbooks: keep any localStorage cookbooks NOT already in the API response,
  // then deduplicate by id so races between loadFromApi and createCookbook never
  // produce ghost double-entries in the add-to-cookbook modal (KAN-242).
  const apiCookbookIds = new Set(cookbooks.map((c) => c.id));
  const localOnlyCookbooks = user.cookbooks.filter((c) => !apiCookbookIds.has(c.id));
  const seenIds = new Set<string>();
  const mergedCookbooks = [...cookbooks, ...localOnlyCookbooks].filter((c) => {
    if (seenIds.has(c.id)) return false;
    seenIds.add(c.id);
    return true;
  });

  return { ...user, savedRecipes: merged, cookbooks: mergedCookbooks };
}

// ─── Recipe Management (localStorage state transforms) ────────

export function upsertSavedRecipe(user: User, recipe: Recipe): User {
  // Check if already saved by ID
  if (user.savedRecipes.some((r) => r.id === recipe.id)) {
    const updatedRecipes = user.savedRecipes.map((r) => (r.id === recipe.id ? recipe : r));
    return { ...user, savedRecipes: updatedRecipes };
  }

  return {
    ...user,
    savedRecipes: [...user.savedRecipes, recipe],
  };
}

/**
 * KAN-241: remove a recipe from localStorage by ID without soft-deleting it.
 *
 * Used to undo the optimistic write when the server says the recipe is a
 * duplicate. `deleteRecipe` is wrong here — it moves the ghost to the
 * recycle bin, where `restoreRecipe` would re-POST it and get another 409.
 */
export function removeSavedRecipeById(user: User, recipeId: string): User | null {
  if (!user.savedRecipes.some((r) => r.id === recipeId)) return null;
  return {
    ...user,
    savedRecipes: user.savedRecipes.filter((r) => r.id !== recipeId),
    // Strip the id from every cookbook too, as deleteRecipe does. Dropping
    // the row while leaving a cookbook.recipeIds entry behind leaves a
    // dangling reference that renders as a missing entry in that cookbook.
    cookbooks: user.cookbooks.map((cb) => ({
      ...cb,
      recipeIds: cb.recipeIds.filter((id) => id !== recipeId),
    })),
  };
}

/**
 * Update a single field on a saved recipe in localStorage only.
 * Used after image generation to set ai_image_url without
 * overwriting the full recipe via the API (which would lose ai_image_data).
 */
export function updateSavedRecipeField(
  user: User,
  recipeId: string,
  field: keyof Recipe,
  value: unknown
): User | null {
  const idx = user.savedRecipes.findIndex((r) => r.id === recipeId);
  if (idx === -1) return null;

  const updatedRecipes = [...user.savedRecipes];
  updatedRecipes[idx] = { ...updatedRecipes[idx], [field]: value };
  return { ...user, savedRecipes: updatedRecipes };
}

export function softDeleteSavedRecipe(user: User, recipeId: string): User {
  const recipe = user.savedRecipes.find((r) => r.id === recipeId);
  const deletedRecipes = [...(user.deletedRecipes || [])];
  if (recipe) {
    // Remember which cookbooks this recipe was in, so restore can re-add it
    const cookbookIds = user.cookbooks
      .filter((cb) => cb.recipeIds.includes(recipeId))
      .map((cb) => cb.id);
    deletedRecipes.push({ recipe, deletedAt: new Date().toISOString(), cookbookIds });
  }

  return {
    ...user,
    savedRecipes: user.savedRecipes.filter((r) => r.id !== recipeId),
    cookbooks: user.cookbooks.map((cb) => ({
      ...cb,
      recipeIds: cb.recipeIds.filter((id) => id !== recipeId),
    })),
    deletedRecipes,
  };
}

export function restoreDeletedRecipe(user: User, recipeId: string): User | null {
  const entry = (user.deletedRecipes || []).find((d) => d.recipe.id === recipeId);
  if (!entry) return null;

  // Restore cookbook membership if it was saved
  const cookbooks = entry.cookbookIds?.length
    ? user.cookbooks.map((cb) => {
        if (entry.cookbookIds!.includes(cb.id) && !cb.recipeIds.includes(recipeId)) {
          return { ...cb, recipeIds: [...cb.recipeIds, recipeId] };
        }
        return cb;
      })
    : user.cookbooks;

  return {
    ...user,
    savedRecipes: [...user.savedRecipes, entry.recipe],
    cookbooks,
    deletedRecipes: (user.deletedRecipes || []).filter((d) => d.recipe.id !== recipeId),
  };
}

export function permanentlyDeleteSavedRecipe(user: User, recipeId: string): User {
  return {
    ...user,
    deletedRecipes: (user.deletedRecipes || []).filter((d) => d.recipe.id !== recipeId),
  };
}

export function clearDeletedRecipes(user: User): User {
  return {
    ...user,
    deletedRecipes: [],
  };
}

// ─── Cookbook Management (localStorage state transforms) ───────

export function appendCookbook(
  user: User,
  name: string,
  description: string = '',
  id?: string
): { user: User; cookbook: Cookbook } {
  const newCookbook: Cookbook = {
    id: id ?? crypto.randomUUID(),
    name,
    description,
    recipeIds: [],
  };

  return {
    user: {
      ...user,
      cookbooks: [...user.cookbooks, newCookbook],
    },
    cookbook: newCookbook,
  };
}

export function removeCookbook(user: User, cookbookId: string): User {
  return {
    ...user,
    cookbooks: user.cookbooks.filter((cb) => cb.id !== cookbookId),
  };
}

/**
 * The id addRecipeToCookbook puts in a cookbook for this recipe: its own,
 * or that of a saved recipe it matches by id or name. KAN-333: an undo of a
 * failed add has to remove this id, not necessarily recipe.id.
 */
export function resolveCookbookRecipeId(user: User | null | undefined, recipe: Recipe): string {
  const saved = user?.savedRecipes.find((r) => r.id === recipe.id || r.name === recipe.name);
  return saved?.id ?? recipe.id;
}

export function addRecipeToUserCookbook(user: User, cookbookId: string, recipe: Recipe): User {
  // 1. Ensure recipe is in savedRecipes
  const savedRecipes = [...user.savedRecipes];
  let recipeId = recipe.id;

  const existingIndex = savedRecipes.findIndex((r) => r.id === recipe.id || r.name === recipe.name);
  if (existingIndex === -1) {
    savedRecipes.push(recipe);
  } else {
    recipeId = savedRecipes[existingIndex].id;
  }

  // 2. Add to cookbook
  const cookbooks = user.cookbooks.map((cb) => {
    if (cb.id === cookbookId) {
      if (!cb.recipeIds.includes(recipeId)) {
        const coverImage = cb.coverImage || recipe.ai_image_url || recipe.stock_image_url;
        return { ...cb, recipeIds: [...cb.recipeIds, recipeId], coverImage };
      }
    }
    return cb;
  });

  return { ...user, savedRecipes, cookbooks };
}

export function removeRecipeFromUserCookbook(
  user: User,
  cookbookId: string,
  recipeId: string
): User {
  const cookbooks = user.cookbooks.map((cb) => {
    if (cb.id === cookbookId) {
      return {
        ...cb,
        recipeIds: cb.recipeIds.filter((id) => id !== recipeId),
      };
    }
    return cb;
  });

  return { ...user, cookbooks };
}

/**
 * KAN-333: set whether one recipe is in one cookbook, touching nothing
 * else. Used to undo an optimistic change the server did not take, so the
 * dialog shows the account's state and saving again sends the request.
 */
export function setUserCookbookMembership(
  user: User,
  cookbookId: string,
  recipeId: string,
  present: boolean
): User {
  const cookbooks = user.cookbooks.map((cb) => {
    if (cb.id !== cookbookId || cb.recipeIds.includes(recipeId) === present) return cb;
    const recipeIds = present
      ? [...cb.recipeIds, recipeId]
      : cb.recipeIds.filter((id) => id !== recipeId);
    return { ...cb, recipeIds };
  });
  return { ...user, cookbooks };
}

// ─── Session localStorage Serialization ───────────────────────

export function serializeSafeSessionUser(user: User): User {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    isGuest: user.isGuest,
    authProvider: user.authProvider,
    // Strip base64 image data from the localStorage cache to stay within
    // the ~5 MB quota. URL-based images (from Flask) are kept.
    savedRecipes: (user.savedRecipes || []).map((r) => ({
      ...r,
      ai_image_url: r.ai_image_url?.startsWith('data:') ? undefined : r.ai_image_url,
      image: r.image?.startsWith('data:') ? undefined : r.image,
    })),
    cookbooks: user.cookbooks || [],
    deletedRecipes: user.deletedRecipes || [],
  };
}

export function saveSessionToStorage(storageKey: string, user: User): void {
  const safeUser = serializeSafeSessionUser(user);
  try {
    localStorage.setItem(storageKey, JSON.stringify(safeUser));
  } catch (e) {
    console.warn('Failed to save local session to localStorage (quota exceeded?):', e);
    // The in-memory signal is already updated, and the backend DB will still receive the POST.
    // Next time the user refreshes, loadFromApi() will restore from the server.
  }
}

export function readSessionFromStorage(storageKey: string, removeOnCorrupt = false): User | null {
  const session = localStorage.getItem(storageKey);
  if (!session) return null;
  try {
    const user = JSON.parse(session) as User;
    if (!user.savedRecipes) user.savedRecipes = [];
    if (!user.cookbooks) user.cookbooks = [];
    if (!user.deletedRecipes) user.deletedRecipes = [];
    return user;
  } catch (e) {
    if (removeOnCorrupt) {
      console.error('Failed to parse local session', e);
      localStorage.removeItem(storageKey);
    }
    return null;
  }
}

// ─── Session Lifecycle & OAuth Reconciliation Helpers ─────────

export interface AuthCheckPayload {
  authenticated?: boolean;
  user_id?: string;
  email: string;
  name?: string;
  picture?: string;
}

/**
 * Clean up ?auth=success query param left by the OAuth redirect,
 * preserving any other query parameters that may be present.
 */
export function cleanOAuthSuccessUrl(): void {
  if (window.location.search.includes('auth=success')) {
    const url = new URL(window.location.href);
    url.searchParams.delete('auth');
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }
}

/**
 * Build an authenticated User record from `/api/auth/check` and merge any
 * existing guest session data before replacing the session.
 */
export function buildAuthenticatedUserFromCheck(
  data: AuthCheckPayload,
  existingLocal: User | null
): User {
  const user: User = {
    id: data.user_id || data.email,
    email: data.email,
    name: data.name || 'Chef',
    picture: data.picture,
    isGuest: false,
    authProvider: 'google',
    savedRecipes: existingLocal?.savedRecipes || [],
    cookbooks: existingLocal?.cookbooks || [],
  };

  // Clear guest marker if present
  if (existingLocal?.isGuest) {
    console.log('Merged guest session data into authenticated user.');
  }

  return user;
}

/**
 * If the loaded local session points at a Google-authed user but Flask
 * reports no active session, drop it entirely. Keeping the cached user
 * (even downgraded to guest) causes the UI to show the Sign In button
 * while still rendering the previously authenticated user's recipes —
 * a state mismatch (and a minor privacy leak on shared devices). The
 * authenticated user's recipes live in the Flask DB and will be re-
 * hydrated on re-login.
 */
export function shouldClearStaleAuthenticatedSession(restored: User | null): boolean {
  return Boolean(restored && !restored.isGuest);
}

/**
 * Decide how `ensureGuestSession()` should handle an existing localStorage session:
 *
 * `init()` may still be awaiting `/api/auth/check`, so `currentUser()` is null
 * even when a session already exists in localStorage. Restore that first
 * instead of overwriting it with a fresh empty guest — otherwise a
 * returning guest who opens a `?save=` or `#kitchen` URL loses their saved
 * recipes to this startup race. (Matches what `init()`'s `loadLocalSession`
 * does; any stale authenticated session is still cleared once the auth
 * check resolves.)
 *
 * A cached *authenticated* session may be stale while the startup auth
 * check is still in flight: restoring it would briefly render another
 * user's data on shared devices, and a save written into it disappears
 * if `clearStaleAuthenticatedSession()` wipes it moments later. Callers
 * that need a session for a save must await `ready` first.
 */
export function resolveGuestSessionEnsure(
  existing: User | null,
  authLoading: boolean
): 'restore' | 'defer' | 'create' {
  if (!existing) return 'create';
  return existing.isGuest || !authLoading ? 'restore' : 'defer';
}

/**
 * Create a new empty guest user session record.
 */
export function createGuestUser(): User {
  return {
    id: crypto.randomUUID(),
    name: 'Guest Chef',
    isGuest: true,
    authProvider: 'guest',
    savedRecipes: [],
    cookbooks: [],
  };
}

