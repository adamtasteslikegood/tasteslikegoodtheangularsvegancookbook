import { describe, expect, it, vi } from 'vitest';
import {
  interpretMembershipResponse,
  interpretSaveResponse,
  PersistenceService,
  recipeWithServerIdentity,
  shouldUndoOptimisticSave,
  shouldWriteCookbookMembership,
} from './persistence.service';
import type { Recipe } from '../recipe.types';
import type { User } from '../auth.types';

/**
 * KAN-155 — a 409 from POST /api/recipes is a REFUSAL, not a success.
 *
 * This file exists because of a single line that was correct when written and
 * silently became wrong:
 *
 *     if (!res.ok && res.status !== 409) { ...return false }
 *
 * The comment above it said "the current API never returns 409 (it upserts
 * instead of conflicting)", and while that held, letting 409 fall through to
 * `return true` was harmless. Then the ownership refusal moved from 500 to 409
 * (Backend #256) and the same line began reporting a rejected write as a
 * successful one — leaving the optimistic `is_public: true` on screen over a row
 * the server never stored. The user is told they published something they did
 * not.
 *
 * Nothing in the frontend changed to cause that. It broke because a downstream
 * contract moved, which is exactly the kind of break a unit test has to catch:
 * the type checker cannot see an HTTP status.
 */
describe('interpretSaveResponse (KAN-155)', () => {
  const res = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  it('reports a 409 as a refusal, not a success', async () => {
    // The core regression. If this ever returns null (= "continue, it worked"),
    // the publish toggle stays on over a row the server refused to write.
    const outcome = await interpretSaveResponse(
      res(409, { error: 'refused', code: 'OWNERSHIP_OTHER_ACCOUNT' })
    );

    expect(outcome).not.toBeNull();
    expect(outcome?.ok).toBe(false);
  });

  it('surfaces the server code so the UI can pick the right message', async () => {
    for (const code of [
      'OWNERSHIP_OTHER_ACCOUNT',
      'OWNERSHIP_OTHER_GUEST_SESSION',
      'OWNERSHIP_ORPHANED_GUEST_ROW',
    ]) {
      const outcome = await interpretSaveResponse(res(409, { code }));
      expect(outcome?.refusal, code).toBe(code);
    }
  });

  it('recognises RECIPE_ALREADY_SAVED as a duplicate, not an ownership refusal', async () => {
    // KAN-241: before this fix, RECIPE_ALREADY_SAVED fell through to the generic
    // 'ownership' bucket, which toasted the wrong message and left a ghost in
    // localStorage. The code must map to 'duplicate' so the caller can clean up.
    const outcome = await interpretSaveResponse(
      res(409, { error: 'You already have this recipe saved.', code: 'RECIPE_ALREADY_SAVED' })
    );

    expect(outcome).toEqual({ ok: false, refusal: 'duplicate' });
  });

  it('degrades a 409 with no code to a generic ownership refusal', async () => {
    // A Backend older than the three-code split still answers a bare 409. It is
    // still a refusal — the absence of a code must never read as success.
    const outcome = await interpretSaveResponse(res(409, { error: 'refused' }));

    expect(outcome).toEqual({ ok: false, refusal: 'ownership' });
  });

  it('degrades an unrecognised 409 code to a generic ownership refusal', async () => {
    // A code from a Backend newer than this build.
    const outcome = await interpretSaveResponse(res(409, { code: 'OWNERSHIP_SOMETHING_FUTURE' }));

    expect(outcome).toEqual({ ok: false, refusal: 'ownership' });
  });

  it('treats a 409 with an unparseable body as a refusal, not a crash', async () => {
    const outcome = await interpretSaveResponse({
      ok: false,
      status: 409,
      json: async () => {
        throw new SyntaxError('not json');
      },
    });

    expect(outcome).toEqual({ ok: false, refusal: 'ownership' });
  });

  it('never reports an ownership refusal as a sync failure', async () => {
    // Would put the connection message back on a permission decision — the
    // original KAN-155 complaint.
    const outcome = await interpretSaveResponse(res(409, { code: 'OWNERSHIP_OTHER_ACCOUNT' }));

    expect(outcome?.refusal).not.toBe('sync');
  });

  it('still reports a non-409 server error as a sync failure', async () => {
    expect(await interpretSaveResponse(res(500, { error: 'boom' }))).toEqual({
      ok: false,
      refusal: 'sync',
    });
    expect(await interpretSaveResponse(res(400, { error: 'bad slug' }))).toEqual({
      ok: false,
      refusal: 'sync',
    });
  });

  // KAN-330: while the publish audit runs, Express answers every recipe write
  // with a 503 that names itself. That one is a pause, not a broken network;
  // any other 503 (an outage) keeps the connection advice.
  it('recognises the recipe write pause by its code', async () => {
    expect(
      await interpretSaveResponse(
        res(503, { error: 'Recipes are read-only for a few minutes.', code: 'RECIPE_WRITE_PAUSE' })
      )
    ).toEqual({ ok: false, refusal: 'paused' });
  });

  it('keeps a bare 503 as a sync failure', async () => {
    expect(await interpretSaveResponse(res(503, { error: 'upstream unavailable' }))).toEqual({
      ok: false,
      refusal: 'sync',
    });
    expect(
      await interpretSaveResponse({
        ok: false,
        status: 503,
        json: async () => {
          throw new SyntaxError('not json');
        },
      })
    ).toEqual({ ok: false, refusal: 'sync' });
  });

  it('returns null on success so the caller continues to the slug mirror-back', async () => {
    // KAN-149 (#3262): the server mints the slug and the caller must adopt it.
    // Short-circuiting a 201 here would silently break the View link.
    expect(await interpretSaveResponse(res(201, { id: 'r1', slug: 'vegan-cornbread' }))).toBeNull();
    expect(await interpretSaveResponse(res(200, { id: 'r1' }))).toBeNull();
  });
});

describe('recipeWithServerIdentity (KAN-265/KAN-289)', () => {
  const recipe = {
    id: 'guest-copy',
    name: 'Cornbread',
    description: '',
    prepTime: 10,
    cookTime: 20,
    servings: 4,
    ingredients: {},
    instructions: [],
    slug: 'old-slug',
  };

  it('mirrors the server slug and stable source id', () => {
    expect(
      recipeWithServerIdentity(recipe, {
        slug: 'server-slug',
        source_recipe_id: 'source-uuid-1',
      })
    ).toMatchObject({
      slug: 'server-slug',
      sourceRecipeId: 'source-uuid-1',
    });
  });

  it('clears a stale source id when the server returns null', () => {
    expect(
      recipeWithServerIdentity(
        { ...recipe, sourceRecipeId: 'deleted-source' },
        { source_recipe_id: null }
      ).sourceRecipeId
    ).toBeUndefined();
  });

  it('adopts first_published_at after the first publish', () => {
    const firstPublishedAt = '2026-09-28T18:20:00';

    expect(
      recipeWithServerIdentity(
        { ...recipe, is_public: true, first_published_at: null },
        { slug: 'server-slug', first_published_at: firstPublishedAt }
      )
    ).toMatchObject({
      slug: 'server-slug',
      first_published_at: firstPublishedAt,
    });
  });

  it('ignores malformed response identity fields', () => {
    expect(
      recipeWithServerIdentity(recipe, {
        slug: 42,
        source_recipe_id: { bad: true },
        origin: 'forged',
        is_public: 'yes',
      })
    ).toBe(recipe);
  });

  // KAN-330: the server decides both. A new row asked to be public comes back
  // private, and the toggle must show that; a finished generation comes back
  // labelled `generated`, which is what enables the toggle at all.
  it('mirrors the server origin and publish state', () => {
    expect(
      recipeWithServerIdentity(
        { ...recipe, is_public: true },
        { id: 'guest-copy', origin: 'generated', is_public: false }
      )
    ).toMatchObject({ origin: 'generated', is_public: false });
  });

  it('clears a client-side origin label the server did not keep', () => {
    expect(
      recipeWithServerIdentity({ ...recipe, origin: 'generated' }, { origin: null }).origin
    ).toBeUndefined();
  });
});

// KAN-330: adding to a cookbook first saves the recipe, then posts the
// membership. When the save never landed (connection, write pause) the
// membership would reference a row the server does not have.
//
// KAN-333: a duplicate refusal does not mean the server has THIS id. It means
// another row with the same source identity exists under its own server id, so
// posting a membership for this id points at a recipe that was never stored.
describe('shouldWriteCookbookMembership', () => {
  it('writes only after a save that landed', () => {
    expect(shouldWriteCookbookMembership({ ok: true })).toBe(true);
    expect(shouldWriteCookbookMembership({ ok: true, alreadySaved: true })).toBe(true);
  });

  it('skips when the server may not hold this id', () => {
    expect(shouldWriteCookbookMembership({ ok: false, refusal: 'duplicate' })).toBe(false);
    expect(shouldWriteCookbookMembership({ ok: false, refusal: 'sync' })).toBe(false);
    expect(shouldWriteCookbookMembership({ ok: false, refusal: 'paused' })).toBe(false);
    expect(shouldWriteCookbookMembership({ ok: false, refusal: 'ownership' })).toBe(false);
  });
});

// KAN-333: the membership request's answer used to be ignored, so a refused
// or failed write still closed the cookbook modal as if it had stuck.
describe('interpretMembershipResponse (KAN-333)', () => {
  it('reports a stored membership change as ok', () => {
    expect(interpretMembershipResponse({ ok: true, status: 201 }, 'add')).toEqual({ ok: true });
    expect(interpretMembershipResponse({ ok: true, status: 204 }, 'remove')).toEqual({ ok: true });
  });

  // The Backend answers a removal of a recipe that is not in the cookbook
  // with 200; its only 404 is "cookbook not found in the caller's scope"
  // (collections_api_bp.remove_recipe_from_collection), e.g. a lapsed session.
  // That removal did not happen, so it must not read as done.
  it('reports a removal the server answered 404 as unsynced', () => {
    expect(interpretMembershipResponse({ ok: false, status: 404 }, 'remove')).toEqual({
      ok: false,
      refusal: 'sync',
    });
  });

  it('reports any other answer, or none, as unsynced', () => {
    for (const res of [{ ok: false, status: 404 }, { ok: false, status: 500 }, null]) {
      expect(interpretMembershipResponse(res, 'add')).toEqual({ ok: false, refusal: 'sync' });
    }
    expect(interpretMembershipResponse({ ok: false, status: 503 }, 'remove')).toEqual({
      ok: false,
      refusal: 'sync',
    });
    expect(interpretMembershipResponse(null, 'remove')).toEqual({ ok: false, refusal: 'sync' });
  });
});

/**
 * The ghost-cleanup undo must fire ONLY for a ghost.
 *
 * saveRecipeDetailed removes the local row when the server answers 409
 * duplicate. That is correct for SsrEntryService, the one caller that mints a
 * fresh UUID before saving. Every other caller passes an id that is already a
 * real local row, and for those the same line deletes the user's recipe.
 *
 * saveNotes() (recipe-view.base.ts) is the reachable case: it re-saves an
 * existing recipe, ignores the return value, closes the editor and reports
 * success. A duplicate 409 there is reachable whenever the local id has
 * diverged from the server's — which is exactly the state this cleanup leaves
 * behind until the next hydrate. The failure is therefore self-perpetuating:
 * the cleanup creates the divergence that makes the next notes edit destructive.
 */
describe('shouldUndoOptimisticSave (KAN-241)', () => {
  it('undoes the write for a ghost — a duplicate on an id that was not already saved', () => {
    // The SsrEntryService path: buildSavedRecipeFromPublic minted a fresh UUID,
    // the optimistic write added a row nothing else references, and the server
    // refused it as a duplicate. That row must go.
    expect(shouldUndoOptimisticSave('duplicate', false)).toBe(true);
  });

  it('does NOT undo when the id was already a saved row', () => {
    // The saveNotes() path, and the one that makes this a data-loss bug rather
    // than a tidiness question: the row is the user's real recipe, and the only
    // thing that happened is that the server refused a duplicate write.
    // Removing it deletes their recipe while saveNotes closes the editor and
    // reports success.
    expect(shouldUndoOptimisticSave('duplicate', true)).toBe(false);
  });

  it('never undoes for a non-duplicate refusal, saved or not', () => {
    // Ownership refusals are KAN-155 territory with their own lifecycle, and a
    // sync failure must leave the offline-first local row alone — that row is
    // the whole point of writing localStorage first.
    for (const refusal of ['ownership', 'sync', undefined] as const) {
      expect(shouldUndoOptimisticSave(refusal, false), `${refusal}/new`).toBe(false);
      expect(shouldUndoOptimisticSave(refusal, true), `${refusal}/existing`).toBe(false);
    }
  });
});

// KAN-333 / pr-gate R1-3: a cookbook change the server did not take used to
// stay on screen, so reopening the dialog saw it as made and saving again
// sent nothing. The constructor needs change-detection wiring this setup
// lacks (see interpretSaveResponse), so the methods run on a bare instance.
describe('cookbook membership changes the server does not take (KAN-333)', () => {
  type Book = { id: string; recipeIds: string[] };
  const recipe = { id: 'r1', name: 'Cornbread' } as Recipe;

  type Answer = { ok: boolean; status: number } | 'throw' | (() => Promise<unknown>);
  const setup = (recipeIds: string[], answer: Answer) => {
    let books: Book[] = [{ id: 'cb1', recipeIds: [...recipeIds] }];
    const user = () => ({ cookbooks: books }) as unknown as User;
    const auth = {
      currentUser: () => user(),
      addRecipeToCookbook: (id: string, r: Recipe) => {
        books = books.map((b) =>
          b.id === id && !b.recipeIds.includes(r.id)
            ? { ...b, recipeIds: [...b.recipeIds, r.id] }
            : b
        );
      },
      removeRecipeFromCookbook: (id: string, rid: string) => {
        books = books.map((b) =>
          b.id === id ? { ...b, recipeIds: b.recipeIds.filter((x) => x !== rid) } : b
        );
      },
      setCookbookMembership: (id: string, rid: string, present: boolean) => {
        books = books.map((b) => {
          if (b.id !== id) return b;
          const without = b.recipeIds.filter((x) => x !== rid);
          return { ...b, recipeIds: present ? [...without, rid] : without };
        });
      },
    };
    const fetch = vi.fn(() =>
      typeof answer === 'function'
        ? answer()
        : answer === 'throw'
          ? Promise.reject(new Error('offline'))
          : Promise.resolve(answer)
    );
    const service = Object.assign(Object.create(PersistenceService.prototype), {
      auth,
      _fetch: fetch,
      _apiSaveRecipe: vi.fn().mockResolvedValue({ ok: true }),
      // Field initializers do not run on a bare instance.
      _membershipOps: new Map(),
      _membershipOpSeq: 0,
    }) as PersistenceService;
    return { service, fetch, ids: () => books[0].recipeIds };
  };

  it('puts the cookbook back when an add fails, so saving again sends the request', async () => {
    const { service, fetch, ids } = setup([], { ok: false, status: 500 });
    expect((await service.addRecipeToCookbook('cb1', recipe)).ok).toBe(false);
    expect(ids()).toEqual([]);

    await service.addRecipeToCookbook('cb1', recipe);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('puts the cookbook back when a removal does not reach the server', async () => {
    const { service, ids } = setup(['r0', 'r1'], 'throw');
    expect((await service.removeRecipeFromCookbook('cb1', 'r1')).ok).toBe(false);
    expect(ids()).toEqual(['r0', 'r1']);
  });

  // pr-gate R3: the dialog can reopen while a request is pending. Undoing a
  // failure must touch only that recipe, and never a newer change to it.
  const later = () => {
    let settle!: (v: unknown) => void;
    const promise = new Promise((resolve) => (settle = resolve));
    return { promise, settle };
  };

  it('undoes only the failed recipe, keeping one added meanwhile', async () => {
    const slow = later();
    const answers = [() => slow.promise, () => Promise.resolve({ ok: true, status: 201 })];
    const { service, ids } = setup([], () => answers.shift()!());
    const first = service.addRecipeToCookbook('cb1', recipe);
    await vi.waitFor(() => expect(ids()).toEqual(['r1']));
    await service.addRecipeToCookbook('cb1', { id: 'r2', name: 'Chili' } as Recipe);
    slow.settle({ ok: false, status: 500 });
    await first;
    expect(ids()).toEqual(['r2']);
  });

  it('does not undo a failure that a newer change to the same recipe overtook', async () => {
    const slow = later();
    const answers = [
      () => slow.promise,
      () => Promise.resolve({ ok: true, status: 200 }),
      () => Promise.resolve({ ok: true, status: 201 }),
    ];
    const { service, ids } = setup([], () => answers.shift()!());
    const first = service.addRecipeToCookbook('cb1', recipe);
    await vi.waitFor(() => expect(ids()).toEqual(['r1']));
    await service.removeRecipeFromCookbook('cb1', 'r1');
    await service.addRecipeToCookbook('cb1', recipe);
    slow.settle({ ok: false, status: 500 });
    await first;
    expect(ids()).toEqual(['r1']);
  });

  it('keeps a change the server took', async () => {
    const { service, ids } = setup([], { ok: true, status: 201 });
    expect((await service.addRecipeToCookbook('cb1', recipe)).ok).toBe(true);
    expect(ids()).toEqual(['r1']);
  });
});
