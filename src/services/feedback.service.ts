import { Injectable, signal } from '@angular/core';
import type { Recipe } from '../recipe.types';
import type { User } from '../auth.types';

/**
 * KAN-356 — recipe feedback, the SPA half (design `docs/designs/recipe-feedback.md`).
 *
 * Every entry is keyed to the PUBLIC recipe's id (the "target"): a saved copy's
 * `sourceRecipeId`, or an author's own published recipe. The Backend decides
 * eligibility and role; the SPA only asks.
 */

export type NoteStatus = 'held' | 'approved' | 'published' | 'rejected' | 'hidden' | null;

export interface FeedbackEntry {
  id: number;
  recipe_id: string;
  stars: number;
  note: string | null;
  note_status: NoteStatus;
  entry_hidden: boolean;
  created_at: string | null;
  deleted_at: string | null;
}

/** `GET /api/feedback/<target_id>`. */
export interface FeedbackState {
  target_id: string;
  target_public: boolean;
  target_slug: string | null;
  role: 'author' | 'cook';
  first_name: string;
  account_new: boolean;
  visible_from: string | null;
  account_trusted: boolean;
  can_post: boolean;
  entry: FeedbackEntry | null;
}

export type FeedbackLoad =
  | { kind: 'ok'; state: FeedbackState }
  /** 401: the browser is not signed in after all. */
  | { kind: 'signed-out' }
  /** 404: not this account's recipe or saved copy. Show nothing. */
  | { kind: 'none' }
  | { kind: 'error' };

export type FeedbackPost =
  | { kind: 'posted'; entry: FeedbackEntry }
  | { kind: 'not-public' }
  | { kind: 'exists'; entry: FeedbackEntry | null }
  | { kind: 'error' };

export type ModerationAction = 'approve' | 'reject' | 'hide-note' | 'hide-entry' | 'show-again';

export interface ModerationRow {
  id: number;
  stars: number;
  note: string | null;
  note_status: NoteStatus;
  entry_hidden: boolean;
  created_at: string | null;
  hidden_at: string | null;
  deleted_at: string | null;
  recipe: { id: string; name: string; slug: string | null; is_public: boolean };
  user: {
    name: string | null;
    email: string | null;
    created_at: string | null;
    account_new: boolean;
    feedback_trusted: boolean;
    is_author: boolean;
  };
}

export interface ModerationLists {
  held: ModerationRow[];
  published_without_review: ModerationRow[];
  hidden_and_deleted: ModerationRow[];
}

/** The one key the `?feedback=` intent lives under while the cook is at Google (R15). */
export const FEEDBACK_INTENT_KEY = 'tlg.feedbackIntent';

export const NOTE_MAX_LENGTH = 1000;

const SLUG_RE = /^[a-z0-9-]+$/;

/** A slug the guard may act on, lowercased, or null. Same rule as `?save=`. */
export function normalizeFeedbackSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase();
  return SLUG_RE.test(slug) ? slug : null;
}

/** Remember which recipe "Add feedback" was for, across the Google round trip. */
export function storeFeedbackIntent(slug: string, storage?: Storage): void {
  try {
    (storage ?? sessionStorage).setItem(FEEDBACK_INTENT_KEY, JSON.stringify({ feedback: slug }));
  } catch {
    // Private mode or a full quota: the cook lands on the home page instead.
  }
}

/** Read the intent once and delete it, so it can never fire twice. */
export function takeFeedbackIntent(storage?: Storage): string | null {
  let raw: string | null;
  try {
    const store = storage ?? sessionStorage;
    raw = store.getItem(FEEDBACK_INTENT_KEY);
    store.removeItem(FEEDBACK_INTENT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { feedback?: unknown };
    return normalizeFeedbackSlug(parsed?.feedback);
  } catch {
    return null;
  }
}

/**
 * The public recipe this recipe's feedback belongs to, or null for none.
 * A copy uses `sourceRecipeId` only; a copy carrying just `sourceSlug` gets no
 * control (A4). An own recipe qualifies only while it is published.
 */
export function feedbackTargetId(recipe: Recipe | null | undefined): string | null {
  if (!recipe) return null;
  if (recipe.sourceRecipeId) return recipe.sourceRecipeId;
  if (recipe.origin === 'saved' || recipe.sourceSlug) return null;
  return recipe.is_public ? recipe.id : null;
}

export function isSignedIn(user: User | null | undefined): boolean {
  return !!user && !user.isGuest && user.authProvider !== 'guest';
}

/** The Backend sends naive UTC ISO strings; read them as UTC. */
export function parseServerTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const withZone = /(?:Z|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`;
  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? null : date;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "13 October". */
export function formatDay(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** "14 October, 3:10 pm", in the cook's own time zone. */
export function formatDayTime(date: Date): string {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${formatDay(date)}, ${hour12}:${minutes} ${hours < 12 ? 'am' : 'pm'}`;
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class FeedbackService {
  /** From `/api/auth/me`. False until the server says otherwise (R2 fails closed). */
  readonly isModerator = signal(false);

  async load(targetId: string): Promise<FeedbackLoad> {
    try {
      const res = await fetch(`/api/feedback/${encodeURIComponent(targetId)}`, {
        credentials: 'include',
      });
      if (res.status === 401) return { kind: 'signed-out' };
      if (res.status === 404) return { kind: 'none' };
      if (!res.ok) return { kind: 'error' };
      const body = await readJson(res);
      return body ? { kind: 'ok', state: body as unknown as FeedbackState } : { kind: 'error' };
    } catch {
      return { kind: 'error' };
    }
  }

  async post(targetId: string, stars: number, note: string): Promise<FeedbackPost> {
    try {
      const res = await fetch(`/api/feedback/${encodeURIComponent(targetId)}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stars, note: note.trim() || null }),
      });
      const body = await readJson(res);
      if (res.ok && body?.['entry']) {
        return { kind: 'posted', entry: body['entry'] as FeedbackEntry };
      }
      if (res.status === 409 && body?.['code'] === 'recipe_not_public')
        return { kind: 'not-public' };
      if (res.status === 409 && body?.['code'] === 'entry_exists') {
        return { kind: 'exists', entry: (body['entry'] as FeedbackEntry) ?? null };
      }
      return { kind: 'error' };
    } catch {
      return { kind: 'error' };
    }
  }

  /** True when the entry is gone (or was already gone). */
  async remove(targetId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/feedback/${encodeURIComponent(targetId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      return res.ok || res.status === 404;
    } catch {
      return false;
    }
  }

  /** Ask the server whether this account moderates feedback (R2). */
  async refreshModerator(user: User | null | undefined): Promise<void> {
    if (!isSignedIn(user)) {
      this.isModerator.set(false);
      return;
    }
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      const body = res.ok ? await readJson(res) : null;
      this.isModerator.set(body?.['is_moderator'] === true);
    } catch {
      this.isModerator.set(false);
    }
  }

  /** `refused` is a 401 or 403: not signed in, or not a moderator (R2). */
  async moderationLists(): Promise<
    { kind: 'ok'; lists: ModerationLists } | { kind: 'refused' } | { kind: 'error' }
  > {
    try {
      const res = await fetch('/api/feedback/moderation', { credentials: 'include' });
      if (res.status === 401 || res.status === 403) return { kind: 'refused' };
      const body = res.ok ? await readJson(res) : null;
      return body ? { kind: 'ok', lists: body as unknown as ModerationLists } : { kind: 'error' };
    } catch {
      return { kind: 'error' };
    }
  }

  async moderate(
    entryId: number,
    action: ModerationAction
  ): Promise<{ ok: true; row: ModerationRow } | { ok: false; message: string }> {
    try {
      const res = await fetch(`/api/feedback/moderation/${entryId}/${action}`, {
        method: 'POST',
        credentials: 'include',
      });
      const body = await readJson(res);
      if (res.ok && body?.['entry']) return { ok: true, row: body['entry'] as ModerationRow };
      const message = typeof body?.['error'] === 'string' ? body['error'] : 'That did not work.';
      return { ok: false, message };
    } catch {
      return { ok: false, message: 'Could not reach the server. Try again.' };
    }
  }
}
