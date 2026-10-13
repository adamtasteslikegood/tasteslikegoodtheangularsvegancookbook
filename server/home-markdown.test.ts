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
  it('keeps a hostile name on one line, as text', () => {
    const name = 'Stew <img src=x onerror=alert(1)>\n## Fake &lt;b&gt; *bold* `code` a_b';
    expect(renderHomeMarkdown('# Guide\n', [{ slug: 'stew', name }])).toBe(
      '# Guide\n\n## Newest vegan recipes\n\n' +
        '- [Stew \\<img src=x onerror=alert(1)\\> ## Fake \\&lt;b\\&gt; \\*bold\\* \\`code\\` a\\_b](/r/stew)\n'
    );
  });

  it('leaves a plain ampersand alone', () => {
    expect(renderHomeMarkdown('# Guide\n', [{ slug: 'mac', name: 'Mac & Cheeze' }])).toContain(
      '- [Mac & Cheeze](/r/mac)'
    );
  });
});
