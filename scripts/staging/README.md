# Staging Environment

Minimal viable staging for the VeganGenius Chef app. Reuses production
container images on separate Cloud Run services so the staging code path
is identical to production.

Staging runs in its **own GCP project** — `gen-lang-client-0491022701`
(display name `comdottasteslikegood-staging`), which lives in the org's
`Staging` folder. Prod (`comdottasteslikegood`) is untouched: staging shares
no IAM surface, secret namespace, or quota pool with it. The only
cross-project edge is a read-only Artifact Registry grant so staging can pull
the prod-built images (the deploy script wires it, idempotently).

## Services

| Service                    | Purpose                | Access                      |
| -------------------------- | ---------------------- | --------------------------- |
| `express-frontend-staging` | SPA + proxy            | Public (`*.run.app`)        |
| `flask-backend-staging`    | API (CloudSQL Postgres) | Private — invoker IAM check |

`flask-backend-staging` mirrors prod's posture (KAN-170): the invoker IAM
check is ON, and Express authenticates with a Google-signed ID token
(`server/flask-auth.ts`). Direct requests to the Flask URL get a 403 from
Cloud Run's edge.

## What staging is NOT

- **Not a build pipeline.** There is no separate `cloudbuild-staging.yaml`.
  The deploy script pulls the same images that production runs.
- **Not a copy of production data.** No real PII. The database is a CloudSQL
  Postgres (db-f1-micro, `vegangenius-staging-db` in the staging project),
  seeded from the app's own Export Cookbook JSON — real recipe shapes, but
  every row is owned by a synthetic `@example.test` user. Migrated from
  Railway Postgres to CloudSQL in KAN-248 (2026-08-24); supersedes the
  Railway decision from KAN-182 and
  [discussion #3394](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/discussions/3394).
- **Not an AI generation environment.** No `GOOGLE_API_KEY` is set, and —
  more fundamentally — staging has no Pub/Sub (`GCP_PROJECT_ID` is empty),
  so `/api/generate` fails at the publish step regardless of any key. This
  is intentional: staging does not incur AI costs (stub-vs-budget-key
  decision tracked in KAN-225). To test generation, use
  `local-generation.sh` (below) — the full pipeline on your machine, with
  only the Gemini call leaving it.

## Quick start

```bash
# Dry run (prints gcloud commands without executing):
./scripts/staging/deploy-staging.sh

# Actually deploy:
./scripts/staging/deploy-staging.sh --apply

# Deploy a specific version:
./scripts/staging/deploy-staging.sh --apply --version v0.4.10
```

**Image-tag gotcha:** the default tag is `v<package.json version>`, but the
prod registry currently carries only commit-SHA tags (the release
pipeline's `_VERSION` tagging step has never produced a `v*` tag there).
Until that lands, pass the SHA prod runs, e.g.
`--version "$(gcloud run services describe flask-backend --region=us-central1 --project=comdottasteslikegood --format='value(spec.template.spec.containers[0].image)' | sed 's/.*://')"`.

## Database (CloudSQL Postgres)

The staging database is a CloudSQL Postgres (db-f1-micro, Postgres 15)
instance `vegangenius-staging-db` in the staging project, private-IP only
(10.62.0.3). Flask reaches it via the Cloud SQL Auth Proxy sidecar
(`--set-cloudsql-instances` on the Cloud Run service).

The connection string is stored **only** in Secret Manager as
`DATABASE_URL_STAGING` in the staging project, using a Unix-socket path:
`postgresql://USER:PASS@/vegangenius?host=/cloudsql/gen-lang-client-0491022701:us-central1:vegangenius-staging-db`

Schema comes from the normal Alembic migrations, run via Cloud Run Job
(the private IP is not routable from a dev machine):

```bash
gcloud run jobs execute flask-staging-migrate \
  --region=us-central1 --project=gen-lang-client-0491022701 --wait
```

## Seeding data

`seed-data.py` populates the staging database two ways, combinable in one
run:

**Synthetic edge rows** (always): 3 users with `@example.test` emails,
8 recipes covering the shapes acceptance criterion 3 needs — published and
unpublished, saved copy with `source_slug` (the publish-guard path),
orphaned guest recipe, `generating` and `error` states — plus 1 cookbook.

**Real export import** (`--from-json`): imports an Export Cookbook JSON
(the app's own export button, shipped since pre-0.1.0). The export carries
no user/email fields, so sanitization reduces to assigning every row to the
synthetic staging-admin owner; all imported rows get `status='ready'`. The
payload already matches `Backend/recipe_schema.json` (camelCase
`prepTime`/`cookTime` are canonical inside `Recipe.data`); only column
fields are lifted out (`sourceSlug` → `source_slug`).

```bash
# Via Cloud Run Job (recommended — private IP not routable from dev machine):
gcloud run jobs execute flask-staging-migrate \
  --region=us-central1 --project=gen-lang-client-0491022701 --wait \
  --args="python,-c,<seed-script-b64>"

# Or locally if you have Cloud SQL Auth Proxy running:
cd Backend
DATABASE_URL='postgresql://...' uv run python \
  ../scripts/staging/seed-data.py \
  --from-json ../<your-cookbook-export>.json
```

The script is idempotent: re-running skips existing users, recipes (by id
and by slug), and cookbooks. **Never commit an export file** — the repo is
public; `.gitignore` blocks `*COOKBOOK_EXPORT*.json` as a guard.

## Logging in on staging (Google OAuth)

Login is **off by default**: without OAuth secrets the Sign In button dead-ends
(`GET /api/auth/login` → 500 `"OAuth credentials not configured"`,
`Backend/blueprints/auth_api_bp.py`) and the SPA stays guest-only. Guest
sessions still read/write the staging DB — but scoped to a fresh
`guest_session_id`, so the seeded cookbook is not visible.

To enable real login:

1. In the **staging project's** console, configure the OAuth consent screen
   (External + Testing; add the Google accounts that will log in as test
   users) and create an **OAuth 2.0 Client ID** (type: Web application) with
   authorized redirect URI:

   ```
   https://<express-staging-url>/api/auth/callback
   ```

2. Store both halves as staging secrets:

   ```bash
   printf '%s' "<client-id>" | gcloud secrets create GOOGLE_CLIENT_ID_STAGING \
     --data-file=- --project=gen-lang-client-0491022701
   printf '%s' "<client-secret>" | gcloud secrets create GOOGLE_CLIENT_SECRET_STAGING \
     --data-file=- --project=gen-lang-client-0491022701
   ```

3. Re-run `./scripts/staging/deploy-staging.sh --apply --version <tag>`. The
   script detects the secrets, wires them plus `FRONTEND_URL` (resolved from
   the existing Express service URL) into Flask, and login turns on. Without
   the secrets the same deploy keeps login off — presence is the switch.

**Owning the seeded cookbook:** imports land under the synthetic
staging-admin user. `seed-data.py --claim-email <your-login-email>` moves
those recipes/cookbooks to a user row with your email; the OAuth callback
matches by email before creating a user, so your first Google login attaches
to that row and the kitchen shows the claimed cookbook. Claimed the wrong
address? Re-run with `--claim-from <wrong> --claim-email <right>`.

## Local generation testing (Pub/Sub emulator)

`local-generation.sh` runs the complete async generation pipeline locally:
`POST /api/generate` → Pub/Sub emulator (Docker) → push subscription →
`/api/worker/recipe` → Gemini. Only the Gemini call leaves your machine; no
cloud infrastructure is touched.

```bash
# Terminal 1 — emulator + Flask (:5000), Ctrl-C stops both:
./scripts/staging/local-generation.sh              # local sqlite
./scripts/staging/local-generation.sh --staging-db # CloudSQL staging Postgres (needs Auth Proxy)

# Terminal 2 — the SPA as usual:
npm run dev
```

Requirements: Docker, uv, and a Gemini key — either `GOOGLE_API_KEY` in the
environment or (preferred) the dedicated staging key stored once as the
`GOOGLE_API_KEY_STAGING` secret, which the script fetches on every run:

```bash
printf '%s' "<the-key>" | gcloud secrets create GOOGLE_API_KEY_STAGING \
  --data-file=- --project=gen-lang-client-0491022701
```

Notes: the target database must already have the schema (`flask db
upgrade`); `GOOGLE_API_KEY=dummy` exercises everything but the Gemini call
(the worker receives the push and fails only there — useful plumbing test);
image jobs additionally need GCS (`GCS_BUCKET_NAME` + credentials) and fail
gracefully without it, while recipe generation completes normally.

## Non-indexable

Staging is non-indexable via two mechanisms, both activated by
`NODE_ENV=staging` on the Express service (covered by `server/staging.test.ts`):

1. **`X-Robots-Tag: noindex, nofollow`** header on every response,
   including `/robots.txt` itself.
2. **`/robots.txt`** returns `Disallow: /` for all user agents.

Staging uses its own `FLASK_SECRET_KEY_STAGING` secret for session signing;
real-user OAuth is off unless the staging OAuth secrets exist (see "Logging
in on staging" above).

## Prerequisites

Before first deploy, create the two staging secrets **in the staging
project**:

```bash
# Session signing (generated):
echo -n "$(openssl rand -base64 32)" | \
  gcloud secrets create FLASK_SECRET_KEY_STAGING \
    --data-file=- --project=gen-lang-client-0491022701

# Database URL (CloudSQL via Auth Proxy Unix socket):
printf '%s' 'postgresql://vegangenius-staging-user:<PASSWORD>@/vegangenius?host=/cloudsql/gen-lang-client-0491022701:us-central1:vegangenius-staging-db' | \
  gcloud secrets create DATABASE_URL_STAGING \
    --data-file=- --project=gen-lang-client-0491022701
```

Everything else (Secret Manager API enablement, secret-accessor grants,
cross-project image-pull grant, Express→Flask invoker grant, CloudSQL proxy
annotation) is handled by `deploy-staging.sh` step 0/1, idempotently. If
the DB password is rotated, add a new secret version — no redeploy needed
beyond a new revision picking up `:latest`.

## Verification

`verify-staging.sh` is the machine-checkable S3 acceptance gate — it
asserts the noindex header, robots deny-all, `/api/health` reporting
`environment=staging`, Flask returning 403 directly, `/browse` and the
public recipe API serving non-empty DB-backed content, and `/static/*`
content types. Exits 0 only if every check passes:

```bash
# URLs resolved via gcloud:
./scripts/staging/verify-staging.sh

# Or explicit (no gcloud needed):
./scripts/staging/verify-staging.sh https://express-frontend-staging-HASH-uc.a.run.app https://flask-backend-staging-HASH-uc.a.run.app
```
