/**
 * KAN-431: /about and /privacy-policy each have a hand-written Markdown form
 * next to their HTML page. Two copies of the same text drift, so this checks
 * the parts that must agree: the title, the section headings in order, and
 * the privacy policy's "Last updated" date. The wording in between is still
 * kept in step by hand.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (file: string): string =>
  readFileSync(fileURLToPath(new URL(`./public/${file}`, import.meta.url)), 'utf8');

const ENTITIES: Record<string, string> = { mdash: '—', amp: '&', nbsp: ' ' };

/** A heading's text, entities decoded in one pass. Headings here hold no tags. */
function htmlHeadings(html: string): string[] {
  return [...html.matchAll(/<h([1-3])\b[^>]*>([^<]*)<\/h\1>/g)].map(([, level, text]) => {
    const plain = text.replace(/&(mdash|amp|nbsp);/g, (_, name: string) => ENTITIES[name]);
    return `${'#'.repeat(Number(level))} ${plain.replace(/\s+/g, ' ').trim()}`;
  });
}

function markdownHeadings(markdown: string): string[] {
  return markdown
    .split('\n')
    .filter((line) => /^#{1,3} /.test(line))
    .map((line) => line.replace(/\\#/g, '#').trim());
}

describe.each(['about', 'privacy-policy'])('%s Markdown', (name) => {
  const html = read(`${name}.html`);
  const markdown = read(`${name}.md`);

  it('has the same headings, in the same order, as the HTML page', () => {
    // Every heading is read: one holding a tag would not match and is caught here.
    expect(htmlHeadings(html)).toHaveLength(html.match(/<h[1-3]\b/g)?.length ?? 0);
    expect(markdownHeadings(markdown)).toEqual(htmlHeadings(html));
  });

  it('is plain Markdown: its only angle brackets are email autolinks', () => {
    for (const [token] of markdown.matchAll(/<[^>\n]*>/g)) {
      expect(token).toMatch(/^<[\w.+-]+@[\w.-]+>$/);
    }
  });
});

describe('privacy-policy Markdown', () => {
  it('carries the same "Last updated" date as the HTML page', () => {
    const date = /Last updated: ([A-Z][a-z]+ \d{1,2}, \d{4})/;
    const htmlDate = read('privacy-policy.html').match(date)?.[1];
    expect(htmlDate).toBeTruthy();
    expect(read('privacy-policy.md').match(date)?.[1]).toBe(htmlDate);
  });
});
