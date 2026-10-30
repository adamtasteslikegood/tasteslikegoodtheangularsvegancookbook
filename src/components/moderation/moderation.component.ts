import { Component, OnInit, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
  FeedbackService,
  formatDay,
  parseServerTime,
  type ModerationAction,
  type ModerationLists,
  type ModerationRow,
} from '../../services/feedback.service';

export interface RowAction {
  action: ModerationAction;
  label: string;
  /** Changes the public count, so it asks once before acting (R13). */
  confirm?: boolean;
}

/**
 * Which actions a row offers, from the row's own state, so a row that stays
 * in place after an action shows what can be done next (R13).
 * A cook-deleted entry is a read-only record: no action, ever.
 */
export function rowActions(row: ModerationRow): RowAction[] {
  if (row.deleted_at) return [];
  const hideEntry: RowAction = { action: 'hide-entry', label: 'Hide whole entry', confirm: true };
  if (row.entry_hidden || row.note_status === 'hidden') {
    return [{ action: 'show-again', label: 'Show again' }];
  }
  if (row.note_status === 'held') {
    return [
      { action: 'approve', label: 'Approve' },
      { action: 'reject', label: 'Reject' },
      hideEntry,
    ];
  }
  if (row.note && (row.note_status === 'published' || row.note_status === 'approved')) {
    return [{ action: 'hide-note', label: 'Hide note' }, hideEntry];
  }
  return [hideEntry];
}

/** "hidden 12 October" / "deleted by the cook 12 October", or null. */
export function rowStateLine(row: ModerationRow): string | null {
  const deleted = parseServerTime(row.deleted_at);
  if (deleted) return `deleted by the cook ${formatDay(deleted)}`;
  if (row.entry_hidden || row.note_status === 'hidden') {
    const hidden = parseServerTime(row.hidden_at);
    const what = row.entry_hidden ? 'entry hidden' : 'note hidden';
    return hidden ? `${what} ${formatDay(hidden)}` : what;
  }
  return null;
}

const RESULT_WORDS: Record<ModerationAction, string> = {
  approve: 'Approved.',
  reject: 'Rejected.',
  'hide-note': 'Note hidden.',
  'hide-entry': 'Entry hidden.',
  'show-again': 'Shown again.',
};

/**
 * KAN-356 (R13) — one page, three lists: waiting for review first, then
 * published without review, then hidden and deleted (collapsed). Linked from
 * the account menu only when `/api/auth/me` says the account moderates; the
 * server refuses everyone else regardless (R2).
 */
@Component({
  selector: 'app-moderation',
  standalone: true,
  template: `
    <section class="max-w-4xl mx-auto" aria-labelledby="moderation-heading">
      <h2 id="moderation-heading" class="text-3xl font-bold text-stone-800 serif mb-6">
        Feedback to review
      </h2>

      @switch (status()) {
        @case ('loading') {
          <p role="status" class="text-stone-500">Loading…</p>
        }
        @case ('refused') {
          <p class="text-stone-700">This page is for feedback moderators.</p>
        }
        @case ('error') {
          <p role="alert" class="text-red-700">Could not load the lists.</p>
          <button
            type="button"
            (click)="reload()"
            class="mt-3 min-h-[44px] px-4 py-2 rounded-lg font-semibold bg-stone-100 text-stone-700 hover:bg-stone-200"
          >
            Try again
          </button>
        }
        @case ('ready') {
          @if (lists(); as l) {
            <h3 class="text-xl font-bold text-stone-800 mt-2 mb-3">
              Waiting for review ({{ l.held.length }})
            </h3>
            @if (l.held.length === 0) {
              <p class="text-stone-600 mb-6">Nothing is waiting.</p>
            } @else {
              <ul class="mb-8 divide-y divide-stone-200 border-y border-stone-200">
                @for (row of l.held; track row.id) {
                  <ng-container *ngTemplateOutlet="rowTpl; context: { $implicit: row }" />
                }
              </ul>
            }

            <h3 class="text-xl font-bold text-stone-800 mb-3">Published without review</h3>
            @if (l.published_without_review.length === 0) {
              <p class="text-stone-600 mb-6">None.</p>
            } @else {
              <ul class="mb-8 divide-y divide-stone-200 border-y border-stone-200">
                @for (row of l.published_without_review; track row.id) {
                  <ng-container *ngTemplateOutlet="rowTpl; context: { $implicit: row }" />
                }
              </ul>
            }

            <details class="mb-8">
              <summary
                class="cursor-pointer text-xl font-bold text-stone-800 min-h-[44px] flex items-center"
              >
                Hidden and deleted ({{ l.hidden_and_deleted.length }})
              </summary>
              @if (l.hidden_and_deleted.length === 0) {
                <p class="text-stone-600 mt-2">None.</p>
              } @else {
                <ul class="mt-2 divide-y divide-stone-200 border-y border-stone-200">
                  @for (row of l.hidden_and_deleted; track row.id) {
                    <ng-container *ngTemplateOutlet="rowTpl; context: { $implicit: row }" />
                  }
                </ul>
              }
            </details>
          }
        }
      }
    </section>

    <ng-template #rowTpl let-row>
      <li class="py-4">
        <p class="font-semibold text-stone-800">
          @if (row.recipe.is_public && row.recipe.slug) {
            <a
              [href]="'/r/' + row.recipe.slug"
              target="_blank"
              rel="noopener noreferrer"
              class="underline underline-offset-2 hover:text-green-800"
              >{{ row.recipe.name }}</a
            >
          } @else {
            {{ row.recipe.name }} <span class="text-stone-500 font-normal">(not public)</span>
          }
        </p>
        <p class="text-sm text-stone-600 mt-1">
          {{ row.user.name || 'No name' }} · {{ row.user.email }} ·
          <span aria-hidden="true" class="text-yellow-800">{{ stars(row.stars) }}</span>
          <span class="sr-only">{{ row.stars }} out of 5 stars</span>
          @if (day(row.created_at); as d) {
            · {{ d }}
          }
          @if (row.user.is_author) {
            · <strong>author</strong>
          }
          @if (row.user.account_new) {
            · <strong>account under 24 hours</strong>
          }
        </p>
        @if (row.note) {
          <blockquote class="mt-2 text-base text-stone-800 whitespace-pre-wrap">
            {{ row.note }}
          </blockquote>
        }
        @if (stateLine(row); as line) {
          <p class="mt-1 text-sm text-stone-500">{{ line }}</p>
        }
        @if (results()[row.id]; as result) {
          <p role="status" class="mt-2 text-sm font-semibold text-stone-800">{{ result }}</p>
        }
        <div class="mt-3 flex flex-col md:flex-row gap-2 md:gap-3">
          @for (a of actions(row); track a.action) {
            @if (a.confirm && !$first) {
              <!-- Never adjacent to Approve without a gap (R13). -->
              <span class="hidden md:block md:w-6" aria-hidden="true"></span>
            }
            @if (confirming() === row.id && a.confirm) {
              <span class="flex flex-col md:flex-row gap-2 md:items-center">
                <span class="text-sm text-stone-700">This changes the public count. Hide it?</span>
                <button
                  type="button"
                  (click)="run(row, a.action)"
                  [disabled]="busy() === row.id"
                  class="w-full md:w-auto min-h-[44px] px-4 py-2 rounded-lg font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Hide whole entry
                </button>
                <button
                  type="button"
                  (click)="confirming.set(null)"
                  class="w-full md:w-auto min-h-[44px] px-4 py-2 rounded-lg font-semibold bg-stone-100 text-stone-700 hover:bg-stone-200"
                >
                  Cancel
                </button>
              </span>
            } @else {
              <button
                type="button"
                (click)="a.confirm ? confirming.set(row.id) : run(row, a.action)"
                [disabled]="busy() === row.id"
                class="w-full md:w-auto min-h-[44px] px-4 py-2 rounded-lg font-semibold disabled:opacity-50"
                [class.bg-green-700]="a.action === 'approve' || a.action === 'show-again'"
                [class.text-white]="a.action === 'approve' || a.action === 'show-again'"
                [class.bg-stone-100]="a.action !== 'approve' && a.action !== 'show-again'"
                [class.text-stone-800]="a.action !== 'approve' && a.action !== 'show-again'"
              >
                {{ a.label }}
              </button>
            }
          }
        </div>
      </li>
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
})
export class ModerationComponent implements OnInit {
  private readonly feedback = inject(FeedbackService);

  readonly status = signal<'loading' | 'ready' | 'refused' | 'error'>('loading');
  readonly lists = signal<ModerationLists | null>(null);
  /** The result written on a row after an action, kept until reload (R13). */
  readonly results = signal<Record<number, string>>({});
  readonly busy = signal<number | null>(null);
  readonly confirming = signal<number | null>(null);

  readonly actions = rowActions;
  readonly stateLine = rowStateLine;

  ngOnInit() {
    void this.reload();
  }

  async reload() {
    this.status.set('loading');
    const result = await this.feedback.moderationLists();
    if (result.kind === 'ok') {
      this.lists.set(result.lists);
      this.results.set({});
      this.status.set('ready');
    } else {
      this.status.set(result.kind);
    }
  }

  stars(n: number): string {
    return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
  }

  day(value: string | null): string | null {
    const date = parseServerTime(value);
    return date ? formatDay(date) : null;
  }

  async run(row: ModerationRow, action: ModerationAction) {
    this.busy.set(row.id);
    this.confirming.set(null);
    try {
      const result = await this.feedback.moderate(row.id, action);
      if (!result.ok) {
        this.results.update((r) => ({ ...r, [row.id]: result.message }));
        return;
      }
      const updated = result.row;
      // The row stays where it is, with its new state, until the page reloads.
      this.lists.update((l) =>
        l
          ? {
              held: l.held.map((r) => (r.id === updated.id ? updated : r)),
              published_without_review: l.published_without_review.map((r) =>
                r.id === updated.id ? updated : r
              ),
              hidden_and_deleted: l.hidden_and_deleted.map((r) =>
                r.id === updated.id ? updated : r
              ),
            }
          : l
      );
      this.results.update((r) => ({ ...r, [row.id]: RESULT_WORDS[action] }));
    } finally {
      this.busy.set(null);
    }
  }
}
