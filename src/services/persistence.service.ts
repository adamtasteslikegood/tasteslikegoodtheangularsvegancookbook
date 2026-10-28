import { Injectable, effect, signal, untracked, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { Recipe } from '../recipe.types';
import { Cookbook, User } from '../auth.types';
import { adoptImagePipelineFields, recipeFromRow, RecipeRow } from '../utils/recipe-row';
import {
  beginMembershipOp,
  DELETE_CANONICAL_LOCK_REFUSAL,
  DELETE_PUBLISHED_REFUSAL,
  DELETE_SYNC_FAILURE,
  type DeleteOutcome,
  endMembershipOp,
  extractExistingCookbookFrom409,
  interpretDeleteResponse,
  interpretMembershipResponse,
  interpretSaveResponse,
  type MembershipOpEntry,
  type RawCookbookPayload,
  recipeWithServerIdentity,
  type SaveOutcome,
  type SaveRefusal,
  type SaveResponseLike,
  shouldUndoOptimisticSave,
  shouldWriteCookbookMembership,
  toCookbook,
} from './persistence-outcomes';

export {
  DELETE_CANONICAL_LOCK_REFUSAL,
  DELETE_PUBLISHED_REFUSAL,
  DELETE_SYNC_FAILURE,
  type DeleteOutcome,
  interpretDeleteResponse,
  interpretMembershipResponse,
  interpretSaveResponse,
  recipeWithServerIdentity,
  type SaveOutcome,
  type SaveRefusal,
  type SaveResponseLike,
  shouldUndoOptimisticSave,
  shouldWriteCookbookMembership,
};

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

  /** Saves a recipe locally first, then to the API, and reports the outcome:
   *  why a save was refused (KAN-155), or that there was no session (KAN-306).
   *  Never rejects — see `_apiSaveRecipe`. */
  async saveRecipeDetailed(recipe: Recipe): Promise<SaveOutcome> {
    const user = this.auth.currentUser();
    if (!user) return { ok: true, noSession: true };

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

  /**
   * KAN-289 — server first, then the local recycle bin, and only on success.
   *
   * This used to move the recipe to the bin (and out of every cookbook) and
   * then fire the DELETE without reading the answer. Once the server can say
   * no — KAN-288 refuses to delete a published recipe with 409 — that order
   * orphans the row: still public on the site, gone from the owner's kitchen,
   * so the toggle that would unpublish it is unreachable. That is exactly how
   * the zucchini poppers page was stranded.
   */
  async deleteRecipe(recipeId: string): Promise<DeleteOutcome> {
    const user = this.auth.currentUser();
    if (!user) return { ok: false, message: DELETE_SYNC_FAILURE };

    let outcome: DeleteOutcome;
    try {
      const res = await this._fetch(`/api/recipes/${encodeURIComponent(recipeId)}`, {
        method: 'DELETE',
      });
      outcome = await interpretDeleteResponse(res);
    } catch (err) {
      console.warn(`[PersistenceService] deleteRecipe failed for ${recipeId}:`, err);
      outcome = { ok: false, message: DELETE_SYNC_FAILURE };
    }

    // Soft-delete locally (recycle bin); the backend hard-deletes (KAN-290).
    if (outcome.ok) this.auth.deleteRecipe(recipeId);
    return outcome;
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
      const existing = extractExistingCookbookFrom409(body);
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

  /**
   * KAN-333: resolves to whether the change reached the server. The local
   * cookbook is updated first so the dialog feels instant; when the server
   * does not take the change, the local membership is put back, so the
   * screen shows what the account holds and saving again sends the request.
   */
  async addRecipeToCookbook(cookbookId: string, recipe: Recipe): Promise<SaveOutcome> {
    const user = this.auth.currentUser();
    if (!user) return { ok: false, noSession: true };

    const localId = this.auth.cookbookRecipeIdFor(recipe);
    const op = this._beginMembershipOp(user, cookbookId, localId);
    this.auth.addRecipeToCookbook(cookbookId, recipe);
    const outcome = await this._addMembership(cookbookId, recipe);
    this._endMembershipOp(op, cookbookId, localId, true, outcome.ok);
    return outcome;
  }

  /** KAN-333: see `beginMembershipOp` / `endMembershipOp` in `persistence-outcomes.ts`. */
  private readonly _membership = new Map<string, MembershipOpEntry>();
  private _membershipOpSeq = 0;

  private _beginMembershipOp(user: User, cookbookId: string, recipeId: string): number {
    return beginMembershipOp(this._membership, ++this._membershipOpSeq, user, cookbookId, recipeId);
  }

  private _endMembershipOp(
    op: number,
    cookbookId: string,
    recipeId: string,
    present: boolean,
    ok: boolean
  ) {
    endMembershipOp(this._membership, op, cookbookId, recipeId, present, ok, (cid, rid, conf) =>
      this.auth.setCookbookMembership(cid, rid, conf)
    );
  }

  private async _addMembership(cookbookId: string, recipe: Recipe): Promise<SaveOutcome> {
    // Ensure the recipe exists in the DB before naming it in a membership.
    // KAN-330: when that save never landed (connection, write pause), the
    // membership would reference a row the server does not have — skip it
    // and report the save's outcome instead.
    const saved = await this._apiSaveRecipe(recipe);
    if (!shouldWriteCookbookMembership(saved)) return saved;
    let res: Response | null = null;
    try {
      res = await this._fetch(`/api/collections/${cookbookId}/recipes`, {
        method: 'POST',
        body: JSON.stringify({ recipe_id: recipe.id }),
      });
    } catch (err) {
      console.warn('[PersistenceService] addRecipeToCookbook failed:', err);
    }
    return interpretMembershipResponse(res);
  }

  /** KAN-333: resolves to whether the removal reached the server. */
  async removeRecipeFromCookbook(cookbookId: string, recipeId: string): Promise<SaveOutcome> {
    const user = this.auth.currentUser();
    if (!user) return { ok: false, noSession: true };

    const op = this._beginMembershipOp(user, cookbookId, recipeId);
    this.auth.removeRecipeFromCookbook(cookbookId, recipeId);

    let res: Response | null = null;
    try {
      res = await this._fetch(`/api/collections/${cookbookId}/recipes/${recipeId}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.warn('[PersistenceService] removeRecipeFromCookbook failed:', err);
    }
    const outcome = interpretMembershipResponse(res);
    this._endMembershipOp(op, cookbookId, recipeId, false, outcome.ok);
    return outcome;
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
  private _toCookbook(raw: RawCookbookPayload): Cookbook {
    return toCookbook(raw);
  }
}
