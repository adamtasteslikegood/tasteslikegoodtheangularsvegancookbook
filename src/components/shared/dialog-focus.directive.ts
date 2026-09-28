import { DOCUMENT } from '@angular/common';
import { AfterViewInit, Directive, ElementRef, Inject, OnDestroy } from '@angular/core';

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"]):not([disabled])',
].join(',');

/**
 * Keeps keyboard focus inside a modal dialog and returns it to the control that
 * opened the dialog when the modal is destroyed.
 */
@Directive({
  selector: '[appDialogFocus]',
  standalone: true,
  host: {
    '(keydown)': 'onKeydown($event)',
  },
})
export class DialogFocusDirective implements AfterViewInit, OnDestroy {
  private readonly previouslyFocused = this.asFocusable(this.document.activeElement);
  private destroyed = false;

  constructor(
    private readonly host: ElementRef<HTMLElement>,
    @Inject(DOCUMENT) private readonly document: Document
  ) {}

  ngAfterViewInit(): void {
    // Wait until Angular has rendered every conditional control in the dialog.
    queueMicrotask(() => {
      if (this.destroyed) return;
      const initial = this.host.nativeElement.querySelector<HTMLElement>(
        '[data-dialog-initial-focus]'
      );
      (initial ?? this.focusableElements()[0] ?? this.host.nativeElement).focus();
    });
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;

    const focusable = this.focusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      this.host.nativeElement.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = this.document.activeElement;
    const focusLeftDialog = !this.host.nativeElement.contains(active);

    if (event.shiftKey && (active === first || focusLeftDialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || focusLeftDialog)) {
      event.preventDefault();
      first.focus();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.previouslyFocused?.isConnected) this.previouslyFocused.focus();
  }

  private focusableElements(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE));
  }

  private asFocusable(element: Element | null): HTMLElement | null {
    return element && 'focus' in element ? (element as HTMLElement) : null;
  }
}
