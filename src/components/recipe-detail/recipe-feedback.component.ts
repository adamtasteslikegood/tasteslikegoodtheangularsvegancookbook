import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type { Recipe } from '../../recipe.types';
import { AuthService } from '../../services/auth.service';
import {
  FeedbackService,
  NOTE_MAX_LENGTH,
  feedbackTargetId,
  formatDay,
  formatDayTime,
  isSignedIn,
  parseServerTime,
  storeFeedbackIntent,
  type FeedbackEntry,
  type FeedbackState,
} from '../../services/feedback.service';
import { DialogFocusDirective } from '../shared/dialog-focus.directive';

/** What the control shows (design "Pass 2" table, R11). */
export type FeedbackView = 'hidden' | 'guest' | 'loading' | 'load-error' | 'form' | 'entry';

/**
 * Which view a loaded state gets. A copy whose source is no longer public and
 * that has no entry shows nothing: there is nothing to post and nothing to see.
 */
export function feedbackViewFor(state: FeedbackState | null): FeedbackView {
  if (!state) return 'hidden';
  if (state.entry) return 'entry';
  return state.can_post ? 'form' : 'hidden';
}

/**
 * The status lines under a posted entry, in order (R11, "Pass 2").
 * `now` is a parameter so the 24-hour line is testable.
 */
export function entryStatusLines(state: FeedbackState, entry: FeedbackEntry, now: Date): string[] {
  const lines: string[] = [];
  const author = state.role === 'author';
  const showsFrom = parseServerTime(state.visible_from);
  if (entry.entry_hidden) {
    lines.push('A moderator hid this feedback. It is not shown or counted.');
  } else if (showsFrom && showsFrom > now) {
    lines.push(`Posted. Your feedback shows on the recipe page from ${formatDayTime(showsFrom)}.`);
    if (entry.note && !state.account_trusted && entry.note_status === 'held') {
      lines.push('Your note will then wait for review.');
    }
  } else if (!entry.note) {
    lines.push(
      author ? 'Your stars are on the recipe page.' : 'Your rating counts on the recipe page.'
    );
  } else if (entry.note_status === 'held') {
    lines.push(
      author
        ? 'Your note is waiting for review.'
        : 'Your rating counts now. Your note is waiting for review.'
    );
  } else if (entry.note_status === 'rejected') {
    lines.push(
      author
        ? 'Your note was not published.'
        : 'Your note was not published. Your rating still counts.'
    );
  } else if (entry.note_status === 'hidden') {
    lines.push(
      author ? 'A moderator hid your note.' : 'A moderator hid your note. Your rating still counts.'
    );
  } else {
    lines.push(
      author
        ? 'Your stars and note are on the recipe page.'
        : 'Your rating and note are on the recipe page.'
    );
  }
  if (!state.target_public) lines.push('This recipe is not public right now.');
  return lines;
}

/** Announce the note counter only as the limit nears, never on every key (R12). */
export function counterAnnouncement(length: number): string {
  const left = NOTE_MAX_LENGTH - length;
  if (left <= 0) return 'Note is at the 1000 character limit.';
  if (left <= 50) return '50 or fewer characters left.';
  if (left <= 100) return '100 or fewer characters left.';
  return '';
}

const STAR_CHOICES = [1, 2, 3, 4, 5] as const;

/**
 * KAN-356 — the feedback control at the bottom of a saved copy (cook) or of
 * the author's own published recipe (author). Native radio stars in a
 * fieldset, a labelled note, one "Post: I cooked this" button; no edit, only
 * delete and post again (R7, R11, R12).
 */
@Component({
  selector: 'app-recipe-feedback',
  standalone: true,
  imports: [DialogFocusDirective],
  template: `
    @if (view() !== 'hidden') {
      <section
        id="feedback"
        aria-labelledby="feedback-heading"
        class="mt-10 bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-stone-200 max-w-3xl"
      >
        <h3
          #heading
          id="feedback-heading"
          tabindex="-1"
          class="text-2xl font-bold text-stone-800 mb-4 serif focus:outline-none"
        >
          {{ isAuthor() ? 'Your notes as the author' : 'Your feedback' }}
        </h3>

        @switch (view()) {
          @case ('guest') {
            <p class="text-stone-600 text-base">Feedback is public and needs a Google account.</p>
            <button
              type="button"
              (click)="signIn()"
              class="mt-4 min-h-[44px] px-5 py-2.5 rounded-lg font-semibold bg-green-700 text-white hover:bg-green-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700 transition-colors"
            >
              Sign in to leave feedback
            </button>
          }
          @case ('loading') {
            <p class="text-stone-500 text-base" role="status">Loading your feedback…</p>
          }
          @case ('load-error') {
            <p class="text-stone-700 text-base" role="alert">Could not load your feedback.</p>
            <button
              type="button"
              (click)="retryLoad()"
              class="mt-4 min-h-[44px] px-5 py-2.5 rounded-lg font-semibold bg-stone-100 text-stone-800 hover:bg-stone-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700 transition-colors"
            >
              Try again
            </button>
          }
          @case ('form') {
            @if (state(); as s) {
              <form (submit)="$event.preventDefault(); post()" class="space-y-5" novalidate>
                <fieldset>
                  <legend class="text-base font-semibold text-stone-800 mb-2">
                    How did it turn out?
                  </legend>
                  <div class="flex flex-nowrap gap-2">
                    @for (n of starChoices; track n) {
                      <label
                        class="flex items-center justify-center gap-2 min-h-[44px] min-w-[44px] px-2 sm:px-3 rounded-lg border border-stone-300 text-stone-700 cursor-pointer has-[:checked]:border-green-700 has-[:checked]:bg-green-50 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-green-700"
                      >
                        <input
                          type="radio"
                          name="feedback-stars"
                          class="h-4 w-4 accent-green-700"
                          [value]="n"
                          [checked]="stars() === n"
                          [disabled]="sending()"
                          (change)="stars.set(n); error.set(null)"
                        />
                        <span class="sm:hidden" aria-hidden="true">{{ n }}</span>
                        <span class="sr-only sm:not-sr-only">{{
                          n === 1 ? '1 star' : n + ' stars'
                        }}</span>
                      </label>
                    }
                  </div>
                </fieldset>

                <div>
                  <label
                    for="feedback-note"
                    class="block text-base font-semibold text-stone-800 mb-1"
                    >What I changed (optional)</label
                  >
                  <textarea
                    id="feedback-note"
                    rows="4"
                    [attr.maxlength]="maxLength"
                    aria-describedby="feedback-note-count"
                    class="w-full p-3 rounded-lg border border-stone-300 text-stone-800 text-base focus:outline-none focus:ring-2 focus:ring-green-600"
                    [value]="note()"
                    [disabled]="sending()"
                    (input)="note.set($any($event.target).value)"
                  ></textarea>
                  <p
                    id="feedback-note-count"
                    class="text-sm text-stone-500 text-right"
                    aria-hidden="true"
                  >
                    {{ note().length }} / {{ maxLength }}
                  </p>
                  <p class="sr-only" aria-live="polite">{{ counterMessage() }}</p>
                </div>

                @if (showsFromText(); as showsFrom) {
                  <p class="text-base text-stone-700">
                    Your account is new. Feedback you post now shows on the recipe page from
                    {{ showsFrom }}.
                  </p>
                }
                <p class="text-base text-stone-600">
                  @if (isAuthor()) {
                    Shown on the recipe page under 'From the author'. Not counted in the rating.
                  } @else {
                    Your rating, your note and your first name ({{ s.first_name }}) will be shown
                    publicly on the recipe page.
                  }
                </p>

                @if (error(); as message) {
                  <p
                    #errorLine
                    role="alert"
                    tabindex="-1"
                    class="text-base text-red-700 font-medium"
                  >
                    {{ message }}
                  </p>
                }
                <button
                  type="submit"
                  [disabled]="sending()"
                  class="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-lg font-semibold bg-green-700 text-white hover:bg-green-800 disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700 transition-colors"
                >
                  {{ sending() ? 'Posting…' : 'Post: I cooked this' }}
                </button>
              </form>
            }
          }
          @case ('entry') {
            @if (state(); as s) {
              @if (s.entry; as entry) {
                @if (notice(); as message) {
                  <p role="alert" class="mb-3 text-base text-stone-800 font-medium">
                    {{ message }}
                  </p>
                }
                <p class="text-lg text-stone-800">
                  <span aria-hidden="true" class="text-yellow-800">{{
                    starGlyphs(entry.stars)
                  }}</span>
                  <span class="sr-only">{{ entry.stars }} out of 5 stars</span>
                </p>
                @if (entry.note) {
                  <blockquote
                    class="mt-2 text-base text-stone-700 whitespace-pre-wrap border-l-0"
                    [textContent]="entry.note"
                  ></blockquote>
                }
                @if (postedOn(entry); as day) {
                  <p class="mt-1 text-sm text-stone-500">Posted {{ day }}</p>
                }
                <div role="status" class="mt-3 space-y-1 text-base text-stone-700">
                  @for (line of statusLines(); track line) {
                    <p>{{ line }}</p>
                  }
                  @if (publicLink(); as href) {
                    <p>
                      <a
                        [href]="href"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="font-semibold text-green-800 underline underline-offset-2 hover:text-green-900"
                        >Open the recipe page</a
                      >
                    </p>
                  }
                </div>
                @if (error(); as message) {
                  <p
                    #errorLine
                    role="alert"
                    tabindex="-1"
                    class="mt-3 text-base text-red-700 font-medium"
                  >
                    {{ message }}
                  </p>
                }
                <button
                  type="button"
                  (click)="confirmingDelete.set(true)"
                  class="mt-4 min-h-[44px] px-4 py-2 rounded-lg font-semibold text-red-700 bg-stone-100 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 transition-colors"
                >
                  Delete feedback
                </button>
              }
            }
          }
        }
      </section>
    }

    @if (confirmingDelete()) {
      <div class="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <button
          type="button"
          class="absolute inset-0 bg-stone-900/50 backdrop-blur-sm"
          (click)="cancelDelete()"
          [disabled]="deleting()"
          aria-label="Close delete feedback dialog"
          tabindex="-1"
        ></button>
        <div
          class="relative bg-white w-full max-w-sm rounded-3xl shadow-2xl p-6 animate-[fadeIn_0.3s_ease-out]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-feedback-title"
          aria-describedby="delete-feedback-body"
          appDialogFocus
          tabindex="-1"
        >
          <h3 id="delete-feedback-title" class="text-xl font-bold text-stone-800 serif text-center">
            Delete your feedback?
          </h3>
          <p id="delete-feedback-body" class="mt-3 text-base text-stone-600">
            It leaves the recipe page now. To change it, delete it and post a new one.
          </p>
          <div class="mt-5 flex gap-3">
            <button
              type="button"
              data-dialog-initial-focus
              (click)="cancelDelete()"
              [disabled]="deleting()"
              class="flex-1 min-h-[44px] py-3 bg-stone-100 text-stone-600 font-bold rounded-xl hover:bg-stone-200"
            >
              Keep
            </button>
            <button
              type="button"
              (click)="confirmDelete()"
              [disabled]="deleting()"
              class="flex-1 min-h-[44px] py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 disabled:opacity-40"
            >
              {{ deleting() ? 'Deleting…' : 'Delete' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class RecipeFeedbackComponent {
  private readonly auth = inject(AuthService);
  private readonly feedback = inject(FeedbackService);
  private readonly route = inject(ActivatedRoute, { optional: true });

  readonly recipe = input.required<Recipe>();

  readonly starChoices = STAR_CHOICES;
  readonly maxLength = NOTE_MAX_LENGTH;

  readonly state = signal<FeedbackState | null>(null);
  readonly loading = signal(false);
  /** The last load failed (network or server), so the panel offers a retry. */
  readonly loadFailed = signal(false);
  readonly stars = signal<number | null>(null);
  readonly note = signal('');
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  /** A one-off message above an entry, e.g. "You already posted feedback…". */
  readonly notice = signal<string | null>(null);
  readonly confirmingDelete = signal(false);
  readonly deleting = signal(false);

  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly errorLine = viewChild<ElementRef<HTMLElement>>('errorLine');

  readonly targetId = computed(() => feedbackTargetId(this.recipe()));
  readonly signedIn = computed(() => isSignedIn(this.auth.currentUser()));
  readonly isAuthor = computed(() => this.state()?.role === 'author');

  readonly view = computed<FeedbackView>(() => {
    const target = this.targetId();
    if (!target) return 'hidden';
    if (!this.signedIn()) {
      // Only a saved copy offers sign-in; a guest has no published recipe of its own.
      return this.recipe().sourceRecipeId ? 'guest' : 'hidden';
    }
    if (this.loading()) return 'loading';
    if (this.loadFailed()) return 'load-error';
    return feedbackViewFor(this.state());
  });

  readonly counterMessage = computed(() => counterAnnouncement(this.note().length));

  readonly showsFromText = computed(() => {
    const s = this.state();
    if (!s?.account_new) return null;
    const date = parseServerTime(s.visible_from);
    return date ? formatDayTime(date) : null;
  });

  readonly statusLines = computed(() => {
    const s = this.state();
    return s?.entry ? entryStatusLines(s, s.entry, new Date()) : [];
  });

  /** The recipe page link, only when the note and rating are actually there. */
  readonly publicLink = computed(() => {
    const s = this.state();
    const entry = s?.entry;
    if (!s?.target_public || !s.target_slug || !entry || entry.entry_hidden) return null;
    const showsFrom = parseServerTime(s.visible_from);
    if (showsFrom && showsFrom > new Date()) return null;
    const published = entry.note_status === 'approved' || entry.note_status === 'published';
    return entry.note && published ? `/r/${s.target_slug}#feedback` : null;
  });

  private loadSeq = 0;

  constructor() {
    effect(() => {
      const target = this.targetId();
      const signedIn = this.signedIn();
      untracked(() => {
        this.state.set(null);
        this.loadFailed.set(false);
        this.error.set(null);
        this.notice.set(null);
        if (target && signedIn) void this.load(target);
      });
    });
  }

  starGlyphs(stars: number): string {
    return '★'.repeat(stars) + '☆'.repeat(Math.max(0, 5 - stars));
  }

  postedOn(entry: FeedbackEntry): string | null {
    const date = parseServerTime(entry.created_at);
    return date ? formatDay(date) : null;
  }

  private async load(target: string) {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.loadFailed.set(false);
    const result = await this.feedback.load(target);
    if (seq !== this.loadSeq) return;
    this.loading.set(false);
    this.state.set(result.kind === 'ok' ? result.state : null);
    this.loadFailed.set(result.kind === 'error');
    if (result.kind === 'ok' && this.route?.snapshot?.fragment === 'feedback') {
      // Arrived from "Add feedback" (R8): bring the form into view and to the
      // screen reader, after it has rendered.
      setTimeout(() => {
        const el = this.heading()?.nativeElement;
        el?.scrollIntoView({ block: 'start' });
        el?.focus({ preventScroll: true });
      });
    }
  }

  retryLoad() {
    const target = this.targetId();
    if (target && this.signedIn()) void this.load(target);
  }

  signIn() {
    const slug = this.recipe().sourceSlug;
    if (slug) storeFeedbackIntent(slug);
    this.auth.login().catch(() => {
      this.error.set('Could not start sign-in. Please try again.');
    });
  }

  async post() {
    const target = this.targetId();
    const stars = this.stars();
    if (!target || this.sending()) return;
    if (!stars) {
      this.showError('Choose how many stars, from 1 to 5.');
      return;
    }
    this.sending.set(true);
    this.error.set(null);
    try {
      const result = await this.feedback.post(target, stars, this.note());
      // The page moved to another recipe while this was in flight: the result
      // belongs to the old one, and the new one has loaded its own state.
      if (this.targetId() !== target) return;
      const s = this.state();
      switch (result.kind) {
        case 'posted':
          if (s) this.state.set({ ...s, entry: result.entry, can_post: false });
          this.note.set('');
          this.stars.set(null);
          break;
        case 'exists':
          if (s && result.entry) {
            this.state.set({ ...s, entry: result.entry, can_post: false });
            this.notice.set(
              'You already posted feedback on this recipe. Delete it to post a new one.'
            );
          } else {
            this.showError(
              'You already posted feedback on this recipe. Delete it to post a new one.'
            );
          }
          break;
        case 'not-public':
          this.showError('This recipe is no longer public, so feedback is closed.');
          if (s) this.state.set({ ...s, target_public: false });
          break;
        default:
          this.showError('Could not post. Your rating and note are still here. Try again.');
      }
    } finally {
      this.sending.set(false);
    }
  }

  cancelDelete() {
    if (!this.deleting()) this.confirmingDelete.set(false);
  }

  async confirmDelete() {
    const target = this.targetId();
    if (!target || this.deleting()) return;
    this.deleting.set(true);
    try {
      const ok = await this.feedback.remove(target);
      this.confirmingDelete.set(false);
      if (this.targetId() !== target) return;
      if (!ok) {
        this.showError('Could not delete your feedback. Try again.');
        return;
      }
      this.notice.set(null);
      await this.load(target);
      setTimeout(() => this.heading()?.nativeElement.focus());
    } finally {
      this.deleting.set(false);
    }
  }

  private showError(message: string) {
    this.error.set(message);
    // Errors take focus (R12), once the alert has rendered.
    setTimeout(() => this.errorLine()?.nativeElement.focus());
  }
}
