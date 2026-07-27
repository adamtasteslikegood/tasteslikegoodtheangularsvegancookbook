# KAN-170 — flask-backend public egress remediation

**Severity:** P1 · **Status:** code landed, production cutover pending
**Jira:** [KAN-170](https://tasteslikegood.atlassian.net/browse/KAN-170) — the ticket holds the forensic timeline, the live-state snapshot, and the service hostname.

> **Do not put the flask-backend hostname or the GCP project number in this file, in a PR body, or in any tracked file.** Both repos are public. The project-number URL form is already derivable from `cloudbuild.yaml`, which is precisely why this was trivially discoverable — do not widen it. Jira is private and is the right place. See KAN-171.

## The exposure

`flask-backend` accepted unauthenticated requests from the public internet from **2026-03-09 until remediation** — about 4 months 18 days. `POST /api/generate` and `/api/generate_image` completed and billed Gemini/Imagen for anonymous callers, and the legacy HTML form `POST /generate_recipe` did too. Everything Express provides was bypassed: the 20/hr AI budget, the 300/15m limiters, express-validator's body validation and 10kb cap, and Helmet's headers.

## Why the config said otherwise

Two settings, one of which silently voids the other:

| Setting                                        | Where                                | Effect                                          |
| ---------------------------------------------- | ------------------------------------ | ----------------------------------------------- |
| `--no-allow-unauthenticated`                   | `cloudbuild.yaml` flask-backend step | Edits the **IAM policy** (removes `allUsers`)   |
| `run.googleapis.com/invoker-iam-disabled=true` | Service annotation                   | Switches the **invoker IAM check off entirely** |

The annotation wins. `--no-allow-unauthenticated` cannot clear it, so the pipeline could never self-heal, and the two artifacts a reviewer would check — the build config and the IAM policy — both read as _secure_ while production was open.

Domain Restricted Sharing is enforced on this project, so `allUsers` can never be added to any IAM policy. That is _why_ the annotation was the only available mechanism for making a service public, and it is why `express-frontend` is public today with **zero** IAM bindings. The annotation was set by a human on 2026-03-09 during setup iteration; ingress opened to `all` 34 seconds later, and that second change is the exposure event.

`gcp-monitor-mcp` in the same project proves the fix works: `ingress=all`, annotation **absent**, zero IAM bindings, and anonymous `GET /` returns 403.

## Two paths, and what each actually fixes

**Path A — ID-token auth.** Express mints a Google-signed ID token and Cloud Run enforces IAM at the edge. This is the real authentication fix: it removes the annotation, so the deploy config stops lying.

**Path B — network isolation.** Express egresses through the VPC; Flask's ingress closes to the internet. Defence in depth. It closes reachability for _both_ run.app hostnames at once, but it leaves `invoker-iam-disabled=true` in place — i.e. it preserves the exact silent-failure mode that caused this. **Path B alone is not a fix.** Do A first.

## Path A

```bash
./scripts/gcloud/kan170_path_a.sh prepare --apply
```

Grants the Express runtime SA `roles/run.invoker` on flask-backend (DRS-legal: a same-customer SA, not `allUsers`), and registers the Pub/Sub push endpoints as **custom audiences**. Both are additive and change no traffic behaviour.

Then deploy Express carrying [`server/flask-auth.ts`](../../server/flask-auth.ts), verify, and only then:

```bash
./scripts/gcloud/kan170_path_a.sh cutover --apply
./scripts/gcloud/kan170_verify.sh
```

Rollback is one command and takes seconds:

```bash
./scripts/gcloud/kan170_path_a.sh rollback --apply
```

### Why the custom audiences step exists

Both Pub/Sub push subscriptions set **no explicit audience**, so Pub/Sub signs `aud` = the full push endpoint URL _including the path_ (`…/api/worker/recipe`). Cloud Run's docs describe the audience as the service URL and do not confirm a path-bearing `aud` is accepted — and the check has never run here, because it is disabled. If Cloud Run rejects it, every push 403s, retries 5×, and async recipe/image generation drains into the DLQ: a silent, user-visible outage with recipes stuck "generating".

Registering those URLs as custom audiences removes the question rather than answering it. It is purely additive — _"The default Google-generated URL always remains as an accepted audience value"_ — so Express's root-origin token keeps working unchanged.

**Do not instead repoint Pub/Sub at the bare service URL.** Flask verifies `audience=request.base_url` (`Backend/blueprints/worker_api_bp.py`), which is the path-bearing form, so that "fix" breaks the app-side check from the opposite direction — same DLQ outcome.

## Path B

```bash
./scripts/gcloud/kan170_path_b.sh nat     --apply   # Cloud Router + Cloud NAT
./scripts/gcloud/kan170_path_b.sh egress  --apply   # Express → all-traffic, then verify
./scripts/gcloud/kan170_path_b.sh ingress --apply   # Flask → internal, then verify
```

Order is enforced by the script: `ingress` refuses to run while Express is still on `private-ranges-only`, and `egress` refuses to run with no Cloud Router.

**Cloud NAT is not what makes Express reach an internal-ingress Flask.** A Public NAT gateway never NATs Google APIs and services; that traffic goes via Private Google Access, which is already enabled on the `default` subnet in us-central1. Google's documented option #1 is exactly this shape: caller on `--vpc-egress=all-traffic` + PGA on the subnet, still dialling the normal public run.app URL — no hostname change, no PSC endpoint.

NAT is required for something else: `express-frontend`'s **non-Google** egress. Under `all-traffic` everything leaves via the VPC, so without a NAT the container loses public internet access entirely and the Datadog intake breaks. NAT is billable and always-on (hourly + per-GB) — owned infrastructure from the moment it is created.

**Pub/Sub push is safe under internal ingress:** Cloud Run counts Pub/Sub subscriptions as internal traffic when they are in the same project and use the default run.app URL. Both hold. Never repoint the push endpoints at the custom domain — a custom-domain push endpoint under internal ingress fails 100% of deliveries.

## Landmines

- **Ordering is the entire safety margin.** Everything before the cutover is reversible and non-breaking. Flipping the check first returns 403 to Express and takes down _every_ proxied route — `/api/*`, `/r/*`, `/browse`, `/sitemap.xml`, `/static/*` — the whole public site, not just the API.
- **You cannot prove the token path works before the cutover.** While the check is disabled every request succeeds regardless of whether the token is present, valid, or correctly scoped. `kan170_verify.sh` checks the two _necessary_ conditions (`FLASK_BACKEND_URL` is a bare https `run.app` origin, so a token is minted at all; and the Express SA holds an invoker binding) — but neither is sufficient. The first real proof is a proxied route still returning 200 _after_ the cutover, which is why rollback must stay one command away.
- **Probe a proxied path, never `/`.** `GET /` is served by Express from disk (the SPA shell) and never touches Flask, so it returns 200 even when every Flask-backed route is 403 — verified empirically. `/api/health` is Express-local too and equally blind. The scripts probe `/sitemap.xml`, which is proxied. A health check that cannot fail is worse than none, because it suppresses the rollback branch that depends on it.
- **`--invoker-iam-check` is service-level**, applied the moment the deploy step runs — before the Express step rolls out. Never land it in the same release that first ships the token code, or the old Express revision 403s for ~60s mid-deploy.
- **The token goes in `X-Serverless-Authorization`, not `Authorization`.** Cloud Run forwards `Authorization` to the container unmodified, and Flask reads it in two live paths: `require_admin` (guarding `/api/admin/*`, which Express proxies) and `require_pubsub_oidc`. Overwriting it breaks both.
- **The audience must be the bare origin** — no path, no trailing slash. `server/flask-auth.ts` derives it with `URL.origin` rather than trusting the raw env var; a trailing slash would 401 the entire site.
- **Diagnostics are inverted from intuition.** `403` = token valid but the caller lacks `run.invoker`. `401` = token missing, malformed, or wrong audience. `404` = the request arrived as EXTERNAL and was refused by internal ingress (a Path B misconfiguration, not an auth failure).
- **Both services share the default compute SA.** Granting "Express's SA" `run.invoker` therefore grants it to anything running as that SA, including flask-backend itself. Accepted here, not hidden — splitting the identities is separate work and deliberately not bundled into a security cutover.

## Exploitation assessment: exposed, never exploited

**The whole exposure window is observable, and it is clean.** Every request that could
have billed a model between the moment the service was opened
(`2026-03-09T10:20:31Z`) and the remediation resolves to Google infrastructure —
Express's own egress — or to Adam's ISP range and devices. **Unattributed callers:
zero.** Nobody else found it.

```bash
gcloud logging read \
 'resource.type="cloud_run_revision" AND resource.labels.service_name="flask-backend"
  AND httpRequest.requestMethod="POST"
  AND (httpRequest.requestUrl:"/api/generate" OR httpRequest.requestUrl:"/generate_recipe")
  AND timestamp>="2026-03-01T00:00:00Z"' --limit=4000 \
 --format='value(timestamp,httpRequest.remoteIp,httpRequest.status)'
```

So KAN-170 closes as an **exposure, not a breach**: no data was reachable that is not
already public, and the billable surface was never abused. No notification obligation
arises — GDPR included, since the anonymous surface exposes no personal data
(`/api/recipes` returns 0 records unauthenticated; it is session-scoped).

**Do not conclude "retention is 30 days" from a `--limit`ed query.** That is the trap
this section originally fell into. The project has **two** log buckets — `_Default` at
30 days and a second at **400 days** — and `gcloud logging read` returns the most-recent
N entries, so a busy service hits the `--limit` cap long before the retention edge and
the oldest row _looks_ like the horizon. Always pin the window with an explicit
`timestamp>=` filter, and note that `--freshness` is unreliable alongside `--order=asc`.

A Gemini/Imagen spend review by month is therefore **not** needed as an abuse check —
request logs answer that question directly and more precisely than cost aggregates
would. Run one only if you want the cost figure for its own sake.

## What this does not fix

- `express-frontend` is _also_ `invoker-iam-disabled=true`, guarded solely by `ingress=internal-and-cloud-load-balancing`. Acceptable for a public frontend behind a load balancer, but it should be a recorded decision rather than an accident of DRS.
- Flask still has no rate limiting of its own (`flask-limiter` is not a dependency) and no auth on the generation endpoints. Express remains the only limiter; both paths work by ensuring Express is the only reachable caller.
- **Nothing detects recurrence.** `kan170_verify.sh` runs when an operator types it; no CI job or scheduled check asserts that `invoker-iam-disabled` stays absent, or that `express-frontend`'s ingress is not widened later. The 4.6-month dwell was a _detection_ failure — the annotation is invisible in both artifacts a reviewer would check — and that half is still open. Precedent for closing it: the single-Alembic-head check sat unused in `scripts/` until it was wired into `pr-gate.yml` **and** `gate.needs` (KAN-138).
