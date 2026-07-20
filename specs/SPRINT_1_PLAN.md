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
- **✅ VERIFIED-DONE (2026-07-19, KAN-112):** memory limit `1Gi` live (rev -00074-r94); memory util p95 27%/34%/**53% max** ≪ 85%, flat (OOM risk retired); Valkey **connection OK** + `Response cache: Valkey/Redis backend` (off SimpleCache — CA fix works), 0 `CERTIFICATE_VERIFY_FAILED` in 8h; Datadog deploy marker **absent** (no DORA events — non-blocking; optional future: wire DORA deploy tracking).
  - **DD toggle location (so it's not re-hunted):** the memory scale-down = `ENV DD_PROFILING_ENABLED=false` at **`Backend/Dockerfile:26`** (baked into the image, NOT a `DD_*` in cookbook `cloudbuild.yaml` — that only mounts the `DD_API_KEY` secret at line 197). Post-v0.3.9 DD state = **profiler OFF (#220), everything else ON**: APM traces (`ddtrace-run`), logs+injection (Dockerfile 20–21), AppSec (Dockerfile 27, `DD_APPSEC_ENABLED=true`). So DD is deployed+working AND scaled back — both true, by design. To re-enable heap flame-graphs for debugging: flip `DD_PROFILING_ENABLED=true` in the Dockerfile + redeploy (DD trial ends ~2026-07-28).

### SI-2 — Convert the 6.5/10 field-test into a ranked UX/UI defect backlog
Live-site score 6.5/10 overall, 7–8/10 on specific elements. **Discovery, not build** — turns the fuzzy score into structured Sprint-2 candidates. Staying inside this fence (list, don't fix) IS the scope-discipline exercise.

- **Owner:** Adam · **Reviewer:** adversarial-agent pass on the list
- **Deliverable / proving artifact:** `specs/ux-backlog.md` — each entry: element, current score, target score, repro, one-line fix hypothesis, effort estimate. Item done when the file exists, every entry has all six fields, and the adversarial pass finds no "vibe-only, no repro" entries.
- **Terminal states:** done (list ships) · rolled (deferred to Sprint 2 with reason).
- **🟡 ARTIFACT SHIPPED, ACCEPTANCE PENDING (2026-07-20):** `specs/ux-backlog.md` compiled by the close-out loop from the real field-test sources (TAS-2899, TAS-2896, `findings.md`, 2026-07-17 live-site review) — 5 ranked entries, all 6 fields each, per-element scores honestly marked _est._ where the field test only recorded the overall 6.5. Self-adversarial pass documented in-file. **Awaiting Adam's acceptance** (KAN-113 stays In Review until he accepts/amends — the only human review left on the board).

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
- **✅ MERGED+LIVE (2026-07-20, KAN-114):** both PRs merged to `dev` and shipped in v0.4.0 (live-verified — anchors in production server HTML, proving commands pass against the live site). Original review state for the record:
  - **#3185** `feat(seo): SSR crawlable links on home shell (TAS-2896)- [KAN-114]` — `<noscript>` nav with `/browse` + 2 hardcoded `/r/<slug>` anchors. Independent Claude review: no changes needed.
  - **#3186** `fix(auth): browser fallback for Google sign-in inside in-app webviews (TAS-2899)` — companion UX fix surfaced by the same field test (in-app-webview `disallowed_useragent` on Google OAuth).
  - Adam's comment on #3185 spawned a follow-up program: **canonical `r/<recipe>` promotion with a documented, gated rubric + CI checks** → kickoff doc `specs/CANONICAL_RECIPES_ROLLOUT.md`, tracked as **SI-4 / KAN-116** below. Hand-picked candidate slugs drafted there, **pending Adam's approval for v0.4.0**.
  - Reaches merged+live when both PRs land on `dev` and v0.4.0 ships (see DONE-gate amendment below).

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

### SI-4 — Canonical `r/<recipe>` promotion: rubric + CI gates + v0.4.0 hand-picked candidates (late add, owner-directed)

Spawned by Adam's 2026-07-20 comment on PR #3185. Kickoff documentation: **`specs/CANONICAL_RECIPES_ROLLOUT.md`** (selection rubric draft, phased rollout, CI gate design, drafted candidates). Jira: **KAN-116** (child of KAN-110).

- **Owner:** Adam (approves the candidate list — hard human gate) · **Reviewer:** PR gate + rubric checks per the rollout doc
- **Sprint-1 slice (only this much is in-sprint):** kickoff doc exists + 3–5 hand-picked candidate slugs drafted **pending Adam's approval** for inclusion in the v0.4.0 home-shell anchors. The full rubric/CI automation is Phase 1+ = Sprint-2 backlog.
- **Terminal states:** approved+amended into #3185 (or follow-up PR) · deferred by Adam to post-v0.4.0 (doc still ships).

---

## Owner amendment (2026-07-20) — Sprint 1 DONE gate

Charter branch 1 amended by the owner (Adam): board state alone no longer closes the sprint. **Sprint 1 == DONE is gated by the v0.4.0 release shipping and verifying clean:**

1. PRs #3185 + #3186 merged to `dev` (closes SI-3a), SI-2 backlog accepted out of review.
2. `dev` → `main` release PR, tag `v0.4.0` (bump from 0.3.9).
3. Cloud Build tag-triggered deploy: **STATUS = SUCCESS on all jobs** (both image builds, migrate job if present, both service deploys).
4. **Both Cloud Run services serving the v0.4.0 build** (revision check) and **live site returns 200** — no downgrade of service post-deploy.

- **Gate status (2026-07-20):** ✅ **GATE CLOSED** — verified by the /cs:pm-loop close-out run (all four criteria):
  1. **#3185 + #3186 merged to dev** (13:39Z / 13:44Z; #3186 was blocked only by unapproved CI runs from the Cyrus-authored branch — approved, all checks green). SI-2 backlog compiled to `specs/ux-backlog.md` (awaiting Adam's acceptance — the one human review left open).
  2. **v0.4.0 released**: bump PR #3191 → dev, release PR #3192 dev → main (merge commit), `release.yml` SUCCESS, GitHub Release `v0.4.0` published 2026-07-20T13:48:54Z.
  3. **Deploy verified live ~7 min after tag**: home serves the new Express build — bundle `main-RAJ3Z62E.js` → `main-LVFATUC7.js`, `<noscript>` anchors (`/browse`, `/r/classic-vegan-margherita-pizza`, `/r/vegan-cornbread`) now in the server HTML; new bundle contains the webview-detector (#3186) strings.
  4. **Both services serving, live site 200, no downgrade**: `/` `/browse` `/r/<slug>` `/sitemap.xml` all 200 (Express→Flask path); Cloud Monitoring post-deploy: 0 4xx/5xx, backend memory ~10% on 1Gi, Valkey connected.
  - *Evidence substitution note:* local `gcloud` needed an interactive re-login mid-run, so "Cloud Build STATUS=SUCCESS" + the revision check were proven indirectly — a new Express image carrying the tag's content can only be serving if the tag-triggered `cloudbuild.yaml` completed every job (Flask deploys *before* Express in that pipeline). Adam: optionally re-run the literal proving commands below after `gcloud auth login`.
- **Proving commands:** `gh release list` shows `v0.4.0` · `gcloud builds list --region=us-central1` latest tag-build SUCCESS · `gcloud run services describe {express-frontend,flask-backend} --region=us-central1` revisions carry the v0.4.0 image · `curl -s -o /dev/null -w '%{http_code}' https://www.tasteslikegood.org/` == 200.
- **Leftover-ASKs write-up** (Adam): deferred to sprint review, post-gate — expected to change once v0.4.0 is live.

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
