/**
 * /about (KAN-272, SEO audit 2026-09-13 C5): who makes the site and why.
 *
 * Asserted against the checked-in file, like the other static-page guards:
 * under Vitest, index.ts resolves server/public relative to server/ rather
 * than server/dist, so a live-route test would read the wrong directory.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyRoute } from './route-manifest.js';

const page = readFileSync(fileURLToPath(new URL('./public/about.html', import.meta.url)), 'utf8');

describe('/about page', () => {
  it('is a standalone static page in the route manifest', () => {
    expect(classifyRoute('/about')).toBe('standalone');
  });

  it('has one H1, a SERP-length title and description, and a self canonical', () => {
    expect(page.match(/<h1\b/g)).toHaveLength(1);
    const title = page.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
    expect(title.length).toBeLessThanOrEqual(60);
    const description = page.match(/name="description"\s+content="([^"]*)"/)?.[1] ?? '';
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(160);
    expect(page).toContain('<link rel="canonical" href="https://www.tasteslikegood.org/about" />');
  });

  it('describes its author as a Person with https sameAs profiles', () => {
    const block = page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    const ld = JSON.parse(block ?? '{}') as {
      '@type': string;
      mainEntity: { '@type': string; name: string; sameAs: string[] };
    };
    expect(ld['@type']).toBe('AboutPage');
    expect(ld.mainEntity['@type']).toBe('Person');
    expect(ld.mainEntity.name).toBe('Adam Schoen');
    expect(ld.mainEntity.sameAs.length).toBeGreaterThan(0);
    for (const url of ld.mainEntity.sameAs) expect(url).toMatch(/^https:\/\//);
  });

  it('links back into the site', () => {
    for (const href of ['href="/"', 'href="/browse"', 'href="/privacy-policy"']) {
      expect(page).toContain(href);
    }
  });
});
