# Release train — the runbook

**This file is the procedure.** It replaces the copy that lived on KAN-138, where
it was unreachable from a checkout and drifted from `CLAUDE.md` until the two
disagreed about the one command that matters (KAN-191).

Read [`README.md`](./README.md) for _why_ the tooling is split the way it is.
This file is _what to do, in order_.

- **Driver:** [`train-run.sh`](./train-run.sh) walks these steps interactively and
  checks them off. It stops before every mutating step and prints the state it is
  about to act on. Use it. This document is the reference it implements, and the
  fallback when you are doing something the driver does not cover.
- **Gate:** `train-verify.sh --for-release` must exit 0 before the release PR
  merges. Since KAN-191 that also runs in `pr-gate.yml` on `main`-targeting PRs,
  so it blocks rather than merely reports.

---

## The one-paragraph version

Backend lands on Backend `dev`, gets promoted to Backend `main`, and **only then**
does the cookbook pin `Backend main`'s own SHA. The version bump and CHANGELOG go
to cookbook `dev`. Cookbook `dev → main` is the release: merging it pushes the tag,
and **the tag is what deploys**. Then back-sync both repos. Verify against
production by content, never by "the merge went green".

---

## Step order

Each step names its precondition, the command, and how you know it worked. The
step numbers are the ones `train-run.sh` prints.

### 0. Establish the starting state

```bash
git fetch origin --prune && git submodule update --init Backend && git -C Backend fetch --prune
./scripts/release/train-verify.sh
```

You are looking for what is _already_ owed — usually a back-sync from the last
release. Pay that down first (step 8's command works any time); starting a release
on top of unpaid drift means every later count is ambiguous.

### 1. Backend change → Backend `dev`

Normal PR into Backend `dev`. Nothing release-specific.

### 2. Backend `dev` → `main`

```bash
gh pr create -R adamtasteslikegood/tasteslikegood.com --base main --head dev \
  --title "release: promote Backend dev → main for <topic> [KAN-###]"
```

**No build fires.** Backend has no push-to-`main` trigger; only the cookbook tag
push reaches Cloud Build. This is a lane move.

> **TRAP — a promotion goes stale the moment anything else lands on Backend `dev`.**
> This is not hypothetical: on v0.4.8, Backend #258 promoted at 19:17 and #259
> merged to `dev` at 03:43 the next morning. The step list said "promotion: done";
> `main` did not have the code. It cost a second promotion (#261).
>
> **Never trust the step list here. Check the content:**
>
> ```bash
> git -C Backend merge-base --is-ancestor <the-PR-merge-sha> origin/main && echo OK || echo STALE
> ```
>
> If anything landed on Backend `dev` after your promotion PR merged, promote again.

### 3. Backend `main` → `dev` back-sync

```bash
./scripts/release/train-backsync.sh --apply --merge
```

The promotion leaves a merge commit on `main` that `dev` lacks. Skipping it is the
most repeated miss in this project's history. Not release-blocking on its own, but
it makes every later drift count non-zero, and a check nobody trusts is a check
that stops being read.

### 4. Pin the pointer to Backend **`main`**

```bash
git switch -c chore/release-vX.Y.Z-KAN-### origin/dev
git -C Backend fetch origin --prune
git -C Backend checkout origin/main      # main's OWN SHA — see below
git add Backend
```

> **TRAP — `git submodule update --remote Backend` is the wrong command here,**
> and `CLAUDE.md` said to use it until KAN-191. `.gitmodules` sets
> `submodule.Backend.branch = dev`, so `--remote` resolves to Backend **`dev`**'s
> tip. Station 3 requires **`main`**'s tip. These can never agree, because every
> promotion + back-sync cycle produces two distinct merge commits:
>
> ```
> main = merge(old_main, dev_tip)     7b6347e = merge(d48f06a, 73fb091)
> dev  = merge(dev_tip,  main)        3fac56b = merge(73fb091, 7b6347e)
> ```
>
> So `dev`'s tip is structurally never `main`'s tip again. Following the old
> instruction produced a Station 3 block **every release** — v0.3.9 shipped that
> way, and v0.4.8 nearly did (fixed by #3320).
>
> The trees are identical, so this is not about what runs in production. It is
> about "which Backend commit is in production?" being answerable from one ref.

### 5. Version + CHANGELOG, same branch

Bump `package.json` **and both self-references in `package-lock.json`**. Add a
`## [X.Y.Z]` section to `CHANGELOG.md` that **names the pinned Backend SHA** —
`train-verify` checks the section against the _actual pointer_, so the SHA in the
prose and the gitlink must be the same value.

The driver writes those mechanics for you — the fiddly part, not the judgment:

```bash
./scripts/release/train-run.sh --bump X.Y.Z
```

It rewrites `package.json`, **both** `package-lock.json` self-references, and
inserts a dated `## [X.Y.Z]` section naming the pinned SHA with a `TODO` where
the prose goes. It does not branch, commit, or push. It **refuses** (exit 2) if
the version is malformed, unchanged, already tagged, or — the one that matters —
if the pointer does not yet pin Backend `main`: scaffolding the section before
step 4 bakes the KAN-191 wrong-SHA trap into the prose, where it then reads as
deliberate.

Then write the actual prose and verify:

```bash
npx prettier --write CHANGELOG.md      # the section will not be Prettier-clean by hand
./scripts/release/train-verify.sh --for-release   # must exit 0
```

Open the PR into **`dev`**, not `main`.

> **Release PRs are `dev → main` only.** Never point a `chore/*` branch at `main`.
> The bump lands on `dev` first; `dev → main` is what ships and tags.

### 6. Cookbook `dev` → `main` — this is the release

```bash
gh pr create --base main --head dev --title "release: vX.Y.Z — <summary> [KAN-###]"
gh pr merge <n> --merge      # merge commit; squash is blocked by the main ruleset
```

The freeze window opens at **step 5**, not here: a `dev → main` PR merges the live
tip of `dev`, so anything landing on `dev` in between ships silently, outside the
CHANGELOG, under a version that never described it.

### 7. The tag deploys

`release.yml` reads `version` from `package.json`, pushes `vX.Y.Z`, and publishes
the Release. **That tag push is the deploy**, via a Cloud Build trigger configured
GCP-side on:

```
^v[0-9]+\.[0-9]+\.[0-9]+$
```

Anchored and digits-only. `v0.4.8` matches. `v0.4.8-rc.1` and `v0.4.8+abc1234` do
**not** — which is why the rewritten immutable-release tags (`v0.4.5+0ff0e4e` …)
never redeployed anything.

> **TRAP — a spent version deploys nothing, silently.** If `vX.Y.Z` already exists,
> `release.yml` skips the tag, the Release, and therefore the trigger — and reports
> success. Green PR, green workflow, no deploy, no error anywhere.
> `--for-release` blocks on this; do not override it.

### 8. Back-sync both repos

```bash
./scripts/release/train-backsync.sh --apply --merge
```

Must be a **merge commit**. Squashing rewrites the commits, ancestry never
converges, and the drift count never returns to zero. This step is local and not
in CI because it needs credentials for both repos (Actions' `GITHUB_TOKEN` is
scoped to one).

> **Correction (2026-08-25).** This paragraph used to say `dev` carries
> `required_linear_history` in both repos. That was never true — no ruleset in
> either repo sets it. The cookbook's `dev` now allows only `merge` and `rebase`
> (squash blocked), so a merge commit is the normal path, not a bypass.

### 9. Verify against production — by content

```bash
./scripts/release/train-run.sh --verify-only     # or the manual form below
```

`--verify-only` runs a **staging health gate first**: it checks that the staging
Cloud Run pair returns 200 and that `/api/health` reports `environment=staging`
(guarding against `STAGING_URL` accidentally pointing at production). The default
URL is hardcoded to the known staging service; override with `STAGING_URL` if the
service is redeployed to a new URL.

> **PRECONDITION — promote to staging before you read staging as evidence.**
> The gate proves staging is **up**. It does not prove staging is **current**.
> Those were nearly the same claim while `staging-deploy.yml` fired on every
> push to `dev`; since 2026-08-26 it does not, so deploying to staging is an
> explicit act and staging can be arbitrarily stale while both HTTP checks
> still pass. A release verified against two-week-old staging exercised
> nothing this release changed.
>
> Before step 9, promote the release ref and wait for it to go green:
>
> ```bash
> git tag staging-vX.Y.Z && git push origin staging-vX.Y.Z   # or:
> gh workflow run staging-deploy.yml --ref dev
> gh run watch "$(gh run list --workflow=staging-deploy.yml --limit 1 \
>   --json databaseId --jq '.[0].databaseId')"
> ```
>
> Then apply the same by-content check below to the staging URL, not just to
> production — a marker string absent from staging means staging is not
> running this build, whatever `/api/health` says.

> **TRAP — verify the code, not the bundle name, and not `main-*.js` alone.**
> On v0.4.8 the deploy was live while a poller grepping only `main-*.js` reported
> "not deployed" for twenty minutes. The app is code-split: `publishFailureMessage`
> ships in a shared `chunk-*.js`. A hash change alone also proves nothing about
> _which_ build landed.
>
> Grep every served asset for a string unique to this release:
>
> ```bash
> for a in $(curl -s https://www.tasteslikegood.org/ | grep -oE '(main|chunk|polyfills)-[A-Z0-9]+\.js' | sort -u); do
>   curl -s "https://www.tasteslikegood.org/$a" | grep -c "<a string only this release has>"
> done
> ```
>
> Pick a string that is **new in this release and absent from the previous one**.
> "Check your connection" was useless on v0.4.8 — the new code kept it for the
> genuine sync case, so it appeared in both builds.

Also confirm: `/`, `/browse`, `/sitemap.xml` return 200, and if the release
touched Backend, that a canonical `/r/<slug>` still resolves.

If `gcloud` is authenticated, `gcloud builds list --region=us-central1` shows the
build — **regional; a global list shows nothing recent**. The content check above
is decisive on its own and needs no credentials.

### 10. Close out

`train-verify.sh` back to exit 0, drift counts zero on both repos, Jira rows moved
with evidence rather than on the merge alone.

---

## Rollback

There is no rollback to a previous tag. The recovery for a failed deploy is a
**patch bump forward through this same runbook** — v0.3.0 died in the migrate Job
and v0.3.4 died parsing the Express Dockerfile; both recovered as v0.3.1 and
v0.3.5. That is also why `main` stays frozen until the deploy is verified: the one
move that breaks `main === deployed` is a panic hotfix pushed straight to `main`.

## Migrations

`flask db heads` must print exactly one line before the release. Two heads and
`flask db upgrade` refuses, the `flask-backend-migrate` Job fails, and the build
aborts — the old Flask revision keeps serving, which is the desired failure, but
the release is dead until you merge the heads. `train-verify` checks this, and
`pr-gate.yml`'s `alembic-heads` job shares the same script so the two can never
disagree.

## What is deliberately still human

Version choice and CHANGELOG prose; the Backend promotion; merging the release PR;
and accepting the production verification. Everything else the driver does.

## What the driver's checklist means

`train-run.sh` keeps a checklist under `.agent-work/release/` and **derives most
of it from observable state on every run** — it does not simply record what it
did. A box is ticked only against a decisive signal:

| Step  | Ticked by                                                           |
| ----- | ------------------------------------------------------------------- |
| 0     | the fetch + station read at the top of every run                    |
| 1     | Backend `dev`'s tree differing from `main` (or `skipped` if none)   |
| 2 · 4 | the driver performing them, or observing them already true          |
| 3 · 8 | the back-sync counts being zero                                     |
| 5     | a CHANGELOG section that **names the pinned SHA**, version untagged |
| 6     | the release PR being opened                                         |
| 7     | the tag existing **on the remote**                                  |
| 9     | `verify_prod` finding the marker in a served asset                  |
| 10    | tag pushed, nothing pending, no drift on either repo                |

Derived marks are **authoritative in both directions** — cleared as readily as
set. Before KAN-138 the driver declared ten steps and only ever marked four, so
six of them read `[ ]` forever even once done, and a finished release still
showed a mostly empty checklist. A checklist that cannot be completed stops being
read, which is the same failure this document names about the back-sync count.

Two things it deliberately does **not** infer: the Jira half of step 10, and
step 9 from anything other than served content. "The merge went green" is not
evidence a build is live.
