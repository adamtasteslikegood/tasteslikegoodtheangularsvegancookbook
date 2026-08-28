# Staging deploys — the GCP Cloud Build trigger

> **Status:** trigger **not yet created**. This document is the record of what it
> must be, written before it exists so that "it exists" becomes a falsifiable
> claim. **KAN-249 / KAN-250, Sprint 9 S3.**

## Why this file exists

Production deploys from a Cloud Build trigger configured in the GCP console.
Nothing in this repository describes it. Sprint 9 names that as risk **R2**:

> S3's GCP trigger is config with no repo record, so it passes vacuously.

A console-only trigger cannot be reviewed from a checkout, cannot be diffed, and
cannot be restored after an accidental delete. Worse, a checklist row that reads
"trigger exists" is unfalsifiable, so it gets ticked and then rots — which is the
same failure mode the release runbook already documents about the Backend
back-sync count.

So the trigger's configuration lives in two places that cannot drift apart:

| Artifact                                        | Role                                                      |
| ----------------------------------------------- | --------------------------------------------------------- |
| `scripts/gcloud/setup_staging_build_trigger.sh` | The executable record. Creates, updates, and **verifies** |
| This document                                   | The prose: why, prerequisites, cutover order, risks       |

Run `./scripts/gcloud/setup_staging_build_trigger.sh --verify` to compare the
live trigger against the record. It exits non-zero on drift, on absence, and on
the trigger being disabled.

## Target topology

Symmetric with production. One mechanism, one config format, one place to look.

```
git tag staging-v0.5.0 && git push  ->  trigger ^staging-v.*               ->  cloudbuild.staging.yaml
git tag v0.5.0         && git push  ->  trigger ^v[0-9]+\.[0-9]+\.[0-9]+$  ->  cloudbuild.yaml
```

The two patterns cannot collide. Production's is anchored and digits-only, so it
can never match a `staging-` prefix.

### The two triggers

| Field        | Staging                                                     | Production                          |
| ------------ | ----------------------------------------------------------- | ----------------------------------- |
| Project      | `gen-lang-client-0491022701`                                | `comdottasteslikegood`              |
| Region       | `us-central1`                                               | `us-central1`                       |
| Name         | `staging-tag-deploy`                                        | (console-created; see caveat below) |
| Event        | push tag                                                    | push tag                            |
| Tag pattern  | `^staging-v.*`                                              | `^v[0-9]+\.[0-9]+\.[0-9]+$`         |
| Build config | `cloudbuild.staging.yaml`                                   | `cloudbuild.yaml`                   |
| Repo         | `adamtasteslikegood/tasteslikegoodtheangularsvegancookbook` | same                                |

> **Caveat, stated rather than glossed:** the production row is transcribed from
> `scripts/release/RUNBOOK.md` § 7 and `CLAUDE.md`, **not** read from the live
> trigger. The pattern is authoritative — the runbook records it as the reason
> `v0.4.8-rc.1` and the rewritten `v0.4.5+0ff0e4e` immutable tags never
> redeployed. The trigger's _name_ and _service account_ were not verifiable at
> the time of writing. Confirm with:
>
> ```bash
> gcloud builds triggers list --project=comdottasteslikegood --region=us-central1 \
>   --format='table(name,github.push.tag,filename,serviceAccount,disabled)'
> ```
>
> Note the **`--region`**: this project is regional, and a global list shows
> nothing.

## Prerequisites

Everything below is state that **no code in this repository provisions**. That is
precisely why it is written down. The `--preflight` mode of the setup script
checks each item and names the failure.

### Repo connection

Cloud Build source connections are **per project**. Production's GitHub
connection lives in `comdottasteslikegood` and does **not** carry over to the
staging project. As of 2026-08-27 Cloud Build has never run in
`gen-lang-client-0491022701` at all, so assume the connection is missing.

Either:

- install the **Cloud Build GitHub App (1st gen)** on the staging project for
  `adamtasteslikegood/tasteslikegoodtheangularsvegancookbook`, and let the script
  use `--repo-owner` / `--repo-name` (its default); or
- create a **2nd-gen host connection** and pass the repository resource:

  ```bash
  REPO_RESOURCE=projects/gen-lang-client-0491022701/locations/us-central1/connections/<c>/repositories/<r> \
    ./scripts/gcloud/setup_staging_build_trigger.sh
  ```

There is no read-only API that proves a 1st-gen install, so the create call is
the test. A `repository not found` or permission error there means the
connection, not the flags.

### Build identity

The trigger's build runs as a service account. Left unset, that is the project's
legacy **default compute SA**, `26682253182-compute@developer.gserviceaccount.com`.

The IAM grants proposed on PR #3441 to make Cloud Build work in the staging
project are:

```
roles/cloudbuild.builds.builder
roles/artifactregistry.writer
roles/run.admin
roles/iam.serviceAccountUser        (project level)
roles/secretmanager.secretAccessor
```

**Read that list against what it is replacing before applying it.** The GitHub
Actions lane this migration retires deliberately refused two of those grants, and
wrote down why:

- `roles/run.admin` includes every `*.setIamPolicy` permission. The Actions
  deployer used **`roles/run.developer`** instead, which covers
  `services.create/update` and `jobs.update/run` and excludes IAM mutation.
- **Project-level `roles/iam.serviceAccountUser`** plus deploy rights is a
  privilege-escalation pair: it lets a compromised build deploy code running as
  _any_ service account in the project, inheriting that identity's secrets and
  API access. The Actions deployer held `serviceAccountUser` **on one service
  account only**.

There is in-repo empirical evidence the narrow posture is sufficient: the
retired workflow performed the same verbs this build performs
(`gcloud run services update`, `gcloud run jobs update --wait`) under
`run.developer` plus a resource-scoped `serviceAccountUser`, and those deploys
succeeded.

The compute SA is also the **runtime** identity of all three staging workloads
(`flask-backend-staging`, `express-frontend-staging`, `flask-staging-migrate`),
so widening it widens what a compromised _running service_ can do, not just a
build.

**Recommendation (Adam's call, not self-authorized):** create a dedicated
`staging-cloudbuild@gen-lang-client-0491022701` service account, grant it
`roles/cloudbuild.builds.builder`, `roles/artifactregistry.writer` on the
`vegangenius` repo, `roles/secretmanager.secretAccessor` on the five
`*_STAGING` secrets, `roles/run.developer` at project level, and
`roles/iam.serviceAccountUser` **on the compute SA only**, then set:

```bash
TRIGGER_SERVICE_ACCOUNT=projects/gen-lang-client-0491022701/serviceAccounts/staging-cloudbuild@gen-lang-client-0491022701.iam.gserviceaccount.com \
  ./scripts/gcloud/setup_staging_build_trigger.sh
```

A user-managed build SA **requires** `options.logging: CLOUD_LOGGING_ONLY`.
`cloudbuild.staging.yaml` already sets it; without it the build fails at submit.

### Everything else

| Resource                                                               | State                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------- |
| Artifact Registry `vegangenius` (`us-central1`)                        | created 2026-08-25, staging project                      |
| Cloud SQL `vegangenius-staging-db`                                     | db-f1-micro, private IP, migrated off Railway 2026-08-24 |
| Secrets `*_STAGING` (×5)                                               | separate secrets in the staging project                  |
| `pubsub-pusher@gen-lang-client-0491022701`                             | OIDC signer for push delivery                            |
| Cloud Run services `express-frontend-staging`, `flask-backend-staging` | live                                                     |

Cloud Run pulls from the staging registry with no extra grant:
`roles/run.serviceAgent` already includes
`artifactregistry.repositories.downloadArtifacts`.

## Absorbed from `.github/workflows/staging-deploy.yml`

That workflow is deleted by this change. Its header was the only durable record
of several facts; the ones still true are preserved here so the deletion does not
lose them.

- **Workload Identity pool/provider**
  `projects/746675616486/locations/global/workloadIdentityPools/github-actions/providers/github`.
  Pre-existing, already pinned to this repo. Still used by other workflows
  (`gc-build-deploy.yml`, posture checks); do **not** delete it.
- **Deployer SA** `staging-deployer@gen-lang-client-0491022701`, bound to that
  pool with `roles/iam.workloadIdentityUser` scoped to this repo. Grants:
  `roles/run.developer` at project level, `roles/iam.serviceAccountUser` on the
  compute SA only, `roles/artifactregistry.writer` on the `vegangenius` repo,
  **nothing in `comdottasteslikegood`**. Once the trigger is live and proven this
  SA and the repo secrets `GCP_STAGING_WIF_PROVIDER` /
  `GCP_STAGING_SERVICE_ACCOUNT` become unused — **retire them in a follow-up, not
  in the same change that removes their only consumer.** Its grant shape is the
  reference posture recommended above.
- **Migrate Job naming.** The workflow drove `flask-staging-migrate`, created in
  the console on 2026-08-24. `cloudbuild.staging.yaml` defaults `_MIGRATE_JOB` to
  **`flask-backend-staging-migrate`** and uses `gcloud run jobs deploy`, which
  creates the Job if absent. So the first trigger-driven build does **not** fail
  — it creates a _second_ migrate Job and leaves the original orphaned. Decide
  one way before cutover: either set `_MIGRATE_JOB: flask-staging-migrate` to
  adopt the existing Job, or accept the new name and delete the old Job. Leaving
  both is drift with a fuse on it.
- **`staging-v*` was already the workflow's trigger pattern.** Deleting the
  workflow and creating the trigger are therefore the _same_ cutover, not two
  independent steps — see below.

## Cutover order (this is the part that bites)

The workflow and the trigger listen to the **same** `staging-v*` tag pattern.

- Delete the workflow **before** the trigger works → staging has no deploy path.
- Create the trigger **while** the workflow still exists → one tag fires two
  concurrent deploys, racing on the migrate Job and the Cloud Run revisions.

So:

1. Apply the IAM grants and the repo connection (above).
2. Create the trigger: `./scripts/gcloud/setup_staging_build_trigger.sh`.
3. `--verify` exits 0.
4. **Temporarily disable the old workflow** — `gh workflow disable staging-deploy.yml`
   — so the acceptance tag fires exactly one deploy. The workflow is still on
   `dev` at this point: the PR that deletes it is gated on step 6, so during
   cutover both listeners exist and only one may be armed.
5. Push one acceptance tag and **watch it**:

   ```bash
   git tag staging-v0.5.0-acceptance && git push origin staging-v0.5.0-acceptance
   gcloud builds list --project=gen-lang-client-0491022701 --region=us-central1 --limit=5
   gcloud builds log <BUILD_ID> --project=gen-lang-client-0491022701 --region=us-central1 --stream
   ```

   `--region` is mandatory; a global list shows nothing.

   > The acceptance tag must match `^staging-v.*` but should not look like a
   > release. `staging-v0.5.0-acceptance` matches the staging pattern and cannot
   > match production's anchored digits-only pattern.

6. `./scripts/staging/verify-staging.sh` exits 0 against the **resulting**
   revision. Confirm it is the resulting one: the build's `Verify Staging
Identity` step must have passed in the log from step 5. A passing
   `verify-staging.sh` against a revision deployed by something else is not
   evidence.
7. Only then merge the workflow deletion.

**Do not read a green build as a deploy.** The runbook already records the
inverse failure for production (a spent version tags nothing and reports
success). Here the analogous trap is the trigger existing but disabled, or
pointing at `cloudbuild.yaml`: `--verify` fails on both.

## Rollback

The workflow deletion is one `git revert` away, and the WIF provider, deployer
SA, and repo secrets are all left in place by this change specifically so that
revert is sufficient. Disable the trigger rather than deleting it
(`gcloud builds triggers update ... --disabled`) so the record and the resource
stay in sync.
