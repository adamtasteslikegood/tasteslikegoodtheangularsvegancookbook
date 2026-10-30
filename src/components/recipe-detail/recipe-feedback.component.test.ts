/**
 * KAN-356 — what the feedback control shows (R11, R12, design "Pass 2").
 * The pure helpers carry every state; the template only renders them.
 */
import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import {
  counterAnnouncement,
  entryStatusLines,
  feedbackViewFor,
} from './recipe-feedback.component';
import type { FeedbackEntry, FeedbackState } from '../../services/feedback.service';

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
