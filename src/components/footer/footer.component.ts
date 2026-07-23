import { Component } from '@angular/core';

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
          <a href="/privacy-policy" class="hover:text-stone-800 underline underline-offset-2"
            >Privacy Policy</a
          >
        </nav>
      </div>
    </footer>
  `,
})
export class FooterComponent {}
