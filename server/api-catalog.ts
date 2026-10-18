// The API catalog at /.well-known/api-catalog (RFC 9727, KAN-398).
//
// One fixed place where an agent finds what the site offers a program: the
// public endpoints, the OpenAPI description Flask serves for them, and the MCP
// endpoint. The catalog is a link set (RFC 9264), so it carries no API detail
// of its own and cannot drift from Flask's.

/** RFC 9727 section 4.2: the link set format, with the catalog profile. */
export const API_CATALOG_CONTENT_TYPE =
  'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';

export const API_CATALOG_PATH = '/.well-known/api-catalog';
export const OPENAPI_PATH = '/api/public/openapi.json';
export const MCP_PATH = '/mcp';

/** RFC 9727 section 2: sent with the catalog, so a HEAD request finds it too. */
export const API_CATALOG_LINK = `<${API_CATALOG_PATH}>; rel="api-catalog"`;

/**
 * The endpoints the catalog lists. RFC 9727 section 4.1 requires links to
 * API endpoints, so each entry is anchored at one a program can call with a
 * plain GET (Appendix A.1), and each points at the same OpenAPI description
 * for the rest. The recipe endpoint takes a slug, so it is found from there.
 */
export const API_CATALOG_ENDPOINTS = ['/api/public/newest-recipes', '/api/agent/tools'];

/** The catalog for a site at `origin` (scheme and host, no trailing slash). */
export function apiCatalog(origin: string): unknown {
  const serviceDoc = [{ href: `${origin}/llms.txt`, type: 'text/plain' }];
  return {
    linkset: [
      ...API_CATALOG_ENDPOINTS.map((path) => ({
        anchor: `${origin}${path}`,
        // The type Flask sends; `application/vnd.oai.openapi+json` would only be a hint
        // that the response contradicts.
        'service-desc': [{ href: `${origin}${OPENAPI_PATH}`, type: 'application/json' }],
        'service-doc': serviceDoc,
      })),
      // The MCP endpoint (KAN-399) describes itself: an MCP client asks it for
      // its tools. The OpenAPI document does not cover it, so no service-desc.
      { anchor: `${origin}${MCP_PATH}`, 'service-doc': serviceDoc },
    ],
  };
}
