import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SsrEntryService } from '../services/ssr-entry.service';

export const ssrEntryGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const ssrEntry = inject(SsrEntryService);

  const queryParams = route.queryParams;
  const fragment = route.fragment;

  const saveParam = queryParams['save'];
  if (saveParam) {
    const slug = Array.isArray(saveParam) ? saveParam[0] : saveParam;
    if (typeof slug === 'string') {
      ssrEntry.handleSave(slug).catch((err) => console.error('SSR save failed:', err));
    }
    return router.createUrlTree(['/kitchen']);
  }

  // KAN-356 (R15): "Cooked this? Add your feedback" from the public page.
  // The service checks the slug, then opens the form or starts sign-in.
  const feedbackParam = queryParams['feedback'];
  if (feedbackParam) {
    const slug = Array.isArray(feedbackParam) ? feedbackParam[0] : feedbackParam;
    if (typeof slug === 'string') {
      ssrEntry.handleFeedback(slug).catch((err) => console.error('SSR feedback failed:', err));
    }
    return router.createUrlTree(['/kitchen']);
  }

  if (queryParams['auth'] === 'success') {
    ssrEntry.handleAuth().catch((err) => console.error('SSR auth handoff failed:', err));
    return router.createUrlTree(['/']);
  }

  // KAN-356 (E2): Google sign-in was cancelled or refused.
  if (queryParams['auth'] === 'cancelled') {
    ssrEntry
      .handleAuthCancelled()
      .catch((err) => console.error('SSR auth cancel handoff failed:', err));
    return router.createUrlTree(['/']);
  }

  if (fragment === 'kitchen') {
    return router.createUrlTree(['/kitchen']);
  }

  return true;
};
