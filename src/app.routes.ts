import { Component } from '@angular/core';
import { Routes } from '@angular/router';
import { ssrEntryGuard } from './guards/ssr-entry.guard';

@Component({ template: '', standalone: true })
class GeneratorStub {}

@Component({ template: '', standalone: true })
class KitchenStub {}

@Component({ template: '', standalone: true })
class RecipeDetailStub {}

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
    component: RecipeDetailStub,
  },
  { path: '**', redirectTo: '' },
];
