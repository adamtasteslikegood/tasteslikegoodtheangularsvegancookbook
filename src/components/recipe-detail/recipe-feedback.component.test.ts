/**
 * KAN-356 — what the feedback control shows (R11, R12, design "Pass 2").
 * The pure helpers carry every state; the template only renders them.
 */
import '@angular/compiler';
import {
  Injector,
  runInInjectionContext,
  signal,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import {
  RecipeFeedbackComponent,
  counterAnnouncement,
  entryStatusLines,
  feedbackViewFor,
} from './recipe-feedback.component';
import { AuthService } from '../../services/auth.service';
import { FeedbackService } from '../../services/feedback.service';
import type { FeedbackEntry, FeedbackState } from '../../services/feedback.service';
import type { User } from '../../auth.types';
import type { Recipe } from '../../recipe.types';

const NOW = new Date('2026-10-14T12:00:00Z');

const state = (fields: Partial<FeedbackState> = {}): FeedbackState => ({
  target_id: 'pub-1',
  target_public: true,
  target_slug: 'thai-peanut-noodles',
  role: 'cook',
  first_name: 'Sam',
  account_new: false,
  visible_from: null,
  account_trusted: false,
  can_post: true,
  entry: null,
  ...fields,
});

const entry = (fields: Partial<FeedbackEntry> = {}): FeedbackEntry => ({
  id: 1,
  recipe_id: 'pub-1',
  stars: 4,
  note: null,
  note_status: null,
  entry_hidden: false,
  created_at: '2026-10-13T09:00:00',
  deleted_at: null,
  ...fields,
});

describe('feedbackViewFor', () => {
  it('shows the entry when there is one, the form when posting is allowed, else nothing', () => {
    expect(feedbackViewFor(null)).toBe('hidden');
    expect(feedbackViewFor(state({ entry: entry() }))).toBe('entry');
    expect(feedbackViewFor(state())).toBe('form');
    expect(feedbackViewFor(state({ can_post: false }))).toBe('hidden');
    // An entry stays visible to its cook even after the recipe went private.
    expect(feedbackViewFor(state({ can_post: false, target_public: false, entry: entry() }))).toBe(
      'entry'
    );
  });
});

describe('entryStatusLines (cook)', () => {
  it('stars only', () => {
    expect(entryStatusLines(state(), entry(), NOW)).toEqual([
      'Your rating counts on the recipe page.',
    ]);
  });

  it('note held for review', () => {
    expect(
      entryStatusLines(state(), entry({ note: 'less salt', note_status: 'held' }), NOW)
    ).toEqual(['Your rating counts now. Your note is waiting for review.']);
  });

  it('note published', () => {
    expect(
      entryStatusLines(state(), entry({ note: 'less salt', note_status: 'published' }), NOW)
    ).toEqual(['Your rating and note are on the recipe page.']);
    expect(
      entryStatusLines(state(), entry({ note: 'less salt', note_status: 'approved' }), NOW)
    ).toEqual(['Your rating and note are on the recipe page.']);
  });

  it('note rejected or hidden: the rating still counts', () => {
    expect(entryStatusLines(state(), entry({ note: 'x', note_status: 'rejected' }), NOW)).toEqual([
      'Your note was not published. Your rating still counts.',
    ]);
    expect(entryStatusLines(state(), entry({ note: 'x', note_status: 'hidden' }), NOW)).toEqual([
      'A moderator hid your note. Your rating still counts.',
    ]);
  });

  it('whole entry hidden', () => {
    expect(entryStatusLines(state(), entry({ entry_hidden: true }), NOW)).toEqual([
      'A moderator hid this feedback. It is not shown or counted.',
    ]);
  });

  it('new account: shows from the visible_from time, then the note waits', () => {
    const s = state({ account_new: true, visible_from: '2026-10-14T15:10:00' });
    const lines = entryStatusLines(s, entry({ note: 'x', note_status: 'held' }), NOW);
    expect(lines[0]).toMatch(/^Posted\. Your feedback shows on the recipe page from 14 October, /);
    expect(lines[1]).toBe('Your note will then wait for review.');

    // Once the time has passed, the ordinary line applies.
    const later = new Date('2026-10-15T00:00:00Z');
    expect(entryStatusLines(s, entry(), later)).toEqual(['Your rating counts on the recipe page.']);
  });

  it('adds a line when the recipe is not public right now', () => {
    expect(entryStatusLines(state({ target_public: false }), entry(), NOW)).toEqual([
      'Your rating counts on the recipe page.',
      'This recipe is not public right now.',
    ]);
  });
});

describe('entryStatusLines (author)', () => {
  const author = state({ role: 'author' });

  it('never talks about counting, because the author is not counted', () => {
    expect(entryStatusLines(author, entry(), NOW)).toEqual(['Your stars are on the recipe page.']);
    expect(entryStatusLines(author, entry({ note: 'x', note_status: 'held' }), NOW)).toEqual([
      'Your note is waiting for review.',
    ]);
    expect(entryStatusLines(author, entry({ note: 'x', note_status: 'published' }), NOW)).toEqual([
      'Your stars and note are on the recipe page.',
    ]);
    expect(entryStatusLines(author, entry({ note: 'x', note_status: 'rejected' }), NOW)).toEqual([
      'Your note was not published.',
    ]);
    expect(entryStatusLines(author, entry({ note: 'x', note_status: 'hidden' }), NOW)).toEqual([
      'A moderator hid your note.',
    ]);
  });
});

describe('counterAnnouncement (R12)', () => {
  it('stays quiet until the limit nears', () => {
    expect(counterAnnouncement(0)).toBe('');
    expect(counterAnnouncement(899)).toBe('');
    expect(counterAnnouncement(900)).toBe('100 or fewer characters left.');
    expect(counterAnnouncement(950)).toBe('50 or fewer characters left.');
    expect(counterAnnouncement(1000)).toBe('Note is at the 1000 character limit.');
  });
});

// Codex pre-PR round 1: results that land after the page moved to another
// recipe, and a load failure that hid the whole panel.
describe('RecipeFeedbackComponent requests (KAN-356)', () => {
  const recipeFor = (sourceRecipeId: string) =>
    ({
      id: `copy-${sourceRecipeId}`,
      name: 'Copy',
      sourceRecipeId,
      sourceSlug: 'thai-peanut-noodles',
    }) as unknown as Recipe;

  const create = (feedback: Record<string, unknown>, login = vi.fn()) => {
    const user = signal<User | null>({
      id: 'u-1',
      name: 'Sam',
      isGuest: false,
      authProvider: 'google',
    } as User);
    const injector = Injector.create({
      providers: [
        { provide: AuthService, useValue: { currentUser: user, login } },
        { provide: FeedbackService, useValue: feedback },
        // The constructor's effect needs a scheduler; these tests drive the
        // component's methods directly and never run change detection.
        { provide: ɵChangeDetectionScheduler, useValue: { notify: () => {}, runningTick: false } },
        {
          provide: ɵEffectScheduler,
          useValue: { add: () => {}, schedule: () => {}, remove: () => {}, flush: () => {} },
        },
      ],
    });
    const comp = runInInjectionContext(injector, () => new RecipeFeedbackComponent());
    const recipe = signal(recipeFor('pub-a'));
    Object.defineProperty(comp, 'recipe', { value: recipe });
    return { comp, recipe, login };
  };

  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('drops a post result that lands after the page moved to another recipe', async () => {
    let finish!: (v: unknown) => void;
    const { comp, recipe } = create({ post: vi.fn(() => new Promise((r) => (finish = r))) });
    comp.state.set(state({ target_id: 'pub-a' }));
    comp.stars.set(4);
    const posting = comp.post();

    recipe.set(recipeFor('pub-b'));
    comp.state.set(state({ target_id: 'pub-b' }));
    finish({ kind: 'posted', entry: entry({ recipe_id: 'pub-a' }) });
    await posting;

    expect(comp.state()?.target_id).toBe('pub-b');
    expect(comp.state()?.entry).toBeNull();
  });

  it('does not reload the old recipe after a delete that finished late', async () => {
    let finish!: (v: boolean) => void;
    const load = vi.fn();
    const { comp, recipe } = create({
      remove: vi.fn(() => new Promise<boolean>((r) => (finish = r))),
      load,
    });
    const deleting = comp.confirmDelete();
    recipe.set(recipeFor('pub-b'));
    finish(true);
    await deleting;
    expect(load).not.toHaveBeenCalledWith('pub-a');
  });

  it("leaves the new recipe's delete confirmation open after a late delete", async () => {
    let finish!: (v: boolean) => void;
    const { comp, recipe } = create({
      remove: vi.fn(() => new Promise<boolean>((r) => (finish = r))),
      load: vi.fn(),
    });
    const deleting = comp.confirmDelete();
    recipe.set(recipeFor('pub-b'));
    comp.confirmingDelete.set(true);
    finish(true);
    await deleting;
    expect(comp.confirmingDelete()).toBe(true);
  });

  it('drops a load for the old recipe after moving to one with no feedback target', async () => {
    let finish!: (v: unknown) => void;
    const { comp } = create({ load: vi.fn(() => new Promise((r) => (finish = r))) });
    comp.retryLoad();
    comp.resetFor(null, true);
    finish({ kind: 'ok', state: state({ target_id: 'pub-a' }) });
    await settle();
    expect(comp.state()).toBeNull();
    expect(comp.view()).not.toBe('loading');
  });

  it('clears the intent when sign-in cannot start', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    } as Storage);

    try {
      const login = vi.fn().mockRejectedValue(new Error('down'));
      const { comp } = create({}, login);

      comp.signIn();
      await settle();

      expect(login).toHaveBeenCalledTimes(1);
      expect(store.has('tlg.feedbackIntent')).toBe(false);
      expect(comp.error()).toBe('Could not start sign-in. Please try again.');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('offers a retry when loading fails, and loads again on Try again', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'error' })
      .mockResolvedValueOnce({ kind: 'ok', state: state() });
    const { comp } = create({ load });
    comp.retryLoad();
    await settle();
    expect(comp.view()).toBe('load-error');

    comp.retryLoad();
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(comp.view()).toBe('form');
  });
});
