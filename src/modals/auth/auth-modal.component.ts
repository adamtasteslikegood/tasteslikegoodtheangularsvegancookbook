import { Component, inject, model, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { isInAppBrowserEnvironment } from '../../utils/in-app-browser';

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './auth-modal.component.html',
})
export class AuthModalComponent {
  readonly authService = inject(AuthService);

  isOpen = model<boolean>(false);
  readonly closed = output<void>();

  authError = signal<string | null>(null);
  authLoginLoading = signal<boolean>(false);
  readonly isInAppBrowser = signal<boolean>(isInAppBrowserEnvironment());
  copiedShareLink = signal<boolean>(false);

  close() {
    this.isOpen.set(false);
    this.closed.emit();
  }

  async onGoogleLogin() {
    if (this.isInAppBrowser()) {
      this.authError.set(null);
      return;
    }

    this.authError.set(null);
    this.authLoginLoading.set(true);

    try {
      await this.authService.login();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start Google login';
      this.authError.set(message);
      this.authLoginLoading.set(false);
    }
  }

  async copyShareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      this.copiedShareLink.set(true);
      setTimeout(() => this.copiedShareLink.set(false), 2500);
    } catch {
      // Clipboard API unavailable/blocked in some webviews
    }
  }
}
