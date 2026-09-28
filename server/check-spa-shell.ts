// Post-build guard (KAN-285), run by `npm run build` after `ng build`.
//
// server/index.ts falls back to the full home shell when it cannot derive the
// route-neutral one, so a build that loses the head sentinels or <app-root>
// would still serve, just with the home H1, FAQ and canonical on every
// non-home route. src/landing-copy.test.ts only checks the SOURCE index.html.
// This checks the BUILT one with the runtime's own parser and exits non-zero,
// which fails the PR gate build, the Express Docker gate and Cloud Build
// alike; Cloud Run then keeps serving the previous revision.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildRouteNeutralSpaShell } from './spa-shell.js';

const indexPath = path.resolve(process.argv[2] ?? 'dist/index.html');

try {
  buildRouteNeutralSpaShell(await readFile(indexPath, 'utf8'), 'noindex, follow');
  console.log(`[check-spa-shell] ok: ${indexPath} has its home-head sentinels and <app-root>`);
} catch (err) {
  console.error(`[check-spa-shell] FAIL: ${indexPath}: ${(err as Error).message}`);
  process.exitCode = 1;
}
