import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishSyncError, publishFailureMessage, RecipeViewBase } from './recipe-view.base';
import { AuthService } from '../../services/auth.service';
import { PersistenceService, type SaveRefusal } from '../../services/persistence.service';
import { GeminiService } from '../../services/gemini.service';
import { RecipeStateService } from '../../services/recipe-state.service';
import { ToastService } from '../../services/toast.service';
import { ModalService } from '../../services/modal.service';

/**
 * KAN-155 — the publish refusal must be honest in BOTH directions.
 *
 * Two failure modes are being guarded here, and they pull against each other:
 *
 *  1. Telling the user "check your connection" for a deliberate permission
 *     refusal. That is what shipped, and it blamed their network for a decision
 *     the server made on purpose.
 *
 *  2. Over-correcting to "this belongs to a different account" for every 409.
 *     RCP-61's repro is a stale tab whose auth had not resolved, where the row
 *     really is the user's own and logging in really does fix it. That message
 *     would tell them to abandon their own recipe.
 *
 * So the network advice has to SURVIVE where it is true, and disappear where it
 * is not. A test suite that only checked #1 would happily accept a build that
 * committed #2.
 */
describe('publish refusal messaging (KAN-155)', () => {
  const OWNERSHIP: SaveRefusal[] = [
    'OWNERSHIP_OTHER_ACCOUNT',
    'OWNERSHIP_OTHER_GUEST_SESSION',
    'OWNERSHIP_ORPHANED_GUEST_ROW',
    'ownership',
  ];

  it('never blames the connection for a deliberate refusal', () => {
    for (const refusal of OWNERSHIP) {
      for (const publishing of [true, false]) {
        const msg = publishFailureMessage(refusal, publishing);
        expect(msg.toLowerCase(), `${refusal} / publishing=${publishing}`).not.toContain(
          'connection'
        );
      }
    }
  });

  it('still blames the connection when the sync genuinely failed', () => {
    // The counterweight to the test above. Adam's point: for a real transport
    // failure this advice is correct and must not be scrubbed away.
    expect(publishFailureMessage('sync', true).toLowerCase()).toContain('connection');
    expect(publishFailureMessage('sync', false).toLowerCase()).toContain('connection');
  });

  it('tells the stale-session user to log in, and the foreign-account user not to', () => {
    // The distinction the three-code split exists to make. Collapsing these two
    // into one string is the regression this pins.
    expect(publishFailureMessage('OWNERSHIP_OTHER_GUEST_SESSION', true).toLowerCase()).toContain(
      'log in'
    );
    expect(publishFailureMessage('OWNERSHIP_OTHER_ACCOUNT', true).toLowerCase()).not.toContain(
      'log in'
    );
  });

  it('does not promise the orphaned-row case will work on retry', () => {
    // The repair is not built (KAN-155, still open). Saying "try again" here
    // would be a promise the code cannot keep.
    const msg = publishFailureMessage('OWNERSHIP_ORPHANED_GUEST_ROW', true).toLowerCase();
    expect(msg).not.toContain('try again');
    expect(msg).toContain('logged in');
  });

  it('uses the verb matching the direction, in both directions', () => {
    // Review catch on #3316. The ownership check fires on the same POST whichever
    // way the toggle is moving, so an UNPUBLISH can be refused too — and the copy
    // hardcoded "published", telling that user their recipe "can't be published".
    //
    // My own test above already looped over both `publishing` values and missed
    // this: it asserted only the ABSENCE of "connection", never that the verb
    // tracked the direction. The loop was right; the assertion was too weak.
    for (const refusal of OWNERSHIP) {
      const unpublishing = publishFailureMessage(refusal, false);
      expect(
        unpublishing,
        `${refusal} must not say "be published" when unpublishing`
      ).not.toContain('be published');
    }
    expect(publishFailureMessage('OWNERSHIP_OTHER_ACCOUNT', true)).toContain('be published');
    expect(publishFailureMessage('OWNERSHIP_OTHER_ACCOUNT', false)).toContain('be unpublished');
    expect(publishFailureMessage('OWNERSHIP_ORPHANED_GUEST_ROW', true)).toContain('be published');
    expect(publishFailureMessage('OWNERSHIP_ORPHANED_GUEST_ROW', false)).toContain(
      'be unpublished'
    );
  });

  it('keeps the guest-session message verb-free in both directions', () => {
    // Its remedy ("log in and try again") is identical either way, so it carries
    // no verb at all. Pinned so a later edit does not add one in one direction.
    const a = publishFailureMessage('OWNERSHIP_OTHER_GUEST_SESSION', true);
    const b = publishFailureMessage('OWNERSHIP_OTHER_GUEST_SESSION', false);
    expect(a).toBe(b);
    // Equality alone is too weak: adding the SAME verb to both directions —
    // the likeliest way this drifts, since the branch takes `publishing` and
    // the four cases around it all use it — would keep a === b and slip past.
    // Assert the property the test is named for. (Review catch on #3316.)
    expect(a).not.toMatch(/publish/i);
  });

  it('gives every refusal a distinct message', () => {
    const all = [...OWNERSHIP, 'sync' as SaveRefusal].map((r) => publishFailureMessage(r, true));
    expect(new Set(all).size).toBe(all.length);
  });

  it('falls back to the sync message for an unrecognised refusal', () => {
    // A code from a newer Backend than this build. Must degrade, not throw.
    const msg = publishFailureMessage('SOMETHING_NEW' as SaveRefusal, true);
    expect(msg).toBe(publishFailureMessage('sync', true));
  });
});

describe('togglePublic on a refused publish (KAN-155)', () => {
  let toastShow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    toastShow = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const createHost = (outcome: { ok: boolean; refusal?: SaveRefusal }) => {
    const recipeState = runInInjectionContext(
      Injector.create({ providers: [] }),
      () => new RecipeStateService()
    );
    const authUser = { isGuest: false, savedRecipes: [] as unknown[] };
    const authSaveRecipe = vi.fn();
    const saveRecipeDetailed = vi.fn().mockResolvedValue(outcome);

    const injector = Injector.create({
      providers: [
        {
          provide: AuthService,
          useValue: {
            currentUser: () => authUser,
            saveRecipe: authSaveRecipe,
            updateRecipeField: vi.fn(),
          },
        },
        {
          provide: PersistenceService,
          useValue: {
            saveRecipe: saveRecipeDetailed,
            saveRecipeDetailed,
            publishStateSync: () => 'synced',
          },
        },
        { provide: GeminiService, useValue: {} },
        { provide: RecipeStateService, useValue: recipeState },
        { provide: ToastService, useValue: { show: toastShow } },
        { provide: ModalService, useValue: { openAuth: vi.fn() } },
      ],
    });

    class Host extends RecipeViewBase {
      protected override onPublishDenied(): void {}
    }
    return {
      host: runInInjectionContext(injector, () => new Host()),
      authSaveRecipe,
    };
  };

  const recipe = () =>
    ({ id: 'r1', name: 'Vegan Cornbread', is_public: false }) as unknown as never;

  it('reverts the optimistic publish state when the server refuses', async () => {
    // The regression that mattered most: persistence.service used to treat 409
    // as SUCCESS, so the toggle stayed ON over a row the server never wrote.
    // The user was shown "published" for a recipe that is not.
    const { host } = createHost({ ok: false, refusal: 'OWNERSHIP_OTHER_ACCOUNT' });
    const r = recipe();
    host.recipe.set(r);

    await host.togglePublic(r);

    expect((host.recipe() as { is_public?: boolean } | null)?.is_public).toBeFalsy();
  });

  it('explains the refusal instead of blaming the connection', async () => {
    const { host } = createHost({ ok: false, refusal: 'OWNERSHIP_OTHER_ACCOUNT' });
    const r = recipe();
    host.recipe.set(r);

    await host.togglePublic(r);

    expect(toastShow).toHaveBeenCalledOnce();
    expect(String(toastShow.mock.calls[0][0]).toLowerCase()).not.toContain('connection');
  });

  it('keeps the connection message for a genuine sync failure', async () => {
    const { host } = createHost({ ok: false, refusal: 'sync' });
    const r = recipe();
    host.recipe.set(r);

    await host.togglePublic(r);

    expect(String(toastShow.mock.calls[0][0]).toLowerCase()).toContain('connection');
  });

  it('defaults to the sync message when no refusal reason is supplied', async () => {
    // ok:false with no reason — an older PersistenceService, or a caller that
    // did not set one. Must not crash and must not invent an ownership claim.
    const { host } = createHost({ ok: false });
    const r = recipe();
    host.recipe.set(r);

    await host.togglePublic(r);

    expect(String(toastShow.mock.calls[0][0]).toLowerCase()).toContain('connection');
  });

  it('carries the refusal through PublishSyncError', () => {
    const err = new PublishSyncError('OWNERSHIP_ORPHANED_GUEST_ROW');
    expect(err.refusal).toBe('OWNERSHIP_ORPHANED_GUEST_ROW');
    expect(err).toBeInstanceOf(Error);
  });
});
