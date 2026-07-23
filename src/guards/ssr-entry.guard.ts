import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SsrEntryService } from '../services/ssr-entry.service';

export const ssrEntryGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const ssrEntry = inject(SsrEntryService);

  const queryParams = route.queryParams;
  const fragment = route.fragment;

  if (queryParams['save']) {
    await ssrEntry.handleSave(queryParams['save']);
    return router.createUrlTree(['/kitchen']);
  }

  if (queryParams['auth'] === 'success') {
    await ssrEntry.handleAuth();
    return router.createUrlTree(['/']);
  }

  if (fragment === 'kitchen') {
    return router.createUrlTree(['/kitchen']);
  }

  return true;
};
