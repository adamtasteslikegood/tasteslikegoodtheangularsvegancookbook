import { Routes } from '@angular/router';
import { ssrEntryGuard } from './guards/ssr-entry.guard';
import { GeneratorComponent } from './components/generator/generator.component';

export const routes: Routes = [
  {
    path: '',
    component: GeneratorComponent,
    canActivate: [ssrEntryGuard],
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
  { path: '**', redirectTo: '' },
];
