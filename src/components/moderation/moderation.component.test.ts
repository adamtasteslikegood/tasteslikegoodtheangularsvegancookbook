/**
 * KAN-356 (R13) — which actions a moderation row offers, and its state line.
 */
import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { rowActions, rowStateLine } from './moderation.component';
import type { ModerationRow } from '../../services/feedback.service';

const row = (fields: Partial<ModerationRow> = {}): ModerationRow => ({
  id: 1,
  stars: 4,
  note: null,
  note_status: null,
  entry_hidden: false,
  created_at: '2026-10-13T09:00:00',
  hidden_at: null,
  deleted_at: null,
  recipe: { id: 'pub-1', name: 'Thai Peanut Noodles', slug: 'thai', is_public: true },
  user: {
    name: 'Sam',
    email: 'sam@example.com',
    created_at: null,
    account_new: false,
    feedback_trusted: false,
    is_author: false,
  },
  ...fields,
});

const names = (r: ModerationRow) => rowActions(r).map((a) => a.action);

describe('rowActions', () => {
  it('offers approve, reject and hide for a held note', () => {
    expect(names(row({ note: 'x', note_status: 'held' }))).toEqual([
      'approve',
      'reject',
      'hide-entry',
    ]);
  });

  it('offers hide note and hide entry for a published note', () => {
    expect(names(row({ note: 'x', note_status: 'published' }))).toEqual([
      'hide-note',
      'hide-entry',
    ]);
    expect(names(row({ note: 'x', note_status: 'approved' }))).toEqual(['hide-note', 'hide-entry']);
  });

  it('offers only hide entry for stars without a note', () => {
    expect(names(row())).toEqual(['hide-entry']);
  });

  it('offers show again for a hidden entry or a hidden note', () => {
    expect(names(row({ entry_hidden: true }))).toEqual(['show-again']);
    expect(names(row({ note: 'x', note_status: 'hidden' }))).toEqual(['show-again']);
  });

  it('never acts on an entry the cook deleted', () => {
    expect(rowActions(row({ deleted_at: '2026-10-14T10:00:00', note_status: 'held' }))).toEqual([]);
  });

  it('asks before hiding a whole entry, and only then', () => {
    for (const a of rowActions(row({ note: 'x', note_status: 'held' }))) {
      expect(!!a.confirm).toBe(a.action === 'hide-entry');
    }
  });
});

describe('rowStateLine', () => {
  it('names a cook deletion first', () => {
    expect(rowStateLine(row({ deleted_at: '2026-10-12T10:00:00', entry_hidden: true }))).toMatch(
      /^deleted by the cook 1[12] October$/
    );
  });

  it('says what was hidden, with the day when known', () => {
    expect(rowStateLine(row({ entry_hidden: true, hidden_at: '2026-10-12T12:00:00' }))).toMatch(
      /^entry hidden 1[12] October$/
    );
    expect(rowStateLine(row({ note: 'x', note_status: 'hidden' }))).toBe('note hidden');
  });

  it('is empty for a visible entry', () => {
    expect(rowStateLine(row())).toBeNull();
  });
});
