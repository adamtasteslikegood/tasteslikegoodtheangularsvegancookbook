import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { footerLinks, standalonePageHref } from './footer.component';

describe('footer standalone-page links', () => {
  it('uses extensionless Express routes in production', () => {
    expect(standalonePageHref('/about', true)).toBe('/about');
    expect(standalonePageHref('/privacy-policy', true)).toBe('/privacy-policy');
  });

  it('uses Angular development assets under npm run dev', () => {
    expect(standalonePageHref('/about', false)).toBe('/about.html');
    expect(standalonePageHref('/privacy-policy', false)).toBe('/privacy-policy.html');

    const workspace = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../angular.json', import.meta.url)), 'utf8')
    ) as {
      projects: {
        app: {
          architect: {
            build: {
              configurations: {
                development: { assets: Array<{ glob: string; input: string }> };
              };
            };
          };
        };
      };
    };

    expect(workspace.projects.app.architect.build.configurations.development.assets).toContainEqual(
      {
        glob: '*.html',
        input: 'server/public',
      }
    );
  });
});

describe('footer nav parity (KAN-294)', () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../site-nav.json', import.meta.url)), 'utf8')
  ) as { footer: Array<{ href: string; label: string }> };

  it('renders exactly the canonical footer set from src/site-nav.json, in order', () => {
    expect(footerLinks(true)).toEqual(manifest.footer);
  });

  it('keeps dev-only .html hrefs for the standalone pages under npm run dev', () => {
    expect(footerLinks(false).map((link) => link.href)).toEqual(
      manifest.footer.map(({ href }) =>
        href === '/about' || href === '/privacy-policy' ? `${href}.html` : href
      )
    );
  });

  it('has no hand-written anchors outside the manifest loop', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./footer.component.ts', import.meta.url)),
      'utf8'
    );
    expect(source).toContain('@for (link of links;');
    expect(source.match(/<a\b/g)).toHaveLength(1);
  });
});
