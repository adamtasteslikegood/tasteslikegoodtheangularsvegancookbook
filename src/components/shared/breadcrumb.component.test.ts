/**
 * KAN-295 / KAN-321 — visible breadcrumbs in the SPA.
 *
 * KAN-321: breadcrumbs stay on their own side of auth. In-app trails start at
 * My Kitchen and link only to /kitchen, /kitchen/<id> and /recipe/<id>; the
 * public SSR trail (Home → Browse → hub → recipe) belongs to the Flask
 * templates alone. The trail builders are pure and pinned here; the template
 * is pinned from source, the same way the other shared components are tested
 * here: Vitest runs in node, with no DOM renderer.
 */
import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  KITCHEN_CRUMB,
  cookbookUrl,
  isInAppCrumbPath,
  kitchenTrail,
  recipeTrail,
  type Crumb,
} from '../../utils/breadcrumbs';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/** Every crumb that renders as a link (all but the current page). */
const linkedCrumbs = (trail: Crumb[]) => trail.slice(0, -1);

/** The rule, stated independently of the predicate under test. */
const IN_APP = /^\/kitchen(\/[^/]+)?$|^\/recipe\/[^/]+$/;

describe('breadcrumb trails (KAN-295 / KAN-321)', () => {
  const cookbook = { id: 'cb-1', name: 'Weeknights' };
  const recipe = { id: 'r-1', name: 'Tofu Scramble' };

  it("labels the Kitchen crumb with the header's label from site-nav.json (KAN-294)", () => {
    const nav = JSON.parse(read('../../site-nav.json')) as {
      header: Array<{ href: string; label: string }>;
    };
    const kitchen = nav.header.find((link) => link.href === '/kitchen');
    expect(KITCHEN_CRUMB).toEqual({ name: kitchen?.label, url: '/kitchen' });
  });

  it('starts at My Kitchen: no Home crumb in-app', () => {
    expect(kitchenTrail(null)[0]).toEqual(KITCHEN_CRUMB);
    expect(recipeTrail(recipe)[0]).toEqual(KITCHEN_CRUMB);
    expect(recipeTrail(recipe, cookbook)[0]).toEqual(KITCHEN_CRUMB);
  });

  it('ends the Kitchen trail at the selected cookbook, linked to its own route', () => {
    expect(kitchenTrail(null)).toEqual([KITCHEN_CRUMB]);
    expect(kitchenTrail(undefined)).toEqual([KITCHEN_CRUMB]);
    expect(kitchenTrail(cookbook)).toEqual([
      KITCHEN_CRUMB,
      { name: 'Weeknights', url: '/kitchen/cb-1' },
    ]);
  });

  it('runs a recipe opened from a cookbook through /kitchen/<id>', () => {
    expect(recipeTrail(recipe, cookbook)).toEqual([
      KITCHEN_CRUMB,
      { name: 'Weeknights', url: '/kitchen/cb-1' },
      { name: 'Tofu Scramble', url: '/recipe/r-1' },
    ]);
  });

  it('runs a recipe opened from All Recipes straight to /kitchen', () => {
    expect(recipeTrail(recipe)).toEqual([
      KITCHEN_CRUMB,
      { name: 'Tofu Scramble', url: '/recipe/r-1' },
    ]);
    expect(recipeTrail(recipe, null)).toEqual(recipeTrail(recipe));
  });

  it('encodes ids into a single path segment', () => {
    expect(cookbookUrl('a/b')).toBe('/kitchen/a%2Fb');
    expect(isInAppCrumbPath(cookbookUrl('a/b'))).toBe(true);
  });

  it('never links a trail outside /kitchen or /recipe (KAN-321)', () => {
    const trails = {
      'All Recipes': kitchenTrail(null),
      cookbook: kitchenTrail(cookbook),
      'recipe without cookbook': recipeTrail(recipe),
      'recipe with cookbook': recipeTrail(recipe, cookbook),
      'published recipe': recipeTrail({ ...recipe, id: 'pub-1' }, cookbook),
    };
    for (const [label, trail] of Object.entries(trails)) {
      for (const crumb of trail) {
        expect(crumb.url, `${label}: ${crumb.name}`).toMatch(IN_APP);
        expect(isInAppCrumbPath(crumb.url), `${label}: ${crumb.name}`).toBe(true);
        expect(crumb.url).not.toMatch(/^\/(browse|r\/)|^\/$/);
      }
      expect(linkedCrumbs(trail).every((c) => c.url.startsWith('/kitchen'))).toBe(true);
    }
  });

  it('treats only in-app destinations as linkable', () => {
    for (const path of ['/kitchen', '/kitchen/cb-1', '/recipe/abc']) {
      expect(isInAppCrumbPath(path)).toBe(true);
    }
    for (const path of [
      '/',
      '/generate',
      '/browse',
      '/browse/tag/breakfast',
      '/r/tofu-scramble',
      '/kitchen/',
      '/kitchen/a/b',
      '/recipe/',
      'https://www.tasteslikegood.org/kitchen',
    ]) {
      expect(isInAppCrumbPath(path), path).toBe(false);
    }
  });

  it('no longer carries the public SSR trail helpers', () => {
    const source = read('../../utils/breadcrumbs.ts');
    for (const gone of [
      'trailFromApi',
      'publicRecipeFallbackTrail',
      'BROWSE_CRUMB',
      'HOME_CRUMB',
      "'/browse'",
    ]) {
      expect(source).not.toContain(gone);
    }
  });
});

describe('breadcrumb markup (KAN-295 / KAN-321)', () => {
  const source = read('./breadcrumb.component.ts');
  const template = source.slice(source.indexOf('template: `'), source.lastIndexOf('`,'));

  it('is a labelled nav around an ordered list', () => {
    expect(template).toContain('<nav aria-label="Breadcrumb"');
    expect(template).toMatch(/<ol[\s>]/);
    expect(template).toMatch(/@for \(crumb of crumbs\(\)[^)]*let last = \$last\)/);
  });

  it('marks the last crumb as the current page and never links it', () => {
    const lastBranch = template.slice(
      template.indexOf('@if (last)'),
      template.indexOf('} @else {')
    );
    expect(lastBranch).toContain('aria-current="page"');
    expect(lastBranch).not.toContain('<a');
  });

  it('links earlier crumbs in-app only, and never with a plain href', () => {
    const linkBranch = template.slice(template.indexOf('} @else {'));
    expect(linkBranch).toContain('@if (isInAppCrumbPath(crumb.url))');
    expect(linkBranch).toContain('[routerLink]="crumb.url"');
    expect(template).not.toContain('[href]');
    expect(template).not.toContain('href=');
    expect(linkBranch).toContain('aria-hidden="true"');
  });

  it('is rendered by the recipe detail and Kitchen views', () => {
    expect(read('../recipe-detail/recipe-detail.component.html')).toContain(
      '<app-breadcrumb [crumbs]="breadcrumbs()" />'
    );
    expect(read('../kitchen/kitchen.component.html')).toContain(
      '<app-breadcrumb [crumbs]="breadcrumbs()" />'
    );
  });

  it('no longer fetches the SSR trail on the recipe page', () => {
    const detail = read('../recipe-detail/recipe-detail.component.ts');
    expect(detail).not.toContain('syncPublicTrail');
    expect(detail).not.toContain('/api/recipes/public/');
  });
});
