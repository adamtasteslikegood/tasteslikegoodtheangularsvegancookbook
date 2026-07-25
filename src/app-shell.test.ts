/**
 * Guards on the app shell (repo-root index.html) that no other test covers.
 *
 * KAN-159 (production, 2026-07-25): the shell shipped without a <base> element.
 * The Angular builder injects its bundles as bare filenames (main-<hash>.js),
 * which a browser resolves against the current *directory* of the document URL
 * — so a reload of /recipe/<id> requested /recipe/main-<hash>.js, missed every
 * build artifact, fell through to the Express SPA catch-all, and came back as
 * the shell itself labelled text/html. Helmet's nosniff then refused to execute
 * it, Angular never bootstrapped, and the page was blank with a dead router.
 *
 * Asserted against the source file rather than dist/: the Vitest CI job does
 * not run an Angular build, so a dist-based check would silently skip.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const shell = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

/**
 * Single left-to-right scan of the shell. The comment alternative comes first
 * and consumes whole comments, so markup *mentioned* inside one is never
 * mistaken for the real thing — this file's own <base> prose would otherwise
 * be counted. Likewise the <base …> alternative swallows its own href, so it
 * cannot also register as a URL reference.
 *
 * Deliberately a tokenizer rather than "strip comments, then match": a
 * `.replace()` that removes <!-- … --> has the shape of an HTML sanitizer
 * without being one (CodeQL js/incomplete-multi-character-sanitization flags
 * it, correctly — a single pass can leave <!-- behind on malformed input).
 */
const TOKEN_RE = /<!--[\s\S]*?-->|<base\b[^>]*>|<\/head>|(?:src|href)="([^"]*)"/g;

type Token = { kind: 'base' | 'headEnd' | 'ref'; text: string; index: number; url: string };

function scanShell(html: string): Token[] {
  const tokens: Token[] = [];
  for (const match of html.matchAll(TOKEN_RE)) {
    const text = match[0];
    const index = match.index ?? 0;
    if (text.startsWith('<!--')) continue;
    if (text.startsWith('<base')) tokens.push({ kind: 'base', text, index, url: '' });
    else if (text.startsWith('</head')) tokens.push({ kind: 'headEnd', text, index, url: '' });
    else tokens.push({ kind: 'ref', text, index, url: match[1] ?? '' });
  }
  return tokens;
}

const tokens = scanShell(shell);
const baseTags = tokens.filter((t) => t.kind === 'base');

// A URL that is neither absolute nor already root-anchored resolves against the
// document's directory — the exact bug this file guards.
const isDirectoryRelative = (url: string): boolean =>
  !/^(?:https?:)?\/\//.test(url) && !url.startsWith('/') && !/^(?:#|data:|mailto:)/.test(url);

describe('app shell <base href>', () => {
  it('declares exactly one base element, anchored at the site root', () => {
    expect(baseTags).toHaveLength(1);
    expect(baseTags[0].text).toMatch(/href="\/"/);
  });

  it('places it before anything that resolves a relative URL', () => {
    expect(baseTags).toHaveLength(1);
    const baseIndex = baseTags[0].index;

    // Vacuous today — every URL in the source shell is absolute or
    // root-anchored. It is a forward guard: adding a bare-filename asset above
    // <base> would reintroduce the directory-relative resolution bug.
    const relative = tokens.filter((t) => t.kind === 'ref' && isDirectoryRelative(t.url));
    for (const ref of relative) {
      expect(ref.index).toBeGreaterThan(baseIndex);
    }
  });

  it('keeps the base element inside the head', () => {
    expect(baseTags).toHaveLength(1);
    const headEnd = tokens.find((t) => t.kind === 'headEnd');
    expect(headEnd).toBeDefined();
    expect(baseTags[0].index).toBeLessThan(headEnd!.index);
  });
});
