import { Routes, UrlMatchResult, UrlSegment } from '@angular/router';
import { ssrEntryGuard } from './guards/ssr-entry.guard';
import { GeneratorComponent } from './components/generator/generator.component';
import { ChunkErrorComponent } from './components/shared/chunk-error.component';

/**
 * KAN-321 — `/kitchen` and `/kitchen/<cookbookId>` as ONE route config.
 *
 * Two entries (`kitchen` + `kitchen/:cookbookId`) would differ in
 * `routeConfig`, so the default RouteReuseStrategy would destroy and recreate
 * KitchenComponent on every cookbook ↔ All Recipes switch, dropping view
 * state such as the open Recycle Bin. One matcher keeps the instance and lets
 * `paramMap` emit the change instead.
 */
export function kitchenMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments[0]?.path !== 'kitchen' || segments.length > 2) return null;
  return {
    consumed: segments,
    posParams: segments.length === 2 ? { cookbookId: segments[1] } : {},
  };
}

export const routes: Routes = [
  {
    path: '',
    component: GeneratorComponent,
    canActivate: [ssrEntryGuard],
  },
  {
    // KAN-287: the Generator tab. Same component, without the landing copy
    // that makes "/" the indexable page; served the noindex route-neutral shell.
    path: 'generate',
    component: GeneratorComponent,
    data: { landing: false },
  },
  {
    matcher: kitchenMatcher,
    loadComponent: () =>
      import('./components/kitchen/kitchen.component').then((m) => m.KitchenComponent),
  },
  {
    path: 'recipe/:id',
    loadComponent: () =>
      import('./components/recipe-detail/recipe-detail.component').then(
        (m) => m.RecipeDetailComponent
      ),
  },
  { path: 'chunk-error', component: ChunkErrorComponent },
  { path: '**', redirectTo: '' },
];
