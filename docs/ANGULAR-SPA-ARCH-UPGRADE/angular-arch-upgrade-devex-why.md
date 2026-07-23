# Angular SPA Architecture Upgrade — The WHY and WHY NOW

> Companion to: **Angular SPA Architecture Upgrade — Review & PRD Planning Prompt**
> (that document defines the WHAT and the GOAL; this one tells the story that makes them urgent)

---

## The Developer Experience Case

The Flask backend went through a clean refactoring arc: a 1,200-line `app.py` became a ~100-line composition root with modular blueprints, a service layer, repositories, and validators. That transformation took two deliberate steps and produced a production-grade system on the first deploy. The architecture now absorbs change efficiently — a new endpoint is a new blueprint file, a new business rule is a new service method, a new validation concern is a new schema.

The Angular SPA never had that moment. It shipped as a Gemini AI Studio prototype and has been patched forward ever since. Every change — no matter how small in product terms — must be threaded through a single 1,096-line component class and a 2,028-line template. The cost of this is no longer theoretical. It is measurable in deploy frequency, session burn, and spec drift.

---

## Exhibit A: The Public Link (v0.3.8 → v0.4.1)

The product requirement is straightforward: when a user publishes a recipe, show them a link to the public page (`/r/<slug>`) so they can share it.

The link exists. It renders as a "View" anchor tag inline in the recipe detail view, next to the publish toggle. It opens `/r/<slug>` in a new tab. The implementation is technically correct.

The problem is that a user cannot find it without prior knowledge of its existence.

There is no routing — the entire app is two view states (`generator` and `kitchen`) toggled by a signal. There is no URL that leads to a specific recipe's detail view. The publish toggle and its sibling "View" link are buried inside a recipe detail expansion that the user must manually open within the kitchen view. The link has no visual prominence, no onboarding cue, no share-sheet pattern, no toast confirmation after publishing that surfaces the URL. It is a correct implementation rendered invisible by the architecture that contains it.

This single UX gap — "user publishes a recipe and cannot find the shareable link" — has consumed:

| Resource | Amount |
|---|---|
| Production deploys touching the public link flow | 4 (v0.3.8, v0.3.9, v0.4.0, v0.4.1) |
| GitHub / Linear / Jira issues filed | ~6 |
| Claude Code agent sessions | ~12 |
| Cached token writes (Opus 4.8 / Fable 5) | 30–49M |
| Output tokens | 10–12M |
| Calendar time | v0.3.7 (Jul 17) → v0.4.1 (Jul 20) = 3 days of concentrated effort |

Each session and each patch addressed symptoms: link visibility for non-publishers, link visibility for saved copies, slug derivation logic, toggle state sync. None addressed the root cause: **there is no component architecture that can give this link a proper home.** In a routed, decomposed app, the public link would live in a `RecipeDetailComponent` with its own URL (`/kitchen/recipe/:id`), a share action in a toolbar, and a post-publish confirmation flow. In the current monolith, it is a conditional `@if` block at line 408 of a 2,028-line template, discoverable only by scrolling.

The architecture does not resist this fix. It resists *every* fix at this level of UX specificity.

---

## Exhibit B: The Patch Treadmill (v0.3.0 → v0.4.1)

The version history from v0.3.0 onward tells a consistent story: each release is a corrective patch for the last, and each patch is a production deploy (`environment=production`, tag → build → deploy).

| Version | Date | What happened |
|---|---|---|
| v0.3.0 | Jul 4 | SSR recipe/browse pages, Save-to-Cookbook CTA, Angular 22. **Failed to deploy** — 14 missing runtime deps from a corrupted `requirements.txt` export. |
| v0.3.1 | Jul 4 | Hotfix for v0.3.0 deploy failure. |
| v0.3.2 | Jul 5 | SSR styling fix, async retry, sitemap unshadow. |
| v0.3.3 | Jul 11 | Editing regressions, auth-gated publishing, monitoring connector. |
| v0.3.4 | Jul 15 | Security, Datadog, CSP, Express validation. **Never reached production** — Dockerfile parse error. |
| v0.3.5 | Jul 15 | Deploy repair for v0.3.4. |
| v0.3.6 | Jul 15 | Google OAuth CSP regression fix (caused by v0.3.4/v0.3.5). |
| v0.3.7 | Jul 17 | Removed free-form slug input; slug is now server-derived. |
| v0.3.8 | Jul 18 | Apex-to-www redirect, robots.txt, favicon, trailing-slash redirect. |
| v0.3.9 | Jul 19 | Valkey cache fix, double-save guard, mobile hero clip fix. |
| v0.4.0 | Jul 20 | SSR crawlable home-shell links, in-app-browser sign-in fallback. |
| v0.4.1 | Jul 20 | Fix: public View link visibility for non-publishers and saved copies. |

That is **12 releases in 16 calendar days**. Two failed to deploy at all (v0.3.0, v0.3.4). Three were immediate hotfixes for the release that preceded them (v0.3.1, v0.3.5, v0.3.6). The remainder are incremental corrections — each individually reasonable, collectively a signal that the frontend architecture does not absorb change cleanly.

Compare to the Backend over the same period: its changes landed as part of the cookbook releases but required no dedicated hotfix cycle. The modular blueprint architecture meant that an SSR template change, a new API endpoint, or a cache integration each landed in isolation without cascading regressions.

---

## Exhibit C: Spec Drift (v0.2.0 → v0.4.1)

The v0.2.0 release (Apr 29) was titled **"Anti-Recipe Site"** and established the product vision that still drives the backlog:

- Sub-500ms SSR public recipe pages at `/r/<slug>`
- JSON-LD structured data for SEO
- "Save to Your Cookbook" CTA converting anonymous visitors into SPA users
- `/browse` page with paginated public recipe grid
- Honest, crawlable URLs

This vision is documented in `specs/roadmap.md` (strategic phases), `specs/plan.md` (tactical checklist with wireframes), and `specs/design-plan.md` (template architecture and CSS tokens). These documents were written during the v0.2.x cycle and reference v0.2.0 conventions throughout.

The codebase is now at v0.4.1. The SSR pages exist and work. The CTA exists and works. But the backlog items that remain open — the ones filed against the original v0.2.0 vision — are still written in v0.2.0 language, reference v0.2.0 architecture assumptions, and carry v0.2.0 acceptance criteria. The specs have not been updated to reflect what was built, what changed, and what "done" means at the current version.

This is not a documentation problem. It is a planning problem. When the spec artifacts belong to v0.2.x and the codebase is at v0.4.x, every planning session starts with implicit translation work: what did this ticket mean when it was written, what does the codebase look like now, and what would "done" actually mean today? That translation burns agent sessions, produces ambiguous acceptance criteria, and creates the conditions for the patch treadmill described above.

---

## Why Now

Three forces converge:

1. **The Backend sets the standard.** The Flask backend is modular, testable, and deploys cleanly. The Express proxy layer is production-grade. The Angular SPA is the only tier that has not been through a deliberate architecture upgrade. The system's weakest link determines its overall development velocity, and that link is now clearly identified.

2. **The cost of incremental patching has exceeded the cost of restructuring.** Twelve releases in sixteen days, two deploy failures, three hotfix chains, and a persistent UX issue that resists resolution because the architecture cannot give it a proper component home. The next feature that requires precise UX placement — and there will be one — will repeat this cycle.

3. **The spec-to-code gap is widening, not closing.** Planning artifacts reference a v0.2.0 world. The codebase is at v0.4.1. Each planning session spends tokens bridging that gap instead of advancing the product. An architecture upgrade is the forcing function that resets the specs to match the system as built and establishes the component vocabulary that future tickets can reference unambiguously.

---

## What This Document Is Not

This is not a retrospective. It is not a critique of any individual decision — the prototype shipped, found users, and proved the product. This document records the observable cost of operating a prototype architecture at production scale, and establishes the developer experience case for the upgrade plan defined in the companion document.
