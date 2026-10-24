import express, { type Express } from 'express';
import compression from 'compression';
import { readFile } from 'node:fs/promises';
import { constants as zlibConstants } from 'node:zlib';
import path from 'node:path';
import { createFlaskProxy } from './proxy.js';
import { buildRouteNeutralSpaShell } from './spa-shell.js';
import { staticCacheControl } from './static-cache.js';
import {
  createFailureLogGate,
  createNewestRecipesSource,
  injectNewestRecipes,
} from './newest-recipes.js';
import {
  API_CATALOG_CONTENT_TYPE,
  API_CATALOG_LINK,
  API_CATALOG_PATH,
  apiCatalog,
} from './api-catalog.js';
import { MARKDOWN_CONTENT_TYPE, acceptsMarkdown, renderHomeMarkdown } from './home-markdown.js';

export function mountCanonicalHostRedirect(app: Express): void {
  // ── Canonical-host redirect (issue #3164) ───────────────────────
  // www.tasteslikegood.org is the canonical host: every canonical URL,
  // sitemap entry, and robots.txt line declares www, but the apex served
  // identical 200s, splitting indexing signals across two hosts. Redirect
  // the apex to www for ALL paths, before any other route. req.hostname
  // honors X-Forwarded-Host ('trust proxy' is set above), which is how
  // Cloud Run traffic arrives. Non-production hosts (localhost, *.run.app)
  // pass through. 301 for GET/HEAD (SEO-canonical), 308 otherwise so
  // clients preserve the method and body instead of downgrading to GET.
  const CANONICAL_ORIGIN = 'https://www.tasteslikegood.org';
  app.use((req, res, next) => {
    if (req.hostname === 'tasteslikegood.org') {
      // Re-parse the request path against the fixed canonical origin and
      // refuse to leave it: a crafted path like //evil.com would otherwise
      // resolve protocol-relative and turn this into an open redirect.
      let target: URL;
      try {
        target = new URL(req.originalUrl, CANONICAL_ORIGIN);
      } catch {
        target = new URL(CANONICAL_ORIGIN + '/');
      }
      if (target.origin !== CANONICAL_ORIGIN) {
        target = new URL(CANONICAL_ORIGIN + '/');
      }
      const status = req.method === 'GET' || req.method === 'HEAD' ? 301 : 308;
      res.redirect(status, target.href);
      return;
    }
    next();
  });
}

export function mountStagingMiddleware(app: Express, isStaging: boolean): void {
  // ── Staging: non-indexable (KAN-182) ──────────────────────────────
  // When NODE_ENV=staging, tell crawlers not to index any page and serve
  // a deny-all robots.txt. X-Robots-Tag covers every response (HTML, SSR
  // proxied pages, API JSON) without needing to rewrite HTML bodies.
  if (isStaging) {
    // Header middleware first: registering the robots.txt route before it
    // would leave that one response without the X-Robots-Tag header.
    app.use((_req, res, next) => {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      next();
    });
    app.get('/robots.txt', (_req, res) => {
      res.type('text/plain').send('User-agent: *\nDisallow: /\n');
    });
  }
}

export function mountHealthAndCompression(
  app: Express,
  isStaging: boolean,
  hasValkey: boolean
): void {
  // Health check (local to Express — handled before the proxy)
  app.get('/api/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: isStaging ? 'staging' : process.env.NODE_ENV || 'development',
      rateLimitStore: hasValkey ? 'valkey' : 'memory',
    });
  });

  // ── Rate limiters (before proxy so they protect Flask) ──────────
  // KAN-362: compress text responses (JS, CSS, HTML, JSON), both what Express
  // serves and what it proxies from Flask. Nothing upstream compresses: the
  // 914 kB main bundle went out as is and was the whole mobile home LCP.
  // Mounted before every route that produces a body. The default filter only
  // touches compressible content types, so recipe images pass through, and it
  // leaves any response that already carries a Content-Encoding alone.
  //
  // Brotli quality 5, up from the library's 4: at 4 the main bundle came out
  // larger than gzip's (256 kB against 252 kB). At 5 it is 237 kB for the same
  // CPU time as gzip (about 26 ms for the whole bundle, measured 2026-10-11).
  app.use(
    compression({
      brotli: { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } },
    })
  );
}

export function createRouteNeutralSpaShellGetter(
  spaIndexPath: string,
  isStaging: boolean
): () => Promise<string> {
  // index.html contains useful static landing copy for the canonical home page,
  // but the same file is also the fallback for /kitchen and /recipe/:id.
  // Derive and cache a route-neutral form only if the catch-all is reached.
  // Keeping this lazy preserves existing test/server startup behavior when no
  // built SPA exists yet, while direct non-home loads never expose home copy.
  let routeNeutralSpaShellPromise: Promise<string> | undefined;
  return (): Promise<string> => {
    if (routeNeutralSpaShellPromise) return routeNeutralSpaShellPromise;
    // Wrap the parse so a transient readFile failure or a build that ships
    // without the sentinels does not poison the cache: on rejection, clear
    // the memo so the next request retries instead of 500ing forever.
    const neutralRobots = isStaging ? 'noindex, nofollow' : 'noindex, follow';
    const attempt = readFile(spaIndexPath, 'utf8').then((fullSpaShell) =>
      // The parse lives in spa-shell.ts so `npm run build` can run the same
      // one against the built index.html and fail closed (KAN-285).
      buildRouteNeutralSpaShell(fullSpaShell, neutralRobots)
    );
    routeNeutralSpaShellPromise = attempt.catch((err) => {
      routeNeutralSpaShellPromise = undefined;
      throw err;
    });
    return routeNeutralSpaShellPromise;
  };
}

export function mountPublicAndSsrRoutes(
  app: Express,
  opts: {
    distPath: string;
    publicPath: string;
    spaIndexPath: string;
    flaskUrl: string;
    staticPageLimiter: express.RequestHandler;
  }
): { preload: Promise<void> } {
  const { distPath, publicPath, spaIndexPath, flaskUrl, staticPageLimiter } = opts;

  // /index.html is a duplicate of the canonical home URL. Redirect it before
  // express.static can serve the file directly. Carry forward only the home
  // parameters the SPA understands; never reflect an arbitrary query string
  // into a redirect target.
  app.get('/index.html', staticPageLimiter, (req, res) => {
    const query = new URLSearchParams();
    if (req.query.auth === 'success') query.set('auth', 'success');

    const save = req.query.save;
    if (typeof save === 'string' && /^[a-z0-9-]{1,200}$/.test(save)) {
      query.set('save', save);
    }

    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    res.redirect(301, `/${suffix}`);
  });

  // KAN-348: the home page's newest-recipes row. Mounted before express.static,
  // which would otherwise answer "/" with the file as built. The row is an
  // addition: with no list, or on any failure here, the request falls through
  // and the built shell is served with its fixed recipe links.
  const newestRecipes = createNewestRecipesSource({ flaskUrl });
  // Fetched now and awaited just before the server listens, so the first home
  // request on a new instance finds the list (or a recorded failure) and does
  // not wait on Flask. Bounded by the fetch timeout; never rejects.
  const newestRecipesPreload = newestRecipes.refresh();
  const shouldLogHomeShellFailure = createFailureLogGate();
  let homeShellPromise: Promise<string> | undefined;
  const getHomeShell = (): Promise<string> => {
    homeShellPromise ??= readFile(spaIndexPath, 'utf8').catch((err) => {
      homeShellPromise = undefined;
      throw err;
    });
    return homeShellPromise;
  };
  // KAN-398: the API catalog. An explicit route, because express.static does
  // not serve from a dot-directory. The links are absolute (as in RFC 9727's
  // examples) and built from the host that was asked, so staging's catalog
  // points at staging. Express answers HEAD from the same handler.
  app.get(API_CATALOG_PATH, staticPageLimiter, (req, res) => {
    res.setHeader('Link', API_CATALOG_LINK);
    res.setHeader('Cache-Control', 'public, max-age=0');
    // A Buffer, so Express leaves the media type as written: for a string it
    // would add a charset parameter the link set type does not define.
    const body = JSON.stringify(apiCatalog(`${req.protocol}://${req.host}`));
    res.type(API_CATALOG_CONTENT_TYPE).send(Buffer.from(body));
  });
  // KAN-395: point agents at the machine-readable descriptions of the site from
  // the home page's response headers. Scoped to GET `/` (so it does not fire on
  // every /api, /r, image or proxy request) but still a standalone handler,
  // because "/" is answered from three places (the composed handler below,
  // express.static, and the catch-all's safety net) and all three need the
  // header.
  app.get('/', (_req, res, next) => {
    res.setHeader(
      'Link',
      `</llms.txt>; rel="describedby"; type="text/plain", </sitemap.xml>; rel="sitemap", ${API_CATALOG_LINK}`
    );
    // KAN-397: "/" has an HTML and a Markdown form, so every answer says so.
    res.vary('Accept');
    next();
  });
  // KAN-397: the Markdown form, for a client that names text/markdown. The
  // guide is a file in the image, so it is read once, now. If that fails it is
  // logged here and "/" is HTML only until the next start: no retry per
  // request, and the warning is this handler's own.
  const homeGuide: Promise<string | null> = readFile(
    path.join(publicPath, 'home.md'),
    'utf8'
  ).catch((err) => {
    console.warn('[home-markdown] no guide to serve; "/" is HTML only:', err);
    return null;
  });
  // Both checks come before the limiter, so a request is counted once whichever
  // form it gets.
  const markdownOnly: express.RequestHandler = async (req, _res, next) => {
    if (!acceptsMarkdown(req.get('Accept'))) return next('route');
    next((await homeGuide) === null ? 'route' : undefined);
  };
  app.get('/', markdownOnly, staticPageLimiter, async (_req, res, next) => {
    const guide = await homeGuide;
    if (guide === null) return next('route');
    res.setHeader('Cache-Control', 'public, max-age=0');
    res.type(MARKDOWN_CONTENT_TYPE).send(renderHomeMarkdown(guide, await newestRecipes.get()));
  });
  app.get('/', staticPageLimiter, async (_req, res, next) => {
    try {
      const recipes = await newestRecipes.get();
      if (recipes.length === 0) return next();
      const html = injectNewestRecipes(await getHomeShell(), recipes);
      // Same Cache-Control express.static gives the file it would have served.
      res.setHeader('Cache-Control', 'public, max-age=0');
      res.type('html').send(html);
    } catch (err) {
      if (shouldLogHomeShellFailure()) {
        console.warn('[newest-recipes] serving the home shell as built:', err);
      }
      next();
    }
  });

  // The compiled Angular bundles and public assets must remain mounted before
  // the SPA catch-all. Missing assets then fall through to the asset 404 below.
  app.use(
    express.static(distPath, {
      setHeaders: (res, filePath) => {
        const cacheControl = staticCacheControl(path.relative(distPath, filePath));
        if (cacheControl) res.setHeader('Cache-Control', cacheControl);
      },
    })
  );

  // A standalone static page, with a hand-written Markdown form (KAN-431) for a
  // client that names text/markdown, the same way "/" answers (KAN-397). The
  // Markdown is read once, now; if that fails the page is HTML only until the
  // next start. Must be mounted BEFORE the SPA catch-all so it isn't swallowed
  // by index.html.
  const staticPage = (route: string, name: string): void => {
    const markdown: Promise<string | null> = readFile(
      path.join(publicPath, `${name}.md`),
      'utf8'
    ).catch((err) => {
      console.warn(`[static-page] no Markdown for ${route}; it is HTML only:`, err);
      return null;
    });
    // Checked before the limiter, so a request is counted once whichever form it gets.
    const markdownOnly: express.RequestHandler = async (req, res, next) => {
      res.vary('Accept');
      if (!acceptsMarkdown(req.get('Accept'))) return next('route');
      next((await markdown) === null ? 'route' : undefined);
    };
    app.get(route, markdownOnly, staticPageLimiter, async (_req, res) => {
      res.setHeader('Cache-Control', 'public, max-age=0');
      res.type(MARKDOWN_CONTENT_TYPE).send(await markdown);
    });
    app.get(route, staticPageLimiter, (_req, res) => {
      res.sendFile(`${name}.html`, { root: publicPath });
    });
  };

  // Privacy policy, served up front by Express on purpose.
  staticPage('/privacy-policy', 'privacy-policy');
  // About page (KAN-272, SEO audit C5): who makes the site and why, with the
  // author's Person schema. Static, like the privacy policy.
  staticPage('/about', 'about');

  // /favicon.ico — browsers and crawlers request this path unconditionally,
  // but the SPA only ships favicon.svg, so the request fell through to the
  // catch-all and came back as index.html (text/html) — an HTML "icon"
  // (issue #3164). Serve the SVG bytes explicitly; sendFile's .svg lookup
  // yields an image/* content-type. Served from server/public (checked in,
  // present in the Docker image) rather than dist so it works even before
  // an Angular build.
  app.get('/favicon.ico', staticPageLimiter, (_req, res) => {
    res.type('image/svg+xml');
    // Express's `send` defaults to Cache-Control: public, max-age=0, so every
    // page navigation re-fetches the favicon and counts toward
    // staticPageLimiter's 300 req / 15 min per-IP budget. Cache it for a day.
    res.sendFile('favicon.svg', { root: publicPath, maxAge: '1d' });
  });

  // /apple-touch-icon.png + /apple-touch-icon-precomposed.png — iOS Safari
  // requests both by convention on every page view, with no <link> needed.
  // The repo ships no PNG icon, so they fell through to the SPA catch-all and
  // came back as 13KB of index.html labelled image/png with max-age=0 — which
  // iOS neither caches nor accepts, so it asked again on the next page. That
  // was 60 requests and 44 of the 429s in the KAN-154 incident: the same
  // defect #3164 fixed for /favicon.ico, on the paths it missed.
  //
  // 204 rather than 404: both stop the index.html leak, but a cacheable 204
  // tells iOS not to re-probe, and 404s are re-requested. iOS falls back to a
  // page screenshot for the home-screen icon, which is the pre-existing
  // behaviour anyway.
  app.get(/^\/apple-touch-icon(-precomposed)?\.png$/, staticPageLimiter, (_req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.status(204).end();
  });

  // Flask SSR routes — individual public recipes, the browse index, and the
  // sitemap must be proxied to Flask BEFORE the Angular catch-all so the HTML
  // the crawler receives is server-rendered (not the empty SPA shell). Using
  // .get() instead of .use() so non-GET methods 404 cleanly; staticPageLimiter
  // applies the same rate limit as the privacy policy and SPA shell.
  const ssrProxy = createFlaskProxy('SSR');
  app.get('/r/*splat', staticPageLimiter, ssrProxy);
  // /browse/ (trailing slash) previously missed the /browse route and fell
  // through to the SPA shell (issue #3164). 301 to the canonical /browse,
  // preserving any query string. Exact-path middleware (not a route pattern)
  // so non-strict pattern matching can never turn this into a redirect loop.
  app.use((req, res, next) => {
    if (req.path === '/browse/') {
      const queryIndex = req.originalUrl.indexOf('?');
      const query = queryIndex === -1 ? '' : req.originalUrl.slice(queryIndex);
      res.redirect(301, `/browse${query}`);
      return;
    }
    next();
  });
  app.get('/browse', staticPageLimiter, ssrProxy);
  // KAN-274: curated category hubs. Flask owns the allow-list (unknown slugs
  // and the prefix root 404 there) and the trailing-slash 301, so both the
  // prefix root and every child path must reach the SSR service.
  app.get('/browse/tag', staticPageLimiter, ssrProxy);
  app.get('/browse/tag/*splat', staticPageLimiter, ssrProxy);
  app.get('/sitemap.xml', staticPageLimiter, ssrProxy);
  // The SSR templates link their stylesheets via Flask's /static/ (e.g.
  // /static/css/tokens.css). Without this route those requests fall through
  // to the SPA catch-all, which answers with index.html as text/html — and
  // Helmet's X-Content-Type-Options: nosniff makes browsers refuse to apply
  // it, so the public pages render completely unstyled. Mounted after
  // express.static so Angular build assets (if any collide) still win.
  app.get('/static/*splat', staticPageLimiter, ssrProxy);

  return { preload: newestRecipesPreload };
}
