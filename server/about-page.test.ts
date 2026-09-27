/**
 * /about (KAN-272, SEO audit 2026-09-13 C5): who makes the site and why.
 *
 * Asserted against the checked-in file so metadata, structured data, and
 * accessibility regressions are covered directly. The live Express route is
 * covered separately in routes.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyRoute } from './route-manifest.js';

const page = readFileSync(fileURLToPath(new URL('./public/about.html', import.meta.url)), 'utf8');

function cssColor(name: string): string {
  return page.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1] ?? '';
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((value) => parseInt(value, 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  if (!channels || channels.length !== 3) return Number.NaN;
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

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

  it('pairs its large-image card with a 1200x630 og:image', () => {
    expect(page).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(page).toContain(
      '<meta property="og:image" content="https://www.tasteslikegood.org/og-home.jpg" />'
    );
    expect(page).toContain('<meta property="og:image:width" content="1200" />');
    expect(page).toContain('<meta property="og:image:height" content="630" />');
  });

  it('uses WCAG AA contrast for links and secondary headings', () => {
    expect(contrastRatio(cssColor('light-green'), cssColor('bg'))).toBeGreaterThanOrEqual(4.5);
  });

  it('links back into the site', () => {
    for (const href of ['href="/"', 'href="/browse"', 'href="/privacy-policy"']) {
      expect(page).toContain(href);
    }
  });
});
