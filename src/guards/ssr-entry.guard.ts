import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SsrEntryService } from '../services/ssr-entry.service';

export const ssrEntryGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const ssrEntry = inject(SsrEntryService);

  const queryParams = route.queryParams;
  const fragment = route.fragment;

  const saveParam = queryParams['save'];
  if (saveParam) {
    const slug = Array.isArray(saveParam) ? saveParam[0] : saveParam;
    if (typeof slug === 'string') {
      await ssrEntry.handleSave(slug);
    }
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
