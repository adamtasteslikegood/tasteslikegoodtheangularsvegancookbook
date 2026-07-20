# Canonical `r/<recipe>` Promotion — Rollout Kickoff

_Origin:_ Adam's 2026-07-20 comment on PR #3185 · _Jira:_ KAN-116 (child of KAN-110) · _Owner:_ Adam
_Status:_ **KICKOFF — candidates drafted, pending Adam's approval for v0.4.0**

## The directive (paraphrased from PR #3185)

Promote a set of canonical `r/<recipe>` pages that are **hand-picked AND graded by documented, gated criteria** that generates a rubric — with CI (repo-level programmed gates driven by docs, not just GH Action checks) covering lint, formatting, and SEO checks, plus hard gates and instructions for agents. Implementation scales with the project. Start with **min 3, max 5 hardcoded `r/<recipe>` anchors, hand-picked, in addition to the two already drafted in #3185**, pending Adam's approval after he actually reviews the candidates, targeted at the v0.4.0 release.

## Why (one paragraph)

The home shell's server HTML was a crawl dead-end; #3185 fixes that with `<noscript>` anchors. But hardcoded slugs are a silent-404 fragility (flagged in the #3185 review) and an editorial statement: whatever we hardcode on `/` is what we're telling Google — and every non-JS unfurler — the site *is*. That selection should be governed, not vibes: documented criteria → rubric → CI gate, so an unpublish/rename breaks a check instead of silently 404ing, and so agents have hard rules instead of taste.

## Phased rollout (implementation scales with the project)

| Phase | Ships | Mechanism |
|---|---|---|
| **0 — v0.4.0 (now)** | 3–5 hand-picked hardcoded anchors (plus the 2 in #3185), Adam-approved | Amend #3185 or follow-up PR off `dev`. Selection justified against the draft rubric below (manual pass). |
| **1 — post-v0.4.0** | Canonical list moves to a tracked data file (e.g. `specs/canonical-recipes.json`: slug, score, rationale, date) — docs drive code | Build script renders anchors from the file; CI gate validates every listed slug (checks below). Rubric scoring still manual, but recorded. |
| **2 — later** | Rubric scoring automated (grade all published recipes, propose promotions/demotions as PRs) | Scheduled job + agent instructions; Adam stays the approval gate on promotion PRs. |

## Selection criteria → rubric (DRAFT v0 — gate on Adam's edit/approval)

Hard gates (binary — any failure disqualifies):

1. **Published + live:** `GET /r/<slug>` → 200, self-canonical, present in `sitemap.xml`.
2. **Has a real image:** hero renders (no `ai_image_url`-without-bytes blanks — known prior defect class).
3. **Valid Recipe JSON-LD** on the page.
4. **Clean slug:** no dedup suffix (`-2`…`-7`), no test/joke artifacts (`vegasssdsdn-*`, `error-handling-*`).
5. **No pending content decision** on the recipe (e.g. the cornbread-variants cleanup).

Scored (1–5 each; rubric total ranks candidates):

- **Representativeness** — does it showcase what the site does (AI-generated vegan recipes with photos)?
- **Breadth** — the canonical set together should span categories (mains, baking, breakfast, snacks), not 5 pizzas.
- **Search intent** — plausible query demand for the dish name (later: Semrush/GSC data instead of judgment).
- **Content quality** — complete ingredients/steps, sane servings/times.

## CI gates (Phase 1 design — docs drive code)

- **Repo-level check (not only GH Actions):** a script (e.g. `scripts/seo/check_canonical_recipes.sh`) run in pr-gate AND runnable locally/pre-commit, that reads the canonical list file and fails on: non-200/redirect, canonical mismatch, missing Recipe JSON-LD, slug absent from sitemap, list size outside 3–5 (Phase 0 bound).
- **Lint/format:** the list file and generated markup go through the existing Prettier/ESLint gates.
- **Agent hard rules:** agents MUST NOT add/remove/reorder canonical slugs without a rubric entry in the list file and Adam's approval on the PR; the CI gate is not to be modified in the same PR that changes the list (locked-evaluator rule).

## Drafted candidates for v0.4.0 (PENDING ADAM'S APPROVAL — not shipped)

Already hardcoded in #3185 (keep unless vetoed):

1. `classic-vegan-margherita-pizza`
2. `vegan-cornbread` — ⚠️ flag: the cornbread-variants content decision (`vegan-cornbread` vs `good-day-vegan-cornbread` vs `adams-vegan-blueberry-cornbread`) is still open; approving this slug implicitly picks the canonical cornbread.

Drafted additions (5, from the live 59-URL sitemap; pass draft hard-gates 1/4/5 by inspection — gates 2/3 need a manual page check before merge):

3. `vegan-seitan-fried-chicken-and-waffles` — signature/showcase dish, strong representativeness
4. `vegan-spaghetti-and-meatballs` — high-recognition mains query
5. `classic-vegan-chocolate-chip-cookies` — baking breadth, evergreen search demand
6. `maple-smoked-tempeh-blt` — sandwiches/lunch breadth, distinctive
7. `vegan-street-style-tofu-tacos` — Mexican/street-food breadth

Adam picks 3–5 of #3–7 (and confirms/vetoes #1–2). Rejected candidates stay here as Phase-1 seed data.

## Explicitly out of scope for v0.4.0

Home-page redesign/restyle (SI-3a scope fence holds), the Phase-1 data file + CI script, automated scoring, any Backend change.
