import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { isInAppCrumbPath, type Crumb } from '../../utils/breadcrumbs';

/**
 * KAN-295 — the visible breadcrumb in the SPA.
 *
 * The last crumb is the current page: plain text with `aria-current="page"`,
 * never a link. Earlier crumbs are `routerLink`s.
 *
 * KAN-321: breadcrumbs stay on their own side of auth. This component links
 * only in-app destinations (`isInAppCrumbPath`: /kitchen, /kitchen/<id>,
 * /recipe/<id>); a crumb pointing anywhere else renders as plain text rather
 * than as an exit to the public SSR pages. The public trail is the SSR
 * template's job (Backend `templates/public/*.html`).
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
                @if (isInAppCrumbPath(crumb.url)) {
                  <a
                    [routerLink]="crumb.url"
                    class="hover:text-stone-800 underline underline-offset-2"
                    >{{ crumb.name }}</a
                  >
                } @else {
                  <span>{{ crumb.name }}</span>
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
  protected readonly isInAppCrumbPath = isInAppCrumbPath;
}
