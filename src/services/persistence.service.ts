import { Injectable, effect, signal, untracked, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { Recipe } from '../recipe.types';
import { Cookbook } from '../auth.types';
import { recipeFromRow, RecipeRow } from '../utils/recipe-row';

/**
 * Why a save did not land (KAN-155).
 *
 * The three `OWNERSHIP_*` values mirror the server's `code` on a 409 verbatim.
 * They are NOT derived here: only the server has seen the stored row, so only it
 * can say which refusal fired. Inferring them client-side from auth state would
 * be a guess wearing the costume of a fact.
 *
 *   OWNERSHIP_OTHER_ACCOUNT        a different real account owns it. Final.
 *   OWNERSHIP_OTHER_GUEST_SESSION  another guest session owns it — usually the
 *                                  user's own stale tab. Logging in resolves it.
 *   OWNERSHIP_ORPHANED_GUEST_ROW   an unclaimed guest row, caller authenticated.
 *                                  Known-incomplete: still refused pending the
 *                                  ownership-repair policy on KAN-155.
 *   ownership                      a 409 with no/unknown code — an older Backend,
 *                                  or a code this build predates.
 *   duplicate                      a 409 with code RECIPE_ALREADY_SAVED — the
 *                                  server already has this recipe for this user.
 *                                  Not a failure: the save is a no-op (KAN-241).
 *   sync                           transport or non-409 server failure.
 */
export type SaveRefusal =
  | 'OWNERSHIP_OTHER_ACCOUNT'
  | 'OWNERSHIP_OTHER_GUEST_SESSION'
  | 'OWNERSHIP_ORPHANED_GUEST_ROW'
  | 'ownership'
  | 'duplicate'
  | 'sync';

export interface SaveOutcome {
  ok: boolean;
  refusal?: SaveRefusal;
  /** True when the server already has this recipe — the save is a no-op, not
   *  a failure. Callers should surface "you already have this" rather than
   *  "saved to your cookbook" or an error. */
  alreadySaved?: boolean;
}

/** Minimal shape of what `interpretSaveResponse` needs from a `Response`. */
interface SaveResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/**
 * Decide what a POST /api/recipes response means. Returns `null` when the save
 * succeeded and the caller should continue to the slug mirror-back.
 *
 * Pulled out of `_apiSaveRecipe` as a pure function so it can be tested
 * directly — this is precisely where KAN-155's regression lived, and
 * `PersistenceService`'s constructor registers an `effect()`, so constructing
 * the real service in a unit test needs change-detection wiring that this
 * repo's plain-`Injector.create` test setup does not have. The decision is
 * worth testing; the DI ceremony to reach it is not.
 */
export async function interpretSaveResponse(res: SaveResponseLike): Promise<SaveOutcome | null> {
  // KAN-155/KAN-241: a 409 carries TWO distinct refusals — ownership (KAN-155)
  // and duplicate (KAN-213). The body is read once and classified here; both
  // are refusals (ok: false), but the caller handles them differently:
  // ownership → revert optimistic state and toast an explanation; duplicate →
  // undo the ghost localStorage entry and tell the user they already have it.
  if (res.status === 409) {
    return { ok: false, refusal: await classifyRefusal409(res) };
  }
  if (!res.ok) {
    return { ok: false, refusal: 'sync' };
  }
  return null;
}

/**
 * Classify a 409 into one of two families: duplicate or ownership.
 *
 * KAN-241: the Backend now returns 409 for TWO situations — `RecipeDuplicateError`
 * (code `RECIPE_ALREADY_SAVED`, KAN-213) and `RecipeOwnershipError` (three codes,
 * KAN-155). Before this fix `interpretSaveResponse` treated every 409 as ownership,
 * so a duplicate refusal surfaced as a generic ownership toast and left a ghost
 * recipe in localStorage that could never sync.
 *
 * Falls back to `'ownership'` when `code` is absent or unknown — a Backend older
 * than the three-code split still answers a bare 409, and a code newer than this
 * build must degrade to "refused" rather than to "succeeded".
 * Never throws: a 409 is a refusal regardless of what its body contains.
 */
async function classifyRefusal409(res: SaveResponseLike): Promise<SaveRefusal> {
  try {
    const body = (await res.json()) as { code?: unknown } | null;
    // Duplicate: the server already has this recipe for this owner.
    if (body?.code === 'RECIPE_ALREADY_SAVED') {
      return 'duplicate';
    }
    // Ownership: the row is owned by someone else.
    if (
      body?.code === 'OWNERSHIP_OTHER_ACCOUNT' ||
      body?.code === 'OWNERSHIP_OTHER_GUEST_SESSION' ||
      body?.code === 'OWNERSHIP_ORPHANED_GUEST_ROW'
    ) {
      return body.code;
    }
  } catch {
    // Body missing or not JSON — still a refusal, just an unspecific one.
  }
  return 'ownership';
}

/**
 * PersistenceService — hybrid persistence layer for Phase IV.
 *
 * Strategy:
 *   - Guest users  → Flask API scoped by session_id + localStorage cache
 *   - Logged-in    → Flask API scoped by user_id + localStorage cache
 *
 * All calls go through relative URLs so the Express proxy forwards
 * them to Flask transparently (no CORS, no env var changes needed).
 * See docs/ADR-001-auth-and-persistence-routing.md for the full decision record.
 */
@Injectable({
  providedIn: 'root',
})
export class PersistenceService {
  /** Prevents duplicate API loads for the same session. */
  private _apiSynced = false;
  private readonly auth = inject(AuthService);

  /**
   * KAN-139 — publish state is server-owned, so the publish toggle renders
   * greyed until the first API load settles: 'pending' while the initial
   * sync is in flight, 'synced' once server rows have been merged in,
   * 'failed' when all retries were exhausted (local state is then the best
   * we have and the toggle re-enables rather than staying dead).
   */
  readonly publishStateSync = signal<'pending' | 'synced' | 'failed'>('pending');

  /** Resolves when the first loadFromApi() settles (success OR exhausted
   *  retries) — lets flows that must see server rows (the SSR CTA's
   *  repeat-save dedup) wait for the merge instead of racing it. */
  readonly firstSyncSettled: Promise<void>;
  private _settleFirstSync!: () => void;

  constructor() {
    this.firstSyncSettled = new Promise<void>((resolve) => {
      this._settleFirstSync = resolve;
    });
    // Auto-load from API when a logged-in user's session is confirmed.
    // Uses untracked() so signal writes inside loadFromApi() don't
    // create a reactive dependency in the effect.
    effect(() => {
      const user = this.auth.currentUser();
      const loading = this.auth.authLoading();

      if (!user) {
        this._apiSynced = false;
        return;
      }

      if (!loading && !this._apiSynced) {
        this._apiSynced = true;
        console.log(
          '[PersistenceService] Effect triggered: loading from API for',
          user.email || user.id
        );
        untracked(() => this.loadFromApi());
      }
    });
  }

  // ─── Public API (components call these instead of AuthService directly) ──

  /** Resolves `false` when the API sync failed so callers with optimistic UI
   *  (e.g. togglePublic) can revert; never rejects — see `_apiSaveRecipe`.
   *  Callers that need to explain WHY should use `saveRecipeDetailed`. */
  async saveRecipe(recipe: Recipe): Promise<boolean> {
    return (await this.saveRecipeDetailed(recipe)).ok;
  }

  /** As `saveRecipe`, but reports why a save was refused (KAN-155).
   *
   *  Kept separate rather than widening `saveRecipe`'s return type: the boolean
   *  contract has a dozen background-sync callers that only need "did it land",
   *  and none of them should have to care about refusal reasons. */
  async saveRecipeDetailed(recipe: Recipe): Promise<SaveOutcome> {
    const user = this.auth.currentUser();
    if (!user) return { ok: true };

    // Always update localStorage first for instant UI feedback.
    this.auth.saveRecipe(recipe);

    const outcome = await this._apiSaveRecipe(recipe);

    // KAN-241: the server said "you already have this recipe" — the optimistic
    // localStorage write above added a ghost (fresh UUID, so auth.saveRecipe's
    // ID dedup did not catch it). Remove the ghost; the original is already on
    // the server and will appear on the next hydrate. Scope the undo to the
    // duplicate case only — ownership refusals are KAN-155 territory and have
    // their own lifecycle.
    if (outcome.refusal === 'duplicate') {
      this.auth.removeRecipeById(recipe.id);
      return { ok: true, alreadySaved: true };
    }

    return outcome;
  }

  async deleteRecipe(recipeId: string): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;

    // Soft-delete: move to recycle bin in localStorage
    this.auth.deleteRecipe(recipeId);

    // Backend hard-deletes (no recycle bin server-side yet)
    await this._fetch(`/api/recipes/${recipeId}`, { method: 'DELETE' });
  }

  async restoreRecipe(recipeId: string): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;

    const entry = (user.deletedRecipes || []).find((d) => d.recipe.id === recipeId);
    if (!entry) return;

    // Restore locally
    this.auth.restoreRecipe(recipeId);

    // Re-save to backend
    await this._apiSaveRecipe(entry.recipe);
  }

  async permanentlyDeleteRecipe(recipeId: string): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;

    this.auth.permanentlyDeleteRecipe(recipeId);
    // Already deleted from backend during soft-delete
  }

  async emptyRecycleBin(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;
    this.auth.emptyRecycleBin();
  }

  /**
   * Creates a cookbook and returns its resolved id, or null if creation
   * failed outright (caller should not treat the operation as complete).
   */
  async createCookbook(name: string, description = ''): Promise<string | null> {
    const user = this.auth.currentUser();
    if (!user) return null;

    // Pre-generated so the same id is reused by every path below (server
    // create, 409 reconcile, or local fallback) — a fallback that minted
    // its own id would leave the server and local caches holding two
    // different cookbooks with the same name.
    const id = crypto.randomUUID();
    let res: Response;
    try {
      res = await this._fetch('/api/collections', {
        method: 'POST',
        // The backend honors either this header or the body `id` for
        // idempotent replay, returning the existing cookbook instead of a
        // fresh insert (adamtasteslikegood/tasteslikegood.com#216).
        headers: { 'Idempotency-Key': id },
        body: JSON.stringify({ id, name, description }),
      });
    } catch {
      // Network failure — fall back to localStorage so the UI still works.
      return this.auth.createCookbook(name, description, id)?.id ?? null;
    }

    // 409 = a cookbook with this name already exists for this owner. The
    // server is authoritative, so do NOT fall back to a local duplicate;
    // reconcile the existing cookbook into local state if it isn't there yet
    // (server-side enforcement + idempotent replay shipped in #216).
    if (res.status === 409) {
      const body = await res.json().catch(() => null);
      // Accept either a `{collection: {...}}` envelope or a raw cookbook
      // dict (matching the 201 shape) — the eventual 409 contract isn't
      // settled yet, so guard on `id` rather than assuming one shape.
      const existing = body?.collection ?? (body && typeof body.id === 'string' ? body : null);
      if (!existing) return null;
      const current = this.auth.currentUser();
      if (current && !current.cookbooks.some((c) => c.id === existing.id)) {
        this.auth.hydrate(current.savedRecipes, [...current.cookbooks, this._toCookbook(existing)]);
      }
      return existing.id;
    }

    if (res.status >= 500) {
      // Server error — fall back to localStorage so the UI still works.
      return this.auth.createCookbook(name, description, id)?.id ?? null;
    }

    if (!res.ok) {
      // Genuine client-side rejection (400/401/403/...) — do not fall back
      // to a local duplicate the server never agreed to.
      console.warn(`[PersistenceService] createCookbook ${res.status}`);
      return null;
    }

    const data = await res.json();
    // Sync the server-assigned cookbook into local state
    const current = this.auth.currentUser();
    if (current) {
      this.auth.hydrate(current.savedRecipes, [...current.cookbooks, this._toCookbook(data)]);
    }
    return data?.id ?? null;
  }

  async deleteCookbook(cookbookId: string): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;

    this.auth.deleteCookbook(cookbookId);

    await this._fetch(`/api/collections/${cookbookId}`, { method: 'DELETE' });
  }

  async addRecipeToCookbook(cookbookId: string, recipe: Recipe): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;

    this.auth.addRecipeToCookbook(cookbookId, recipe);

    await this._apiSaveRecipe(recipe); // ensure recipe exists in DB
    await this._fetch(`/api/collections/${cookbookId}/recipes`, {
      method: 'POST',
      body: JSON.stringify({ recipe_id: recipe.id }),
    });
  }

  async removeRecipeFromCookbook(cookbookId: string, recipeId: string): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;

    this.auth.removeRecipeFromCookbook(cookbookId, recipeId);

    await this._fetch(`/api/collections/${cookbookId}/recipes/${recipeId}`, {
      method: 'DELETE',
    });
  }

  // ─── Internal: API sync ───────────────────────────────────────────────────

  /**
   * Load all recipes and cookbooks from the Flask API and merge into
   * the Angular user state via AuthService.hydrate().
   * Called once after Google OAuth login is confirmed.
   * Retries up to 2 times on failure (session may not be ready immediately after OAuth redirect).
   * The awaited loop makes retries run sequentially within a single invocation, and any
   * caller that explicitly awaits this method will wait for the full operation (including retries).
   * This method does not by itself prevent separate loadFromApi() invocations from overlapping.
   */
  async loadFromApi(retries = 2): Promise<void> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        const remaining = retries - attempt;
        console.log(`[PersistenceService] Retrying in 1s (${remaining} retries left)...`);
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      }
      try {
        console.log('[PersistenceService] Loading recipes from API...');
        const [recipesRes, collectionsRes] = await Promise.all([
          this._fetch('/api/recipes'),
          this._fetch('/api/collections'),
        ]);

        console.log(
          `[PersistenceService] API responses: recipes=${recipesRes.status}, collections=${collectionsRes.status}`
        );

        if (!recipesRes.ok || !collectionsRes.ok) {
          console.warn('[PersistenceService] API returned non-OK');
          continue;
        }

        const recipesData = await recipesRes.json();
        const collectionsData = await collectionsRes.json();

        // Column-over-blob merge (KAN-139) — see recipeFromRow for the
        // contract; shared with recipe-detail's cold deep-link fetch (KAN-149).
        const recipes: Recipe[] = (recipesData.recipes ?? []).map((r: RecipeRow) =>
          recipeFromRow(r)
        );

        const cookbooks: Cookbook[] = (collectionsData.collections ?? []).map(this._toCookbook);

        console.log(
          `[PersistenceService] Hydrating ${recipes.length} recipes, ${cookbooks.length} cookbooks`
        );
        this.auth.hydrate(recipes, cookbooks);
        this.publishStateSync.set('synced');
        this._settleFirstSync();
        return;
      } catch (err) {
        console.warn('[PersistenceService] loadFromApi attempt failed:', err);
      }
    }
    console.warn(
      '[PersistenceService] loadFromApi failed after all retries, will retry on next auth change'
    );
    this._apiSynced = false;
    this.publishStateSync.set('failed');
    this._settleFirstSync();
  }

  /** POST a recipe to Flask; the endpoint upserts same-owner recipes, so
   *  re-saves are idempotent (201 both on create and on update).
   *  Never rejects — background-sync callers (restoreRecipe,
   *  addRecipeToCookbook, ...) rely on that. Resolves to a `SaveOutcome`
   *  instead, so callers that need to react to a failed sync (e.g. revert
   *  optimistic UI state) can check `.ok`, and the publish path can read
   *  `.refusal` to say WHY. Was a bare `false` before KAN-155, which is
   *  exactly what made a refusal indistinguishable from a network failure. */
  private async _apiSaveRecipe(recipe: Recipe): Promise<SaveOutcome> {
    try {
      const res = await this._fetch('/api/recipes', {
        method: 'POST',
        body: JSON.stringify({ ...recipe, id: recipe.id }),
      });
      const refused = await interpretSaveResponse(res);
      if (refused) {
        if (refused.refusal === 'sync') {
          console.warn(`[PersistenceService] saveRecipe ${res.status}`);
        }
        return refused;
      }
      // Publish flow: the server may assign a different slug than the client
      // sent (uniqueness collision suffix), so mirror its authoritative
      // value back into local state — otherwise the /r/<slug> link in the UI
      // silently points at another recipe or 404s until the next reload.
      // Immutable on purpose (KAN-149 / #3262): zoneless change detection
      // only re-renders on a signal change, so an in-place `recipe.slug =`
      // write updated the store but never the screen. Callers that render
      // this recipe must re-read it from auth state after the sync resolves.
      try {
        const body = await res.json();
        const serverSlug = body?.slug;
        if (typeof serverSlug === 'string' && serverSlug && serverSlug !== recipe.slug) {
          this.auth.saveRecipe({ ...recipe, slug: serverSlug });
        }
      } catch {
        // Body missing or not JSON — keep the optimistic local value.
      }
      return { ok: true };
    } catch (err) {
      console.warn('[PersistenceService] apiSaveRecipe failed:', err);
      return { ok: false, refusal: 'sync' };
    }
  }

  /** Fetch with session cookie and JSON content-type. */
  private _fetch(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(path, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  }

  /** Map Flask collection JSON → Angular Cookbook interface. */
  private _toCookbook(raw: {
    id: string;
    name: string;
    description?: string;
    coverImage?: string;
    recipeIds?: string[];
  }): Cookbook {
    return {
      id: raw.id,
      name: raw.name,
      description: raw.description ?? '',
      coverImage: raw.coverImage,
      recipeIds: raw.recipeIds ?? [],
    };
  }
}
