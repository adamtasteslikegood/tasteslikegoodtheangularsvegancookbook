# Staging Environment

Minimal viable staging for the VeganGenius Chef app. Reuses production
container images on separate Cloud Run services so the staging code path
is identical to production.

## Services

| Service                      | Purpose          | URL                              |
| ---------------------------- | ---------------- | -------------------------------- |
| `express-frontend-staging`   | SPA + proxy      | `*.run.app` (auto-assigned)      |
| `flask-backend-staging`      | API (SQLite)     | `*.run.app` (auto-assigned)      |

## What staging is NOT

- **Not a build pipeline.** There is no separate `cloudbuild-staging.yaml`.
  The deploy script pulls the same images that production runs.
- **Not a copy of production data.** Staging uses SQLite with synthetic seed
  data. No Cloud SQL, no real PII.
- **Not an AI generation environment.** No `GEMINI_API_KEY` or
  `GOOGLE_API_KEY` is set, so `/api/generate` and `/api/generate_image`
  will fail. This is intentional: staging does not incur AI costs.

## Quick start

```bash
# Dry run (prints gcloud commands without executing):
./scripts/staging/deploy-staging.sh

# Actually deploy:
./scripts/staging/deploy-staging.sh --apply

# Deploy a specific version:
./scripts/staging/deploy-staging.sh --apply --version v0.4.10

# Seed the staging database (run inside Backend/):
cd Backend
DATABASE_URL=sqlite:///staging.db uv run python ../scripts/staging/seed-data.py
```

## Non-indexable

Staging is non-indexable via two mechanisms, both activated by
`NODE_ENV=staging` on the Express service:

1. **`X-Robots-Tag: noindex, nofollow`** header on every response.
2. **`/robots.txt`** returns `Disallow: /` for all user agents.

No real-user OAuth is configured. Staging uses its own
`FLASK_SECRET_KEY_STAGING` secret for session signing.

## Seeding data

`seed-data.py` populates the staging database with sanitized test data:

- 3 users with `@example.test` emails (no real PII)
- 8 recipes covering edge cases:
  - Published and unpublished recipes
  - Saved copy with `source_slug` (the publish-guard code path)
  - Orphaned guest recipe (no `user_id`, only `guest_session_id`)
  - Recipe stuck in `generating` state
  - Recipe in `error` state
- 1 cookbook with recipe IDs

The seed script is idempotent: re-running it skips existing users.

## Prerequisites

Before first deploy, create the staging secret:

```bash
echo -n "$(openssl rand -base64 32)" | \
  gcloud secrets create FLASK_SECRET_KEY_STAGING \
    --data-file=- --project=comdottasteslikegood
```

## Verification

After deploying, verify:

```bash
STAGING_URL="$(gcloud run services describe express-frontend-staging \
  --region=us-central1 --project=comdottasteslikegood \
  --format='value(status.url)')"

# Should contain noindex header:
curl -sI "$STAGING_URL/" | grep -i x-robots-tag

# Should deny all crawlers:
curl -s "$STAGING_URL/robots.txt"

# Health check:
curl -s "$STAGING_URL/api/health" | python3 -m json.tool
```
