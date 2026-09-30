import { Component } from '@angular/core';
import { environment } from '../../environments/environment';
import siteNav from '../../site-nav.json';

export const standalonePageHref = (
  path: '/about' | '/privacy-policy',
  production = environment.production
): string => (production ? path : `${path}.html`);

/**
 * The footer's links: the canonical set in src/site-nav.json (KAN-294), shared
 * with the SSR base template. Only the href is adjusted, and only under
 * `npm run dev`, where the standalone pages are served as .html assets.
 */
export const footerLinks = (production = environment.production) =>
  siteNav.footer.map(({ href, label }) => ({
    label,
    href:
      href === '/about' || href === '/privacy-policy' ? standalonePageHref(href, production) : href,
  }));

@Component({
  selector: 'app-footer',
  standalone: true,
  template: `
    <footer class="mt-auto pt-10 pb-6 border-t border-stone-200 text-sm text-stone-500">
      <div
        class="flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left"
      >
        <p class="serif">&copy; 2026 Tasteslikegood.org &mdash; VeganGenius Chef</p>
        <nav class="flex items-center gap-5">
          @for (link of links; track link.href) {
            <a [href]="link.href" class="hover:text-stone-800 underline underline-offset-2">{{
              link.label
            }}</a>
          }
        </nav>
        <!--
          KAN-292: a button, not a nav link (the footer link set is canonical, KAN-294).
          Ships hidden; public/rum/consent.js reveals it when RUM is configured and
          opens the analytics choice on click.
        -->
        <button
          type="button"
          hidden
          data-analytics-settings
          class="hover:text-stone-800 underline underline-offset-2"
        >
          Analytics choice
        </button>
      </div>
    </footer>
  `,
})
export class FooterComponent {
  readonly links = footerLinks();
}
