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

## D-3 — Cloud NAT is funded so `flask-backend` can run on two guards

**Status:** Approved, not yet executed · **Recorded:** 2026-08-27 · **Ticket:** KAN-176

`flask-backend` runs on a single guard: invoker IAM enforcement (Path A, shipped
v0.4.7). Its ingress is `all`, so an anonymous request still reaches Cloud Run
and is turned away by IAM rather than refused by the network. That is one
annotation away from KAN-170 again — `invoker-iam-disabled=true` silently voids
`--no-allow-unauthenticated`, which is exactly how the original exposure worked.

Path B closes it by restricting Flask's ingress. It was blocked on cost, not on
design: closing Flask's ingress requires Express to reach it over the VPC, which
requires `--vpc-egress=all-traffic`, which severs Express's public egress unless
a Cloud NAT exists. No Cloud Router existed (verified 2026-08-27), so Path B
meant standing up billable, always-on infrastructure.

**The decision: that cost is approved.** Roughly $3.60/month for one NAT external
IPv4 address, plus gateway hourly usage, $0.045/GiB processed, and normal
outbound transfer — on the order of $5–10/month at this volume. That figure is an
estimate to be **measured over the first seven days**, not assumed; it rises with
NAT assignments, instance scaling and traffic.

Two constraints ride with the approval:

- **The networking cutover stays isolated from application deploys.** It does not
  ship alongside a version rollout. A combined change is one opaque event with
  two independent failure modes, and the NAT half is the one that fails quietly.
- **Flask's target ingress is `internal`, not `internal-and-cloud-load-balancing`.**
  Flask was created `internal` and was opened to `all` on 2026-03-09; `internal`
  is both the restoration and the least-privilege setting. The load-balancer
  variant is a deliberate opt-in for a service behind an external LB, which Flask
  is not — Express is the single entry point and reaches it over the VPC.

**What would change this decision:** measured NAT cost materially above the
estimate, or Flask genuinely being placed behind an external load balancer.

Until the cutover completes, the daily posture check requires **one** guard
(`REQUIRED_FLASK_GUARDS=1`). Demanding two before Path B lands would make the job
permanently red, and a permanently-red check is an ignored one. Flipping it to
`2` is the final step of the cutover, and is what makes the two-guard posture the
declared steady state rather than a hope.

---

## Related

- `docs/security/KAN-170_PUBLIC_EGRESS_REMEDIATION.md` — the remediation runbook
- `scripts/gcloud/kan170_verify.sh` — the posture check these decisions rely on
- `.github/workflows/security-posture-check.yml` — the schedule that runs it
