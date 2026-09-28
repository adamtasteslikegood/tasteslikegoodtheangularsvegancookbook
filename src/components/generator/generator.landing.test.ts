import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Injector, runInInjectionContext } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { GeneratorComponent } from './generator.component';
import { routes } from '../../app.routes';
import { AuthService } from '../../services/auth.service';
import { PersistenceService } from '../../services/persistence.service';
import { GeminiService } from '../../services/gemini.service';
import { RecipeStateService } from '../../services/recipe-state.service';
import { ToastService } from '../../services/toast.service';
import { ModalService } from '../../services/modal.service';

// KAN-287: "/" is the landing page and "/generate" (the Generator tab) is the
// same component with the landing copy hidden. These pin the three pieces that
// have to agree: the route data, the component flag, and the template gating.

const create = (routeData?: Record<string, unknown>) => {
  const injector = Injector.create({
    providers: [
      { provide: AuthService, useValue: { currentUser: () => null } },
      { provide: PersistenceService, useValue: {} },
      { provide: GeminiService, useValue: {} },
      { provide: RecipeStateService, useValue: { clearRecipe: () => undefined } },
      { provide: ToastService, useValue: { show: () => undefined } },
      { provide: ModalService, useValue: {} },
      ...(routeData
        ? [{ provide: ActivatedRoute, useValue: { snapshot: { data: routeData } } }]
        : []),
    ],
  });
  return runInInjectionContext(injector, () => new GeneratorComponent());
};

describe('GeneratorComponent landing vs /generate (KAN-287)', () => {
  it('routes "" and "generate" to the generator, only the latter with landing:false', () => {
    const home = routes.find((r) => r.path === '');
    const generate = routes.find((r) => r.path === 'generate');
    expect(home?.component).toBe(GeneratorComponent);
    expect(home?.data?.['landing']).toBeUndefined();
    expect(generate?.component).toBe(GeneratorComponent);
    expect(generate?.data).toEqual({ landing: false });
  });

  it('shows the landing copy on "/" (no route data) and hides it on /generate', () => {
    expect(create({}).showLanding).toBe(true);
    expect(create({ landing: false }).showLanding).toBe(false);
  });

  it('gates both landing blocks (hero and how-it-works/FAQ) on showLanding', () => {
    const template = readFileSync(
      fileURLToPath(new URL('./generator.component.html', import.meta.url)),
      'utf8'
    );
    expect(template).toMatch(
      /@if \(showLanding\) \{\s*<section[^>]*aria-labelledby="landing-title"/
    );
    expect(template).toMatch(
      /@if \(showLanding && !recipe\(\)\) \{\s*<section[^>]*About the vegan/
    );
  });
});
