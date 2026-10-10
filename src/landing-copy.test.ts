/**
 * Home page as the "vegan recipe generator" landing page (KAN-272).
 *
 * The landing copy lives in src/components/generator/landing-copy.ts and is
 * rendered twice: by GeneratorComponent (the rendered DOM Google indexes) and
 * as static HTML inside <app-root> in the root index.html (server HTML: what
 * non-JS crawlers, unfurlers and the first paint see). The FAQPage JSON-LD
 * repeats the FAQ. These tests fail when any copy drifts from the module, and
 * pin the SERP-length and social-card fixes from the SEO audit 2026-09-13.
 *
 * Asserted against source files, like app-shell.test.ts: CI runs no Angular
 * build, so a dist-based check would silently skip.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  LANDING_FAQ,
  LANDING_H1,
  LANDING_HUBS,
  LANDING_HUBS_HEADING,
  LANDING_INTRO,
  LANDING_LEAD,
  LANDING_STEPS,
} from './components/generator/landing-copy';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const shell = read('../index.html');
const generatorTemplate = read('./components/generator/generator.component.html');
const headerTemplate = read('./components/header/header.component.html');

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&#39;': "'",
  '&quot;': '"',
  '&rarr;': '→',
  '&lt;': '<',
  '&gt;': '>',
};
const decode = (text: string): string =>
  text.replace(/&(?:amp|#39|quot|rarr|lt|gt);/g, (entity) => ENTITIES[entity]);
const squash = (text: string): string => decode(text).replace(/\s+/g, ' ').trim();

/**
 * Text content of an HTML fragment, comments and tags skipped. A tokenizer
 * rather than tag-stripping .replace() calls, for the reason app-shell.test.ts
 * gives (CodeQL js/incomplete-multi-character-sanitization).
 */
function textOf(html: string): string {
  const parts: string[] = [];
  for (const match of html.matchAll(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g)) {
    if (!match[0].startsWith('<')) parts.push(match[0]);
  }
  return squash(parts.join(' '));
}

/** Markup with comments removed, by the same tokenizing approach. */
function withoutComments(html: string): string {
  const parts: string[] = [];
  for (const match of html.matchAll(/<!--[\s\S]*?-->|[^<]+|</g)) {
    if (!match[0].startsWith('<!--')) parts.push(match[0]);
  }
  return parts.join('');
}

const liveShell = withoutComments(shell);
const appRoot = liveShell.match(/<app-root>([\s\S]*?)<\/app-root>/)?.[1] ?? '';
const appRootText = textOf(appRoot);

const meta = (attr: 'name' | 'property', key: string): string | undefined => {
  const value = liveShell.match(new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`))?.[1];
  return value === undefined ? undefined : decode(value);
};

const jsonLdBlocks = [
  ...liveShell.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
].map((m) => JSON.parse(m[1]) as Record<string, unknown>);

/** Width and height from a baseline or progressive JPEG's SOF marker. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  const u16 = (at: number): number => (bytes[at] << 8) | bytes[at + 1];
  let offset = 2;
  while (offset < bytes.length) {
    const marker = bytes[offset + 1];
    const length = u16(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: u16(offset + 5), width: u16(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error('no SOF marker');
}

describe('home page SERP snippet (KAN-272)', () => {
  it('has a title that fits a result line and names the query', () => {
    const title = decode(liveShell.match(/<title>([^<]*)<\/title>/)?.[1] ?? '');
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.toLowerCase()).toContain('vegan recipe generator');
  });

  it('has a description that is not truncated', () => {
    const description = meta('name', 'description') ?? '';
    expect(description.length).toBeGreaterThanOrEqual(120);
    expect(description.length).toBeLessThanOrEqual(160);
  });
});

describe('home page server HTML (KAN-272)', () => {
  it('has exactly one H1, and it is the landing H1', () => {
    const h1s = [...liveShell.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
    expect(h1s).toHaveLength(1);
    expect(squash(h1s[0][1])).toBe(LANDING_H1);
    expect(LANDING_H1.toLowerCase()).toContain('vegan recipe generator');
  });

  it('carries enough visible copy to rank (>= 150 words)', () => {
    expect(appRootText.split(' ').length).toBeGreaterThanOrEqual(150);
  });

  it('mirrors every piece of landing copy from landing-copy.ts', () => {
    const expected = [
      LANDING_LEAD,
      ...LANDING_INTRO,
      ...LANDING_STEPS.flatMap((step) => [step.title, step.text]),
      ...LANDING_FAQ.flatMap((item) => [item.question, item.answer]),
    ];
    for (const text of expected) expect(appRootText).toContain(squash(text));
  });

  it('links every tag hub from the first HTML response, in manifest order (KAN-319)', () => {
    expect(appRootText).toContain(LANDING_HUBS_HEADING);
    const hubLinks = [
      ...appRoot.matchAll(/<a\b[^>]*\bhref="(\/browse\/tag\/[^"]+)"[^>]*>([^<]*)</g),
    ];
    expect(hubLinks.map((m) => ({ href: m[1], label: squash(m[2]) }))).toEqual(LANDING_HUBS);
    expect(LANDING_HUBS.length).toBeGreaterThanOrEqual(6);
  });

  it('keeps the noscript recipe links outside <app-root>', () => {
    expect(liveShell).toMatch(/<\/app-root>\s*<noscript>/);
  });
});

describe('home page structured data (KAN-272)', () => {
  it('has a FAQPage whose questions and answers are exactly the visible FAQ', () => {
    const faq = jsonLdBlocks.find((block) => block['@type'] === 'FAQPage');
    expect(faq).toBeDefined();
    const entities = faq!.mainEntity as { name: string; acceptedAnswer: { text: string } }[];
    expect(entities.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(
      LANDING_FAQ.map((item) => [item.question, item.answer])
    );
  });

  it('no longer advertises the dead /?q= SearchAction', () => {
    expect(JSON.stringify(jsonLdBlocks)).not.toContain('SearchAction');
  });
});

describe('home page social cards (KAN-272)', () => {
  const OG_URL = 'https://www.tasteslikegood.org/og-home.jpg';

  it('points og:image and twitter:image at a raster, not the SVG favicon', () => {
    expect(meta('property', 'og:image')).toBe(OG_URL);
    expect(meta('name', 'twitter:image')).toBe(OG_URL);
    expect(meta('property', 'og:image:width')).toBe('1200');
    expect(meta('property', 'og:image:height')).toBe('630');
  });

  it('ships that image in public/ at 1200x630', () => {
    const file = fileURLToPath(new URL('../public/og-home.jpg', import.meta.url));
    expect(existsSync(file)).toBe(true);
    expect(jpegSize(readFileSync(file))).toEqual({ width: 1200, height: 630 });
  });
});

describe('route-neutral shell sentinels (KAN-272)', () => {
  // server/index.ts strips the head between these sentinels and empties
  // <app-root> for every non-home route; without them it falls back to the
  // full home shell. Guard the source so that fallback never ships.
  it('wraps the home-only head in both sentinels, in order, around the canonical', () => {
    const start = liveShell.indexOf('name="tlg-home-head-start"');
    const canonical = liveShell.indexOf('rel="canonical"');
    const end = liveShell.indexOf('name="tlg-home-head-end"');
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(canonical);
    expect(canonical).toBeLessThan(end);
  });

  it('keeps the site-wide favicon outside the sentinels', () => {
    expect(liveShell.indexOf('rel="icon"')).toBeLessThan(
      liveShell.indexOf('name="tlg-home-head-start"')
    );
  });
});

describe('rendered DOM (KAN-272)', () => {
  it('renders the landing H1 from the copy module in the generator', () => {
    expect(generatorTemplate).toMatch(/<h1\b[^>]*>\s*\{\{\s*landing\.h1\s*\}\}\s*<\/h1>/);
    // Every field renders from the module, so no stale hardcoded copy can
    // stand in for one of them.
    for (const binding of [
      'landing.lead',
      'landing.intro',
      'landing.steps',
      'landing.faq',
      'landing.hubsHeading',
      'landing.hubs',
    ]) {
      expect(generatorTemplate).toContain(binding);
    }
  });

  it('leaves the H1 to the page: the site header has none', () => {
    expect(withoutComments(headerTemplate)).not.toMatch(/<h1\b/);
  });

  it('navigates with real anchors, including a link to /browse', () => {
    const header = withoutComments(headerTemplate);
    expect(header).not.toContain('switchView');
    expect(header).toMatch(/<a\s[^>]*routerLink="\/"/);
    expect(header).toMatch(/<a\s[^>]*routerLink="\/kitchen"/);
    expect(header).toMatch(/<a\s[^>]*href="\/browse"/);
  });
});
