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
| `flask-backend-staging`    | API (Railway Postgres) | Private — invoker IAM check |

`flask-backend-staging` mirrors prod's posture (KAN-170): the invoker IAM
check is ON, and Express authenticates with a Google-signed ID token
(`server/flask-auth.ts`). Direct requests to the Flask URL get a 403 from
Cloud Run's edge.

## What staging is NOT

- **Not a build pipeline.** There is no separate `cloudbuild-staging.yaml`.
  The deploy script pulls the same images that production runs.
- **Not a copy of production data.** No Cloud SQL, no real PII. The database
  is a Railway Postgres (Railway project `thriving-reverence`) seeded from
  the app's own Export Cookbook JSON — real recipe shapes, but every row is
  owned by a synthetic `@example.test` user. Decision recorded in KAN-182
  (2026-08-10); it supersedes
  [discussion #3394](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/discussions/3394)'s
  seeded-image vs Cloud SQL axis.
- **Not an AI generation environment.** No `GEMINI_API_KEY` or
  `GOOGLE_API_KEY` is set, so `/api/generate` and `/api/generate_image`
  will fail. This is intentional: staging does not incur AI costs
  (stub-vs-budget-key decision tracked in KAN-225).

## Quick start

```bash
# Dry run (prints gcloud commands without executing):
./scripts/staging/deploy-staging.sh

# Actually deploy:
./scripts/staging/deploy-staging.sh --apply

# Deploy a specific version:
./scripts/staging/deploy-staging.sh --apply --version v0.4.10
```

## Database (Railway Postgres)

The staging database is a Railway Postgres in Railway project
`thriving-reverence`, reached from Cloud Run over Railway's public TCP
proxy (`railway connect` is a local-machine tunnel; Cloud Run cannot use
it, and Railway private networking is intra-Railway only). The connection
string is stored **only** in Secret Manager as `DATABASE_URL_STAGING` in
the staging project, with `sslmode=require` appended.

Schema comes from the normal Alembic migrations, run from `Backend/`
against the Railway URL:

```bash
cd Backend
DATABASE_URL='<railway url>?sslmode=require' uv run flask db upgrade
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
cd Backend
DATABASE_URL='<railway url>?sslmode=require' uv run python \
  ../scripts/staging/seed-data.py \
  --from-json ../<your-cookbook-export>.json
```

The script is idempotent: re-running skips existing users, recipes (by id
and by slug), and cookbooks. **Never commit an export file** — the repo is
public; `.gitignore` blocks `*COOKBOOK_EXPORT*.json` as a guard.

## Non-indexable

Staging is non-indexable via two mechanisms, both activated by
`NODE_ENV=staging` on the Express service (covered by `server/staging.test.ts`):

1. **`X-Robots-Tag: noindex, nofollow`** header on every response,
   including `/robots.txt` itself.
2. **`/robots.txt`** returns `Disallow: /` for all user agents.

No real-user OAuth is configured. Staging uses its own
`FLASK_SECRET_KEY_STAGING` secret for session signing.

## Prerequisites

Before first deploy, create the two staging secrets **in the staging
project**:

```bash
# Session signing (generated):
echo -n "$(openssl rand -base64 32)" | \
  gcloud secrets create FLASK_SECRET_KEY_STAGING \
    --data-file=- --project=gen-lang-client-0491022701

# Database URL (copied from Railway: thriving-reverence → Postgres →
# Variables → DATABASE_PUBLIC_URL, with sslmode=require appended):
printf '%s' "${DATABASE_PUBLIC_URL}?sslmode=require" | \
  gcloud secrets create DATABASE_URL_STAGING \
    --data-file=- --project=gen-lang-client-0491022701
```

Everything else (Secret Manager API enablement, secret-accessor grants,
cross-project image-pull grant, Express→Flask invoker grant) is handled by
`deploy-staging.sh` step 0/1, idempotently. If Railway's credentials are
rotated, add a new secret version — no redeploy needed beyond a new
revision picking up `:latest`.

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
