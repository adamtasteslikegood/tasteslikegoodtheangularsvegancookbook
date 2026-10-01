import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { isSpaPath, type Crumb } from '../../utils/breadcrumbs';

/**
 * KAN-295 — the visible breadcrumb, the SPA counterpart of the SSR trail
 * (Backend `templates/public/*.html`, `nav.public-breadcrumb`).
 *
 * The last crumb is the current page: plain text with `aria-current="page"`,
 * never a link. Earlier crumbs are real anchors. Router-owned paths use
 * `routerLink`; Flask-served ones (/browse, /browse/tag/…, /r/…) use a plain
 * `href`, because the SPA's `**` route would send a routerLink to them home.
 *
 * `navigate` fires for in-app crumbs. A crumb that points at the URL already
 * open is a router no-op (`onSameUrlNavigation: 'ignore'`), so a view whose
 * state is not in the URL (Kitchen's selected cookbook) resets it from here.
 */
@Component({
  selector: 'app-breadcrumb',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (crumbs().length) {
      <nav aria-label="Breadcrumb" class="mb-4 text-sm text-stone-500">
        <ol class="flex flex-wrap items-center gap-x-2 gap-y-1">
          @for (crumb of crumbs(); track $index; let last = $last) {
            <li class="flex items-center gap-2 min-w-0">
              @if (last) {
                <span aria-current="page" class="font-medium text-stone-700 truncate">{{
                  crumb.name
                }}</span>
              } @else {
                @if (isSpaPath(crumb.url)) {
                  <a
                    [routerLink]="crumb.url"
                    (click)="onNavigate($event, crumb)"
                    class="hover:text-stone-800 underline underline-offset-2"
                    >{{ crumb.name }}</a
                  >
                } @else {
                  <a [href]="crumb.url" class="hover:text-stone-800 underline underline-offset-2">{{
                    crumb.name
                  }}</a>
                }
                <span aria-hidden="true" class="text-stone-300">/</span>
              }
            </li>
          }
        </ol>
      </nav>
    }
  `,
})
export class BreadcrumbComponent {
  readonly crumbs = input.required<Crumb[]>();
  readonly navigate = output<Crumb>();
  protected readonly isSpaPath = isSpaPath;

  protected onNavigate(event: MouseEvent, crumb: Crumb): void {
    // Preserve normal anchor semantics: opening a crumb in another tab/window
    // must not mutate the currently open Kitchen view.
    if (
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }
    this.navigate.emit(crumb);
  }
}
