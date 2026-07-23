import { Component } from '@angular/core';
import { Routes } from '@angular/router';
import { ssrEntryGuard } from './guards/ssr-entry.guard';
import { RecipeDetailComponent } from './components/recipe-detail/recipe-detail.component';

@Component({ template: '', standalone: true })
class GeneratorStub {}

@Component({ template: '', standalone: true })
class KitchenStub {}

export const routes: Routes = [
  {
    path: '',
    component: GeneratorStub,
    canActivate: [ssrEntryGuard],
  },
  {
    path: 'kitchen',
    component: KitchenStub,
  },
  {
    path: 'recipe/:id',
    component: RecipeDetailComponent,
  },
  { path: '**', redirectTo: '' },
];
