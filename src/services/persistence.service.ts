import { Injectable, effect, signal, untracked, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { Recipe } from '../recipe.types';
import { Cookbook } from '../auth.types';
import { adoptImagePipelineFields, recipeFromRow, RecipeRow } from '../utils/recipe-row';

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
 *                                  Always a refusal at this layer
 *                                  (interpretSaveResponse returns ok:false).
 *                                  saveRecipeDetailed then translates it to
 *                                  ok:true + alreadySaved ONLY when this save
 *                                  created the row it is undoing — the
 *                                  SsrEntryService ghost. There "you already
 *                                  have this" IS the successful outcome: the
 *                                  user asked to save a public recipe and they
 *                                  have it, so there was nothing left to do.
 *                                  When the id was ALREADY a saved row the
 *                                  refusal stands as ok:false + duplicate. That
 *                                  caller asked to persist a CHANGE to an
 *                                  existing recipe — edited notes, a publish
 *                                  toggle — and the server refused it, so the
 *                                  change is not stored and reporting success
 *                                  would be a lie of exactly the kind KAN-155
 *                                  was filed about. Callers can still tell it
 *                                  apart from 'sync' (KAN-241).
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
 * Should the optimistic localStorage write be undone after a refusal?
 *
 * Only for a GHOST: a row this save itself created. `SsrEntryService` is the
 * one caller that mints a fresh UUID before saving, so its duplicate-409 leaves
 * a row nothing else references. Every other caller passes an id that is
 * already a real local row — removing that deletes the user's recipe.
 *
 * `saveNotes()` (recipe-view.base.ts) is the reachable case: it re-saves an
 * existing recipe, ignores the return value, closes the editor and reports
 * success. A duplicate 409 there is reachable whenever the local id has
 * diverged from the server's, which is exactly the state this undo leaves
 * behind until the next hydrate — so without the guard the cleanup creates the
 * divergence that makes the next notes edit destructive. Bulk import
 * (kitchen.component.ts) has the same shape and over-reports its count.
 *
 * Pure and exported for the same reason as `interpretSaveResponse` above: the
 * decision is worth testing, the DI ceremony to reach it is not.
 */
export function shouldUndoOptimisticSave(
  refusal: SaveRefusal | undefined,
  wasAlreadySaved: boolean
): boolean {
  return refusal === 'duplicate' && !wasAlreadySaved;
}

/**
 * Mirrors the server-owned identity fields returned by POST /api/recipes into
 * the local cache. The stable source id is required for hydrate-time dedup
 * after a public source recipe has been re-slugged (KAN-265).
 */
export function recipeWithServerIdentity(recipe: Recipe, body: unknown): Recipe {
  if (typeof body !== 'object' || body === null) return recipe;
  const row = body as Record<string, unknown>;
  let serverSlug = recipe.slug;
  if (typeof row['slug'] === 'string' && row['slug']) {
    serverSlug = row['slug'];
  }

  let serverSourceRecipeId = recipe.sourceRecipeId;
  if ('source_recipe_id' in row) {
    const value = row['source_recipe_id'];
    if (value === null) serverSourceRecipeId = undefined;
    else if (typeof value === 'string' && value) serverSourceRecipeId = value;
  }

  if (serverSlug === recipe.slug && serverSourceRecipeId === recipe.sourceRecipeId) return recipe;
  return {
    ...recipe,
    ...(serverSlug ? { slug: serverSlug } : {}),
    sourceRecipeId: serverSourceRecipeId,
  };
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

    // Whether this id was ALREADY a saved row before the optimistic write
    // below. Must be sampled first: auth.saveRecipe dedups by id, so after it
    // runs a ghost and a pre-existing row are indistinguishable. Reads the
    // `user` captured above rather than re-calling currentUser(), so the sample
    // is a true snapshot of the same state the guard above validated.
    const wasAlreadySaved = user.savedRecipes.some((r) => r.id === recipe.id);

    // Always update localStorage first for instant UI feedback.
    this.auth.saveRecipe(recipe);

    const outcome = await this._apiSaveRecipe(recipe);

    // KAN-241: the server said "you already have this recipe" — the optimistic
    // localStorage write above added a ghost (fresh UUID, so auth.saveRecipe's
    // ID dedup did not catch it). Remove the ghost; the original is already on
    // the server and will appear on the next hydrate. Scope the undo to the
    // duplicate case only — ownership refusals are KAN-155 territory and have
    // their own lifecycle.
    //
    // The `!wasAlreadySaved` guard is load-bearing, not belt-and-braces. This
    // is a generic layer and only SsrEntryService mints a ghost; every other
    // caller passes an id that is already a real local row. saveNotes()
    // (recipe-view.base.ts) is the dangerous one — it re-saves an existing
    // recipe, and a duplicate 409 there is reachable whenever the local id has
    // diverged from the server's (which is precisely the state this cleanup
    // leaves behind until the next hydrate). Without the guard, the user's real
    // recipe is deleted from localStorage while saveNotes closes the editor and
    // reports success.
    //
    // Bulk import (kitchen.component.ts) is protected by the same guard but for
    // a different reason: importRecipes() pre-inserts every id BEFORE the save
    // loop, so wasAlreadySaved is always true there and the undo never fires.
    // That is the right outcome — those are real imported rows, not ghosts —
    // but it does not fix that caller's success count, which ignores the return
    // value entirely and reports collisions as imported. Tracked separately in
    // KAN-262; it is a pre-existing reporting bug, not data loss.
    if (shouldUndoOptimisticSave(outcome.refusal, wasAlreadySaved)) {
      this.auth.removeRecipeById(recipe.id);
      return { ok: true, alreadySaved: true };
    }

    return outcome;
  }

  /**
   * KAN-255 — re-read ONE recipe's authoritative row and merge it into local state.
   *
   * The image pipeline finishes server-side. The Pub/Sub worker writes
   * `ai_image_gcs`, `ai_metadata.image_generation`, and flips
   * `ai_metadata.image_request.status` / `ai_metadata.image_enqueue.status` from
   * `pending` to `complete` (Backend `worker_api_bp._image_generation_metadata`).
   * The client only ever wrote `ai_image_url` back, so navigating away during
   * image generation and returning left the in-memory copy AND localStorage
   * still claiming the image was pending — visible the moment a single recipe
   * was exported as JSON.
   *
   * Contract, deliberately narrow:
   *  - Never rejects. This runs as a background reconcile after an image
   *    settles; a failed reconcile must not take the caller down. Resolves to
   *    the merged recipe, or `null` when the row could not be read.
   *  - Local write only. The row came FROM the server, so POSTing it back is a
   *    pointless round trip that can also lose a race with the worker.
   *  - Never ADDS a row. A cold deep-linked recipe (recipe-detail, saved=false)
   *    is not in the user's cookbook, and a background image reconcile must not
   *    be the thing that saves it for them.
   *  - The server wins for the image-pipeline fields ONLY
   *    (`adoptImagePipelineFields`), not wholesale. Adopting the whole row here
   *    reverted a concurrent notes edit or publish made during the 30-60s image
   *    window, and — because `saveNotes` POSTs the whole recipe — the next save
   *    after that clobber wrote the stale copy back to the server for good.
   */
  async refreshRecipeFromApi(recipeId: string): Promise<Recipe | null> {
    if (!this.auth.currentUser()) return null;
    try {
      const res = await this._fetch(`/api/recipes/${encodeURIComponent(recipeId)}`);
      if (!res.ok) return null;
      // Column-over-blob merge (KAN-139) — same contract as loadFromApi and
      // recipe-detail's cold deep-link fetch. See utils/recipe-row.ts.
      const fresh = recipeFromRow(await res.json());
      if (!fresh?.id || fresh.id !== recipeId) return null;
      const current = this.auth.currentUser();
      const local = current?.savedRecipes.find((r) => r.id === fresh.id);
      if (!local) return fresh;
      // Merge onto the SAVED row, not onto `fresh`: anything the user changed
      // locally while the image was generating lives here and must survive.
      const merged = adoptImagePipelineFields(local, fresh);
      this.auth.saveRecipe(merged);
      return merged;
    } catch (err) {
      console.warn(`[PersistenceService] refreshRecipeFromApi failed for ${recipeId}:`, err);
      return null;
    }
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
    // Sync the server-assigned cookbook into local state — guard against duplicates
    // the same way the 409 path does, in case loadFromApi already hydrated it (KAN-242).
    const current = this.auth.currentUser();
    if (current && !current.cookbooks.some((c) => c.id === data?.id)) {
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
        const syncedRecipe = recipeWithServerIdentity(recipe, body);
        if (syncedRecipe !== recipe) this.auth.saveRecipe(syncedRecipe);
      } catch {
        // Body missing or not JSON — keep the optimistic local identity.
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
