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

| Service                    | Purpose                        | Access                       |
| -------------------------- | ------------------------------ | ---------------------------- |
| `express-frontend-staging` | SPA + proxy                    | Public (`*.run.app`)         |
| `flask-backend-staging`    | API (SQLite)                   | Private — invoker IAM check  |

`flask-backend-staging` mirrors prod's posture (KAN-170): the invoker IAM
check is ON, and Express authenticates with a Google-signed ID token
(`server/flask-auth.ts`). Direct requests to the Flask URL get a 403 from
Cloud Run's edge.

## What staging is NOT

- **Not a build pipeline.** There is no separate `cloudbuild-staging.yaml`.
  The deploy script pulls the same images that production runs.
- **Not a copy of production data.** No Cloud SQL, no real PII.
- **Not durable.** The database is SQLite inside the container: it resets on
  every deploy and holds no tables until something creates them. The service
  is pinned to `max-instances=1` so there is never more than one database.
  The durable-storage decision (seeded image vs Cloud SQL) is tracked in
  [discussion #3394](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/discussions/3394).
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
```

## Seeding data

`seed-data.py` populates a **local** staging-shaped database with sanitized
test data:

- 3 users with `@example.test` emails (no real PII)
- 8 recipes covering edge cases:
  - Published and unpublished recipes
  - Saved copy with `source_slug` (the publish-guard code path)
  - Orphaned guest recipe (no `user_id`, only `guest_session_id`)
  - Recipe stuck in `generating` state
  - Recipe in `error` state
- 1 cookbook with recipe IDs

```bash
cd Backend
DATABASE_URL=sqlite:///staging.db uv run python ../scripts/staging/seed-data.py
```

The script is idempotent: re-running it skips existing users, recipes, and
cookbooks.

**Limitation:** this writes to a SQLite file on the machine running the
script. It cannot reach the deployed Cloud Run service's in-container
database — there is currently **no way to seed the deployed staging
environment**. That is the storage gap discussion #3394 exists to close;
the seeder is the reusable half of whichever option lands (bake the seeded
file into an image, or point the script at a staging Cloud SQL instance).

## Non-indexable

Staging is non-indexable via two mechanisms, both activated by
`NODE_ENV=staging` on the Express service (covered by `server/staging.test.ts`):

1. **`X-Robots-Tag: noindex, nofollow`** header on every response,
   including `/robots.txt` itself.
2. **`/robots.txt`** returns `Disallow: /` for all user agents.

No real-user OAuth is configured. Staging uses its own
`FLASK_SECRET_KEY_STAGING` secret for session signing.

## Prerequisites

Before first deploy, create the staging secret **in the staging project**:

```bash
echo -n "$(openssl rand -base64 32)" | \
  gcloud secrets create FLASK_SECRET_KEY_STAGING \
    --data-file=- --project=gen-lang-client-0491022701
```

Everything else (Secret Manager API enablement, secret-accessor grant,
cross-project image-pull grant, Express→Flask invoker grant) is handled by
`deploy-staging.sh` step 0/1, idempotently.

## Verification

After deploying, verify:

```bash
STAGING_PROJECT=gen-lang-client-0491022701

STAGING_URL="$(gcloud run services describe express-frontend-staging \
  --region=us-central1 --project=$STAGING_PROJECT \
  --format='value(status.url)')"
FLASK_URL="$(gcloud run services describe flask-backend-staging \
  --region=us-central1 --project=$STAGING_PROJECT \
  --format='value(status.url)')"

# Should contain noindex header:
curl -sI "$STAGING_URL/" | grep -i x-robots-tag

# Should deny all crawlers:
curl -s "$STAGING_URL/robots.txt"

# Health check (through Express):
curl -s "$STAGING_URL/api/health" | python3 -m json.tool

# Flask must NOT be directly reachable (expect 403):
curl -s -o /dev/null -w '%{http_code}\n' "$FLASK_URL/api/health"
```
