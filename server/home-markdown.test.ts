import { describe, expect, it } from 'vitest';
import { acceptsMarkdown, renderHomeMarkdown } from './home-markdown.js';

describe('acceptsMarkdown', () => {
  it.each([
    ['text/markdown', true],
    ['text/html, text/markdown;q=0.5', true],
    ['TEXT/Markdown ; Q=1', true],
    [undefined, false],
    ['', false],
    ['*/*', false],
    ['text/*', false],
    ['text/html', false],
    ['text/markdown;q=0', false],
    ['text/markdown;q=0.0', false],
    ['text/markdown;q=abc', false],
  ])('%s → %s', (accept, expected) => {
    expect(acceptsMarkdown(accept)).toBe(expected);
  });
});

describe('renderHomeMarkdown', () => {
  it('is the guide alone when there is no list', () => {
    expect(renderHomeMarkdown('# Guide\n\n', [])).toBe('# Guide\n');
  });

  it('adds the newest recipes as links, with brackets in a name escaped', () => {
    expect(renderHomeMarkdown('# Guide\n', [{ slug: 'a-b', name: 'A [b](x)' }])).toBe(
      '# Guide\n\n## Newest vegan recipes\n\n- [A \\[b\\](x)](/r/a-b)\n'
    );
  });
});
