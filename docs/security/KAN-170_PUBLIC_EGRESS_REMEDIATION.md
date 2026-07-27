# KAN-170 — flask-backend public egress remediation

**Severity:** P1 · **Status:** code landed, production cutover pending
**Jira:** [KAN-170](https://tasteslikegood.atlassian.net/browse/KAN-170) — the ticket holds the forensic timeline, the live-state snapshot, and the service hostname.

> **Do not put the flask-backend hostname or the GCP project number in this file, in a PR body, or in any tracked file.** Both repos are public. The project-number URL form is already derivable from `cloudbuild.yaml`, which is precisely why this was trivially discoverable — do not widen it. Jira is private and is the right place. See KAN-171.

## The exposure

`flask-backend` accepted unauthenticated requests from the public internet from **2026-03-09 until remediation** — about 4 months 18 days. `POST /api/generate` and `/api/generate_image` completed and billed Gemini/Imagen for anonymous callers, and the legacy HTML form `POST /generate_recipe` did too. Everything Express provides was bypassed: the 20/hr AI budget, the 300/15m limiters, express-validator's body validation and 10kb cap, and Helmet's headers.

## Why the config said otherwise

Two settings, one of which silently voids the other:

| Setting | Where | Effect |
| --- | --- | --- |
| `--no-allow-unauthenticated` | `cloudbuild.yaml` flask-backend step | Edits the **IAM policy** (removes `allUsers`) |
| `run.googleapis.com/invoker-iam-disabled=true` | Service annotation | Switches the **invoker IAM check off entirely** |

The annotation wins. `--no-allow-unauthenticated` cannot clear it, so the pipeline could never self-heal, and the two artifacts a reviewer would check — the build config and the IAM policy — both read as *secure* while production was open.

Domain Restricted Sharing is enforced on this project, so `allUsers` can never be added to any IAM policy. That is *why* the annotation was the only available mechanism for making a service public, and it is why `express-frontend` is public today with **zero** IAM bindings. The annotation was set by a human on 2026-03-09 during setup iteration; ingress opened to `all` 34 seconds later, and that second change is the exposure event.

`gcp-monitor-mcp` in the same project proves the fix works: `ingress=all`, annotation **absent**, zero IAM bindings, and anonymous `GET /` returns 403.

## Two paths, and what each actually fixes

**Path A — ID-token auth.** Express mints a Google-signed ID token and Cloud Run enforces IAM at the edge. This is the real authentication fix: it removes the annotation, so the deploy config stops lying.

**Path B — network isolation.** Express egresses through the VPC; Flask's ingress closes to the internet. Defence in depth. It closes reachability for *both* run.app hostnames at once, but it leaves `invoker-iam-disabled=true` in place — i.e. it preserves the exact silent-failure mode that caused this. **Path B alone is not a fix.** Do A first.

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

Both Pub/Sub push subscriptions set **no explicit audience**, so Pub/Sub signs `aud` = the full push endpoint URL *including the path* (`…/api/worker/recipe`). Cloud Run's docs describe the audience as the service URL and do not confirm a path-bearing `aud` is accepted — and the check has never run here, because it is disabled. If Cloud Run rejects it, every push 403s, retries 5×, and async recipe/image generation drains into the DLQ: a silent, user-visible outage with recipes stuck "generating".

Registering those URLs as custom audiences removes the question rather than answering it. It is purely additive — *"The default Google-generated URL always remains as an accepted audience value"* — so Express's root-origin token keeps working unchanged.

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

- **Ordering is the entire safety margin.** Everything before the cutover is reversible and non-breaking. Flipping the check first returns 403 to Express and takes down *every* proxied route — `/api/*`, `/r/*`, `/browse`, `/sitemap.xml`, `/static/*` — the whole public site, not just the API.
- **You cannot prove the token path works before the cutover.** While the check is disabled every request succeeds regardless of whether the token is present, valid, or correctly scoped. A green site proves nothing. Assert the header is actually being sent.
- **`--invoker-iam-check` is service-level**, applied the moment the deploy step runs — before the Express step rolls out. Never land it in the same release that first ships the token code, or the old Express revision 403s for ~60s mid-deploy.
- **The token goes in `X-Serverless-Authorization`, not `Authorization`.** Cloud Run forwards `Authorization` to the container unmodified, and Flask reads it in two live paths: `require_admin` (guarding `/api/admin/*`, which Express proxies) and `require_pubsub_oidc`. Overwriting it breaks both.
- **The audience must be the bare origin** — no path, no trailing slash. `server/flask-auth.ts` derives it with `URL.origin` rather than trusting the raw env var; a trailing slash would 401 the entire site.
- **Diagnostics are inverted from intuition.** `403` = token valid but the caller lacks `run.invoker`. `401` = token missing, malformed, or wrong audience. `404` = the request arrived as EXTERNAL and was refused by internal ingress (a Path B misconfiguration, not an auth failure).
- **Both services share the default compute SA.** Granting "Express's SA" `run.invoker` therefore grants it to anything running as that SA, including flask-backend itself. Accepted here, not hidden — splitting the identities is separate work and deliberately not bundled into a security cutover.

## What this does not fix

- `express-frontend` is *also* `invoker-iam-disabled=true`, guarded solely by `ingress=internal-and-cloud-load-balancing`. Acceptable for a public frontend behind a load balancer, but it should be a recorded decision rather than an accident of DRS.
- Flask still has no rate limiting of its own (`flask-limiter` is not a dependency) and no auth on the generation endpoints. Express remains the only limiter; both paths work by ensuring Express is the only reachable caller.
- **Billing has not been reviewed.** Request-log retention reaches only 2026-06-27, so ~3.6 months of the 4.6-month exposure is unobservable. In the visible window, 139 of 140 POSTs were Express's own egress and the single external caller was Adam's workstation — absence of evidence, not evidence of absence. A Gemini/Imagen spend review by month since March is still outstanding.
