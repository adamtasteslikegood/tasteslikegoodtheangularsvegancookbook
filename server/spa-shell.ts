// The route-neutral SPA shell (KAN-272), as a pure function so the runtime
// catch-all in server/index.ts and the post-build check in
// server/check-spa-shell.ts (KAN-285) apply exactly the same parse. A build
// that drops the sentinels fails the check instead of shipping a shell the
// runtime can only answer by falling back to the full home page.

// Meta sentinels survive Angular's production HTML minification; ordinary
// comments do not. Match with a regex tolerant to attribute reordering,
// quote-style changes, and self-closing syntax that a future minifier
// upgrade could introduce. The name value is followed by a required
// boundary (quote, whitespace, `/`, or `>`) so a future sentinel-prefixed
// name like `tlg-home-head-start-social` cannot accidentally match here.
const HOME_HEAD_START_RE =
  /<meta\s+[^>]*name=(?:"tlg-home-head-start"|'tlg-home-head-start'|tlg-home-head-start(?=[\s/>]))[^>]*>/i;
const HOME_HEAD_END_RE =
  /<meta\s+[^>]*name=(?:"tlg-home-head-end"|'tlg-home-head-end'|tlg-home-head-end(?=[\s/>]))[^>]*>/i;
const APP_ROOT_OPEN_RE = /<app-root(?:\s[^>]*)?>/;

/**
 * Derive the shell served for every non-home SPA route from the full
 * index.html. The checked-in index carries home-only title/canonical/social
 * tags and structured data; removing only <app-root>'s children still exposed
 * the home FAQ and canonical on /kitchen and /recipe/:id. So the marked head
 * block is replaced with deliberately generic, non-indexable metadata, and the
 * <app-root> children (the static landing copy) are stripped.
 *
 * Throws when the sentinels or <app-root> are missing.
 */
export function buildRouteNeutralSpaShell(fullSpaShell: string, neutralRobots: string): string {
  const homeHeadStartMatch = HOME_HEAD_START_RE.exec(fullSpaShell);
  const homeHeadEndMatch = homeHeadStartMatch
    ? HOME_HEAD_END_RE.exec(fullSpaShell.slice(homeHeadStartMatch.index))
    : null;
  if (!homeHeadStartMatch || !homeHeadEndMatch) {
    throw new Error('Angular index.html is missing its home-page head sentinels');
  }
  const homeHeadStart = homeHeadStartMatch.index;
  const homeHeadEnd =
    homeHeadStartMatch.index + homeHeadEndMatch.index + homeHeadEndMatch[0].length;
  const neutralHead = `<title>TastesLikeGood</title><meta name="robots" content="${neutralRobots}" />`;
  const shellWithoutHomeHead =
    fullSpaShell.slice(0, homeHeadStart) + neutralHead + fullSpaShell.slice(homeHeadEnd);

  const appRootOpenMatch = APP_ROOT_OPEN_RE.exec(shellWithoutHomeHead);
  const appRootOpen = appRootOpenMatch?.index ?? -1;
  const appRootClose = shellWithoutHomeHead.indexOf('</app-root>', appRootOpen);
  if (appRootOpen === -1 || appRootClose === -1 || !appRootOpenMatch) {
    throw new Error('Angular index.html is missing its app-root element');
  }

  const appRootContentStart = appRootOpen + appRootOpenMatch[0].length;
  return (
    shellWithoutHomeHead.slice(0, appRootContentStart) + shellWithoutHomeHead.slice(appRootClose)
  );
}
