import '@angular/compiler';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import {
  provideRouter,
  withPreloading,
  PreloadAllModules,
  withNavigationErrorHandler,
  Router,
} from '@angular/router';
import { inject } from '@angular/core';
import { AppComponent } from './src/app.component';
import { routes } from './src/app.routes';

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withPreloading(PreloadAllModules),
      withNavigationErrorHandler((e) => {
        if (e instanceof Error && /chunk|loading/i.test(e.message)) {
          inject(Router).navigateByUrl('/chunk-error');
        }
      })
    ),
  ],
}).catch((err) => console.error(err));

// AI Studio always uses an `index.tsx` file for all project types.
