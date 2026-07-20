# Changelog

All notable changes to Vegangenius Chef are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.4.0] - 2026-07-20

Discoverability and conversion release closing out Sprint 1 (KAN-110). Ends the
home-page crawl dead-end with server-rendered anchors and unblocks Google
sign-in for visitors arriving inside in-app browsers. No schema migration.

### Added

- **Server-rendered crawlable links on the home shell**: the Angular home shell
  previously served only `<app-root>` — a crawler or no-JS client hitting `/`
  found zero anchors, making the public SSR pages (`/browse`, `/r/<slug>`) a
  crawl dead-end. A `<noscript>` nav now ships in the server HTML with
  `<a href="/browse">` plus two published recipe links, without changing the
  JS-rendered UI
  ([#3185](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3185),
  TAS-2896, KAN-114).

### Fixed

- **Google sign-in no longer dead-ends inside in-app browsers**: visitors who
  arrive from Pinterest (and Instagram/Facebook/etc.) view the site inside that
  app's embedded webview, where Google blocks OAuth with
  `Error 403: disallowed_useragent`. The sign-in dialog now detects the in-app
  browser and, instead of firing a doomed consent redirect, shows an "open this
  page in Safari/Chrome to sign in" fallback with a copy-link button. Guest
  saving already works in-webview, so first-time saves are no longer blocked at
  the conversion moment
  ([#3186](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3186),
  TAS-2899, KAN-113).

---

## [0.3.9] - 2026-07-19

Stability and infrastructure release. Restores the Flask backend's shared
Valkey response cache (it had silently fallen back to a per-worker in-memory
cache), gives the backend OOM headroom, dedups the "Save to cookbook" action,
and unclips the public recipe hero on mobile. No schema migration.

### Fixed

- **Flask backend uses the shared Valkey response cache again**: the IAM Valkey
  client never trusted the Memorystore CA, so every TLS handshake failed with
  `CERTIFICATE_VERIFY_FAILED` and the backend silently fell back to a per-worker
  in-memory `SimpleCache` — no cache sharing across workers or replicas, and
  extra heap per worker. The IAM client now trusts the Memorystore CA cert and
  the Cloud Run deploy mounts the `VALKEY_CA_CERT` secret
  ([#3176](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3176),
  Backend [#222](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/222)).
- **"Save to cookbook" no longer double-fires**: a fast double-click could send
  two save requests; the action now guards against in-flight requests and the
  success toast reports what actually happened. The public-page "View" link is
  decluttered and carries `rel="noreferrer"`
  ([#3169](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3169)).
- **Public recipe hero no longer clips on mobile**: the eyebrow/title of the
  `/r/<slug>` hero was cut off on narrow viewports (Backend
  [#221](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/221),
  RCP-45).

### Changed

- **flask-backend memory headroom**: Cloud Run memory raised to **1Gi**
  ([#3173](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3173)),
  the Datadog continuous profiler disabled, and gunicorn workers now recycle on
  a max-request cap (Backend
  [#220](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/220)) —
  headroom over the flat ~84% memory baseline that risked an OOM at the 99% edge.
  Gunicorn's `--graceful-timeout` is raised to **540s** to match
  `GENAI_HTTP_TIMEOUT_MS` so a worker restart lets an in-flight Gemini/Imagen
  call finish instead of the 30s default force-killing it (Backend
  [#224](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/224)).
- **Agent / PM tooling**: new `harness-qa-loop` QA-gated harness skill plus an
  `.env.example` credentials callout
  ([#3177](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3177));
  Confluence sync hardened — md2cf storage format, 409 retry, stable page titles
  ([#3175](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3175));
  the `receiving-code-review` skill is now enforced on PR feedback
  ([#3170](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3170)).
- **Cleanup**: the dead `.continue/` config was removed after Continue was
  decommissioned
  ([#3172](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3172));
  the residual Continue Atlassian connectivity check now targets the
  streamable-HTTP MCP endpoint
  ([#3171](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3171)).

### Deploy notes

- Backend submodule pointer **`4857369` → `18a303a`**. **No new Alembic
  migration** — single head unchanged, so `flask-backend-migrate` is a no-op
  this release.
- The flask-backend Cloud Run deploy now mounts the **`VALKEY_CA_CERT`** secret
  and sets **`--memory=1Gi`**. After deploy, verify in Datadog: Valkey
  connection healthy (no `CERTIFICATE_VERIFY_FAILED`) and a per-worker heap drop
  as the response cache moves off `SimpleCache`.

## [0.3.8] - 2026-07-18

Public-site audit release. Fixes the navigation, dead-link, and SEO defects
from the tiered UX audit ([#3164](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/3164)),
closes the duplicate-cookbook double-click race, and ships the consolidated
CI gate plus Backend dependency refreshes.

### Fixed

- **Apex domain now redirects to the canonical www host**: `tasteslikegood.org`
  served identical 200s to `www.tasteslikegood.org`, splitting indexing signals
  across two hosts even though every canonical URL, sitemap entry, and
  robots.txt line declares www. Express now 301s all apex paths to www (308 for
  non-GET/HEAD so method and body survive), with the redirect target re-parsed
  against the fixed canonical origin so a crafted path can never turn it into
  an open redirect ([#3165](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3165)).
- **Recipe images are no longer blocked from image crawlers**: `robots.txt`'s
  `Disallow: /api/` also swallowed every recipe hero/og:image URL; a
  longest-match `Allow: /api/recipes/*/image` line restores crawler access
  ([#3165](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3165)).
- **`/favicon.ico` serves a real image**: the path fell through to the SPA
  catch-all and returned `index.html` as `text/html`. It now serves the SVG
  favicon bytes with an `image/*` content-type and a one-day cache so repeat
  fetches stop burning the shared per-IP rate-limit budget
  ([#3165](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3165)).
- **`/browse/` (trailing slash) 301s to `/browse`** instead of falling through
  to the empty SPA shell, preserving any query string
  ([#3165](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3165)).
- **Public recipe image responses declare the content-type of their actual
  bytes** (sniffed from magic bytes instead of trusting a stored label — the
  live crawl found 8 URLs declaring `image/png` over JPEG bytes), stop
  emitting cookies/CORS headers, and carry `Cache-Control: public,
max-age=86400`. Recipe pages whose image rows have no stored bytes no longer
  render a hero/og:image that 404s (Backend
  [#217](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/217)).
- **Double-clicking "Create" no longer produces duplicate cookbooks**: the
  create button now guards against in-flight requests and sends an
  `Idempotency-Key` ([#3163](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3163));
  the server enforces a per-owner unique cookbook name with partial unique
  indexes, deduplicates existing rows by rename in migration `b7e2a9c4d1f8`,
  answers replays idempotently, and retries the guest→user login merge on
  `IntegrityError` (Backend [#216](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/216)).
- **CodeQL error-severity backlog drained**: 90 of 142 open Backend alerts
  fixed (Backend [#213](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/213)).

### Added

- **SPA → public-site navigation**: the app footer now links to
  "Browse Public Recipes" — the compiled bundle previously contained zero
  references to `/browse`
  ([#3165](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3165)).
- **`scripts/audit/crawl-links.sh`**: read-only public-site link & image crawl
  gate (sitemap + `/` + `/browse` pagination + every `/r/<slug>`; fails on any
  final status ≥ 400 or an image content-type that doesn't match the
  downloaded bytes) ([#3165](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3165)).
- **`Backend/scripts/unpublish_slugs.py`**: idempotent operator script to
  unpublish junk public slugs, syncing both the `is_public` column and the
  recipe data blob (Backend [#217](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/217)).

### Changed

- **CI consolidated to a single blocking gate** (`pr-gate`), now including an
  Express Docker image build — root-Dockerfile syntax errors surface on the PR
  instead of at release time, closing the gap that burned the v0.3.4 tag
  ([#3157](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3157),
  [#3158](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3158)).
  `dev` and `main` carry required status checks enforced by branch protection
  ([#3162](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3162)).
- **Backend image modernized**: base bumped to `python:3.13-slim` (Backend
  [#206](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/206));
  dependencies now export from `uv.lock` at build time and the tracked
  `requirements.txt` is gone (Backend
  [#215](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/215),
  [#214](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/214));
  `websockets` 16.1.1 (Backend [#209](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/209)),
  `ddtrace` 4.11.1 (Backend [#208](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/208)).
- **Docs**: Copilot instructions rewritten for the current app in both repos,
  Gemini credential-flow corrections, model-ID notes; unused `@google/genai`
  dependency removed
  ([#3154](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3154),
  [#3155](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3155),
  [#3156](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3156),
  Backend [#210](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/210),
  [#212](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/212)).

### Deploy notes

- `flask-backend-migrate` applies **`b7e2a9c4d1f8`** (per-owner unique
  cookbook-name indexes + dedup-by-rename of existing duplicate rows). Single
  Alembic head verified at the pinned Backend SHA `4857369`.
- Post-deploy operator steps (issue [#3164](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/3164)):
  run `Backend/scripts/unpublish_slugs.py` in prod against the item-8 junk-slug
  list, then re-run `scripts/audit/crawl-links.sh` — expected exit 0.

## [0.3.7] - 2026-07-17

Public-URL hardening release. The recipe publish flow no longer accepts a
user-typed `/r/<slug>` address.

### Fixed

- **Removed the free-form public-slug input in My Kitchen**: the publish row
  let any text be saved verbatim as the recipe's public `/r/<slug>` address —
  an abuse vector for a stable, indexed, shareable URL (junk URLs, collisions,
  client/server slug drift). The slug is now always derived from the recipe
  title (client mirror of the server's `normalize_slug`, byte-identical and
  pinned by a 15-case parity test) and shown read-only; the server remains
  authoritative and its collision-resolved slug is reconciled back into local
  state from the save response ([#3138](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3138)).
  Follow-ups tracked in [#3146](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/3146)
  and [#3147](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/issues/3147).
- **Pinterest "Save to Pinterest" button no longer creates broken pins**: the
  button on a public recipe page now renders only when the recipe has a
  genuinely fetchable image, so a recipe whose image is missing (a row with an
  `ai_image_url` but no stored bytes) no longer offers a pin whose media 404s.
  A run of broken pins to a fresh domain can trigger Pinterest's new-account spam
  heuristics. Also adds an inert `p:domain_verify` placeholder in the public
  `<head>` for domain claiming (unlocks Rich Pins). Ships via the Backend
  submodule pointer bump to `c3e4687` (Backend [#200](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/200)).
- **Pinterest pin media now matches the gated image source**: with a stale
  `ai_image_url` (bytes never stored) next to a valid stock image, the
  Pinterest button passed its render gate via the stock image but still
  shipped the dead AI URL as the pin's `media`. The share URL is now built
  from the same signal that passes the gate — the canonical image endpoint
  when stored bytes exist, else the stock image URL (Backend
  [#203](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/203),
  flagged by Copilot review on the Backend promotion PR
  [#202](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/202)).
- **Publish/unpublish now reverts cleanly when the server sync fails**: a
  failed publish toggle kept the optimistic `is_public` state in the UI and
  in localStorage even though the server never saved it. Sync failures now
  surface to `togglePublic()`, which reverts the toggle and re-persists the
  reverted state (on [#3150](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3150),
  flagged by Copilot review).

## [0.3.6] - 2026-07-15

Login fix release. Restores Google OAuth sign-in, which regressed under the
Content Security Policy shipped in v0.3.4.

### Fixed

- **Google OAuth login no longer blanks on the callback**: the OAuth callback
  returned an inline-script HTML page to perform its post-login redirect, which
  Helmet's `script-src 'self'` CSP (added in v0.3.4) blocked — leaving users on
  a blank callback page instead of signed in. The callback now issues a
  server-side 302 redirect instead of relying on client-side script. Ships via
  the Backend submodule pointer bump to `1077e42` (Backend #195, cookbook #3130).

### Changed

- **CI (internal, no runtime impact)**: added an advisory, cost-optimized
  independent Claude review workflow that reviews each PR on a cheaper, different
  model than the authoring session (#3128, #3129), plus a CI/CD refresh plan and
  specs (#3125).
- **Tooling (internal)**: automated session-start/end PM rituals via hooks
  (#3126).

## [0.3.5] - 2026-07-15

Deploy repair release. Identical in content to v0.3.4, which never reached
production: its tag-triggered Cloud Build failed while parsing the Express
Dockerfile, before any image was pushed or deployed.

### Fixed

- **Express Dockerfile parses again**: the unquoted space in
  `ENV NODE_OPTIONS=--require dd-trace/init` made Docker's parser reject the
  Dockerfile (`can't find = in "dd-trace/init"`), aborting the v0.3.4 deploy at
  the image-build step. The value is now quoted. The v0.3.4 tag is superseded
  by this release.

## [0.3.4] - 2026-07-15

Security, observability, and operations release. Adds Express-layer request
validation, enables a scoped Content Security Policy, ships Datadog telemetry
across both services, hardens the Atlassian/Confluence automation, and promotes
the Backend async-generation release line with additional release safeguards.

### Added

- **Express validates AI requests before proxying them to Flask** ([#3110](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3110)): generation and image payloads are size-limited and validated while preserving the raw request bytes for the streaming proxy, with dedicated route and validation coverage.
- **Datadog observability for the production stack** ([#3112](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3112)): the Express and Flask services run through Datadog serverless-init, emit release metadata, and receive the Datadog API key from Secret Manager. The one-shot migration job overrides that entrypoint and remains uninstrumented with no unnecessary access to the telemetry secret.
- **Reliable session logging and PM-daemon controls** ([#3105](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3105), [#3113](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3113)): adds `/wrap`, automatic pre-compaction transcript digests, a direct MCP driver, and a singleton watcher lock so concurrent agent sessions do not race to update Confluence.

### Fixed

- **Helmet now enforces a scoped Content Security Policy** ([#3109](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3109)): scripts, styles, fonts, images, connections, frames, and objects are restricted to the origins the application uses. Public SSR interactions now load from a same-origin static script so the policy does not disable modal and save controls.
- **Logs cannot be split or forged with control characters** ([#3108](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3108)): request, proxy, and error logging share one sanitizer for untrusted path and message values.
- **Backend release blockers are removed** (Backend [#193](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/193)): stops tracking a local SQLite database, preserves server-side sessions during migration, verifies Pub/Sub OIDC audiences against the exact worker URL, makes worker delivery idempotent across retries and guest-to-user ownership changes, prevents cached private images from bypassing ownership checks, binds Gemini execution to an immutable trusted plan, pins CI actions, sanitizes untrusted log values, and hardens partial SSR rendering and keyboard interaction.

### Changed

- **Atlassian automation is constrained to the canonical workspace** ([#3102](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3102)): PM scripts reject the retired service site and restrict recipe-app writes to Jira KAN/RCP, with synchronized routing documentation and an audit trail.
- **Backend submodule promoted to the v0.3.4 release candidate** (Backend [#193](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/193)): includes public SSR and image delivery, Pub/Sub recipe/image workers with retries and status polling, authenticated publishing, route-safe slugs, Datadog/Gunicorn production startup, refreshed CI, and expanded worker/API regression coverage.
- Angular 22.0.6 and related Angular tooling, Helmet 8.3.0, ESLint/TypeScript lint tooling, and GitHub Actions received their scheduled updates ([#3115](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3115), [#3116](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3116), [#3117](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3117), [#3118](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3118)).

## [0.3.3] - 2026-07-11

Stability and automation release. Fixes cookbook editing regressions, makes authenticated publishing explicit, hardens the hosted GCP monitoring connector, repairs the repository's agentic workflows, and adds active-work reflection for Jira/KAN.

### Fixed

- **Recipe editing no longer loses ingredient data** ([#3057](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3057)): the wizard preserves ingredient groups while editing, cookbook creation rejects blank names, and modal controls now have accessible labels.
- **Abandoned manual-entry rows no longer leak into later recipes** ([#3098](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3098)): closing or reopening manual recipe entry clears pending ingredient and instruction drafts before the next save.
- **Publishing is limited to signed-in users** ([#3066](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3066), Backend [#142](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/142)): guests see a clear "Sign in to publish" action instead of a control that cannot complete, while the backend rejects guest publishing and migrates previously guest-published rows safely.
- **Hosted gcp-monitor connector reliability** ([#3058](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3058), [#3060](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3060), [#3078](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3078)): secret-path routing now works with connector registration, reverse-proxy host validation no longer rejects Cloud Run traffic, and `metric_pb2` is imported consistently.
- **PM session-log configuration matches the documented environment variables** ([#3065](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3065), [#3079](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3079)): session logs target the Agent Session Logs index and receive the expected label.
- **Agentic workflows compile and run again** ([#3077](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3077), [#3091](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3091), [#3093](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3093)): Daily Repo Status uses the current gh-aw runtime, and Issue Arborist now uses the built-in GitHub token with a regenerated lock file whose frontmatter hash matches its source.
- **Backend operational endpoints are safer and accurate** (Backend [#147](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/147)): `/api/migrate` requires an admin token and `/api/status` performs a working database health probe.

### Added

- **Issue Arborist automation** ([#3089](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3089), [#3093](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3093)): periodically groups strongly related GitHub issues into parent/sub-issue relationships, with compiler-generated maintenance for expiring safe outputs.
- **Jira/KAN work reflection** ([#3080](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3080)): `npm run pm:reflect` compares the active branch, changed files, recent commits, and referenced issues with KAN/RCP, then writes board-alignment recommendations under `.agent-work/pm/`.
- **Reverse-engineered product reference** ([#3082](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3082)): documents current pages, API inventory, data model, enums, and platform behavior under `prd/`.

### Changed

- Angular 22.0.5 -> 22.0.6, `@google/genai` 2.10 -> 2.11, Vite 8.0.16 -> 8.1.4, Node types 25 -> 26, plus testing and linting patch updates ([#3000](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3000), [#3071](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3071), [#3073](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3073), [#3074](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3074), [#3075](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3075), [#3076](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3076)).
- Backend submodule `ef594bf` -> `3883f00`, adding authenticated publishing enforcement and the operational endpoint fixes above. Alembic remains on one head (`e91b47a2c5d3`).
- Repository and agent-tooling pointers were refreshed, runtime artifacts were explicitly parked/ignored, and session-start synchronization guidance was tightened ([#3068](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3068), [#3085](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3085)).

## [0.3.2] - 2026-07-05

Regression-fix release for v0.3.1: restores styling on the server-rendered public pages, makes async recipe generation retry transient model failures, and un-shadows the dynamic sitemap. Also brings the GCP monitoring MCP server to Cloud Run as an authenticated Claude connector and gates PRs targeting `dev` with the full CI suite.

### Fixed

- **Public SSR pages render styled again** ([#3047](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3047), [#3048](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3048)): Express proxied `/r/*`, `/browse`, and `/sitemap.xml` to Flask but not `/static/*`, so the SSR templates' stylesheet requests fell through to the SPA catch-all and came back as `index.html` (`text/html`) — Helmet's `X-Content-Type-Options: nosniff` then made browsers refuse to apply them, leaving every public page unstyled. `GET /static/*` is now proxied to Flask (mounted after `express.static`, so Angular build assets still win on collision). `server/index.ts` exports `app` and a `ready` promise with the listener skipped under `VITEST`/`NODE_ENV=test`, backed by new route-mounting integration tests (`server/routes.test.ts`).
- **Async recipe generation survives flaky model responses** (Backend [#141](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/141) via [#3049](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3049)): `gemini-3.1-pro-preview` intermittently returns truncated JSON, and the Pub/Sub worker was single-shot with only "Unknown error" logging — users saw "generation failed during async processing". The worker now retries transient generation failures up to `GENERATION_MAX_ATTEMPTS` (default 3) and failure records carry the real error message (validation failures wrapped as `ValidationError`). Backend submodule `b359743` → `ef594bf`.
- **Dynamic sitemap unshadowed** ([#3041](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3041)): a stale static `public/sitemap.xml` was served by `express.static` ahead of the Flask proxy route, hiding the dynamic sitemap of public recipes shipped in v0.3.1. Deleted.

### Added

- **GCP monitoring served over HTTP for Claude connectors** ([#3051](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3051), [#3052](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3052)): the gcp-monitor MCP server can now run as an authenticated Streamable-HTTP service on Cloud Run — keyless (runs as a `roles/monitoring.viewer` service account via ADC), bearer-token auth from Secret Manager, token also accepted via `?key=` query param for connector UIs without header support — with a Dockerfile and `deploy_mcp_cloud_run.sh`. Cloud routines get the monitoring tools first-class instead of shelling out to scripts.
- **gcp-monitor cloud-session resilience** ([#3043](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3043), [#3044](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3044), [#3046](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3046)): prebuilt-venv fast path so the stdio server survives cloud-routine cold starts, retries around transient PyPI timeouts in the setup script, and project MCP servers pre-approved in `.claude/settings.json` for cloud sessions.

### Changed

- **CI: pull requests targeting `dev` now run the lint/test/build gate** ([#3050](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3050)) — previously the gate only ran on pushes, so a broken PR could merge green.
- Docs: GBrain config + search guidance in `CLAUDE.md` refreshed ([#3042](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3042), [#3045](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/pull/3045)); `docs/MCP_GCP_MONITORING.md` expanded with the Cloud Run connector setup (§ 4.5).

## [0.3.1] - 2026-07-04

Deploy hotfix. The v0.3.0 tag was cut but its Cloud Build died in the `flask-backend-migrate` job (`ModuleNotFoundError: flask_cors`) before either service deployed — production kept serving v0.2.5 throughout. v0.3.1 is v0.3.0 plus the dependency fix; it is the release that actually ships the v0.3.0 feature set.

### Fixed

- **Backend image lost 14 runtime dependencies** (Backend [#140](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/140)): a Dependabot uv-group bump (Backend #133) regenerated `requirements.txt` — which the Dockerfile installs from — dropping flask-cors, flask-migrate, flask-sqlalchemy, alembic, psycopg2-binary, google-cloud-storage, google-cloud-pubsub, redis and more. `google-cloud-storage`/`google-cloud-pubsub`/`redis` are now declared in `pyproject.toml` (they were imported by services but never listed there), `requirements.txt` is regenerated from `uv.lock`, and a new Backend CI step fails on any future drift between the two. Backend submodule pin: `2baccf2` → `b359743`.

## [0.3.0] - 2026-07-04

Feature release: server-rendered public recipe/browse pages with a styled shell and Save-to-Cookbook flow, the Angular 22 + TypeScript 6 upgrade, GCP monitoring tooling, a production Valkey TLS fix, Atlassian/PM tooling, a repository cleanup, and a batch of dependency updates.

### Added

- **SSR recipe & browse pages with a "Save to Cookbook" CTA.** Public recipes render server-side. The CTA is a server-rendered link to `/?save=<slug>#kitchen`; `AppComponent.handleSaveFromSSR()` fetches the recipe from the new `GET /api/recipes/public/<slug>` JSON endpoint (Backend [#139](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/139)) and saves it to the guest/user cookbook through the session-aware flow (fresh id, image fields preserved), then cleans the URL. A `#kitchen` hash deep-links straight into the cookbook view (`syncViewFromLocation`).
- **Styled public shell + SEO** (Backend [#132](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/132)): `base_public.html` layout with design tokens (`tokens.css`, `recipe-site.css`), canonical/Open Graph/JSON-LD metadata, Pinterest share, and a dynamic `/sitemap.xml` of public routes.
- **Public recipe save flow** wired into the kitchen.
- **GCP monitoring MCP server + "Run System Health Check" routine** (#3008, #3020): read-only Cloud Monitoring tools covering Cloud Run, Cloud SQL, Valkey, and Pub/Sub, with an SRE health-report skill.
- **Atlassian / PM tooling.** `.pi/` Atlassian AOTA extension, session-log skill + schemas, background pm-daemon controls, and session-log publishing scripts. New `docs/PM_TOOLING.md` and `.github/CODEOWNERS`.

### Fixed

- **Production Valkey TLS trust** (#3027): Memorystore server certs chain to a Google-managed private CA, so every Express instance failed TLS verification and silently fell back to in-memory rate limiting. The new `VALKEY_CA_CERT` secret (full CA bundle, created by `scripts/gcloud/setup_valkey_ca.sh`) is passed as `tls.ca`, keeping verification enabled. Closes #163.
- **SSR save flow hardened** (#3031, Backend #139): saves from public pages no longer race the startup auth check (a stale cached authenticated session could swallow the save), keep their `ai_image_url`/`stock_image_url`, and always get a fresh id so they sync server-side. The old inline localStorage CTA (which bypassed all of this) is replaced by the server-backed flow above.

### Changed

- **Angular 21 → 22 and TypeScript → 6.0.3** (#3009), with `@angular-eslint/*` 22.x moved in lockstep.
- **Repository cleanup.** Reorganized docs, moved scripts under `scripts/git` and `scripts/pm`, removed clutter (a stray email file, Confluence JSON dumps, a GitHub-skyline STL, `scripts/output.md`, etc.), and rewrote the README.
- `.gitignore` now ignores Python virtualenvs (`scripts/pm/.venv`).
- **Backend submodule** bumped to `2baccf2`, the Backend `dev` integration tip. It carries the public recipe SSR routes + data model (`ade81bc`), the `is_public`/`slug` column sync (`3987d9a`), the Alembic status+slug head merge (`534898c`, single migration head `c60f6530f4ff`), the styled public shell + SEO (#132), the public recipe JSON endpoint + SPA-routed Save CTA (#139), removal of the failing Gemini Dispatch CI pipeline (#138), and the latest dependency bumps. Verified resolvable against `origin/dev`.

### Dependencies

- helmet 8.1→8.2, ioredis 5.10→5.11.1, google-auth-library 10.6→10.9, @google-cloud/secret-manager 6.1.1→6.2.0, globals 17.5→17.7, @types/node 25.6.0→25.6.2, vite 8.0.10→8.0.16, hono override →4.12.26 (clears two high-severity advisories), eslint 10.6, prettier 3.9.4, @typescript-eslint/eslint-plugin 8.62.
- **Major bumps:** `@google/genai` 1.50→2.x (not imported in TypeScript — version-only), `rate-limit-redis` 4.3→5.0 (API-compatible with the existing `RedisStore` usage in `server/security.ts`), `express-rate-limit` →8.5.2.
- Docker base image `node:25-alpine` → `node:26-alpine`, with CI `node-version` pinned to 26 to match; GitHub Actions group bumps.

## [0.2.5] - 2026-05-06

Hotfix on top of v0.2.4 — Google OAuth login was returning HTTP 500 for some returning users.

### Fixed

- **OAuth callback tolerates Google's scope bundling for returning users.** Backend [#128](https://github.com/adamtasteslikegood/tasteslikegood.com/pull/128). Users who had previously consented to `cloud-platform` (from an earlier deploy that requested it before commit `d85e3dd` removed the scope) were getting `{"error":"Authentication failed"}` on every login attempt — Google was bundling the previously-granted scope back into the token response, and `oauthlib`'s strict `validate_token_parameters` was raising on the scope-set mismatch (`Scope has changed from "openid userinfo.email userinfo.profile" to "openid userinfo.profile cloud-platform userinfo.email"`). Two-part fix: (1) drop `include_granted_scopes="true"` from the `/api/auth/login` authorization URL since the cookbook already requests its full scope set up front, and (2) set `OAUTHLIB_RELAX_TOKEN_SCOPE=1` at module import as defense-in-depth for accounts still carrying stale grants. Backend submodule bumped to `397ba90`.

## [0.2.4] - 2026-05-04

Bug-fix release on top of v0.2.3, plus PM tooling and docs reorganization. Corrects two UX regressions (browser back button, AI image persistence), ships the new Jira/Confluence/PR sync script that PR #2903 introduced, moves planning docs into `specs/`, and bumps the Backend submodule onto the green `dev` tip after the test-fixture fix lands.

### Fixed

- **Browser back button now restores the correct view.** `src/app.component.ts`'s `popstate` handler had its mappings inverted: returning to a `{view: 'kitchen'}` history entry switched the user to the generator (and vice versa). Pressing back from a recipe detail dropped users on the generator instead of the kitchen, and pressing back from the kitchen was effectively a no-op. The handler now mirrors the `pushState` calls in `switchView`/`viewRecipe` so back navigation matches user intent.
- **AI-generated recipe images survive a refresh.** `src/services/auth.service.ts`'s `hydrate()` now merges `ai_image_url` from localStorage into API recipe data when the backend hasn't persisted the image URL yet (Pub/Sub write hasn't landed). The merge uses a `Map` keyed by recipe id so the cost is O(n+m) instead of O(n·m).
- **Public recipes show up at `/browse`.** Backend `create_recipe()` now syncs the `is_public` and `slug` columns from the recipe payload on create, update, and migration paths, so saving a recipe as public actually flips the DB column the listing query filters on.
- **Backend test fixtures reliably bind to `:memory:`** — Backend issue [#118](https://github.com/adamtasteslikegood/tasteslikegood.com/issues/118). `tests/test_migration_backfill_slug.py` had been failing on every CI run since the SSR/data-model PR landed (`table recipe has no column named status`) because the fixture updated `SQLALCHEMY_DATABASE_URI` _after_ `create_app()` had already let Flask-SQLAlchemy latch onto the file-based dev DB. `create_app()` now accepts config kwargs that are applied before `db.init_app()`, and both the `test_migration_backfill_slug.py` and `test_public_ssr.py` fixtures use the new signature. Backend pytest is fully green again on the PR-gate workflow.
- **PM sync scripts follow the docs into `specs/`.** `sync_docs_to_confluence.py` and `scripts/pm/atlassian_pm_link.py` had their planning-doc paths still pointing at repo root; both now read from `specs/` so the Confluence sync and PM briefing pick up the canonical locations again.

### Added

- **`scripts/pm/sync_jira_confluence_status.py`** — one-shot sync that prints production-site health, open GitHub PR check status, open + recently-updated Jira issues for the `KAN` project, and Confluence pages mentioning the current release. The release version is read from `package.json` (override with `RELEASE_VERSION`); `ATLASSIAN_CONFLUENCE_PARENT_PAGE_ID` and `ATLASSIAN_CONFLUENCE_KEY_PAGES` env vars let callers retarget the workspace without editing the script.
- `scripts/pm/requirements.txt` declares the runtime deps (`requests`, `python-dotenv`).

### Changed

- **Planning docs moved from repo root to `specs/`.** `plan.md`, `roadmap.md`, `planning_notes.md`, `design-plan.md`, `SCRUM_BOOTSTRAP_AND_BOARD_PLAN.md`, `SPRINT_0_PLAN.md`, `ATLASSIAN_PM_LINK.md`. `CLAUDE.md`'s pm-daemon paths reference the new locations; the watcher in `alirez-claude-skills/pm-daemon/pm_daemon.py` matches by basename so it picked up the move automatically.
- **`AGENTS.md` rewritten for OpenCode.** Removed the gstack-specific routing block, added a `Backend submodule` "CRITICAL" section, and added pointers to the PM tooling.
- **`.gitignore`** now ignores `.claude/scheduled_tasks.lock` and `.omg/state/` (agent runtime state, not version-controlled).
- Backend submodule pointer bumped to the post-#127 `dev` tip so the cookbook ships with the test-fixture fix in place. No runtime behavior changes.

## [0.2.3] - 2026-04-30

Hotfix on top of v0.2.2 — the migrate Job couldn't reach Cloud SQL.

### Fixed

- `cloudbuild.yaml`: add `--set-cloudsql-instances=comdottasteslikegood:us-central1:vegangenius-db` to the `flask-backend-migrate` Cloud Run Job. The `DATABASE_URL` secret is configured for a Cloud SQL Unix-socket connection (`postgresql://...?host=/cloudsql/<instance>`) — without this flag the socket path doesn't exist in the Job container and SQLAlchemy falls back to localhost, failing with `OperationalError: Is the server running locally and accepting connections on that socket?`. The v0.2.2 build aborted at "Execute Migrate Job" because of this; the new Flask revision was correctly _not_ deployed (the gate worked), but no migration ran. v0.2.3 rebuilds with the corrected Job spec.

## [0.2.2] - 2026-04-30

Production hotfix: restore recipe generation and auth on tasteslikegood.org.

### Fixed

- **Database migrations now run automatically before each Flask deploy.** A new Cloud Run **Job** (`flask-backend-migrate`) wired into `cloudbuild.yaml` runs `flask db upgrade` against Cloud SQL before the Flask service is redeployed. A failing migration aborts the build so the old Flask revision keeps serving traffic. This closes the gap that caused the v0.2.0/v0.2.1 production outage: schema-changing migrations (`recipe.status`, `recipe.slug`, `recipe.is_public`) shipped without ever being applied to prod.
- **Backend submodule pointer bumped to `dev` tip (`15ba254`)**, which now contains an Alembic merge migration unifying the previously branched heads (`03da1e46c9a5` for `recipe.status` and `fc014cd27ab4` for `recipe.slug`/`recipe.is_public`). Without this merge, `flask db upgrade` would have refused to run on prod regardless of when it was called.
- `.gitmodules`: Backend submodule branch tracker fixed from `dev/backend_sub222` (deleted upstream) → `dev`. `git submodule update --remote Backend` now resolves correctly again.

### Changed

- `CLAUDE.md` and `AGENTS.md`: explicit **Branching strategy (FINAL)** section codifies `main` = release, `dev` = integration, feature branches off `dev`. New **Database migrations** section documents the Cloud Run Job and the multi-PR head-conflict policy (`flask db merge`). Release flow updated to include the migrate step. Backend submodule non-obvious pattern rewritten with the current `dev` branch and `flask db heads` check.

## [0.2.1] - 2026-04-29

Post-v0.2.0 polish: repo hygiene, Cloud Run image trimming, agent-tooling wiring. No user-facing app changes.

### Added

- `.mcp.json` registers the `pm-daemon` MCP server (from `alirez-claude-skills/pm-daemon` via `scripts/pm/run_pm_daemon.sh`) so Claude Code, Codex, and other agents auto-spawn the daemon on session start. The daemon watches plan files (`plan.md`, `roadmap.md`, `planning_notes.md`, `design-plan.md`, `SCRUM_BOOTSTRAP_AND_BOARD_PLAN.md`, `SPRINT_0_PLAN.md`, `ATLASSIAN_PM_LINK.md`) and syncs them to Confluence in the background. Deletes orphaned `auto_pm_mcp.json` (wrong filename — Claude Code reads `.mcp.json`).
- PM daemon (`alirez-claude-skills/pm-daemon`) gains recursive plan-file matching (uses `rglob`) and a `--watch-only` mode for running the watcher without MCP transport
- "Always check the `Backend/` submodule repo for PRs and changes" guidance in CLAUDE.md and AGENTS.md, with `gh pr list -R adamtasteslikegood/tasteslikegood.com` and `git -C Backend log` commands. Backend/ is roughly half the project; missed PRs there have caused integration drift on past releases.
- Cloud Build trigger regex documentation in CLAUDE.md — production deploys fire only on tags matching `^v[0-9]+\.[0-9]+\.[0-9]+$`, so pre-release tags like `v0.2.1-rc.1` or build-metadata tags like `v0.2.1+sha.abc` cannot accidentally trigger a production push.

### Changed

- Expand `.dockerignore` and `.gcloudignore` to keep planning, PM, AI/agent tooling (`.codex/`, `.gemini/`, `.junie/`, `.clawhub/`, `claude-code-tresor/`, `skills/`), Python venvs, and non-runtime submodules (`alirez-claude-skills/`, `gemstack/`) out of the Cloud Run build context. Smaller image, faster build, less surface area.
- Clean up `.gitignore`: resolve unresolved `<<<<<<<` / `>>>>>>>` merge conflict markers that had silently been there (likely a missed conflict during a previous merge from `origin/main`), dedupe entries, add Python bytecode patterns, and stop ignoring `AGENTS.md` so the agent-facing guidance is actually tracked in git.

### Fixed

- Bump `alirez-claude-skills` submodule pointer to pick up recursive plan-file watching and `--watch-only` mode in `pm_daemon.py` (was silently uncommitted in the parent for ~3 days)

## [0.2.0] - 2026-04-29

The "Anti-Recipe Site" release. Public recipes can now be shared via clean URLs that crawlers and JS-flaky in-app browsers (Facebook, Instagram) render correctly. Recipe and image generation moved off the request thread onto Pub/Sub workers, so the UI returns instantly instead of holding the connection open for 30+ seconds.

### Added

- Public recipes: toggle "Make Public" on a saved recipe and share `/r/<slug>` — server-rendered HTML with photo, ingredients, instructions, and a working CTA. Indexed by Googlebot. ([TAS-2718](https://linear.app/tasteslikegood/issue/TAS-2718))
- `/browse` index page lists every public recipe with author byline and pagination
- `slug` and `is_public` columns on recipes plus a backfill script for existing entries
- Async AI generation via Pub/Sub: `POST /api/generate` and `POST /api/generate_image` now return 202 instantly; recipes complete in the background and the UI polls for status
- `/api/worker/recipe` and `/api/worker/image` HTTP push endpoints with OIDC verification — Pub/Sub signs each push with a JWT that the endpoints validate against `PUBSUB_INVOKER_SA` before processing
- `scripts/gcloud/setup_pubsub.sh` and `scripts/gcloud/update_push_endpoints.sh` for one-time GCP infrastructure setup (topics, subscriptions, IAM, dead-letter queue)
- Branching guidance in CLAUDE.md, COPILOT.md, and GEMINI.md: always branch off `dev`, never commit directly to `dev` or `main`

### Changed

- SSR proxy routes (`/r`, `/browse`, `/sitemap.xml`) moved from `app.use()` to `app.get()` with rate limiting via `staticPageLimiter` — non-GET methods 404 cleanly, no bot POST spam reaches Flask
- "Make Public" toggle replaced with proper `<button role="switch">` + `aria-labelledby` for screen reader support and to satisfy `@angular-eslint/template/label-has-associated-control`
- `Recipe` model gains a `status` column (`pending`, `ready`, `error`) so the frontend can poll while async generation completes

### Fixed

- OAuth scope reduction: removed broad `cloud-platform` scope from user auth so the consent screen no longer triggers a Google security warning that was scaring away recipe-share recipients
- `Backend/blueprints/worker_api_bp.py` import was missing from `app.py` — the container would have crashed on startup with `NameError`
- Catch `shutdownValkey()` failures inside `createValkeyClient()` so a broken `quit()` cannot prevent reinitialization or fallback to in-memory rate limiting ([TAS-48](https://linear.app/tasteslikegood/issue/TAS-48/catch-quit-failures-before-reinitializing-valkey-client))
- On startup, clear the cached authenticated user when the Flask session is gone instead of downgrading it to guest — prevents the header showing "Sign In" while Kitchen still lists the previously authenticated user's recipes ([TAS-2725](https://linear.app/tasteslikegood/issue/TAS-2725/bug-ui-shows-logged-out-state-login-button-while-still-displaying))
- `.gitmodules` now points `gemstack` at the correct upstream (`adamtasteslikegood/gemstack`) so CI can fetch the recorded SHA

### Removed

- 38MB of stray ImageMagick PostScript dumps committed to repo root with cryptic names (`base64`, `json`, `logging`, `markdown`, `os`, `requests`, `sys`)
- Broken `dependency-submission.yml` workflow — GitHub natively detects npm dependencies from `package-lock.json` ([TAS-2713](https://linear.app/tasteslikegood/issue/TAS-2713/snapshot-github-action-failing-still))
- Standalone pull-based Pub/Sub worker scripts (`Backend/workers/recipe_worker.py`, `image_worker.py`, `run_workers.py`) — replaced by HTTP push endpoints
- Duplicate `gemstack` entry in `.gitmodules`

### Infrastructure

- Cloud Run flask-backend env vars now include `GCP_PROJECT_ID` and `PUBSUB_INVOKER_SA` so the worker endpoints know which OIDC issuer to trust
- New GCP service account `pubsub-pusher@comdottasteslikegood.iam.gserviceaccount.com` with `roles/run.invoker` on flask-backend; flask service account gains `roles/pubsub.publisher`
- Push subscriptions configured with 600s ack-deadline (Imagen takes 30-90s), exponential retry backoff, and dead-letter routing to `generation-dlq` after 5 failed deliveries

### Internal

- Mark all `inject()` service references as `readonly` across Angular components and services ([TAS-2707](https://linear.app/tasteslikegood/issue/TAS-2707/find-a-small-improvement-copy))
- Use `Number.parseInt()` instead of global `parseInt()` in `server/valkey.ts` for consistency with the rest of the codebase
- Add descriptive context to bare `console.error()` in recipe import error handler

## [0.1.0] - 2026-04-13

### Added

- Angular 21 SPA with Signals API — recipe generation, AI food photos, personal cookbook
- Google OAuth 2.0 authentication with guest-session fallback (localStorage)
- Express reverse proxy with Helmet, rate limiting (Valkey / in-memory fallback), request logging
- Flask API with modular blueprint architecture: auth, generation, recipes, collections
- AI recipe generation via Google Gemini; AI food photography via Imagen
- Cloud SQL (PostgreSQL) persistence with Alembic migrations; SQLite for local dev
- Dual-auth pattern: user OAuth credentials → server `GOOGLE_API_KEY` fallback
- Guest-to-authenticated session merge on OAuth login
- Privacy policy page at `/privacy-policy` (KAN-5)
- Valkey IAM auth with periodic token refresh and 3-second graceful shutdown timeout (KAN-16)
- `generation_api_bp` blueprint registered in Flask app (KAN-23)
- `OAUTHLIB_INSECURE_TRANSPORT` guarded behind non-production env check (KAN-29)
- `FLASK_SECRET_KEY` fail-fast on startup in production (KAN-29)
- `client_secret` removed from session cookie; injected at runtime from Secret Manager (KAN-24)
- HTTP 500 error messages sanitized — no internal details exposed to clients (KAN-24)
- Two Cloud Run services: `express-frontend` (public) and `flask-backend` (private VPC) in us-central1
- Cloud Build pipeline with SemVer image tagging (`$SHORT_SHA` + `$_VERSION`) (KAN-32)
- Deploy ordering: Flask backend deploys before Express frontend to prevent version skew (KAN-30)
- Automated CI: PR gate (`pr-gate.yml`) with lint, type-check, build, test, and CHANGELOG checks
- Automated release pipeline (`release.yml`): git tag + GitHub Release + Cloud Build on merge to main
- Branch strategy: `main` (production), `dev` (integration), `fix/KAN-XX` / `feat/KAN-XX` feature branches

### Security

- KAN-23: `generation_api_bp` blueprint registration fix (AI endpoints were unreachable)
- KAN-24: Sanitized all Flask 500 responses; removed `client_secret` from session storage
- KAN-16: Valkey shutdown timeout prevents Cloud Run SIGTERM window exhaustion
- KAN-29: `FLASK_ENV=production` activates production-only guards in Cloud Run

---
