# Sprint 1 Plan — Post-v0.3.9 Verification & UX Baseline

_Start:_ 2026-07-19 · _Owner:_ Adam Schoen · _Cadence:_ flow-based (no fixed end date)
_Sprint closes when:_ all committed items reach a terminal state (verified-done or explicitly rolled).
_Locked via `/cs:grill-pm` (6/6 branches) — decisions below are the sprint charter, do not re-litigate mid-sprint._

---

## Charter (locked decisions)

| # | Branch | Decision |
|---|--------|----------|
| 1 | **Outcome / DONE** | DONE = a compiled `.agent-harness/plan.json` for this sprint passes `plan_qa.py` (exit 0), and every committed item reaches a terminal state. This `.md` is the human charter; the `plan.json` is the machine-gated artifact. |
| 2 | **Measurement** | No forecasting. Zero tracked flow history exists, so Sprint 1 **generates** the first throughput/cycle-time data. Sized by **WIP limit (≤3 in flight)**, not story points or velocity. |
| 3 | **Ownership** | Two-lane: **human owner = Adam** (accountable, scope calls). **Reviewer = machine gate + adversarial-agent pass**, never Adam rubber-stamping his own output (code → PR gate/CodeQL/Copilot; specs → `plan_qa.py` + adversarial review). Linear agents model. |
| 4 | **Risk (pre-mortem)** | 4 owned risks + guards: (a) verification never terminates → each item ships its proving command *before* work; (b) backlog creep → WIP=3 hard stop, everything else is a Sprint-2 candidate; (c) plausible-but-wrong agent output → mandatory adversarial gate; (d) plan rot → this file is source-of-truth, closing an item means editing it. |
| 5 | **Budgets** | **3 attempts/task, 12 iterations/sprint-goal.** Escalation reviewer = Adam, reason written to this file. Verification items: if the proving command can't exit 0 within the cap, the *finding* (incl. "inconclusive — manual look needed") is the deliverable and the item escalates. |

---

## Committed items (WIP ≤ 3 in flight; SI-0 already terminal)

### SI-0 — Programmatically confirm what v0.3.9 shipped & deployed → **DONE (90–100%)**
Field recon + memory/logs + this session's git checks confirm it. Closed by evidence already in hand:
- `git tag v0.3.9` present, HEAD `f91b816`, both repos clean/0 open PRs.
- Backend submodule pinned at `18a303a` per the release commits (`048e028`, `87ed2da`).
- **Residual question rolled into SI-1:** what exactly the "Datadog deploy marker" is / whether one fired for the v0.3.9 window. Answering that is the only open thread, and it lives with the Datadog work in SI-1.

### SI-1 — Verify Valkey + flask-backend memory after `--memory=1Gi` **+ confirm the v0.3.9 Datadog deploy marker**
The reason the bump shipped (#3173 / Backend #220): confirm the OOM-edge risk is retired. While in Datadog, resolve SI-0's residual marker question in the same pass.

- **Owner:** Adam · **Reviewer:** machine gate (commands below). Easy win — take the momentum into SI-2.
- **Proving command(s) — item is done when all hold:**
  - `gcloud run services describe flask-backend --region=us-central1 --format='value(spec.template.spec.containers[0].resources.limits.memory)'` == `1Gi`.
  - Datadog memory-% query over the post-deploy window: **peak < 85%**, steady-state flat (baseline, not a leak — per prior finding ~84% was baseline on 512Mi; on 1Gi expect a proportional drop).
  - Valkey: connection healthy (`connected` in Flask logs / Datadog), no `CERTIFICATE_VERIFY_FAILED` post-TLS-CA-fix.
  - **Datadog deploy marker:** confirm whether a v0.3.9 deploy event/version marker exists; if not, note it (informational — does not block SI-1).
- **Terminal states:** verified-done · inconclusive+escalate (cap: 3 attempts, hard token/wall-clock cap on Datadog query loops).

### SI-2 — Convert the 6.5/10 field-test into a ranked UX/UI defect backlog
Live-site score 6.5/10 overall, 7–8/10 on specific elements. **Discovery, not build** — turns the fuzzy score into structured Sprint-2 candidates. Staying inside this fence (list, don't fix) IS the scope-discipline exercise.

- **Owner:** Adam · **Reviewer:** adversarial-agent pass on the list
- **Deliverable / proving artifact:** `specs/ux-backlog.md` — each entry: element, current score, target score, repro, one-line fix hypothesis, effort estimate. Item done when the file exists, every entry has all six fields, and the adversarial pass finds no "vibe-only, no repro" entries.
- **Terminal states:** done (list ships) · rolled (deferred to Sprint 2 with reason).

### SI-3 — Make the site discoverable: home SSR crawlable links **+** GSC sitemap submission
Two coupled sub-gates toward one outcome — fix the home crawl dead-end (3a) *and* tell Google to crawl (3b). Both advance the v0.2 SEO/distribution goal.

**SI-3a — Home-page SSR crawlable links** (build — harness-executable)
- **Owner:** Adam · **Reviewer:** PR gate (Gate/Analyze/DepReview) + adversarial pass
- **Do:** add server-rendered `<a href="/browse">` plus ≥1 `<a href="/r/<slug>">` recipe link, and a real `<lastmod>`/date, to the home page — so a crawler hitting `/` finds anchors in the **server HTML**, not just the Angular JS shell.
- **Proving command (all must hold against server HTML, not rendered JS):**
  - `curl -s https://www.tasteslikegood.org/ | grep -c 'href="/browse"'` ≥ 1
  - `curl -s https://www.tasteslikegood.org/ | grep -oE 'href="/r/[^"]+"' | head` returns ≥ 1 recipe anchor
  - home no longer a zero-server-link SPA shell
- **Scope fence (the discipline exercise):** ship **ONLY** the anchors + lastmod. **No** home-page redesign, no new sections, no restyle. That restraint is the point.
- **Terminal states:** merged+live · rolled (with reason).

**SI-3b — Submit sitemap + Request Indexing in GSC** (Adam doing now)
- **Owner:** Adam (GSC actions) · **Reviewer:** machine gate (GSC status + captured baseline)
- **The one correct URL to submit:** `https://www.tasteslikegood.org/sitemap.xml`
  - `www` is canonical; apex `tasteslikegood.org` (and its sitemap) **301-redirects to www** — do NOT submit the apex version, GSC errors on a redirecting sitemap.
  - **URL-prefix property** `https://www.tasteslikegood.org/` → type just `sitemap.xml` in the box.
  - **Domain property** `tasteslikegood.org` (Adam's actual property — bare name, DNS-verified, covers apex+www) → paste the **full** `https://www.tasteslikegood.org/sitemap.xml`. Do NOT type bare `sitemap.xml` here: GSC resolves it to the apex `https://tasteslikegood.org/sitemap.xml`, which 301s to www → **"Couldn't fetch"**. (Hit once on 2026-07-19; fix = submit the explicit www URL.)
  - Also confirm you're in the **`.org`** property, not `tasteslikegood.com` — a `.com`-property + `.org`-sitemap fails as cross-domain.
  - Live sitemap + robots verified this session: sitemap 200 / `application/xml`, **59 URLs, all www** (`/`, `/browse`, 57 `/r/<slug>`), `<lastmod>` present; `robots.txt` already declares `Sitemap: https://www.tasteslikegood.org/sitemap.xml`, so Google discovery isn't blocked regardless of the GSC report.
- **Proving artifact (same-sprint, hard close):**
  - GSC shows sitemap status **Success / "Discovered"** (not Error), discovered-URL count ≈ 59.
  - Request Indexing fired for the priority slugs (home + `/browse` + top recipes).
  - **Baseline captured** in this file: submission date + GSC "Last update" date at submit time.
- **✅ SITEMAP SUB-GATE CLOSED (2026-07-19):** GSC (`tasteslikegood.org` Domain property) → sitemap `https://www.tasteslikegood.org/sitemap.xml` → **Status: Sitemap processed successfully · Submitted 2026-07-19 · Last read 2026-07-19 · 59 discovered pages · 0 videos.** Discovered count matches the live 59-URL sitemap. Baseline recorded. (Note: initial "Couldn't fetch" was GSC's pre-first-read placeholder — resolved on its own once Google actually read it; the full-www-URL re-submit was the correct move.)
- **Still open (optional, low-effort):** fire **Request Indexing** on home + `/browse` + 2–3 top recipes to nudge priority crawl. Not required for the sub-gate.
- **Out of scope (sprint boundary):** actual indexing is a **timed recrawl that lands after sprint close** — that's a Sprint-2 GSC checkpoint, NOT a Sprint-1 gate. Gate = "submitted cleanly + baseline recorded," per the pre-mortem termination rule.
- **Sequencing note:** ship 3a before/with 3b so that when Google crawls the sitemap'd home URL, it finds the new anchors (deeper discovery). Order-independent enough that neither blocks the other.
- **Terminal states:** done (submitted + baseline recorded) · inconclusive+escalate.

---

## Sprint-2 candidate list (NOT committed — parked to protect WIP)

- `findings.md` cleanup: delete `zzz-racetest-*` + extra `Dooypkiitts` test cookbooks (prod row hygiene — Adam's call).
- Pinterest Rich Pins implementation (research done in `pintrest-research.md`; Recipe Rich Pin metadata + domain verification).
- GSC indexing checkpoint: 1-week-after-ship recrawl verification of the 48 recipe slugs.
- `unpublish_slugs.py` prod content hygiene + cornbread decision.
- Valkey broken-connection edge cases (KAN-16, KAN-17 / GH #162, #163).
- Home-page SSR `<a href>` links (crawl dead-end accelerant, not blocker).
- Anything surfaced by SI-3.

---

## How this drives (path)

1. Compile SI-1..SI-3 into `.agent-harness/plan.json` (each item's proving command becomes its verification).
2. `plan_qa.py .agent-harness/plan.json` must exit 0 — **the gate.** No task may have tautological/smoke-only verification.
3. Drive via the harness loop (caps: 3/task, 12/sprint). Escalations land back in this file.
4. Sprint review when all 3 items are terminal → the throughput/cycle-time data collected becomes Sprint 2's first legitimate forecast input.
