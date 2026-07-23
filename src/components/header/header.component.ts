import { Component, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ModalService } from '../../services/modal.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './header.component.html',
})
export class HeaderComponent {
  private readonly router = inject(Router);
  readonly authService = inject(AuthService);
  readonly modalService = inject(ModalService);

  readonly activeView = signal<'generator' | 'kitchen' | 'recipe'>('generator');
  readonly showUserProfileCard = signal(false);

  readonly logoutRequested = output<void>();

  constructor() {
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) {
        const url = e.urlAfterRedirects;
        if (url.startsWith('/kitchen')) this.activeView.set('kitchen');
        else if (url.startsWith('/recipe')) this.activeView.set('recipe');
        else this.activeView.set('generator');
      }
    });
  }

  switchView(view: 'generator' | 'kitchen') {
    this.router.navigate([view === 'kitchen' ? '/kitchen' : '/']);
  }

  toggleUserProfileCard() {
    this.showUserProfileCard.update((v) => !v);
  }

  closeUserProfileCard() {
    this.showUserProfileCard.set(false);
  }

  maskedEmail(): string {
    const email = this.authService.currentUser()?.email;
    if (!email) return '';
    const [local, domain] = email.split('@');
    if (!domain || local.length <= 2) return email;
    return local.slice(0, 2) + '***@' + domain;
  }

  onLogout() {
    this.closeUserProfileCard();
    this.logoutRequested.emit();
  }
}
