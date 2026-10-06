# KAN-329 hotfix — cutover runbook

**Owner:** Adam. **Written:** 2026-10-06 against cookbook fork `2c3ed0d` and Backend fork `51720c5`.
**Companion:** `specs/KAN-329_PUBLISH_GATE_HOTFIX_PLAN.md` (the plan; this file is the procedure).

**Scope:** from "T6 complete in both advisory forks" to "pause lifted, production verified by
content, `verify` clean, advisories published, close-out done".

Every step is: command → expected output → check → what to do when the check fails. Anything
not verified while writing is marked `[VERIFY]` with the command that verifies it; the full
list is in the appendix. `gcloud` could not be read while writing (token refresh needs an
interactive login), so every Cloud Run / Cloud Build / Scheduler fact below is `[VERIFY]`
unless it comes from `cloudbuild.yaml` or `scripts/staging/deploy-staging.sh`.

## Abort rules (the three that decide the day)

| Signal                                                        | Meaning                                      | Action                                                                                                      |
| ------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `cutover` exits **2** (`manifest refused: …`)                 | Undecided, duplicate, unknown or bare row    | Nothing changed. Fix the manifest, re-upload, dry-run again.                                                |
| `cutover` exits **3** (`cutover refused: … held by a worker`) | A text or image worker still holds a row     | Nothing changed. Wait for the drain (Phase E.4). `--allow-busy` only after an abandoned claim is confirmed. |
| `verify` exits **1** (`PROBLEM …` lines)                      | The public set is not what the manifest says | **Stay paused.** Fix (re-bless or unpublish), re-run `verify`, lift the pause only on exit 0.               |

`cutover` without `--apply` always rolls back and exits 0 even when it prints `SECOND` rows —
read the report, not the exit code.

## Phase overview

| Phase | What                                                                            | Mutates                                   | Gate to the next phase                                         |
| ----- | ------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| A     | Pre-flight: local gates, forks pushed, fork PRs opened, #3612 held              | nothing                                   | both gate runs green, `v0.5.8` untagged, #3612 OPEN            |
| B     | Bootstrap the audit job, run `list`, review, decide, dry-run `cutover`          | one image, one job per project, GCS files | every manifest row decided; dry-run has no `SECOND` rows       |
| C     | Backend: merge fork PR → `dev`, promote `dev`→`main`, back-sync                 | Backend `dev`/`main` (public)             | new Backend `main` SHA recorded                                |
| D     | Cookbook: pin Backend `main`, amend CHANGELOG, merge fork PR → `dev`            | cookbook `dev` (public)                   | `train-verify.sh --for-release` exit 0 from a `dev` checkout   |
| E     | Pause ON: fork-built Express revision with `RECIPE_WRITE_PAUSE=1`               | `express-frontend` revision               | POST → 503, GET → not 503, drain count 0                       |
| F     | Release: merge #3612 → tag `v0.5.8` → Cloud Build                               | production services + jobs                | build SUCCESS, pause still on, migrate job ran                 |
| G     | Cutover: staging job, then production job (dry-run → re-bless → apply → verify) | recipe rows, Valkey keys                  | `verify` exit 0 on both                                        |
| H     | Lift the pause, verify by content, re-list, record counts                       | `express-frontend` revision               | marker found, health 200s, kept slug 200, unpublished slug 404 |
| I     | Publish advisories, back-sync, Jira, audit record, follow-ups                   | advisories (public), `dev` back-sync      | done                                                           |

Phases C → F are the public-exposure window (see "Evaluation points", 2). Do not start C
until B is complete and E can follow immediately.

## Conventions

Shell variables used throughout. Paste once per terminal.

```bash
COOKBOOK_FORK=/home/allisone/Projects/tasteslikegoodtheangularsvegancookbook-ghsa-8744-3qm2-c4x8
BACKEND_FORK=/home/allisone/Projects/tasteslikegood.com-ghsa-48gm-m2wj-96xh
COOKBOOK=adamtasteslikegood/tasteslikegoodtheangularsvegancookbook
BACKEND=adamtasteslikegood/tasteslikegood.com
PROD_PROJECT=comdottasteslikegood
STAGE_PROJECT=gen-lang-client-0491022701
REGION=us-central1
REG=us-central1-docker.pkg.dev/comdottasteslikegood/vegangenius
TAG=kan-329-audit
PROD_BUCKET=tasteslikegood-recipe-images
STAGE_BUCKET=tasteslikegood-recipe-images-staging
PROD=https://www.tasteslikegood.org
STAGE=https://staging.tasteslikegood.xyz
AUDIT_JOB=flask-backend-publish-audit
```

Reading a job execution's output (used in B, G, H). `--wait` exits non-zero when the task
fails, but the script's exit code (1/2/3) is only in the logs:

```bash
# newest execution of the audit job; set P to $PROD_PROJECT or $STAGE_PROJECT
P=$PROD_PROJECT
EXEC=$(gcloud run jobs executions list --job $AUDIT_JOB --region $REGION --project $P --limit 1 --format='value(metadata.name)')
gcloud run jobs executions describe "$EXEC" --region $REGION --project $P --format='yaml(status.conditions,status.succeededCount,status.failedCount)'
gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=$AUDIT_JOB AND labels.\"run.googleapis.com/execution_name\"=\"$EXEC\"" --project $P --limit 500 --order=desc --format='value(textPayload)' | tac
```

Trap: `--freshness` is ignored with `--order=asc` (you get the oldest N entries). Read
`--order=desc` and `tac`, and check the first timestamp is today. `[VERIFY]` the label key
`run.googleapis.com/execution_name` on the first real execution; if empty, drop the
`labels.` clause and filter by time instead.

---

## Phase A — Pre-flight

### A.1 Both forks: clean, current, pushed

```bash
cd $COOKBOOK_FORK && git status --short --branch && git log --oneline -1
cd $BACKEND_FORK && git status --short --branch && git log --oneline -1
gh api repos/$COOKBOOK/branches/dev --jq .commit.sha
gh api repos/$BACKEND/branches/dev --jq .commit.sha
```

Expected: `## advisory-fix-1...origin/advisory-fix-1` with no `[ahead` and no modified files in
either fork (the cookbook fork's `Backend` submodule is uninitialized, see D.1 — that is not a
modification); tips `2c3ed0d` (cookbook) and `51720c5` (Backend) or later; public `dev` tips
`534ac17` (cookbook) and `0506f0f` (Backend), which are the forks' merge bases (verified
2026-10-06).

If a public `dev` tip moved: rebase the fork branch onto it (`git fetch
https://github.com/$COOKBOOK dev && git rebase FETCH_HEAD`, same for Backend), re-run A.2,
push the fork. The advisory merge does a three-dot merge; a stale base merges but is then a
merge you never tested.

### A.2 Local gates (CI never runs on advisory forks — this is the gate)

```bash
cd $BACKEND_FORK && uv run black --check . && uv run flake8 && uv run mypy . && uv run pytest -q 2>&1 | tail -3
cd $COOKBOOK_FORK && npm run lint && npm run format:check && npm run type-check && npm test 2>&1 | tail -5 && npm run build 2>&1 | tail -3
```

Expected: Backend `785 passed` (last run), cookbook `829 passed` (last run), build exit 0.
Fail → fix in the fork, commit, push, re-run. Do not proceed on a red gate; there is no CI
behind the advisory merge.

### A.3 Open the temporary-fork PRs (none exist yet — verified 2026-10-06)

GitHub docs: pull requests in a temporary private fork are created from the advisory page
("Compare & pull request"), **cannot be merged individually** — all open PRs of an advisory
are merged at once from the advisory — and status checks and branch protection do not run on
them. Merging and publishing are separate actions; **publishing deletes the fork.**

1. `https://github.com/$BACKEND/security/advisories/GHSA-48gm-m2wj-96xh` → the fork banner →
   **Compare & pull request** for `advisory-fix-1`. Base must be `dev` (the default branch in
   both repos, verified). Title neutral, ending `[KAN-329]`.
2. Same for `https://github.com/$COOKBOOK/security/advisories/GHSA-8744-3qm2-c4x8`, title
   ending `[KAN-330]`.

```bash
gh pr list -R $BACKEND-ghsa-48gm-m2wj-96xh --state open --json number,headRefName,baseRefName,url
gh pr list -R $COOKBOOK-ghsa-8744-3qm2-c4x8 --state open --json number,headRefName,baseRefName,url
```

Expected: one open PR each, `headRefName: advisory-fix-1`, `baseRefName: dev`. Base is anything
else → close it and re-open against `dev`. **Do not press Merge yet.**

### A.4 Release PR #3612 held, `v0.5.8` untagged

```bash
gh pr view 3612 -R $COOKBOOK --json state,mergeable,mergeStateStatus,headRefName,baseRefName
git ls-remote --tags https://github.com/$COOKBOOK v0.5.8
```

Expected: `state OPEN`, `headRefName dev`, `baseRefName main` (verified: OPEN, CLEAN,
MERGEABLE); the tag query prints **nothing** (verified: only `v0.5.7` exists). A `v0.5.8` tag
already present means the version is spent: `release.yml` would skip the tag and nothing would
deploy — stop, bump to 0.5.9 through RUNBOOK step 5, and replace every `v0.5.8` below.

### A.5 Release-train state

```bash
cd /path/to/a/public/cookbook/dev/checkout
git fetch origin --prune && git submodule update --init Backend && git -C Backend fetch --prune
./scripts/release/train-verify.sh
./scripts/release/train-verify.sh --for-release; echo "exit=$?"
```

Expected now: plain run clean; `--for-release` exit 0 **before** Phase C (pointer `6fe7893` =
Backend `main`, `## [0.5.8]` names it, untagged). It will go to exit 1 after C.2 until D lands
(D.4 explains). Exit 2 = could not inspect; treat as a failure.

### A.6 Bucket IAM (plan bootstrap step 0) `[VERIFY]`

The listing carries owner emails and lands in these buckets. Each policy must have no
`allUsers` / `allAuthenticatedUsers` binding.

```bash
gsutil iam get gs://$PROD_BUCKET
gsutil iam get gs://$STAGE_BUCKET
gsutil iam get gs://$PROD_BUCKET | grep -cE 'allUsers|allAuthenticatedUsers'
gsutil iam get gs://$STAGE_BUCKET | grep -cE 'allUsers|allAuthenticatedUsers'
```

Expected: the first two print a JSON policy (`bindings`, `etag`); the counts print `0`.
**Empty output from `iam get` means the command failed (auth), not that the bucket is
private** — on 2026-10-06 the command printed nothing, so this is unverified. A count above
0 → do not run `list` into that bucket; use a local `--out` path (the job cannot write
locally — create a private bucket first) or fix the policy.

### A.7 gcloud auth

```bash
gcloud auth login
gcloud config set project $PROD_PROJECT
gcloud run jobs describe flask-backend-image-repair --region $REGION --project $PROD_PROJECT --format='value(metadata.name)'
```

Expected: `flask-backend-image-repair`. Everything below assumes this works.

---

## Phase B — Bootstrap the audit job, run the listing, decide

Order: staging first (B.1–B.4 with `P=$STAGE_PROJECT`), production second. The staging run is
the evidence the job and the script work on real wiring. Both listings must come from an
image built from the exact Backend fork tip that Phase C merges (`51720c5` or later): the
fingerprint in `list` (pre-release image) and in `cutover` (release image) must be the same
code. **Any later Backend fork commit → rebuild the image and re-run `list`.**

### B.1 Build the Backend image from the fork into the private registry

```bash
cd $BACKEND_FORK && git switch advisory-fix-1 && git log --oneline -1
gcloud builds submit --project $PROD_PROJECT --region $REGION --tag $REG/flask-backend:$TAG .
gcloud artifacts docker images describe $REG/flask-backend:$TAG --project $PROD_PROJECT --format='value(image_summary.digest)'
```

Expected: build `SUCCESS`; a `sha256:…` digest. `.gcloudignore` keeps `.git`, `.venv` out of
the context. No code leaves GCP. Fail → read the build log (`gcloud builds log <id>`); the
Dockerfile is the one the release uses, so a failure here is a failure the release would
have too.

Also build the Express image now (Phase E and the staging deploy need it; same tag so
`deploy-staging.sh` can deploy both with one `--version`):

```bash
cd $COOKBOOK_FORK && git switch advisory-fix-1 && git log --oneline -1
gcloud builds submit --project $PROD_PROJECT --region $REGION --tag $REG/express-frontend:$TAG .
gcloud artifacts docker images describe $REG/express-frontend:$TAG --project $PROD_PROJECT --format='value(image_summary.digest)'
```

The root `.gcloudignore` excludes `Backend/` and the root `Dockerfile` does not need it.

### B.2 Create the job

**Production** — copy the image-repair job's wiring (plan bootstrap step 2), then align the
three values that differ from the release's `Deploy Publish Audit Job` step
(`cloudbuild.yaml:218-247`): memory `4Gi`, `maxRetries: 0`, `timeoutSeconds: 900`:

```bash
gcloud run jobs describe flask-backend-image-repair --region $REGION --project $PROD_PROJECT --format=export > /tmp/audit-job.yaml
sed -i -e 's/flask-backend-image-repair/flask-backend-publish-audit/' \
       -e "s#flask-backend:[^\"']*#flask-backend:$TAG#" \
       -e 's#scripts/repair_missing_images.py#scripts/publish_audit.py#' \
       -e 's/memory: 1Gi/memory: 4Gi/' \
       -e 's/maxRetries: 1/maxRetries: 0/' \
       -e 's/timeoutSeconds: 600/timeoutSeconds: 900/' /tmp/audit-job.yaml
grep -n -E 'name: flask-backend|image:|command|args|memory|maxRetries|timeoutSeconds|IMAGE_REPAIR_LIMIT' /tmp/audit-job.yaml
```

Review the grep: `command: [python]`, `args: [scripts/publish_audit.py]` (a bare run prints
usage and exits 2, nothing else), `memory: 4Gi`, `maxRetries: 0`, `timeoutSeconds: 900`,
image `…/flask-backend:kan-329-audit`. Delete the `IMAGE_REPAIR_LIMIT` env entry by hand
(two lines, `name:`/`value:`). `[VERIFY]` the exact YAML keys on your export — the sed
patterns assume `memory: 1Gi`, `maxRetries: 1`, `timeoutSeconds: 600`; a non-matching sed is
silent, which is why the grep is the check.

```bash
gcloud run jobs replace /tmp/audit-job.yaml --region $REGION --project $PROD_PROJECT
gcloud run jobs describe $AUDIT_JOB --region $REGION --project $PROD_PROJECT --format='value(spec.template.spec.template.spec.containers[0].image,spec.template.spec.template.spec.containers[0].resources.limits.memory,spec.template.spec.template.spec.maxRetries)'
```

Expected: `…/flask-backend:kan-329-audit  4Gi  0`. The release build (Phase F) later
redeploys this job from the release image with the same settings.

**Staging** — no job to copy. Values are those `scripts/staging/deploy-staging.sh` gives
`flask-backend-staging` (env, two secrets, Cloud SQL instance, VPC). Staging has no Valkey, so
the cutover's cache invalidation is a no-op there (SimpleCache in the service may show stale
owned GETs for up to ten minutes; harmless for the rehearsal).

```bash
gcloud run jobs create $AUDIT_JOB --project $STAGE_PROJECT --region $REGION \
  --image $REG/flask-backend:$TAG --command=python --args=scripts/publish_audit.py,--help \
  --max-retries=0 --task-timeout=900 --cpu=1 --memory=4Gi --parallelism=1 --tasks=1 \
  --set-env-vars=FLASK_ENV=staging,FLASK_APP=app.py,FRONTEND_URL=$STAGE,GCS_BUCKET_NAME=$STAGE_BUCKET,GCP_PROJECT_ID=$STAGE_PROJECT,PUBSUB_INVOKER_SA=pubsub-pusher@$STAGE_PROJECT.iam.gserviceaccount.com,GEMINI_DEFAULT_MODEL=gemini-3.8-flash,GEMINI_IMAGE_MODEL=gemini-3-pro-image \
  --set-secrets=FLASK_SECRET_KEY=FLASK_SECRET_KEY_STAGING:latest,DATABASE_URL=DATABASE_URL_STAGING:latest \
  --set-cloudsql-instances=$STAGE_PROJECT:$REGION:vegangenius-staging-db \
  --network=default --subnet=default --vpc-egress=private-ranges-only
gcloud run jobs execute $AUDIT_JOB --project $STAGE_PROJECT --region $REGION --wait
```

Expected: the bare execution prints the script's usage and **fails** (exit 2 from argparse)
— that proves image pull (cross-project read on the prod registry is bound by
`deploy-staging.sh` step 0 for the service agent; `[VERIFY]` the job pulls with the same
agent), secrets and Cloud SQL wiring. An `ImagePullBackOff` or a secret error here is a
wiring problem, not a script problem. `[VERIFY]` that `GOOGLE_API_KEY_STAGING` is not needed
by `create_app()` for this script (the staging service passes it only when present).

### B.3 Run the listing

```bash
# production
gcloud run jobs execute $AUDIT_JOB --region $REGION --project $PROD_PROJECT --wait \
  --args=scripts/publish_audit.py,list,--out,gs://$PROD_BUCKET/audit/prod-$(date +%F)-pre
mkdir -p ~/kan-329-audit && cd ~/kan-329-audit
gsutil cp "gs://$PROD_BUCKET/audit/prod-*-pre.*" .
ls -l
# staging
gcloud run jobs execute $AUDIT_JOB --region $REGION --project $STAGE_PROJECT --wait \
  --args=scripts/publish_audit.py,list,--out,gs://$STAGE_BUCKET/audit/staging-$(date +%F)-pre
gsutil cp "gs://$STAGE_BUCKET/audit/staging-*-pre.*" .
```

Expected (logs, see "Conventions"): `N public row(s) written to gs://…/prod-<date>-pre.{jsonl,md,manifest.json}`;
three files per environment land locally. Sitemaps showed 101 `/r/` URLs on production and 35
on staging (2026-10-06); `N` should be close — a large gap means public rows without a
sitemap entry or the reverse, worth a note on the ticket, not a blocker. The `-pre` suffix
matters: Phase H re-runs `list` and must not overwrite the audit record.

### B.4 Read the Markdown and decide every row

`prod-<date>-pre.md`: `# Publish audit listing`, `N public rows.`, then `## <owner email>`
sections, one `### <name> — /r/<slug>` per row with id, fingerprint, origin column / blob,
status, canonical, flags, eligibility, media identity, full description, ingredients,
instructions, notes.

- Rows under Adam's and Allison's accounts (two accounts each per the plan): quick pass.
- Every other owner: full read of text and ingredients/steps.
- Flags in bold decide by themselves: `STATUS <x>` (not `ready`) → `unpublish` (the script
  would refuse a `keep` anyway); `column/blob disagree: …` → read with suspicion;
  `CANONICAL` → keep only after the full read; `slug not normalized` → `unpublish` unless
  the slug is one you want to keep (T4 finding: the publish transition only repairs empty
  or path-shaped slugs); `eligibility:` anything but `ok` → `unpublish`.
- Media walk (D10): open `$PROD/r/<slug>` for every `keep` with the content-credentials
  browser extension active; an image without the credential icon, or a stock image that is
  not the one expected → `unpublish`. The fingerprint binds the reviewed `ai_image_gcs` /
  `stock_image_url` / `image_keywords` to the decision.

Fill `decision` in `prod-<date>-pre.manifest.json` with `keep` or `unpublish` on every row,
save as `prod.manifest.json` (and `staging.manifest.json`). Keep the fingerprints as
generated. Count:

```bash
cd ~/kan-329-audit
python3 -c "import json,collections;m=json.load(open('prod.manifest.json'));print(collections.Counter(r['decision'] for r in m['rows']))"
```

Expected: `Counter({'keep': K, 'unpublish': U})` with no `''` key. An empty decision is what
exit 2 refuses later.

### B.5 Upload and dry-run `cutover` (no pause needed for a dry run)

```bash
gsutil cp prod.manifest.json gs://$PROD_BUCKET/audit/prod.manifest.json
gsutil cp staging.manifest.json gs://$STAGE_BUCKET/audit/staging.manifest.json
gcloud run jobs execute $AUDIT_JOB --region $REGION --project $STAGE_PROJECT --wait \
  --args=scripts/publish_audit.py,cutover,--manifest,gs://$STAGE_BUCKET/audit/staging.manifest.json
gcloud run jobs execute $AUDIT_JOB --region $REGION --project $PROD_PROJECT --wait \
  --args=scripts/publish_audit.py,cutover,--manifest,gs://$PROD_BUCKET/audit/prod.manifest.json
```

Expected log shape:

```
[DRY RUN] reset R label(s)
[DRY RUN] restored K approved row(s)
  RESTORE   <id>
[DRY RUN] second look 0 row(s)
[DRY RUN] unpublished U row(s)
  UNPUBLISH <id>
[DRY RUN] touched T row(s)
```

Checks: `restored` = number of `keep` rows; `second look 0`; `unpublished` ≥ `unpublish`
count (rows published after the listing are in it, by design). A `SECOND <id> — content
changed since the listing` now (same day) means an image regeneration or an edit happened
between `list` and this run — re-read the row in a fresh `list`, update its fingerprint in
the manifest, re-upload, dry-run again. A `SECOND … status …` or `saved copy` row → change
its decision to `unpublish`. Exit 3 here is a busy worker on an ordinary day — wait and
retry; it does not need the pause for a dry run.

### B.6 The audit record

**Publishing an advisory deletes its temporary fork**, so nothing that must outlive Phase I
may live only in the fork. Keep, outside both public repos:

- `prod-<date>-pre.md`, `.jsonl` (owner emails: the audit record), `prod.manifest.json`,
  the dry-run log, later the apply and verify logs — in `gs://$PROD_BUCKET/audit/` (private
  bucket, A.6) and attached to KAN-329 (Jira is private). Staging likewise under
  `gs://$STAGE_BUCKET/audit/`.
- The plan says "saved with the advisory": attach the manifest (no emails) to the advisory
  text if wanted; never the `.md`/`.jsonl` (emails) and never a repo path.

---

## Phase C — Backend release

### C.1 Merge the Backend fork PR into Backend `dev` — do not publish

On `https://github.com/$BACKEND/security/advisories/GHSA-48gm-m2wj-96xh`: the advisory's
**merge** action (not "Publish advisory"). Branch protection and required checks are
bypassed by design for advisory merges; A.2 was the gate.

```bash
gh api repos/$BACKEND/branches/dev --jq .commit.sha
gh api repos/$BACKEND/security-advisories/GHSA-48gm-m2wj-96xh --jq .state
```

Expected: `dev` moved past `0506f0f` and `git log --oneline -1` of that SHA shows the merge;
advisory state still `draft`. **From this moment the fix and `scripts/publish_audit.py`'s
docstring are public** (the repo is public) — see "Evaluation points", 2. Backend `ci.yml`
runs on the push to `dev`; let it run, it is not a gate for the train.

### C.2 Promote Backend `dev` → `main`

```bash
gh pr create -R $BACKEND --base main --head dev \
  --title "release: promote Backend dev → main for the publish gate hotfix [KAN-329]" \
  --body "Promotes dev to main for v0.5.8. [KAN-329] [KAN-328]"
gh pr checks <n> -R $BACKEND --watch
gh pr merge <n> -R $BACKEND --merge
```

Expected: checks green (CodeQL `Analyze (python)` + CI jobs; read the live required set with
the commands in CLAUDE.md "Branch protection"); merged with a merge commit (squash is blocked
on Backend `main`). **Unresolved review threads block the merge** — answer and resolve every
one.

STALE trap (RUNBOOK step 2): anything landing on Backend `dev` after this merge is not on
`main`. Before D.1:

```bash
gh api "repos/$BACKEND/compare/main...dev" --jq '.ahead_by'
gh api repos/$BACKEND/branches/main --jq .commit.sha
```

Expected: `ahead_by` is `0` (nothing on `dev` that `main` lacks) until C.3 runs; after C.3 it
is `1`, the back-sync merge commit, which `train-verify` counts as drift zero. Any other
number → something landed on `dev` after the promotion: promote again (C.2) before D.1.

### C.3 Back-sync Backend `main` → `dev` and record the SHA

```bash
cd /path/to/a/public/cookbook/dev/checkout
./scripts/release/train-backsync.sh --apply --merge --only backend
BACKEND_MAIN=$(gh api repos/$BACKEND/branches/main --jq .commit.sha); echo $BACKEND_MAIN
```

Expected: a `main → dev` PR opened and merged with a merge commit; `train-verify.sh` shows
`Backend main→dev back-sync owed: 0`. Write `BACKEND_MAIN` down: it is the pin and the
CHANGELOG value. (`main`'s own SHA, not `dev`'s: after the back-sync they are structurally
different commits with identical trees; RUNBOOK step 4.)

---

## Phase D — Cookbook release prep

### D.1 Pin Backend `main`'s own SHA in the cookbook fork

The fork's `Backend` submodule is uninitialized (`git submodule status` shows `-6fe7893…`);
`.gitmodules` points at the public Backend repo, so initializing clones it read-only.

```bash
cd $COOKBOOK_FORK && git switch advisory-fix-1
git submodule update --init Backend
git -C Backend fetch origin --prune
git -C Backend checkout $BACKEND_MAIN
git add Backend
git diff --cached --submodule=short
```

Expected: `Subproject commit 6fe7893… → <BACKEND_MAIN>`. Never `git submodule update
--remote Backend` (resolves to Backend `dev`'s tip, blocks Station 3 every time).

### D.2 Amend `## [0.5.8]` in `CHANGELOG.md`

Edit the section (currently `Backend pointer pinned at \`6fe78936f803\` (Backend \`main\`,
promotion #367).`): name the new pointer and the hotfix in neutral terms, and keep the
`train-verify` contract — the section must contain the pinned SHA's 12-char prefix.

Suggested lines (keep the hole in the plan, not here):

```
Backend pointer pinned at `<BACKEND_MAIN first 12>` (Backend `main`, promotion #<C.2 PR>).

### Security

- Publication and provenance of recipes are server-owned (KAN-329, KAN-328, KAN-330;
  GHSA-48gm-m2wj-96xh, GHSA-8744-3qm2-c4x8). Only a recipe the generation worker finished
  can be published, its generated content is locked against client rewrites, and the
  JSON import is removed; export drops the server-owned fields. A publish-state audit job
  (`flask-backend-publish-audit`) and a recipe write pause in Express
  (`RECIPE_WRITE_PAUSE=1`) support the one-time cutover.
```

```bash
npx prettier --write CHANGELOG.md && npm run format:check
grep -n -A3 '^## \[0.5.8\]' CHANGELOG.md
git add CHANGELOG.md
git commit -m "chore(release): pin Backend main for v0.5.8 and amend the changelog [KAN-330]"
git push origin advisory-fix-1
```

Expected: format check passes; the commit shows two files (`Backend`, `CHANGELOG.md`).

### D.3 Merge the cookbook fork PR into cookbook `dev` — do not publish

On `https://github.com/$COOKBOOK/security/advisories/GHSA-8744-3qm2-c4x8`: the advisory's
merge action. Then:

```bash
gh api repos/$COOKBOOK/branches/dev --jq .commit.sha
gh api repos/$COOKBOOK/security-advisories/GHSA-8744-3qm2-c4x8 --jq .state
```

Expected: `dev` moved past `534ac17`; state `draft`. The merge carries
`specs/KAN-329_PUBLISH_GATE_HOTFIX_PLAN.md` and the three Codex review files, which describe
the hole — public from here (Evaluation point 2).

### D.4 `train-verify.sh --for-release` → exit 0

It judges `origin/dev:Backend`, not a local branch, so between C.2 and D.3 it blocks with
`submodule pointer pins 6fe7893…, Backend main is <new> … bump the pointer` — expected, and
the same check runs in `pr-gate.yml` on #3612, which goes red for the same reason until D.3
lands. Neither is a failure to fix; D.3 is the fix.

```bash
cd /path/to/a/public/cookbook/dev/checkout
git switch dev && git pull --ff-only && git submodule update --init Backend && git -C Backend fetch --prune
./scripts/release/train-verify.sh --for-release; echo "exit=$?"
gh pr checks 3612 -R $COOKBOOK
```

Expected: `exit=0`; #3612's checks re-run on `dev`'s new tip and go green (including the
`Gate — all checks passed` aggregate). Exit 1 → read the `blocking` lines; the usual ones are
the pointer (D.1), the CHANGELOG SHA (D.2), or a Backend back-sync owed (C.3). Exit 2 → the
checkout could not inspect; fix the checkout, never override.

---

## Phase E — Pause ON before the release merge

`cloudbuild.yaml` deploys Flask before Express (KAN-30), so the pause must already be on
when the build runs: the old Express would otherwise serve writes against the new API for
the build's duration, and the cutover needs a quiet table anyway.

### E.1 Snapshot the current service

```bash
gcloud run services describe express-frontend --region $REGION --project $PROD_PROJECT --format=export > /tmp/express-before.yaml
grep -n -E 'image:|ingress|vpc-access-egress|RECIPE_WRITE_PAUSE' /tmp/express-before.yaml
```

Expected: current image `…/express-frontend:<short sha>`, `run.googleapis.com/ingress:
internal-and-cloud-load-balancing`, `vpc-access-egress: all-traffic`, no `RECIPE_WRITE_PAUSE`.

### E.2 Deploy the fork-built Express image with the pause on

`gcloud run deploy` on an existing service keeps every setting it is not given (secrets,
network, egress, ingress, labels, min instances), and `--update-env-vars` adds one variable
without touching the rest. The release build's Express step also uses `--update-env-vars`
(`cloudbuild.yaml:356`), so the variable survives Phase F.

```bash
gcloud run deploy express-frontend --region $REGION --project $PROD_PROJECT \
  --image $REG/express-frontend:$TAG --update-env-vars RECIPE_WRITE_PAUSE=1 --quiet
gcloud run services describe express-frontend --region $REGION --project $PROD_PROJECT --format=export > /tmp/express-after.yaml
diff /tmp/express-before.yaml /tmp/express-after.yaml
```

Expected diff: the image tag, a `RECIPE_WRITE_PAUSE: '1'` env entry, revision name /
timestamps / `generation` — nothing else. Any other line (ingress, egress, a secret) → the
deploy changed a pin; redeploy with the missing flag from `cloudbuild.yaml:336-381` or roll
traffic back to the previous revision (`gcloud run services update-traffic express-frontend
--to-revisions <previous>=100`).

### E.3 Confirm the pause from outside

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST $PROD/api/recipes -H 'content-type: application/json' -d '{}'
curl -s -i -X POST $PROD/api/recipes -H 'content-type: application/json' -d '{}' | grep -iE '^(HTTP|retry-after)|RECIPE_WRITE_PAUSE'
curl -s -o /dev/null -w '%{http_code}\n' -X POST $PROD/api/generate -H 'content-type: application/json' -d '{}'
curl -s -o /dev/null -w '%{http_code}\n' $PROD/api/recipes
for p in / /browse /sitemap.xml /api/health; do printf '%s ' $p; curl -s -o /dev/null -w '%{http_code}\n' $PROD$p; done
```

Expected: `503` twice, `Retry-After: 120` and `"code":"RECIPE_WRITE_PAUSE"` in the body;
`GET /api/recipes` → anything but 503 (401/200 depending on session); the four reads → `200`.
A POST that is not 503 → the variable is not `1` on the serving revision (`gcloud run
services describe … --format='value(spec.template.spec.containers[0].env)'`) or traffic is
not on the new revision (`--format='value(status.traffic)'`).

### E.4 Drain, and stop the scheduler

The pause stops the SPA, not Pub/Sub: in-flight text and image workers finish on their own.
The daily image-repair scheduler enqueues image regeneration straight to Pub/Sub and does
not go through Express, so it can create `generating_image` rows with claim tokens during
the window (and change `ai_image_gcs` on a `keep` row — a fingerprint failure). Pause it
for the day.

```bash
gcloud scheduler jobs list --location $REGION --project $PROD_PROJECT
gcloud scheduler jobs pause <image-repair scheduler job name> --location $REGION --project $PROD_PROJECT
```

`[VERIFY]` the scheduler job's name and schedule (created out of band per
`cloudbuild.yaml:173-174`; not in the repo). Resume it in H.5.

Drain check in Cloud SQL Studio (instance `vegangenius-db`, database `vegangenius`, user
`vegangenius-user`):

```sql
SELECT count(*) FROM recipe WHERE status IN ('processing','generating_image') AND worker_claim_token IS NOT NULL;
SELECT id, status, updated_at FROM recipe WHERE status IN ('processing','generating_image') AND worker_claim_token IS NOT NULL ORDER BY updated_at;
```

Expected: `0`. Rows older than the worker's claim window with no progress are abandoned
claims — the only case for `--allow-busy` in G.3, and only after you have read them here.
Pub/Sub backlog as a second signal: `gcloud pubsub subscriptions describe <push sub>
--project $PROD_PROJECT --format='value(name)'` and the `gcp-monitor` `check_system_health`
tool (`pubsub` component, unacked age).

---

## Phase F — Release (merge #3612 → tag → Cloud Build)

### F.1 Merge the release PR

```bash
gh pr view 3612 -R $COOKBOOK --json mergeStateStatus,headRefOid --jq '{mergeStateStatus, head: .headRefOid}'
gh api repos/$COOKBOOK/branches/dev --jq .commit.sha
gh pr merge 3612 -R $COOKBOOK --merge
```

Expected: `CLEAN` and the head OID equals `dev`'s tip from D.3 (a `dev → main` PR merges the
live tip of `dev`; anything landing on `dev` after D.3 ships under this version, so freeze
`dev` from D.3 to here). `--merge`, never `--squash`: the `main` ruleset blocks squash, and
squashing breaks the ancestry the back-sync counts depend on. `BLOCKED` with green checks =
an unresolved review thread; resolve it, do not bypass.

### F.2 The tag

```bash
gh run list -R $COOKBOOK --workflow=release.yml --limit 1 --json databaseId,status,conclusion
gh run watch -R $COOKBOOK "$(gh run list -R $COOKBOOK --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
git ls-remote --tags https://github.com/$COOKBOOK v0.5.8
```

Expected: `release.yml` reads `0.5.8` from `package.json`, finds no tag, pushes `v0.5.8` and a
Release; `ls-remote` prints the tag. "Tag already exists — skipping" in the run log = spent
version (A.4): nothing deployed; bump forward.

### F.3 Cloud Build

```bash
gcloud builds list --project $PROD_PROJECT --region $REGION --limit 3 --format='table(id,status,createTime,substitutions.TAG_NAME,substitutions.SHORT_SHA)'
BUILD=$(gcloud builds list --project $PROD_PROJECT --region $REGION --limit 1 --format='value(id)')
gcloud builds log $BUILD --project $PROD_PROJECT --region $REGION --stream | grep -E '^(Starting Step|Finished Step|Step #|ERROR|PUSH|DONE|FAILURE|SUCCESS)' | head -80
```

Expected: a build with `TAG_NAME v0.5.8` reaching `SUCCESS`; step ids `Init Submodules`,
builds, pushes, `Deploy Migrate Job`, `Execute Migrate Job` (no migration in this hotfix —
`flask db upgrade` prints no-ops), `Deploy Image Repair Job`, `Deploy Publish Audit Job`,
`Deploy Flask Backend`, `Deploy Express Frontend`, `Verify Valkey Health`. The build is
regional: a global `gcloud builds list` shows nothing recent. `[VERIFY]` whether the
trigger passes `_VERSION` (the staging README says `v*` image tags never appeared in the
registry; the SHORT_SHA tag is the one to rely on).

### F.4 What landed

```bash
SHORT=$(gcloud builds describe $BUILD --project $PROD_PROJECT --region $REGION --format='value(substitutions.SHORT_SHA)'); echo $SHORT
gcloud run services describe flask-backend --region $REGION --project $PROD_PROJECT --format='value(spec.template.spec.containers[0].image)'
gcloud run services describe express-frontend --region $REGION --project $PROD_PROJECT --format='value(spec.template.spec.containers[0].image,spec.template.spec.containers[0].env)'
gcloud run jobs list --region $REGION --project $PROD_PROJECT --format='table(metadata.name,spec.template.spec.template.spec.containers[0].image)'
gcloud run jobs executions list --job flask-backend-migrate --region $REGION --project $PROD_PROJECT --limit 1 --format='table(metadata.name,status.succeededCount,status.failedCount,metadata.creationTimestamp)'
```

Expected: both services on `…:$SHORT`; Express env still lists `RECIPE_WRITE_PAUSE=1`; three
jobs (`flask-backend-migrate`, `flask-backend-image-repair`, `flask-backend-publish-audit`) on
`…:$SHORT`; the migrate execution `succeededCount 1`.

### F.5 Pause still on, site still reads

Repeat E.3 verbatim. Expected: identical results (POST 503 with the code, reads 200). A POST
that now passes means the Express deploy dropped the variable — re-run E.2 immediately
(with `--image $REG/express-frontend:$SHORT` this time) before G.

---

## Phase G — Cutover

Staging first with the staging job and manifest; production second. Same commands with
`P`, bucket and manifest swapped. The production run below; prefix every command with the
staging values for the rehearsal and read the same outputs.

### G.1 Dry run under the pause

```bash
gcloud run jobs execute $AUDIT_JOB --region $REGION --project $PROD_PROJECT --wait \
  --args=scripts/publish_audit.py,cutover,--manifest,gs://$PROD_BUCKET/audit/prod.manifest.json
```

Read the log (Conventions). Expected: `[DRY RUN] second look 0 row(s)`, `restored` = keep
count, `unpublished` ≥ unpublish count. The production job now runs the release image
(`…:$SHORT`), which carries the same `publish_audit.py` as `…:$TAG` if B's rule was kept.

### G.2 Re-bless loop (only while `SECOND` rows exist)

A `keep` row listed as `SECOND <id> — content changed since the listing` is **still public**
here and still appears in a fresh `list`. After `--apply` it is private, gone from `list`,
and can only be regenerated — so finish this loop before G.3.

```bash
gcloud run jobs execute $AUDIT_JOB --region $REGION --project $PROD_PROJECT --wait \
  --args=scripts/publish_audit.py,list,--out,gs://$PROD_BUCKET/audit/prod-$(date +%F)-rebless
gsutil cp "gs://$PROD_BUCKET/audit/prod-*-rebless.*" ~/kan-329-audit/
```

For each `SECOND` id: find it in `prod-<date>-rebless.md`, re-read text and media (image
regeneration between listing day and today changes `ai_image_gcs` and fails the fingerprint
by design, D10), then either copy the new `fingerprint` into that row of
`prod.manifest.json` (decision stays `keep`) or set `decision` to `unpublish`. Re-upload and
re-run G.1 until `second look 0`. A `SECOND … status <x>` / `guest-owned` / `saved copy`
reason has no re-bless path: `unpublish`.

### G.3 Apply

```bash
gcloud run jobs execute $AUDIT_JOB --region $REGION --project $PROD_PROJECT --wait \
  --args=scripts/publish_audit.py,cutover,--manifest,gs://$PROD_BUCKET/audit/prod.manifest.json,--apply
```

Expected log: the same counts as the last dry run with `[APPLIED]`. Exit 2 → the manifest
changed between G.1 and here (nothing applied); exit 3 → a worker claimed a row since E.4
(nothing applied; re-check the drain, then retry). `--allow-busy` only for a claim you read
in E.4 as abandoned. Save the log to `~/kan-329-audit/prod-cutover-applied.log` and
`gsutil cp` it next to the manifest.

### G.4 Verify

```bash
gcloud run jobs execute $AUDIT_JOB --region $REGION --project $PROD_PROJECT --wait \
  --args=scripts/publish_audit.py,verify,--manifest,gs://$PROD_BUCKET/audit/prod.manifest.json
```

Expected: `verify: 0 problem(s)`, execution succeeded. Any `PROBLEM <id>: …` → stay paused,
fix (a `public but not approved` row = a publish that slipped in: set it `unpublish` in the
manifest and re-run G.3 — the apply is idempotent and re-locks the same set), re-run
`verify` to 0. Save the log.

Cloud SQL Studio cross-check (read-only):

```sql
SELECT count(*) FILTER (WHERE is_public) AS public_rows,
       count(*) FILTER (WHERE origin = 'generated') AS generated_rows,
       count(*) FILTER (WHERE is_public AND origin IS DISTINCT FROM 'generated') AS public_without_label
FROM recipe;
```

Expected: `public_rows` = keep count, `generated_rows` = keep count, `public_without_label`
= 0.

---

## Phase H — Lift the pause and verify by content

### H.1 Lift

```bash
gcloud run services update express-frontend --region $REGION --project $PROD_PROJECT --remove-env-vars RECIPE_WRITE_PAUSE
curl -s -o /dev/null -w '%{http_code}\n' -X POST $PROD/api/recipes -H 'content-type: application/json' -d '{}'
```

Expected: a new revision; the POST is **not 503** (a validation 400 or an auth 401 for an
empty anonymous body — `[VERIFY]` the exact code once; anything but 503 is the check).

### H.2 Verify by content (RUNBOOK step 9)

Markers new in this release: `RECIPE_WRITE_PAUSE` (`persistence.service.ts`, a core service,
expected in `main-*.js`) and `Only recipes generated here can have a public page`
(`recipe-view.base.ts`, likely a lazy chunk). `[VERIFY]` which served asset carries each on the
first run: the index lists only `main-*.js` (2026-10-06: `main-OA6KSVBS.js`), and lazy chunks
are named inside it.

```bash
cd /path/to/a/public/cookbook/dev/checkout
./scripts/release/train-run.sh --verify-only --marker 'RECIPE_WRITE_PAUSE'
for a in $(curl -s $PROD/ | grep -oE '(main|chunk|polyfills)-[A-Z0-9]+\.js' | sort -u); do printf '%-28s ' "$a"; curl -s "$PROD/$a" | grep -Fc 'RECIPE_WRITE_PAUSE'; done
MAIN=$(curl -s $PROD/ | grep -oE 'main-[A-Z0-9]+\.js' | head -1)
for c in $(curl -s "$PROD/$MAIN" | grep -oE 'chunk-[A-Za-z0-9_-]+\.js' | sort -u); do printf '%-28s ' "$c"; curl -s "$PROD/$c" | grep -Fc 'Only recipes generated here can have a public page'; done
```

Expected: `train-run.sh` prints `marker found in N place(s) — this release IS live` and
`/`, `/browse`, `/sitemap.xml → 200`; at least one asset prints a count above 0 for each
marker. `0` everywhere = the deploy is not live (F.4 images) or the marker lives in an
asset the loops do not fetch — mark which and widen the loop, never conclude "deployed" from
a bundle-hash change alone.

### H.3 Health and pages

```bash
for p in / /browse /sitemap.xml /api/health; do printf '%s ' $p; curl -s -o /dev/null -w '%{http_code}\n' $PROD$p; done
curl -s $PROD/api/health
KEPT=<slug of a keep row>; GONE=<slug of an unpublish row>
curl -s -o /dev/null -w 'kept %{http_code}\n' $PROD/r/$KEPT
curl -s -o /dev/null -w 'gone %{http_code}\n' $PROD/r/$GONE
curl -s $PROD/sitemap.xml | grep -oE '/r/[^<"]+' | wc -l
```

Expected: four `200`s; health `{"status":"ok",…,"environment":"production","rateLimitStore":"valkey"}`;
kept `200`; gone `404`; sitemap count = keep count (was 101). A gone slug still `200` →
SSR cache: the public page is served by Flask from the row, so a 200 means the row is still
public — back to G.4. Candidate kept slug from the 2026-10-06 sitemap:
`vegan-korean-bbq-rib-and-coleslaw-heros` (only if it is a `keep`).

### H.4 Re-list and verify once more, record counts

```bash
gcloud run jobs execute $AUDIT_JOB --region $REGION --project $PROD_PROJECT --wait \
  --args=scripts/publish_audit.py,list,--out,gs://$PROD_BUCKET/audit/prod-$(date +%F)-post
gcloud run jobs execute $AUDIT_JOB --region $REGION --project $PROD_PROJECT --wait \
  --args=scripts/publish_audit.py,verify,--manifest,gs://$PROD_BUCKET/audit/prod.manifest.json
gsutil cp "gs://$PROD_BUCKET/audit/prod-*-post.*" ~/kan-329-audit/
```

Expected: `K public row(s) written …` with K = keep count; `verify: 0 problem(s)`. Record on
KAN-329: public rows before (`N` from B.3), kept (K), unpublished (U + any post-listing
rows), reset label count (R), `verify` 0.

### H.5 Resume the scheduler

```bash
gcloud scheduler jobs resume <image-repair scheduler job name> --location $REGION --project $PROD_PROJECT
```

Old open tabs keep the old bundle and their stale local `is_public`/`origin` until a full
reload — accepted (plan cutover step 6).

---

## Phase I — Publish, back-sync, close out

### I.1 Publish both advisories (Evaluation point 1 — Adam's call)

Only after H.2–H.4 are clean. Publishing makes the write-up public, assigns the CVE if
requested, and **deletes the temporary fork** (B.6 must be done). UI: the advisory page →
**Publish advisory**. API equivalent (`state` accepts `published`, `closed`, `draft`):

```bash
gh api -X PATCH repos/$BACKEND/security-advisories/GHSA-48gm-m2wj-96xh -f state=published --jq '.state,.published_at'
gh api -X PATCH repos/$COOKBOOK/security-advisories/GHSA-8744-3qm2-c4x8 -f state=published --jq '.state,.published_at'
```

Expected: `published` and a timestamp for each. Before pressing: the advisory's affected /
patched versions name `< 0.5.8` / `0.5.8` (cookbook) and the Backend SHA, or Dependabot
alerts users with no safe version to move to.

### I.2 Back-sync cookbook `main` → `dev`

```bash
cd /path/to/a/public/cookbook/dev/checkout
./scripts/release/train-backsync.sh --apply --merge --only cookbook
./scripts/release/train-verify.sh; echo "exit=$?"
```

Expected: merge-commit PR merged; `exit=0`, both drift counts zero.

### I.3 Jira (the caller posts; evidence to name)

- **KAN-329** (Backend): advisory merge SHA, promotion PR, `BACKEND_MAIN`, B.3 counts, G.3
  and G.4 logs, H.4 counts, the GCS prefix of the audit record. Attach
  `prod-<date>-pre.md`/`.jsonl`, `prod.manifest.json`, the applied and verify logs.
- **KAN-330** (SPA/Express): cookbook advisory merge SHA, #3612 merge, `v0.5.8` tag, Cloud
  Build id, H.2 marker hits, pause on/off revision names.
- **KAN-328** (content lock): rides KAN-329's evidence; `tests/test_generated_content_lock.py`
  count.
- Retire the `kan-329-audit` images once `verify` is clean on the release image
  (`gcloud artifacts docker images delete $REG/flask-backend:$TAG`, same for Express) —
  optional.

### I.4 Follow-up tickets (plan "Follow-ups" plus what this runbook found)

- Display name on public bylines (D9).
- Image provenance through content credentials (automated C2PA / SynthID check).
- KAN-327 (blob copies of `is_public`/`slug`), KAN-331 (server-side recycle bin).
- Image-repair scheduler is not covered by the write pause (E.4).
- `flask-backend-publish-audit` for staging in `cloudbuild.staging.yaml` /
  `staging-deploy.yml` (today it is hand-created, B.2).
- `train-run.sh --verify-only` only fetches assets named in `/`; lazy chunks are invisible to
  it (H.2).

---

## Rollback and abort

- **No rollback to an old tag.** A failed deploy recovers by a patch bump forward through the
  same runbook (RUNBOOK "Rollback"). `main` stays frozen until H is done.
- **Before G.3 (`--apply`)** nothing in the data has changed; abort at any point by lifting
  the pause (H.1) — the old rows and labels are untouched, the new code enforces the new rule
  for new rows only. Public rows carrying an unverified `generated` label stay public until
  the cutover is run; that is the pre-fix state, not a regression.
- **After G.3** the only reversal is through the manifest: a row wrongly unpublished with a
  changed fingerprint cannot be re-blessed (`list` no longer shows it); regenerate it. A row
  wrongly unpublished with an **unchanged** fingerprint can be restored by setting its
  decision to `keep` and re-running G.3 — only if it is still in the manifest, which lists
  rows that were public at B.3. Rows never in the manifest cannot be published by the
  script.
- **Pause stuck / something unrelated breaks under the pause:** lift it with H.1 at any time;
  reads were never affected. If the fork-built Express revision itself misbehaves, roll
  traffic: `gcloud run services update-traffic express-frontend --region $REGION --project
$PROD_PROJECT --to-revisions <revision from /tmp/express-before.yaml>=100` (that revision
  has no pause switch, so writes resume).
- **Backend promoted, cookbook not yet pinned:** `train-verify` red is the designed state;
  finish D. Do not "fix" it by pinning `dev`'s SHA.
- **Build failed mid-way (F.3):** the old Flask revision keeps serving; the pause is still on;
  fix forward with a patch bump. If the Express step ran but Flask did not, E.3 still holds
  (old API under pause, new SPA sends ignored fields; item 14 compatibility).

## Variant B — fix production before the public merge (Evaluation point 2)

The prescribed order publishes the fix diff on `dev` (C.1, D.3) before the tag deploys it
(F). Both images are already built from the forks (B.1) and the pause switch is deployed
from one of them (E.2). The same move closes the window entirely:

1. Phases A, B, E as written.
2. Deploy the fork-built Flask image behind the pause:
   `gcloud run deploy flask-backend --region $REGION --project $PROD_PROJECT --image
$REG/flask-backend:$TAG --quiet` (keeps `--ingress=internal`, `--invoker-iam-check`, VPC,
   secrets; diff the `--format=export` before/after as in E.2). No migration in this hotfix.
3. Phase G and H.1–H.4 on the fork image (`$TAG` is the job's image already from B.2).
4. Then C, D, F (the release redeploys identical code from `main`; re-run G.4 `verify` on the
   release image), H.2 marker check again, H.5, I.

Cost: one extra Flask deploy and a release that is a no-op for behaviour; `train-verify` does
not know about hand-deployed images. Benefit: when the public repos receive the code and the
plan text, production is already fixed and cut over.

## Evaluation points for Adam

- [ ] **1. Publish order.** The plan publishes both advisories at release-sequence steps 3–4,
      before the cutover (step 6). Merging a fork PR and publishing the advisory are separate
      GitHub actions (verified in the docs). This runbook **merges** at C.1/D.3 and
      **publishes** at I.1, after production is verified by content and `verify` is clean.
      Plan says otherwise — Adam's call.
- [ ] **2. The merge is the disclosure, not the publish.** Both repos are public: C.1 makes
      the Backend diff and `publish_audit.py`'s docstring ("any signed-in client could set
      `is_public`…") public; D.3 makes the plan and three Codex review files public, with the
      hole described in full. Production runs the old code until F completes. Either run C → F
      in one sitting with E already done and B decided (window ≈ Backend CI + promotion +
      Cloud Build), or take Variant B, or `git rm` the spec files from the fork before D.3 and
      attach them to Jira instead. Plan line "both public repositories stay untouched until the
      advisories are published" is not what an advisory merge does.
- [ ] **3. The audit record cannot live with the advisory's fork.** Publishing deletes the
      fork. B.6 keeps the record in the private bucket and on KAN-329.
- [ ] **4. The image-repair scheduler bypasses the pause** (E.4). Pause it for the day; plan
      gap.
- [ ] **5. Bootstrap job parameters.** The plan's sed copies image-repair's `maxRetries: 1`
      and `timeoutSeconds: 600`; the release deploys the job with `0` / `900`. B.2 aligns
      them (a retried, timed-out `--apply` is a second transaction).
- [ ] **6. Staging cannot be deployed by the workflow from a fork branch.** B.1 builds both
      images from the forks under one tag so the staging deploy script can deploy them for
      the rehearsal, with the staging pause set on the Express service first. The plan's
      "cutover steps 2–6 on staging" needs this; it names no mechanism. The commands:

      ```bash
      gcloud run services update express-frontend-staging --project $STAGE_PROJECT --region $REGION --update-env-vars RECIPE_WRITE_PAUSE=1
      cd $COOKBOOK_FORK && ./scripts/staging/deploy-staging.sh --apply --version $TAG
      ./scripts/staging/verify-staging.sh
      ```

- [ ] **7. Listing file names.** `prod-$(date +%F)` as the prefix lets the Phase H re-list
      overwrite the audit record on the same day; this runbook uses `-pre` / `-rebless` /
      `-post`.
- [ ] **8. Plan cutover step 2 ("deploy the new Backend revision behind the pause") has no
      separate step in the prescribed order** — the release build does it in F, Flask before
      Express, while the pause is on. Variant B makes it explicit.
- [ ] **9. Review load.** 101 public rows; the quick pass covers the four trusted-account rows
      (plan), everything else is a full read plus the media walk. Budget the day for B.4; the
      re-bless loop in G.2 re-reads only `SECOND` rows.
- [ ] **10. Same image for `list` and `cutover`.** B's rule: a Backend fork commit after B.1
      invalidates the listing's fingerprints (same algorithm today, but the rule is the
      guard, not the diff).

## Appendix — environment values

| Item                          | Value                                                                                                     | Verified 2026-10-06              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Cookbook public repo          | `adamtasteslikegood/tasteslikegoodtheangularsvegancookbook`, default branch `dev`                         | yes (`gh api`)                   |
| Backend public repo           | `adamtasteslikegood/tasteslikegood.com`, default branch `dev`                                             | yes                              |
| Cookbook advisory             | `GHSA-8744-3qm2-c4x8`, draft, high, fork `…cookbook-ghsa-8744-3qm2-c4x8`                                  | yes                              |
| Backend advisory              | `GHSA-48gm-m2wj-96xh`, draft, high, fork `tasteslikegood.com-ghsa-48gm-m2wj-96xh`                         | yes                              |
| Fork PRs                      | none open in either fork                                                                                  | yes (A.3 creates them)           |
| Cookbook fork tip / base      | `2c3ed0d` on `advisory-fix-1` / public `dev` `534ac17`                                                    | yes                              |
| Backend fork tip / base       | `51720c5` on `advisory-fix-1` / public `dev` `0506f0f`                                                    | yes                              |
| Backend `main`                | `6fe7893` (= current cookbook pin, named in `## [0.5.8]`)                                                 | yes                              |
| Cookbook `main`               | `6136fb1` (v0.5.7)                                                                                        | yes                              |
| Release PR                    | #3612 `dev → main`, OPEN, CLEAN, MERGEABLE                                                                | yes                              |
| Tag `v0.5.8`                  | absent (`v0.5.7` is the latest)                                                                           | yes                              |
| `package.json` version (fork) | `0.5.8`                                                                                                   | yes                              |
| Cloud Build trigger           | tag `^v[0-9]+\.[0-9]+\.[0-9]+$`, GCP-side                                                                 | from RUNBOOK; `[VERIFY]`         |
| Prod project / region         | `comdottasteslikegood` / `us-central1`                                                                    | from `cloudbuild.yaml`           |
| Registry                      | `us-central1-docker.pkg.dev/comdottasteslikegood/vegangenius`                                             | from `cloudbuild.yaml`           |
| Prod services                 | `express-frontend`, `flask-backend`                                                                       | from `cloudbuild.yaml`           |
| Prod jobs                     | `flask-backend-migrate`, `flask-backend-image-repair`, `flask-backend-publish-audit` (new, 4Gi, `python`) | from `cloudbuild.yaml`           |
| Express deploy env handling   | `--update-env-vars` (`cloudbuild.yaml:356`); pause variable survives the release                          | yes                              |
| Prod DB                       | Cloud SQL `vegangenius-db`, db `vegangenius`, user `vegangenius-user`, private IP, Studio only            | from memory/plan                 |
| Prod bucket                   | `tasteslikegood-recipe-images` (must be private)                                                          | `[VERIFY]` A.6                   |
| Staging project               | `gen-lang-client-0491022701`                                                                              | from `deploy-staging.sh`         |
| Staging services              | `express-frontend-staging`, `flask-backend-staging`; Cloud SQL `vegangenius-staging-db`; no Valkey        | from `deploy-staging.sh`         |
| Staging jobs                  | `flask-staging-migrate` only; audit job created in B.2                                                    | `[VERIFY]`                       |
| Staging bucket / URL          | `tasteslikegood-recipe-images-staging` / `https://staging.tasteslikegood.xyz`                             | URL yes; bucket `[VERIFY]`       |
| Public `/r/` URLs             | production 101, staging 35                                                                                | yes (sitemaps)                   |
| Prod health                   | `/api/health` 200, `environment production`, `rateLimitStore valkey`                                      | yes                              |
| Served index asset            | `main-OA6KSVBS.js` (pre-release)                                                                          | yes                              |
| Markers                       | `RECIPE_WRITE_PAUSE`; `Only recipes generated here can have a public page`                                | in fork source; asset `[VERIFY]` |
| Audit script tests            | `tests/test_publish_audit.py` 33 passed (Backend fork)                                                    | yes                              |
| Local gates, last run         | Backend 785 passed; cookbook 829 passed, build exit 0                                                     | caller-reported                  |
| Image-repair scheduler        | name, schedule                                                                                            | `[VERIFY]` E.4                   |

### `[VERIFY]` list

| #   | Item                                                                    | Command                                                                                             |
| --- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Both buckets private                                                    | `gsutil iam get gs://tasteslikegood-recipe-images` / `…-staging` (A.6; empty output = auth failure) |
| 2   | Image-repair job export keys (`memory`, `maxRetries`, `timeoutSeconds`) | `gcloud run jobs describe flask-backend-image-repair --region us-central1 --format=export` (B.2)    |
| 3   | Staging job pulls from the prod registry                                | first `gcloud run jobs execute` on staging (B.2)                                                    |
| 4   | `GOOGLE_API_KEY` not required by `create_app()` for the script          | same execution; `grep -n GOOGLE_API_KEY Backend/app.py Backend/config.py`                           |
| 5   | Log label key for an execution                                          | first `gcloud logging read` with `labels."run.googleapis.com/execution_name"` (Conventions)         |
| 6   | Scheduler job name for image repair                                     | `gcloud scheduler jobs list --location us-central1 --project comdottasteslikegood` (E.4)            |
| 7   | Trigger passes `_VERSION` (`v*` image tags)                             | `gcloud builds describe <id> --region us-central1 --format='value(substitutions)'` (F.3)            |
| 8   | Non-503 code for an empty anonymous POST after the pause lifts          | H.1 curl                                                                                            |
| 9   | Which served asset carries each marker                                  | H.2 loops                                                                                           |
| 10  | Cloud Build trigger regex and tag-based firing                          | `gcloud builds triggers list --region us-central1 --project comdottasteslikegood`                   |
