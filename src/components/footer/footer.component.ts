import { Component } from '@angular/core';
import { environment } from '../../environments/environment';

export const standalonePageHref = (
  path: '/about' | '/privacy-policy',
  production = environment.production
): string => (production ? path : `${path}.html`);

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
          <a href="/browse" class="hover:text-stone-800 underline underline-offset-2"
            >Browse Public Recipes</a
          >
          <a [href]="aboutHref" class="hover:text-stone-800 underline underline-offset-2">About</a>
          <a [href]="privacyPolicyHref" class="hover:text-stone-800 underline underline-offset-2"
            >Privacy Policy</a
          >
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
  readonly aboutHref = standalonePageHref('/about');
  readonly privacyPolicyHref = standalonePageHref('/privacy-policy');
}
