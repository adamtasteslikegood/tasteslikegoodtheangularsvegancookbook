# Sprint 10 product grill — locked decisions (2026-09-06)

Run with `/cs:grill-product` against Adam's plan: "get back to improving the frontend visually — navigation, symmetrical footer, top nav menu, filtering and sorting on SPA and public browse, mobile experience, fast-loading image placeholders, a settings tab with model choices." Every branch of the product-canon decision tree was walked, one question per turn, with Adam confirming or overriding each recommendation. Execution ticket for the charter work: **KAN-269**.

**Structure gate:** `specs/discovery/sprint10/ost.json` passes `ost_linter.py` (8 opportunities, 0 violations, exit 0). Re-run:

```bash
python3 ~/.claude/plugins/cache/claude-code-skills/product-skills/2.11.1/skills/product-skills/scripts/ost_linter.py \
  --input specs/discovery/sprint10/ost.json --output human
```

## Locked decisions

| #   | Branch         | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | How locked                                                                                        |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Q1  | Outcome        | Two-tier root. **Product outcome:** more mobile visitors who land on a public recipe page keep a recipe (save into a Kitchen); instrumentation is a non-droppable SI because nothing measures it today, and the S10 target for it is "baseline captured". **Sprint exit number:** mobile LCP ≤ 2.5 s at Lighthouse slow-4G on `/r/<slug>`, `/browse`, `/`, from **7.6 / 7.7 / 6.1 s**.                                                                                                                              | Confirmed                                                                                         |
| Q2  | Retro actions  | All five Sprint 9 retro actions in, as sized: acceptance rows at charter (KAN-269) · KAN-250 via Cloud Deploy, **approach decided by Adam**, reshaped to per-PR preview URLs · KAN-151 latency measured → **KAN-268** filed · per-user recipe tables = Adam decision row · Jira auto-transition guard **closed by removal** (Jira rules and the GitHub workflow both disabled by Adam).                                                                                                                             | Confirmed                                                                                         |
| Q2b | KAN-151        | Stays Done as-is. New defect **KAN-268** (Flask Valkey IAM auth failures), acceptance row **RCP-98**, non-droppable: it gates the LCP number.                                                                                                                                                                                                                                                                                                                                                                       | Confirmed                                                                                         |
| Q3  | Evidence       | Obvious defects need no participants. Nav = observed task failure (non-author participant on a phone; agent walkthrough reproduced it). Images and mobile layout = lab. Filter/sort = inspection (95 public, 134 personal recipes, dozens of cookbooks). Footer = cosmetic. Settings = hypothesis. **Pre-launch by design: zero traffic is expected, not a finding.** No friends-and-family testers until Adam's done-bar; Adam recruits if needed.                                                                 | Adam override                                                                                     |
| Q4  | Prioritisation | **Sprint 10 is not the launch sprint.** Ordinal cost-of-delay buckets, not RICE (reach = 0 pre-launch). Rank: 1 KAN-268 · 2 instrumentation · 3 images/LCP · 4 nav · 5 mobile layout · 6 filter/sort · 7 Cloud Deploy preview URLs · 8 footer · 9 settings. Flips: filter/sort above layout if the primary S10 user is Adam's own Kitchen; images below nav if an interim resizing proxy lands the LCP number; Cloud Deploy to the top if it blocks the release.                                                    | Adam override on launch                                                                           |
| Q5  | Workbench      | Two loops, no new environment. **Inner:** local `npm run dev` + gstack browse at 390×844 + local Lighthouse. **Outer:** per-PR preview URLs on staging via Cloud Run revision tags on the Cloud Deploy path (= the KAN-250/KAN-227 acceptance). **Cloud Workstations out.** Staging is complete by design: OAuth live with staging credentials, both Cloud Run services, Pub/Sub, dedicated Cloud SQL Postgres, Artifact Registry, image bucket; intentionally no Valkey and no Cloud NAT. KAN-234 closed as stale. | Confirmed with corrections                                                                        |
| Q6  | Measurement    | **North Star: recipes kept per week** (any save into a Kitchen, any source, guest or signed-in). Inputs = the PRD's five KPIs: recipe-page reach · view→save · generation + image completion · returning Kitchen use · publication. Instrument with **Datadog RUM** (SPA + SSR, 100% sampling, custom actions) behind a **consent toggle** via `trackingConsent`, which makes the privacy policy's promised opt-out true. Web-vitals bands apply now; funnel bands after four weeks.                                | Confirmed                                                                                         |
| Q7  | AI feature     | Settings tab at rank 9 (first cut): default servings, metric/imperial, image generation on/off, **model picker bound to an explicit server-owned GA allowlist derived from `GET /api/models`**. The endpoint currently filters capabilities, not release channel, so KAN-269 must add the allowlist before the picker; preview, experimental, and moving `latest` aliases are excluded. **Eval spec before UI:** 12-prompt golden set (4 cuisines × 3 difficulty) per model; all 12 must be schema-valid on the first attempt or the model is dropped; p95 ≤ 20 s; error → fallback to default with a UI notice; endpoint-allowlist and fixture tests in CI + manual live dispatch. PRD non-goal amended in this branch.                    | Confirmed; PRD is a rough draft (reverse-engineered, interrupted run), not a constraint, per Adam |

## Evidence baseline (all reproducible)

**Lighthouse 12, mobile, simulated slow-4G, 2026-09-06** (`npx -y lighthouse@12 <url> --only-categories=performance --form-factor=mobile --screenEmulation.mobile --throttling-method=simulate --chrome-flags="--headless=new --no-sandbox"`):

| Page        | Perf | LCP   | FCP   | LCP element                    | Image bytes |
| ----------- | ---- | ----- | ----- | ------------------------------ | ----------- |
| `/r/<slug>` | 74   | 7.6 s | 1.9 s | hero `<img loading="lazy">`    | 1.0 MB      |
| `/browse`   | 71   | 7.7 s | 2.0 s | first card image               | 3.1 MB      |
| `/` (SPA)   | 63   | 6.1 s | 6.0 s | the `<h1>`, after the JS boots | 0           |

Google bands: good ≤ 2.5 s, poor > 4.0 s. Images are one full-resolution PNG/JPEG per recipe (0.9–1.8 MB, 20 on `/browse`), no variants, no `srcset`, no `width`/`height`, no placeholder; the SSR hero, the LCP element, is lazy-loaded (`Backend/templates/public/recipe.html:38`).

**Phone viewport 390×844 (gstack browse):** `/browse` shows 0 complete recipe cards above the fold and the one visible image is still blank at 5 s; the page is 13,122 px tall (20 cards, one per row). `/` shows 0 recipes: header, generator form, footer.

**Walkthrough as a first-time guest (agent, 2026-09-06):** (1) home: only route to public recipes is the footer link; header = Generator / My Kitchen / Sign In. (2) My Kitchen empty state offers "Go to Generator" only. (3) `/browse` works. (4) `/r/<slug>` has "Save to your cookbook", "← Browse all recipes", header Browse: good. (5) guest save works, no login, no duplicate, lands in the Kitchen. (6) back to browse from inside the SPA: footer link only, at y = 875 in an 844 px viewport. Same failure a non-author participant hit on a phone ("go to the public recipes").

**Field data:** none by design. Semrush: 0 estimated organic visits (8 keywords, none top-20, first seen 2026-08-15). Datadog: 0 RUM apps; the image traffic in APM is ClaudeBot and Pinterestbot. No analytics in `src/`, `server/`, `Backend/`; `server/public/privacy-policy.html` promises analytics and an opt-out.

**KAN-268 (found while measuring the KAN-151 delta):** 482 of 947 Flask `redis.command` spans in 7 days errored with `AuthenticationError`; refreshed IAM tokens die 33–37 min after refresh, the refresh timer is a fixed 45 min; image endpoint p95 9.6–11 s. Root cause and fix shape on the ticket.

## Discovery log (feeds `discovery_cadence_tracker.py`)

| Date             | Participant                        | Type             | Task / finding                                                                                            |
| ---------------- | ---------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------- |
| 2026-09 (pre-06) | Non-author, phone (Adam's partner) | usability task   | "Go to the public recipes": failed; needed the link next to Publish or the footer pointed out.            |
| 2026-09-06       | Agent walkthrough (gstack)         | heuristic walk   | Reproduced the same dead end from home and from the Kitchen; save flow from `/r/<slug>` works as a guest. |
| continuous       | Adam (author)                      | self-observation | Every use; mobile on a throttled connection: one recipe at a time, slow images.                           |

## Not in Sprint 10 (surfaced, not self-authorised)

- Cloud Workstations as a cloud dev box (Adam: out; local + staging is sufficient).
- Any friends-and-family invite or launch event (Adam: not until the site is done).
- Filter/sort on the SSR `/browse` beyond `?sort` if it threatens the SEO canonical gate; the SearchAction fix rides with it or is removed.
- Regenerating `prd/` with code-to-PRD (Adam: after the next release, alone on the checkout).

## Next

`/cs:grill-pm` → `specs/SPRINT_10_PLAN.md`, the RCP delivery epic, one `S10 acceptance:` row per SI (RCP-98 exists; parent it), KAN rows labelled `sprint-10`, both sprint gates green on day 1. All under KAN-269.
