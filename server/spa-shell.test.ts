/**
 * The route-neutral shell parse shared by the runtime catch-all and the
 * post-build check (KAN-272, KAN-285). routes.test.ts covers it end to end
 * through Express; this pins the parse itself, including the failure modes
 * `npm run build` relies on to fail closed.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRouteNeutralSpaShell } from './spa-shell.js';

const HEAD_START = '<meta name="tlg-home-head-start" content="">';
const HEAD_END = '<meta name="tlg-home-head-end" content="">';
const shell = (head: string, body: string) =>
  `<!doctype html><html><head><link rel="icon" href="/favicon.svg">${head}</head><body>${body}</body></html>`;
const HOME_HEAD = `${HEAD_START}<title>Home</title><link rel="canonical" href="/">${HEAD_END}`;
const APP_ROOT = '<app-root ng-version="22.1.0"><h1>home-landing</h1></app-root>';

describe('buildRouteNeutralSpaShell', () => {
  it('replaces the home head block and strips the <app-root> children', () => {
    expect(buildRouteNeutralSpaShell(shell(HOME_HEAD, APP_ROOT), 'noindex, follow')).toBe(
      shell(
        '<title>TastesLikeGood</title><meta name="robots" content="noindex, follow" />',
        '<app-root ng-version="22.1.0"></app-root>'
      )
    );
  });

  it('tolerates minifier-style sentinels (unquoted, self-closing, reordered)', () => {
    const head =
      '<meta content="" name=tlg-home-head-start /><title>Home</title>' +
      "<meta content='' name='tlg-home-head-end'>";
    const out = buildRouteNeutralSpaShell(shell(head, APP_ROOT), 'noindex, follow');
    expect(out).not.toContain('Home</title>');
    expect(out).not.toContain('home-landing');
  });

  it('does not treat a sentinel-prefixed name as the sentinel', () => {
    const head = '<meta name="tlg-home-head-start-social" content="">' + HOME_HEAD;
    const out = buildRouteNeutralSpaShell(shell(head, APP_ROOT), 'noindex, follow');
    expect(out).toContain('tlg-home-head-start-social');
    expect(out).not.toContain('Home</title>');
  });

  it('throws when the start sentinel is missing', () => {
    const head = `<title>Home</title>${HEAD_END}`;
    expect(() => buildRouteNeutralSpaShell(shell(head, APP_ROOT), 'noindex')).toThrow(
      /head sentinels/
    );
  });

  it('throws when the end sentinel is missing', () => {
    const head = `${HEAD_START}<title>Home</title>`;
    expect(() => buildRouteNeutralSpaShell(shell(head, APP_ROOT), 'noindex')).toThrow(
      /head sentinels/
    );
  });

  it('throws when <app-root> is missing', () => {
    expect(() => buildRouteNeutralSpaShell(shell(HOME_HEAD, '<main></main>'), 'noindex')).toThrow(
      /app-root/
    );
  });

  it('accepts the checked-in index.html', () => {
    const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const out = buildRouteNeutralSpaShell(source, 'noindex, follow');
    expect(out).toContain('<meta name="robots" content="noindex, follow" />');
    expect(out).not.toMatch(/tlg-home-head-(start|end)["'\s/>]/);
  });
});
