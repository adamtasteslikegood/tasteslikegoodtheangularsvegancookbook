import { Cookbook, User } from '../auth.types';
import { Recipe } from '../recipe.types';

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
 *   paused                         a 503 with code RECIPE_WRITE_PAUSE — Express
 *                                  is holding every recipe write for a few
 *                                  minutes while a publish-state audit runs
 *                                  (KAN-330). Nothing reached the server; the
 *                                  local write stands and a retry will land.
 *   sync                           transport or non-409 server failure.
 */
export type SaveRefusal =
  | 'OWNERSHIP_OTHER_ACCOUNT'
  | 'OWNERSHIP_OTHER_GUEST_SESSION'
  | 'OWNERSHIP_ORPHANED_GUEST_ROW'
  | 'ownership'
  | 'duplicate'
  | 'paused'
  | 'sync';

export interface SaveOutcome {
  ok: boolean;
  refusal?: SaveRefusal;
  /** True when the server already has this recipe — the save is a no-op, not
   *  a failure. Callers should surface "you already have this" rather than
   *  "saved to your cookbook" or an error. */
  alreadySaved?: boolean;
  /** True when there was no session, so nothing was saved (not even locally).
   *  `ok` stays true for the existing boolean callers; analytics must not
   *  count it as a kept recipe (KAN-292). */
  noSession?: boolean;
}

/** Minimal shape of what `interpretSaveResponse` needs from a `Response`. */
export interface SaveResponseLike {
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
  // KAN-330: the write pause names itself. A 503 without the code is an
  // outage, and the connection advice stays right for that.
  if (res.status === 503 && (await isWritePauseBody(res))) {
    return { ok: false, refusal: 'paused' };
  }
  if (!res.ok) {
    return { ok: false, refusal: 'sync' };
  }
  return null;
}

async function isWritePauseBody(res: SaveResponseLike): Promise<boolean> {
  try {
    const body = (await res.json()) as { code?: unknown } | null;
    return body?.code === 'RECIPE_WRITE_PAUSE';
  } catch {
    return false;
  }
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
 * KAN-330 — may a cookbook membership be posted after the recipe save?
 *
 * The membership names a row by id, so it only makes sense once the server
 * has that row: after a successful save. A save that never landed —
 * connection, write pause — or that the server refused as not the caller's
 * leaves no row for the membership to point at. KAN-333: neither does a
 * duplicate refusal. It means another row with the same source identity
 * exists under its own server id, not this one, so a membership for this id
 * would point at a recipe that was never stored.
 */
export function shouldWriteCookbookMembership(outcome: SaveOutcome): boolean {
  return outcome.ok;
}

/**
 * KAN-333 — what a cookbook membership write's answer means. `null` is a
 * request that never got an answer (transport failure).
 *
 * Anything that is not a success is reported unsynced. That includes a 404 on
 * removal: the Backend answers 200 when the recipe is not in the cookbook, and
 * 404 only when the cookbook is not found in the caller's scope (a lapsed
 * session, say), so the removal did not happen. The write pause does not cover /api/collections, so a
 * membership request itself never carries the named pause; the pause reaches
 * an add through the recipe save that precedes it.
 */
export function interpretMembershipResponse(
  res: { ok: boolean; status: number } | null
): SaveOutcome {
  if (res?.ok) return { ok: true };
  return { ok: false, refusal: 'sync' };
}

/** KAN-333: whether a recipe is in a cookbook right now. */
export function isInCookbook(user: User, cookbookId: string, recipeId: string): boolean {
  return user.cookbooks.some((cb) => cb.id === cookbookId && cb.recipeIds.includes(recipeId));
}

/**
 * KAN-333: membership changes per cookbook and recipe. The dialog can reopen
 * while a request is pending, so changes to one pair overlap. `confirmed` is
 * the membership the server last took (or the local state when no change
 * was pending), and a failure puts the screen back to it, but only when it
 * is the newest change to that pair. An older change that lands after a
 * newer one failed updates `confirmed` and the screen follows it.
 */
export interface MembershipOpEntry {
  latest: number;
  pending: number;
  confirmed: boolean;
  undone: boolean;
}

export function beginMembershipOp(
  membership: Map<string, MembershipOpEntry>,
  op: number,
  user: User,
  cookbookId: string,
  recipeId: string
): number {
  const key = `${cookbookId}\u0000${recipeId}`;
  const entry = membership.get(key);
  if (!entry || entry.pending === 0) {
    const confirmed = isInCookbook(user, cookbookId, recipeId);
    membership.set(key, { latest: op, pending: 1, confirmed, undone: false });
  } else {
    entry.latest = op;
    entry.pending++;
    entry.undone = false;
  }
  return op;
}

export function endMembershipOp(
  membership: Map<string, MembershipOpEntry>,
  op: number,
  cookbookId: string,
  recipeId: string,
  present: boolean,
  ok: boolean,
  onUndo: (cookbookId: string, recipeId: string, confirmed: boolean) => void
): void {
  const key = `${cookbookId}\u0000${recipeId}`;
  const entry = membership.get(key);
  if (!entry) return;
  entry.pending--;
  if (ok) entry.confirmed = present;
  if (!ok && entry.latest === op) entry.undone = true;
  if (entry.undone) onUndo(cookbookId, recipeId, entry.confirmed);
  if (entry.pending === 0) membership.delete(key);
}

const SERVER_ORIGINS = new Set<Recipe['origin']>(['manual', 'generated', 'saved']);

/**
 * Mirrors the server-owned identity fields returned by POST /api/recipes into
 * the local cache. The stable source id is required for hydrate-time dedup
 * after a public source recipe has been re-slugged (KAN-265).
 *
 * KAN-330: `origin` and `is_public` are mirrored too. The server writes
 * `origin` only from its own worker, and it saves a new row private however
 * the payload was flagged — so both come back as the server has them, and the
 * publish toggle renders from the row the server holds, not the one the client
 * proposed.
 */
export function recipeWithServerIdentity(recipe: Recipe, body: unknown): Recipe {
  if (typeof body !== 'object' || body === null) return recipe;
  const row = body as Record<string, unknown>;
  let serverSlug = recipe.slug;
  if (typeof row['slug'] === 'string' && row['slug']) {
    serverSlug = row['slug'];
  }

  let serverOrigin = recipe.origin;
  if ('origin' in row) {
    const value = row['origin'];
    if (value === null) serverOrigin = undefined;
    else if (SERVER_ORIGINS.has(value as Recipe['origin'])) {
      serverOrigin = value as Recipe['origin'];
    }
  }

  let serverIsPublic = recipe.is_public;
  if (typeof row['is_public'] === 'boolean') {
    serverIsPublic = row['is_public'];
  }

  let serverSourceRecipeId = recipe.sourceRecipeId;
  if ('source_recipe_id' in row) {
    const value = row['source_recipe_id'];
    if (value === null) serverSourceRecipeId = undefined;
    else if (typeof value === 'string' && value) serverSourceRecipeId = value;
  }

  let serverFirstPublishedAt = recipe.first_published_at;
  let hasServerFirstPublishedAt = false;
  if ('first_published_at' in row) {
    const value = row['first_published_at'];
    if (value === null || (typeof value === 'string' && value)) {
      serverFirstPublishedAt = value;
      hasServerFirstPublishedAt = true;
    }
  }

  if (
    serverSlug === recipe.slug &&
    serverSourceRecipeId === recipe.sourceRecipeId &&
    serverFirstPublishedAt === recipe.first_published_at &&
    serverOrigin === recipe.origin &&
    serverIsPublic === recipe.is_public
  ) {
    return recipe;
  }
  return {
    ...recipe,
    ...(serverSlug ? { slug: serverSlug } : {}),
    sourceRecipeId: serverSourceRecipeId,
    ...(hasServerFirstPublishedAt ? { first_published_at: serverFirstPublishedAt } : {}),
    origin: serverOrigin,
    ...(serverIsPublic === undefined ? {} : { is_public: serverIsPublic }),
  };
}

/** KAN-289 — what the kitchen needs to know after asking to delete a recipe. */
export type DeleteOutcome = { ok: true } | { ok: false; message: string };

export const DELETE_SYNC_FAILURE =
  "Couldn't delete this recipe. Check your connection and try again; it is still in your cookbook.";
export const DELETE_PUBLISHED_REFUSAL =
  'This recipe is published. Unpublish it before deleting it: deleting permanently retires its public page.';
export const DELETE_CANONICAL_LOCK_REFUSAL =
  "This is a canonical public recipe, so it can't be deleted. It is still in your cookbook.";

/**
 * KAN-289 — decide what a DELETE /api/recipes/:id response means.
 *
 * Only a success or a 404 (the row is already gone server-side, e.g. deleted
 * from another device) lets the local delete go ahead. A 409 is the KAN-288
 * refusal to delete a published recipe and a 400 the KAN-139 canonical lock;
 * for both the server's text wins over the client fallback. Anything else is a failure: the local copy must stay, or the row
 * lives on server-side with no way back to it from the kitchen.
 */
export async function interpretDeleteResponse(res: SaveResponseLike): Promise<DeleteOutcome> {
  if (res.ok || res.status === 404) return { ok: true };
  if (res.status === 409 || res.status === 400) {
    // Both are deliberate server refusals: a retry-shaped "check your
    // connection" fallback would invite a retry that can never succeed (KAN-291).
    let message = res.status === 409 ? DELETE_PUBLISHED_REFUSAL : DELETE_CANONICAL_LOCK_REFUSAL;
    try {
      const body = (await res.json()) as { error?: unknown } | null;
      if (body && typeof body.error === 'string' && body.error) message = body.error;
    } catch {
      // Body missing or not JSON: keep the client fallback.
    }
    return { ok: false, message };
  }
  return { ok: false, message: DELETE_SYNC_FAILURE };
}

export interface RawCookbookPayload {
  id: string;
  name: string;
  description?: string;
  coverImage?: string;
  recipeIds?: string[];
}

/** Map Flask collection JSON → Angular Cookbook interface. */
export function toCookbook(raw: RawCookbookPayload): Cookbook {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? '',
    coverImage: raw.coverImage,
    recipeIds: raw.recipeIds ?? [],
  };
}

/**
 * Accept either a `{collection: {...}}` envelope or a raw cookbook
 * dict (matching the 201 shape) — the eventual 409 contract isn't
 * settled yet, so guard on `id` rather than assuming one shape.
 */
export function extractExistingCookbookFrom409(body: unknown): RawCookbookPayload | null {
  if (typeof body !== 'object' || body === null) return null;
  const obj = body as { collection?: RawCookbookPayload; id?: unknown };
  const candidate =
    obj.collection ?? (typeof obj.id === 'string' ? (obj as RawCookbookPayload) : null);
  return candidate && typeof candidate.id === 'string' ? candidate : null;
}
