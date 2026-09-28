import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { standalonePageHref } from './footer.component';

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
