import { Component } from '@angular/core';

@Component({
  selector: 'app-chunk-error',
  template: `
    <div class="flex flex-col items-center justify-center py-20 text-center">
      <p class="text-lg text-gray-600 dark:text-gray-400 mb-4">
        Failed to load page. Check your connection and try again.
      </p>
      <button
        (click)="retry()"
        class="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
      >
        Retry
      </button>
    </div>
  `,
})
export class ChunkErrorComponent {
  retry() {
    window.location.assign('/');
  }
}
