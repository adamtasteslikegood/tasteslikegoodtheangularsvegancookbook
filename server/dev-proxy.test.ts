import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const proxyConfig = JSON.parse(
  readFileSync(fileURLToPath(new URL('../proxy.conf.json', import.meta.url)), 'utf8')
) as Record<string, { target?: string }>;

describe('Angular development proxy', () => {
  it('forwards the complete Flask-rendered surface to Flask', () => {
    for (const path of ['/browse', '/sitemap.xml', '/r/', '/static']) {
      expect(proxyConfig[path]?.target).toBe('http://localhost:5000');
    }
  });
});
