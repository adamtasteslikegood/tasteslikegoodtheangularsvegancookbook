import { describe, expect, it } from 'vitest';
import { apiCatalog, API_CATALOG_CONTENT_TYPE, OPENAPI_PATH } from './api-catalog.js';

describe('apiCatalog (KAN-398)', () => {
  it('anchors each entry at a callable endpoint; the REST ones share the OpenAPI description', () => {
    const origin = 'https://www.tasteslikegood.org';
    const entry = (path: string) => ({
      anchor: `${origin}${path}`,
      'service-desc': [{ href: `${origin}${OPENAPI_PATH}`, type: 'application/json' }],
      'service-doc': [{ href: `${origin}/llms.txt`, type: 'text/plain' }],
    });
    expect(apiCatalog(origin)).toEqual({
      linkset: [
        entry('/api/public/newest-recipes'),
        entry('/api/agent/tools'),
        {
          anchor: `${origin}/mcp`,
          'service-doc': [{ href: `${origin}/llms.txt`, type: 'text/plain' }],
        },
      ],
    });
  });

  it('is the link set media type with the RFC 9727 profile', () => {
    expect(API_CATALOG_CONTENT_TYPE).toMatch(/^application\/linkset\+json; profile="/);
  });
});
