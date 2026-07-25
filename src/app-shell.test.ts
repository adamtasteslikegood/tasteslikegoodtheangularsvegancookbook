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

// Prose in comments mentions the element by name; only real markup counts.
const markup = shell.replace(/<!--[\s\S]*?-->/g, '');

describe('app shell <base href>', () => {
  it('declares exactly one base element, anchored at the site root', () => {
    const baseTags = markup.match(/<base\b[^>]*>/g) ?? [];
    expect(baseTags).toHaveLength(1);
    expect(baseTags[0]).toMatch(/href="\/"/);
  });

  it('places it before anything that resolves a relative URL', () => {
    const baseIndex = markup.search(/<base\b/);
    expect(baseIndex).toBeGreaterThan(-1);

    // Any src=/href= that is not absolute (https://, //host) and not already
    // root-anchored would resolve against the document directory, so it has to
    // sit after <base> to be anchored correctly.
    const relativeRefRe = /(?:src|href)="(?!https?:\/\/|\/\/|\/|#|data:|mailto:)[^"]+"/g;
    for (const match of markup.matchAll(relativeRefRe)) {
      expect(match.index).toBeGreaterThan(baseIndex);
    }
  });

  it('keeps the base element inside the head', () => {
    const headEnd = markup.indexOf('</head>');
    expect(headEnd).toBeGreaterThan(-1);

    const baseIndex = markup.search(/<base\b/);
    // Guard the vacuous pass: search() returns -1 when absent, which would
    // otherwise satisfy "before </head>" without a base element existing.
    expect(baseIndex).toBeGreaterThan(-1);
    expect(baseIndex).toBeLessThan(headEnd);
  });
});
