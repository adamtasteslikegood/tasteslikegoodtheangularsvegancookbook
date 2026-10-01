/**
 * KAN-295 — visible breadcrumbs in the SPA, matching the SSR BreadcrumbList.
 *
 * The trail builders are pure and pinned here against the SSR shape
 * (Backend `public_bp._breadcrumbs`: Home → Browse → [hub] → recipe). The
 * template is pinned from source, the same way the other shared components
 * are tested here: Vitest runs in node, with no DOM renderer.
 */
import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BROWSE_CRUMB,
  HOME_CRUMB,
  KITCHEN_CRUMB,
  isSpaPath,
  kitchenTrail,
  privateRecipeTrail,
  publicRecipeFallbackTrail,
  toSameOriginPath,
  trailFromApi,
} from '../../utils/breadcrumbs';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('breadcrumb trails (KAN-295)', () => {
  it('spells Home and Browse the way the SSR trail does', () => {
    expect(HOME_CRUMB).toEqual({ name: 'Home', url: '/' });
    expect(BROWSE_CRUMB).toEqual({ name: 'Browse', url: '/browse' });
  });

  it("labels the Kitchen crumb with the header's label from site-nav.json (KAN-294)", () => {
    const nav = JSON.parse(read('../../site-nav.json')) as {
      header: Array<{ href: string; label: string }>;
    };
    const kitchen = nav.header.find((link) => link.href === '/kitchen');
    expect(KITCHEN_CRUMB).toEqual({ name: kitchen?.label, url: '/kitchen' });
  });

  it('turns the SSR trail from the public API into same-origin crumbs, hub included', () => {
    const api = [
      { name: 'Home', url: 'https://www.tasteslikegood.org/' },
      { name: 'Browse', url: 'https://www.tasteslikegood.org/browse' },
      {
        name: 'Vegan Breakfast Recipes',
        url: 'https://www.tasteslikegood.org/browse/tag/breakfast',
      },
      { name: 'Tofu Scramble', url: 'https://www.tasteslikegood.org/r/tofu-scramble' },
    ];
    expect(trailFromApi(api)).toEqual([
      { name: 'Home', url: '/' },
      { name: 'Browse', url: '/browse' },
      { name: 'Vegan Breakfast Recipes', url: '/browse/tag/breakfast' },
      { name: 'Tofu Scramble', url: '/r/tofu-scramble' },
    ]);
  });

  it('rejects a missing or malformed API trail so the caller falls back', () => {
    expect(trailFromApi(undefined)).toBeNull();
    expect(trailFromApi([])).toBeNull();
    expect(trailFromApi([{ name: 'Home', url: '/' }])).toBeNull();
    expect(
      trailFromApi([
        { name: 'Home', url: '/' },
        { name: '', url: '/browse' },
      ])
    ).toBeNull();
    expect(trailFromApi([{ name: 'Home', url: '/' }, { name: 'Browse' }])).toBeNull();
    expect(trailFromApi([{ name: 'Home', url: '/' }, null])).toBeNull();
    // An empty url would resolve to "/" and link "Browse" to the home page.
    expect(
      trailFromApi([
        { name: 'Home', url: '/' },
        { name: 'Browse', url: '' },
      ])
    ).toBeNull();
  });

  it('keeps only the path of an absolute URL', () => {
    expect(toSameOriginPath('https://www.tasteslikegood.org/r/x')).toBe('/r/x');
    expect(toSameOriginPath('/browse')).toBe('/browse');
  });

  it('falls back to Home → Browse → recipe for a published recipe', () => {
    expect(publicRecipeFallbackTrail({ name: 'Tofu Scramble', slug: 'tofu-scramble' })).toEqual([
      HOME_CRUMB,
      BROWSE_CRUMB,
      { name: 'Tofu Scramble', url: '/r/tofu-scramble' },
    ]);
  });

  it('runs a private recipe through My Kitchen', () => {
    expect(privateRecipeTrail({ id: 'abc', name: 'Secret Stew' })).toEqual([
      HOME_CRUMB,
      KITCHEN_CRUMB,
      { name: 'Secret Stew', url: '/recipe/abc' },
    ]);
  });

  it('ends the Kitchen trail at the selected cookbook, or at My Kitchen', () => {
    expect(kitchenTrail(null)).toEqual([HOME_CRUMB, KITCHEN_CRUMB]);
    expect(kitchenTrail(undefined)).toEqual([HOME_CRUMB, KITCHEN_CRUMB]);
    expect(kitchenTrail('Weeknights')).toEqual([
      HOME_CRUMB,
      KITCHEN_CRUMB,
      { name: 'Weeknights', url: '/kitchen' },
    ]);
  });

  it('routes SPA paths in-app and leaves Flask-served paths to the browser', () => {
    for (const path of ['/', '/kitchen', '/generate', '/recipe/abc']) {
      expect(isSpaPath(path)).toBe(true);
    }
    for (const path of ['/browse', '/browse/tag/breakfast', '/r/tofu-scramble']) {
      expect(isSpaPath(path)).toBe(false);
    }
  });
});

describe('breadcrumb markup (KAN-295)', () => {
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

  it('links every earlier crumb: routerLink for SPA paths, href for SSR paths', () => {
    const linkBranch = template.slice(template.indexOf('} @else {'));
    expect(linkBranch).toContain('@if (isSpaPath(crumb.url))');
    expect(linkBranch).toContain('[routerLink]="crumb.url"');
    expect(linkBranch).toContain('[href]="crumb.url"');
    expect(linkBranch).toContain('aria-hidden="true"');
  });

  it('is rendered by the recipe detail and Kitchen views', () => {
    expect(read('../recipe-detail/recipe-detail.component.html')).toContain(
      '<app-breadcrumb [crumbs]="breadcrumbs()" />'
    );
    expect(read('../kitchen/kitchen.component.html')).toContain(
      '<app-breadcrumb [crumbs]="breadcrumbs()" (navigate)="onCrumb($event)" />'
    );
  });

  it('reports in-app crumb clicks, so Kitchen can leave a cookbook via My Kitchen', () => {
    // /kitchen → /kitchen is a router no-op; the selected cookbook is not in
    // the URL, so the Kitchen resets it when its own crumb is clicked.
    const spaLink = template.slice(
      template.indexOf('[routerLink]="crumb.url"'),
      template.indexOf('} @else {', template.indexOf('[routerLink]="crumb.url"'))
    );
    expect(spaLink).toContain('(click)="navigate.emit(crumb)"');
    expect(source).toContain('readonly navigate = output<Crumb>();');
    const kitchen = read('../kitchen/kitchen.component.ts');
    expect(kitchen).toMatch(
      /onCrumb\(crumb: Crumb\) \{\s*if \(crumb\.url === KITCHEN_CRUMB\.url\) this\.selectCookbook\(null\);/
    );
  });

  it('forgets the fetched trail when the recipe is unpublished, so a republish refetches', () => {
    const detail = read('../recipe-detail/recipe-detail.component.ts');
    const sync = detail.slice(detail.indexOf('private async syncPublicTrail()'));
    const notPublic = sync.slice(0, sync.indexOf('const slug = r.slug;'));
    expect(notPublic).toContain('if (!r?.is_public || !r.slug) {');
    expect(notPublic).toContain('this.publicTrailRequestedFor = null;');
  });
});
