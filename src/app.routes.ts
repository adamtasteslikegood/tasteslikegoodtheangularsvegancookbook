import { Routes } from '@angular/router';
import { ssrEntryGuard } from './guards/ssr-entry.guard';
import { GeneratorComponent } from './components/generator/generator.component';
import { ChunkErrorComponent } from './components/shared/chunk-error.component';

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
    path: 'kitchen',
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
