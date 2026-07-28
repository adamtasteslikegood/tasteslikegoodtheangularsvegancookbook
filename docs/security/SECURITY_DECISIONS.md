# Security decisions register

Deliberate security postures and content policies that a reader would otherwise
mistake for an oversight.

This file exists because of how KAN-170 happened. A Cloud Run annotation that
made `flask-backend` publicly invokable sat in production for roughly 4.6
months. Nobody decided that; it was a side effect of working around Domain
Restricted Sharing, and it was never written down. When a posture is unrecorded,
there is no difference between "we accepted this risk" and "we never noticed" —
not to an auditor, not to a future contributor, and not to us six months later.

Each entry states what the posture is, why it is accepted, what actually holds
it shut, and what would change the decision.

---

## D-1 — `express-frontend` runs with the invoker IAM check disabled

**Status:** Accepted · **Recorded:** 2026-07-28 · **Ticket:** KAN-172 · **Detection:** KAN-173

`express-frontend` carries `run.googleapis.com/invoker-iam-disabled=true` — the
same annotation that caused the KAN-170 exposure on `flask-backend`. It is not
an oversight and it is not scheduled for removal.

**Why it is there.** Domain Restricted Sharing forbids granting `allUsers` on
the service, so the annotation was the only available mechanism for making a
service publicly servable at all. The alternative was not "a more secure public
frontend"; it was "no public frontend."

**Why it is acceptable.** `express-frontend` is _supposed_ to serve anonymous
traffic. It is the public web tier. An invoker IAM check on it would have to be
satisfied by every visitor's browser, which is not a thing browsers do. The
service is the intended front door.

**What actually holds it shut.** `ingress=internal-and-cloud-load-balancing`,
plus the external load balancer in front of it. Verified 2026-07-27: the
service's `run.app` URL returns 404 from outside the perimeter on both hostname
forms (opaque-hash and project-number).

**The reusable lesson — ingress is the differentiator, not IAM.** Both services
were equally unauthenticated at the IAM layer. `flask-backend` was exposed
because its `ingress=all`; `express-frontend` was not because its ingress is
load-balancer-only. Only reachability differed. Anyone reasoning about this
stack should check ingress first, and should not read an absent `allUsers`
binding as evidence of anything.

**The load-bearing consequence.** Because ingress is the _only_ guard,
widening it reproduces KAN-170 on this service — with no IAM change to make it
visible in a policy dump, and nothing in `cloudbuild.yaml` to contradict.
`scripts/gcloud/kan170_verify.sh` therefore asserts `express-frontend`'s ingress
directly, and the scheduled `Security — posture drift` workflow runs it daily.

**What would change this decision.** If the load balancer is ever configured to
serve identity (IAP or equivalent), the invoker check can be re-enabled on
`express-frontend` too, and this entry should be revised rather than deleted.
Doing that is explicitly out of scope for KAN-172, which records the present
state.

---

## D-2 — Security scanner and posture exports are never committed

**Status:** Enforced · **Recorded:** 2026-07-28 · **Tickets:** KAN-171, KAN-175

Security Command Center exports, SARIF files, and similar scanner output must
not be committed to either repository. Enforced by `.gitignore` (`*.sarif`,
`*.sarif.json`, `**/logs_findings/`, `findings.csv`). Keep them in Confluence or
the GCP console and link to those instead.

**Why, precisely.** The usual objection to committing an export is that it leaks
internal identifiers, and that is true but secondary — the project number is
also derivable from `cloudbuild.yaml`, so no rewrite restores obscurity, and
obscurity should never have been load-bearing.

The real harm is different: **a scanner export is an itemised list of your own
known-unfixed weaknesses, ranked and dated.** Publishing one to a public repo
hands a reader the prioritised worklist. That harm does not depend on any
identifier being secret, so it is not mitigated by anything except not
publishing the file.

**Corollary that is easy to miss.** Removing the export does not remediate the
findings inside it. Anything that was ACTIVE at export time is still ACTIVE
afterwards and needs its own tracking. Deleting the map is not the same as
fixing the territory.

**Scope of the withdrawal.** Removal from the working tree and from history does
not reach forks, prior clones, or platform-side caches. KAN-175 tracks the
artifact-side withdrawal and the outstanding confirmation from GitHub support.
The posture that makes this acceptable is that, post-KAN-170, no identifier in
the export is load-bearing.

---

## Related

- `docs/security/KAN-170_PUBLIC_EGRESS_REMEDIATION.md` — the remediation runbook
- `scripts/gcloud/kan170_verify.sh` — the posture check these decisions rely on
- `.github/workflows/security-posture-check.yml` — the schedule that runs it
