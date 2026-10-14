import { describe, expect, it } from 'vitest';
import { apiCatalog, API_CATALOG_CONTENT_TYPE, OPENAPI_PATH } from './api-catalog.js';

describe('apiCatalog (KAN-398)', () => {
  it('links the OpenAPI description and llms.txt under the given origin', () => {
    expect(apiCatalog('https://www.tasteslikegood.org')).toEqual({
      linkset: [
        {
          anchor: 'https://www.tasteslikegood.org/api/public',
          'service-desc': [
            {
              href: `https://www.tasteslikegood.org${OPENAPI_PATH}`,
              type: 'application/vnd.oai.openapi+json',
            },
          ],
          'service-doc': [{ href: 'https://www.tasteslikegood.org/llms.txt', type: 'text/plain' }],
        },
      ],
    });
  });

  it('is the link set media type with the RFC 9727 profile', () => {
    expect(API_CATALOG_CONTENT_TYPE).toMatch(/^application\/linkset\+json; profile="/);
  });
});
