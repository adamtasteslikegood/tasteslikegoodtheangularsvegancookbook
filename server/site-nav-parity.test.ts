/**
 * Header + footer nav parity across every page chrome the site serves (KAN-294).
 *
 * The canonical link set is src/site-nav.json. This file asserts that the
 * chromes rendered from checked-in files carry exactly that set, in order:
 *
 *   - the SPA header (src/components/header/header.component.html)
 *   - the standalone Express pages (/about, /privacy-policy)
 *   - the Flask SSR base template (Backend/templates/public/base_public.html),
 *     which every /r/<slug>, /browse and /browse/tag/<slug> page extends
 *
 * The SPA footer renders the manifest by construction; its own test is in
 * src/components/footer/footer.component.test.ts.
 *
 * The SSR half is a LOCAL check, not a CI gate: the Vitest job checks out
 * without submodules, so Backend/ is empty there and that case is skipped.
 * It is also skipped when Backend/ is checked out at a SHA older than the
 * KAN-294 template (no tests/test_public_nav_parity.py): the gitlink moves
 * only at release, so between merge and the next pin a fresh checkout of dev
 * carries the old template, and failing every contributor's `npm test` there
 * would gate nothing the Backend test does not already gate.
 * The CI gate for the SSR side is Backend's tests/test_public_nav_parity.py,
 * which renders the real pages and, when run inside this superproject (the
 * backend-test job uses `submodules: recursive`), compares against this same
 * manifest. That half goes live once a Backend SHA carrying it is pinned.
 *
 * A link is (href, label): label is the anchor's aria-label when it has one
 * (the brand, whose visible content is an icon plus the wordmark), otherwise
 * its visible text. Sign-in state is deliberately not part of the set: SSR
 * cannot know it, and the SPA's Sign In / profile control is a button.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyRoute } from './route-manifest.js';

type Link = { href: string; label: string };
type SiteNav = { header: Link[]; footer: Link[] };

const repoFile = (relative: string): string =>
  fileURLToPath(new URL(`../${relative}`, import.meta.url));
const read = (relative: string): string => readFileSync(repoFile(relative), 'utf8');

const siteNav = JSON.parse(read('src/site-nav.json')) as SiteNav;

/** The standalone pages link to SSR/standalone routes by absolute URL so the
 * links survive `npm run dev`; compare them by path. */
const ORIGIN = 'https://www.tasteslikegood.org';
const toPath = (href: string): string =>
  href.startsWith(`${ORIGIN}/`) ? href.slice(ORIGIN.length) : href;

/** Contents of the first <tag …>…</tag> element. None of the parsed files nest
 * a same-named element inside their site header or footer. */
function region(html: string, tag: 'header' | 'footer'): string {
  const open = html.match(new RegExp(`<${tag}\\b[^>]*>`));
  if (!open || open.index === undefined) throw new Error(`no <${tag}> element`);
  const start = open.index + open[0].length;
  const end = html.indexOf(`</${tag}>`, start);
  if (end === -1) throw new Error(`unclosed <${tag}>`);
  return html.slice(start, end);
}

const attr = (attrs: string, name: string): string | undefined =>
  attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];

type ParsedLink = Link & { routerLink: boolean };

/**
 * Anchors in a fragment, in document order. A single left-to-right scan whose
 * comment alternatives (HTML and Jinja) consume whole comments, so an anchor
 * mentioned inside one is never counted — the same tokenizer shape as
 * app-shell.test.ts, for the same CodeQL reason.
 */
function anchors(fragment: string): ParsedLink[] {
  const TOKEN_RE = /<!--[\s\S]*?-->|\{#[\s\S]*?#\}|<a\b([^>]*)>([\s\S]*?)<\/a>/g;
  const links: ParsedLink[] = [];
  for (const match of fragment.matchAll(TOKEN_RE)) {
    const attrs = match[1];
    if (attrs === undefined) continue; // a comment
    const routerLink = attr(attrs, 'routerLink');
    const href = routerLink ?? attr(attrs, 'href') ?? '';
    // Visible text: the segments between tags, minus Angular interpolation
    // and control-flow lines (the kitchen badge's `@if (…) {` / `}`).
    const text = match[2]
      .split(/<[^>]*>|\n/)
      .map((segment) => segment.trim())
      .filter((s) => s && !s.startsWith('@') && !s.startsWith('{{') && s !== '}')
      .join(' ');
    links.push({
      href: toPath(href),
      label: attr(attrs, 'aria-label') ?? text,
      routerLink: routerLink !== undefined,
    });
  }
  return links;
}

const pairs = (links: ParsedLink[]): Link[] => links.map(({ href, label }) => ({ href, label }));

describe('site nav manifest (src/site-nav.json)', () => {
  it('has a header and a footer, and every link is a live route', () => {
    expect(siteNav.header.length).toBeGreaterThan(0);
    expect(siteNav.footer.length).toBeGreaterThan(0);
    for (const { href, label } of [...siteNav.header, ...siteNav.footer]) {
      expect(label.trim(), href).not.toBe('');
      expect(['spa', 'ssr', 'standalone'], href).toContain(classifyRoute(href));
    }
  });
});

describe('SPA header', () => {
  const links = anchors(region(read('src/components/header/header.component.html'), 'header'));

  it('renders exactly the canonical header set, in order', () => {
    expect(pairs(links)).toEqual(siteNav.header);
  });

  it('uses routerLink only for SPA routes, so SSR and standalone links do full navigations', () => {
    // A routerLink to /browse would be resolved by the Angular router, whose
    // wildcard redirects to "/", instead of reaching the Flask page Express
    // proxies before the SPA catch-all.
    for (const link of links) {
      expect(link.routerLink, link.href).toBe(classifyRoute(link.href) === 'spa');
    }
  });
});

describe.each(['server/public/about.html', 'server/public/privacy-policy.html'])(
  'standalone page %s',
  (file) => {
    const page = read(file);

    it('renders exactly the canonical header set, in order', () => {
      expect(pairs(anchors(region(page, 'header')))).toEqual(siteNav.header);
    });

    it('renders exactly the canonical footer set, in order', () => {
      expect(pairs(anchors(region(page, 'footer')))).toEqual(siteNav.footer);
    });
  }
);

const SSR_BASE = 'Backend/templates/public/base_public.html';

// Present only in a Backend checkout that carries the parity work.
const BACKEND_PARITY_TEST = 'Backend/tests/test_public_nav_parity.py';

describe.skipIf(!existsSync(repoFile(BACKEND_PARITY_TEST)))(
  `SSR base template (${SSR_BASE}; local only — skipped when Backend/ is absent, as in CI, ` +
    'or checked out at a pre-KAN-294 SHA; the pointer moves at release)',
  () => {
    const template = () => read(SSR_BASE);

    it('renders exactly the canonical header set, in order', () => {
      expect(pairs(anchors(region(template(), 'header')))).toEqual(siteNav.header);
    });

    it('renders exactly the canonical footer set, in order', () => {
      expect(pairs(anchors(region(template(), 'footer')))).toEqual(siteNav.footer);
    });
  }
);
