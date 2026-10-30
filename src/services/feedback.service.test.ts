/**
 * KAN-356 — recipe feedback, SPA helpers and the API client.
 * Vitest runs in node: storage is an in-memory stand-in, fetch is stubbed.
 */
import '@angular/compiler';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FEEDBACK_INTENT_KEY,
  FeedbackService,
  feedbackTargetId,
  formatDay,
  formatDayTime,
  isSignedIn,
  normalizeFeedbackSlug,
  parseServerTime,
  storeFeedbackIntent,
  takeFeedbackIntent,
} from './feedback.service';
import type { Recipe } from '../recipe.types';
import type { User } from '../auth.types';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
  };
}

const recipe = (fields: Partial<Recipe>): Recipe => ({ id: 'r1', ...fields }) as Recipe;

const response = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as Response;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('feedback intent (R15)', () => {
  it('is read once and then gone, so it can never fire twice', () => {
    const storage = memoryStorage();
    storeFeedbackIntent('thai-peanut-noodles', storage);

    expect(storage.getItem(FEEDBACK_INTENT_KEY)).toBe('{"feedback":"thai-peanut-noodles"}');
    expect(takeFeedbackIntent(storage)).toBe('thai-peanut-noodles');
    expect(takeFeedbackIntent(storage)).toBeNull();
    expect(storage.getItem(FEEDBACK_INTENT_KEY)).toBeNull();
  });

  it('drops a stored value that is not a valid slug, and still deletes it', () => {
    const storage = memoryStorage();
    storage.setItem(FEEDBACK_INTENT_KEY, '{"feedback":"../admin"}');
    expect(takeFeedbackIntent(storage)).toBeNull();
    expect(storage.getItem(FEEDBACK_INTENT_KEY)).toBeNull();

    storage.setItem(FEEDBACK_INTENT_KEY, 'not json');
    expect(takeFeedbackIntent(storage)).toBeNull();
  });

  it('survives storage that throws (private mode)', () => {
    const broken = {
      setItem: () => {
        throw new Error('quota');
      },
      getItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {},
    } as unknown as Storage;

    expect(() => storeFeedbackIntent('x', broken)).not.toThrow();
    expect(takeFeedbackIntent(broken)).toBeNull();
  });

  it('normalizes the slug the same way as ?save=', () => {
    expect(normalizeFeedbackSlug('  Thai-Peanut-Noodles ')).toBe('thai-peanut-noodles');
    expect(normalizeFeedbackSlug('a b')).toBeNull();
    expect(normalizeFeedbackSlug(42)).toBeNull();
  });
});

describe('feedbackTargetId (A4)', () => {
  it('uses the saved copy’s sourceRecipeId', () => {
    expect(feedbackTargetId(recipe({ sourceRecipeId: 'pub-1', sourceSlug: 's' }))).toBe('pub-1');
  });

  it('gives a copy carrying only sourceSlug no control', () => {
    expect(feedbackTargetId(recipe({ sourceSlug: 'thai' }))).toBeNull();
    expect(feedbackTargetId(recipe({ origin: 'saved' } as Partial<Recipe>))).toBeNull();
  });

  it('uses an own recipe’s id only while it is published', () => {
    expect(feedbackTargetId(recipe({ is_public: true }))).toBe('r1');
    expect(feedbackTargetId(recipe({ is_public: false }))).toBeNull();
    expect(feedbackTargetId(null)).toBeNull();
  });
});

describe('isSignedIn', () => {
  it('is false for no user and for a guest', () => {
    expect(isSignedIn(null)).toBe(false);
    expect(isSignedIn({ isGuest: true } as User)).toBe(false);
    expect(isSignedIn({ isGuest: false, authProvider: 'guest' } as User)).toBe(false);
    expect(isSignedIn({ isGuest: false, authProvider: 'google' } as User)).toBe(true);
  });
});

describe('server times', () => {
  it('reads the Backend’s naive ISO strings as UTC', () => {
    expect(parseServerTime('2026-10-14T15:10:00')?.toISOString()).toBe('2026-10-14T15:10:00.000Z');
    expect(parseServerTime('2026-10-14T15:10:00Z')?.toISOString()).toBe('2026-10-14T15:10:00.000Z');
    expect(parseServerTime('2026-10-14T15:10:00+00:00')?.toISOString()).toBe(
      '2026-10-14T15:10:00.000Z'
    );
    expect(parseServerTime(null)).toBeNull();
    expect(parseServerTime('nonsense')).toBeNull();
  });

  it('formats a day and a day with time in plain words', () => {
    expect(formatDay(new Date(2026, 9, 13, 9, 0))).toBe('13 October');
    expect(formatDayTime(new Date(2026, 9, 14, 15, 10))).toBe('14 October, 3:10 pm');
    expect(formatDayTime(new Date(2026, 9, 14, 0, 5))).toBe('14 October, 12:05 am');
    expect(formatDayTime(new Date(2026, 9, 14, 12, 0))).toBe('14 October, 12:00 pm');
  });
});

describe('FeedbackService', () => {
  const service = () => new FeedbackService();

  it('maps the GET statuses the control cares about', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock.mockResolvedValueOnce(response(200, { target_id: 'p1', entry: null }));
    expect(await service().load('p1')).toEqual({
      kind: 'ok',
      state: { target_id: 'p1', entry: null },
    });
    fetchMock.mockResolvedValueOnce(response(401, {}));
    expect(await service().load('p1')).toEqual({ kind: 'signed-out' });
    fetchMock.mockResolvedValueOnce(response(404, {}));
    expect(await service().load('p1')).toEqual({ kind: 'none' });
    fetchMock.mockResolvedValueOnce(response(500, {}));
    expect(await service().load('p1')).toEqual({ kind: 'error' });
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await service().load('p1')).toEqual({ kind: 'error' });
  });

  it('posts stars and a trimmed note, sending null for an empty note', async () => {
    const entry = { id: 7, stars: 4 };
    const fetchMock = vi.fn().mockResolvedValue(response(201, { entry }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await service().post('p1', 4, '  ')).toEqual({ kind: 'posted', entry });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ stars: 4, note: null });

    await service().post('p1', 5, '  less salt ');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ stars: 5, note: 'less salt' });
  });

  it('tells a recipe that went private from an entry that already exists', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock.mockResolvedValueOnce(response(409, { code: 'recipe_not_public' }));
    expect(await service().post('p1', 3, '')).toEqual({ kind: 'not-public' });
    fetchMock.mockResolvedValueOnce(response(409, { code: 'entry_exists', entry: { id: 2 } }));
    expect(await service().post('p1', 3, '')).toEqual({ kind: 'exists', entry: { id: 2 } });
    fetchMock.mockResolvedValueOnce(response(400, { code: 'invalid_stars' }));
    expect(await service().post('p1', 3, '')).toEqual({ kind: 'error' });
  });

  it('treats a delete of an entry already gone as done', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock.mockResolvedValueOnce(response(200, {}));
    expect(await service().remove('p1')).toBe(true);
    fetchMock.mockResolvedValueOnce(response(404, {}));
    expect(await service().remove('p1')).toBe(true);
    fetchMock.mockResolvedValueOnce(response(500, {}));
    expect(await service().remove('p1')).toBe(false);
  });

  it('is a moderator only when /api/auth/me says so, and never for a guest (R2)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const s = service();
    const google = { isGuest: false, authProvider: 'google' } as User;

    fetchMock.mockResolvedValueOnce(response(200, { is_moderator: true }));
    await s.refreshModerator(google);
    expect(s.isModerator()).toBe(true);

    fetchMock.mockResolvedValueOnce(response(200, { is_moderator: 'yes' }));
    await s.refreshModerator(google);
    expect(s.isModerator()).toBe(false);

    s.isModerator.set(true);
    await s.refreshModerator({ isGuest: true } as User);
    expect(s.isModerator()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a refused moderation page for 401 and 403', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock.mockResolvedValueOnce(response(403, {}));
    expect(await service().moderationLists()).toEqual({ kind: 'refused' });
    fetchMock.mockResolvedValueOnce(response(401, {}));
    expect(await service().moderationLists()).toEqual({ kind: 'refused' });
    fetchMock.mockResolvedValueOnce(response(500, {}));
    expect(await service().moderationLists()).toEqual({ kind: 'error' });
  });

  it('returns the updated row after a moderation action, or the server’s message', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock.mockResolvedValueOnce(response(200, { entry: { id: 3 } }));
    expect(await service().moderate(3, 'approve')).toEqual({ ok: true, row: { id: 3 } });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/feedback/moderation/3/approve');

    fetchMock.mockResolvedValueOnce(response(409, { error: 'Already deleted by the cook.' }));
    expect(await service().moderate(3, 'hide-entry')).toEqual({
      ok: false,
      message: 'Already deleted by the cook.',
    });
  });
});
