# SEO driver review — what the site needs to fulfil the v0.2 "Anti-Recipe Site" driver

_Ticket:_ [KAN-325](https://tasteslikegood.atlassian.net/browse/KAN-325) · Reviewed by `/plan-ceo-review` on 2026-10-03 · `dev` @ 528a8b3 · v0.5.7 live · Author: Claude Code for Adam
Mode: SELECTIVE EXPANSION (Adam, D1) · Depth: strategy-only · Destination: charter input for RCP-119 (Sprint 10 is frozen; no build work here starts before that charter. The actions allowed before it are listed under Implementation Tasks)

## Inputs reconciled

Inputs 1 and 2 were Adam's working files; they are committed alongside this review under the names below.

1. [`SEO_GSC_WIZARD_REVIEW_2026-10-03.md`](./SEO_GSC_WIZARD_REVIEW_2026-10-03.md) (ChatGPT / GSC Wizard transcript, 6 items; called "the ChatGPT doc" below)
2. [`SEO_NEXT_STEPS_INDEXING_2026-09-30.md`](./SEO_NEXT_STEPS_INDEXING_2026-09-30.md) (indexing focus, 7 items; called "the Sep 30 doc" below)
3. `docs/seo/SEO_AUDIT_2026-09-13.md` (KAN-270 audit, action plan)
4. Open Jira rows: KAN-319, 320, 275, 277 (+311/312/313), 284, 309, 299, 298; In Review: KAN-271/272/273/274/276
5. Live Search Console via gcp-monitor `gsc_*`, 2026-10-03
6. Driver: Confluence 11206731 / `specs/roadmap.md`; design doc 2026-07-05 (APPROVED: "the binding constraint is feedback, not code")
7. Sprint 9 retrospective actions (Confluence 81657858). Sprint 10 is still open, so its retro does not exist yet; the RCP-119 charter must walk it when it does.

## Live evidence (2026-10-03)

| Signal                                    | Value                                                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 28d clicks / impressions (Sep 5 to Oct 2) | 2 / 27 (previous 28d: 5 / 92)                                                                       |
| Brand impressions                         | 0                                                                                                   |
| "vegan recipe generator"                  | position ~112 (28d), ~94 (90d)                                                                      |
| 90d queries                               | catalog long-tail (onion rings, kimchi, english breakfast, corn dogs) at positions 50 to 90         |
| Oldest 25 sitemap URLs                    | 25/25 indexed, last crawls mostly Aug 20 to 30                                                      |
| Newest 15 sitemap URLs (by `lastmod`)     | 2/15 indexed; all sampled tag hubs + 5 recipes "Discovered, never crawled"; 1 "unknown to Google"   |
| `/browse` last crawl                      | 2026-07-25 (before hubs existed)                                                                    |
| Home last crawl                           | 2026-10-01; links to `/browse` + 8 recipes, 0 hubs                                                  |
| Hub inbound links                         | `/browse` (10 hubs), 1 tag per recipe page, sitemap                                                 |
| Recipe rich results                       | detected on every indexed recipe; 22 to 37 "issues" each, unclassified (errors vs warnings unknown) |
| Sitemap                                   | 113 submitted / 114 live, 0 errors, downloaded 2026-10-03                                           |
| Impressions cliff                         | starts 2026-09-01, four weeks before v0.5.0 to v0.5.2; cause unknown                                |

### Host-load hypothesis (Adam, mid-review) and what the traces show

Adam's observation: by hand in Search Console, at least 6 unindexed recipes carried the explanation that crawling "was expected to overload the site". That sentence is Google's standard description of the "Discovered – currently not indexed" status, shown for every URL in that state, so it is not a per-URL measurement. It is still a hypothesis worth testing, because KAN-268 had the image endpoint at ~10 s p95 from early September until v0.5.7.

Datadog APM, Googlebot user agent, 2026-09-03 to 2026-10-03 (sampled traces matched on user agent only, source IP not verified, so counts are indicative):

| Observation                         | Value                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| 429 or 5xx responses to Googlebot   | 0                                                                                |
| p95 latency on 200s                 | under 200 ms every day                                                           |
| Most-fetched URL                    | `/robots.txt` (62)                                                               |
| Page fetches                        | home 8, sitemap 8, `/browse` 3, recipe pages 2 distinct                          |
| 404 spikes (Sep 30: 37, Oct 2: 214) | secret-file scanners spoofing the Googlebot UA against the bare load-balancer IP |
| Live timings today                  | HTML 180 to 300 ms; `?w=800` image 0.5 s; unsized original image 1.0 MB in 1.6 s |

Update 2026-10-04 (Adam, Search Console): the Page indexing report defines the status as "Typically, Google wanted to crawl the URL but this was expected to overload the site; therefore Google rescheduled the crawl." That confirms the sentence is the report's definition of the status. A live URL Inspection test of `/r/peach-raspberry-raw-sorbet` the same day returned: URL is available to Google, page fetch successful, crawl and indexing allowed, Breadcrumbs 1 valid item, Recipes 1 valid item with non-critical issues only. So on that page the Recipe "issues" are warnings, not errors, and the breadcrumb markup added in v0.5.x is recognised.

Reading: in the window that can still be observed, the server gave Googlebot no reason to slow down. Googlebot is choosing to fetch about one page a day. That is low crawl demand, which fits the authority diagnosis, not capacity. Not ruled out: what Googlebot saw in late August and the first days of September (outside trace retention), and image fetches during the KAN-268 period. Search Console → Settings → Crawl stats → Host status is the one place that still holds that answer (T4).

Side finding **S2**: the page rate limiter exempts crawlers by user-agent string (KAN-218), and scanners are already sending that string. Some scanner paths on the bare IP also returned 200 from the SPA catch-all. Flagged for Adam; not in this plan's scope.

## Driver scorecard

| Driver bullet              | State                      | Evidence                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Speed <500ms full render   | Shipped, target unverified | KAN-271 live: `?w=400/800/1200` variants, preload, `fetchpriority=high`. Mobile Lighthouse on 2026-09-29 (v0.5.0, `specs/discovery/sprint10/product-grill-2026-09-29.md`): LCP 1.2 s on home, 3.1 s on the sampled recipe and `/browse` (was 6 to 8 s). No run since v0.5.1, and LCP is not the full-render measure, so the <500ms target is unverified |
| Honest URLs                | Done                       | `/r/<slug>`; retired slugs return 410                                                                                                                                                                                                                                                                                                                   |
| One photo per recipe       | Done                       |                                                                                                                                                                                                                                                                                                                                                         |
| Save-to-cookbook CTA       | Done                       | conversion instrumented behind opt-in analytics, not yet reported                                                                                                                                                                                                                                                                                       |
| Perfect Recipe JSON-LD     | Mostly                     | KAN-320 in progress; issue list unclassified                                                                                                                                                                                                                                                                                                            |
| (implied) Strangers arrive | **Not met**                | 27 impressions, 0 brand, 0 measured external links                                                                                                                                                                                                                                                                                                      |

## Core finding

The on-page half of the driver is shipped. **Working hypothesis:** the binding constraint is crawl demand and authority. In the newest-15 sample, 13 URLs have no indexed crawl, and nothing outside the site is known to link to it. The sample picks URLs by sitemap `lastmod`, which is not publication date, so it does not show that every recipe published since late August is uncrawled. T4 tests H3 only.

Three explanations fit "Discovered, never crawled", and the evidence does not yet separate them:

| Hypothesis                                                                                                    | For                                                                        | Against                                                                     | Discriminator                                                      |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| H1 Links/authority: new URLs are poorly linked and the site has no external links                             | hubs unreachable from the crawled home page; 0 brand queries               | sitemap lists every URL and Google reads it                                 | after rank 1 ships, hubs get crawl dates                           |
| H2 Predicted quality: Google expects ~113 AI-generated pages to be low value and does not spend crawl on them | fits the scaled-content pattern; old pages indexed before the catalog grew | 25/25 oldest still indexed with rich results                                | URLs move to "Crawled, currently not indexed" instead of "Indexed" |
| H3 Host load: slow or failing responses in late Aug / early Sep made Googlebot back off                       | KAN-268 timing; cliff starts Sep 1                                         | no 429/5xx and fast responses Sep 3 to Oct 3 (sampled, images not isolated) | Search Console Crawl stats → Host status (T4)                      |

The impressions drop itself (92 → 27) is small enough to be noise and should not carry the diagnosis alone. All three input docs rank more on-page work at or above distribution. The ChatGPT doc's "all inspected URLs are indexed" sampled only old URLs; the newest-URL sample contradicts it.

Tension Adam owns: "no life story" removes the authorship signals that separate valued content from scaled AI content. E1 (accepted) is the deliberate, bounded exception.

## Accepted scope, ranked

| Rank | Workstream                                                                                                                                                                                                                                                                                                                                                                                                          | Rows                                              | Origin                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------- |
| 1    | **Crawl discovery.** Hubs linked from home and footer (KAN-319). Every recipe page links all its allow-listed tags (unticketed). Newest-recipes row on home (E3). Then manual Request Indexing for `/browse`, hubs, newest recipes                                                                                                                                                                                  | KAN-319, new row, E3                              | Sep 30 #1 to #3, ChatGPT #1/#3, D4          |
| 2    | **Authority.** Owned-property links, Pinterest verify + pins, launch post, listicle outreach                                                                                                                                                                                                                                                                                                                        | KAN-277 (+311/312/313), KAN-284, KAN-309, KAN-299 | Sep 30 #6, audit B1/B2, carried S10/S11/S18 |
| 3    | **Human proof.** Two parts. (E1) 10 to 15 recipes cooked by Adam and marked tested, short capped notes, a second smaller real photo, `/about` extended with authorship. (E5) A way for anyone (Adam, friends, family, any user) to leave real feedback on a recipe they generated or cooked. The site is primarily AI-generated recipes; proof should come from the people who cook them, not only from the founder | new rows                                          | ChatGPT #2, audit C4/C5, D2, D7, D8         |
| 4    | **Measurement.** Crawl-evidence instrument (E2); weekly `/seo-weekly-check`; newest-URL coverage trend; mobile LCP re-run; classify rich-result issues; release dates vs crawl dates                                                                                                                                                                                                                                | new rows                                          | ChatGPT #1/#5/#6, Sep 30 #7, D3             |
| 5    | **Schema polish.** Recipe recommended fields                                                                                                                                                                                                                                                                                                                                                                        | KAN-320 (In Progress)                             | Sep 30 #5, ChatGPT #4                       |
| 6    | **Hygiene and process.** Close KAN-271/272/273/274/276 on release evidence; KAN-275 audit incl. joke-title decision                                                                                                                                                                                                                                                                                                 | KAN-27x                                           | Sprint 9 retro action d; audit C2/C3        |

Success measures, read 4 weeks after rank 1 deploys: newest-15 coverage sample at 10/15 or better; every hub has a crawl date; non-brand impressions at or above 100 per 28 days (Sprint 10 D1's second-tier number); at least one hub query in `gsc_striking_distance`. Read 4 weeks after rank 2 (launch) lands: brand impressions above 0; 5 or more referring domains in Search Console Links.

Falsification branch: if the newest URLs get crawled and land in "Crawled, currently not indexed", that is a quality verdict (H2). Response: human proof (E1 and E5) becomes the top priority.

Capacity note: Adam's serial, non-delegable time across this plan is roughly 4 to 5 weeks (cooking ~2 weeks, authority and launch ~1 to 2 weeks, Request Indexing, Crawl stats, title decision). It will not fit one sprint box alongside engineering review; the charter must sequence it.

## 0I. Temporal interrogation

```
HOUR 1 (foundations)   Home is static HTML mirrored in index.html and drift-tested
                       (src/landing-copy.test.ts). Footer comes from site-nav.json and
                       Backend templates. KAN-319 and E3 both touch that pair.
HOUR 2-3 (core)        E3: where does a dynamic list come from on a static page?
                       Build-time list goes stale between releases; request-time needs
                       Express to call Flask. Unchosen. Tag allow-list: which tags get
                       links from recipes (hubs under 3 recipes are noindex).
HOUR 4-5 (integration) Release train: Backend change then pointer bump then tag. Staging
                       must be promoted before it is evidence. Request Indexing is manual,
                       about 10 URLs per day.
HOUR 6+ (polish)       Nothing shows a result for 1 to 4 weeks. Without E2 there is no
                       early signal. Search Console data lags 2 days.
```

Effort: rank 1 human ~3 days / CC ~2 hours. Rank 2 human ~1 to 2 weeks, mostly not code. E1 human ~2 weeks of cooking / CC ~1 hour. E2 human ~1 day / CC ~30 min. E5 is unsized until designed (T13).

Feasibility: KAN-319, recipe tag links, authority and KAN-320 have no blockers. E3 has a real design constraint: every render option cuts something (Express is proxy-only by architecture; a build-time list goes stale between releases; proxying `/` to Flask breaks the drift-tested `index.html` mirror), and "newest" must order by `first_published_at` (`Backend/models/recipe.py`), not `created_at`, or a recipe created in July and published today would not surface. E3 needs a design decision before it can be chartered (ledger A1). E2 needs its source and filter chosen (ledger S1). E5 needs a design pass before it can be chartered (T13).

## Section 1: Architecture

```
                       Googlebot
                          |
              crawls often|            crawls rarely (last: Jul 25)
                          v                       v
   +------------------- HOME (/) ----+        /browse ------+
   | today: /browse + 8 fixed /r/    |          | 10 hubs   |
   | + KAN-319: hubs (home, footer)  |          | 20 /r/    |
   | + E3: newest 6-8 /r/            |          v           v
   +------+-------------------+------+   /browse/tag/<t>   /r/<slug>
          |                   |               ^   |           |
          v                   v               |   +--> /r/ <--+ related (exists)
   /browse/tag/<t>        /r/<slug> ----------+ all tags (new row; today 1 tag)
                              |
                              +--> tested marker + notes (E1) --> /about (E1)

   External: owned properties, Pinterest, launch post, listicles --> home, hubs, /r/  (rank 2)
   Observe:  Cloud Run request logs --> crawl-evidence (E2) --> weekly report
   Proof:    feedback from anyone who generated or cooked a recipe (E5; undesigned)
   Deferred: "veganize" pages (E4), later charter
```

Findings:

- **WARNING A1.** E3 turns a static landing page into one with a data dependency. Implementation owner must prove: the row degrades to the existing 8 static links when Flask is unreachable, the no-JS HTML contains the links, and the `index.html` mirror and drift test still hold.
- **WARNING A2.** KAN-319 and E3 change the same files in the same release. Charter them as one lane, not two parallel sessions.
- **OK.** No new services. Rollback for ranks 1 and 5 is a patch release forward per the runbook.
- Platform note: a "newest" feed on home is the same data an RSS/Atom feed or IndexNow ping would use later. Not in scope.

## Section 2: Error and rescue map (capability level)

| Capability               | What can go wrong                                                                                   | Known safeguard                                                 | User / Google sees                  | Owner must prove                                                                                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hub links on home/footer | Link to a hub that is noindex (<3 recipes) or removed                                               | allow-list exists for hubs                                      | wasted crawl, soft dead end         | links generated from the same allow-list as the sitemap                                                                                                                                                                                                      |
| Recipe → all tags        | Tag with no hub renders as link                                                                     | unknown                                                         | 404 from a recipe page              | only allow-listed tags link                                                                                                                                                                                                                                  |
| E3 newest row            | Flask down or slow at render                                                                        | unknown                                                         | home blank or slow                  | static fallback, timeout, cache                                                                                                                                                                                                                              |
| E3 newest row            | Recipe unpublished after listing                                                                    | tombstones return 410                                           | link to 410 from home               | list excludes non-public at read time; cache TTL bounded                                                                                                                                                                                                     |
| Request Indexing         | Quota (~10/day) exhausted; request ignored                                                          | none                                                            | nothing                             | dated log of what was requested                                                                                                                                                                                                                              |
| E2 crawl evidence        | No log permission; logs expired; UA spoofed (scanners outnumber real fetches ~200 to 1 on bad days) | none yet                                                        | tool error or inflated counts       | actionable error like `gsc_*`; verify the source IP against Google's published ranges before a count is used as evidence of Google crawling; label user-agent-only counts as unverified (a scanner can fetch the home page with that user agent and get 200) |
| E1 tested marker         | Marker shown on a recipe nobody cooked                                                              | none                                                            | false claim to readers and Google   | marker is an explicit per-recipe field only the owner sets                                                                                                                                                                                                   |
| E5 feedback              | Spam, abuse, false "cooked it" reports; feedback orphaned by unpublish                              | none                                                            | junk or false proof on public pages | moderation and identity model from T13                                                                                                                                                                                                                       |
| Launch post              | Traffic spike meets rate limit or Valkey auth errors                                                | KAN-318 fix live in v0.5.7; four launch gates in Sprint 10 plan | errors for first visitors           | the four gates are Done before posting                                                                                                                                                                                                                       |
| Weekly report            | Striking-distance threshold (≥10 impressions) hides everything at this volume                       | none                                                            | "no rows" every week                | also run `gsc_striking_distance(min_impressions=3)` until volume grows; the weekly report takes only `days`                                                                                                                                                  |

## Section 3: Security

- **WARNING S1 (Med likelihood, Med impact).** E2 as first described needs `roles/logging.viewer` on the service account behind the hosted connector, whose only access control is a secret URL. That would expose all project request logs (client IPs, URLs, the connector's own secret path) to anyone holding the URL. Preferred direction, pending implementation owner: a **log-based metric** counting Googlebot requests by path prefix, read through the existing `monitoring.viewer` tools. No new role, aggregates only.
- E1 About page: publishes the author's name and profiles, already public. OK.
- E3, hubs: public published data only. OK.
- **WARNING S3 (High likelihood once public, Med impact).** E5 is the first user-generated content shown on public, indexable pages. It needs input validation, rate limiting, an identity rule, and a moderation path before it ships. Undesigned; T13.
- No new secrets or dependencies.

## Section 4: Data flow and interaction edge cases

```
PUBLISH recipe --> is_public + slug --> sitemap (works today)
                                   --> /browse page 1 (works; rarely crawled)
                                   --> hub pages by tag (works; never crawled)
                                   --> HOME newest row (E3; new)
   shadow: unpublish --> 410 tombstone --> must leave home row, hubs, related blocks
   shadow: rename slug --> old slug retired --> same
   shadow: zero recipes for a tag --> hub noindex --> must not be linked from home/footer
```

Edge cases: newest row with fewer than 6 public recipes (render what exists); two recipes published in the same second (stable order); a joke-titled recipe landing on the home page (KAN-275 title decision is still open and now more visible). No async ordering concerns at strategy depth.

## Section 5: Code quality (strategy level)

- **WARNING Q1.** Three places will list recipes on home: the 8 canonical links (`specs/canonical-recipes.json`, CI-gated), the `<noscript>` nav, and E3. Implementation owner must avoid a third hand-maintained list.
- Tag → hub mapping must have one source for sitemap, `/browse`, footer, home, and recipe chips.
- No over-engineering risk in ranks 1 to 5. E5 is a new feature and deserves its own design pass.

## Section 6: Tests

```
NEW THING                    TEST TYPE        EXISTS?   NEEDED ASSERTION
Home hub links (KAN-319)     static/drift     partial   server HTML contains N hub hrefs; each returns 200 + index
Footer hub links             SSR (pytest)     no        every SSR template footer contains the allow-listed hubs
Recipe → all tags            SSR (pytest)     no        recipe with k allow-listed tags renders k hub links
E3 newest row                integration      no        Flask down → static 8 still render; unpublished never listed
E2 crawl evidence            unit (fake)      no        permission error is actionable; zero rows is not an error
E1 tested marker             SSR (pytest)     no        marker absent unless the field is set
Crawl gate (existing)        CI crawl         yes       extend to fail on any home/footer link that is non-200
```

Release verification by content: grep served home HTML for `/browse/tag/` after deploy (absent in v0.5.7, so it is a valid marker).

## Section 7: Performance

- E3 adds one query to the home path. Cache it; home TTFB must not regress. Owner must prove.
- Driver bullet 1: the last mobile Lighthouse run is 2026-09-29 on v0.5.0 (LCP 1.2 s home, 3.1 s recipe and `/browse`). Re-run on home, `/browse` and one recipe on the current release before claiming the bullet; LCP alone does not prove the <500ms full-render target.
- Hubs and recipe chips: no new queries of note.

## Section 8: Observability

- Search-side instruments today are Search Console (2-day lag) and URL Inspection. Crawl: Datadog APM traces give sampled, user-agent-only evidence (used in the host-load section); there is no dedicated crawl report. Funnel: the instrumentation is shipped. With consent, Datadog RUM records recipe views, save outcomes (`src/utils/analytics.ts`, `src/services/ssr-entry.service.ts`) and how the visitor arrived (privacy policy § 3.4). What is missing is a reported search arrival → save number.
- E2 supplies crawl. Weekly report should add the newest-15 coverage count as a trend line.
- **WARNING O1.** The Sep 1 cliff may already be past recovery: default Cloud Logging retention is 30 days. Search Console → Settings → Crawl stats keeps 90 days and is UI-only. Adam should look at it this week.
- Reporting the search arrival → Save CTA conversion from that RUM data is not in scope here.

## Section 9: Deployment and rollout

```
1. Backend PR (footer, recipe tags, hub allow-list source)  --> Backend dev --> main
2. Cookbook PR (index.html + component, E3 render path)     --> dev
3. Promote to staging, verify by content                    --> staging
4. Release PR dev --> main, tag                             --> prod
5. Verify: home HTML has hub + newest links, all 200
6. Adam: Request Indexing, ~10/day, /browse first, then hubs, then newest recipes
7. Day 7 / 14 / 28: coverage sample, crawl evidence, weekly report
8. Launch post only after step 5 and the four launch gates
```

Risks: step 6 is manual and easy to forget (make it a KAN row with dated evidence). Launch before step 5 wastes the one launch on a site whose hubs Google cannot reach.

## Section 10: Long-term trajectory

- Reversibility: ranks 1 to 5 are 4/5. E1 is 4/5. E5 is 3/5: public feedback, once collected, is hard to withdraw without breaking trust.
- Retrospective on cherry-picks: E3 and E2 directly serve rank 1. E1 plus E5 are the answer to the scaled-content risk; E5 (Adam, D8) is the larger bet and changes what "proof" means on this site, from founder-tested to cook-reported. E4 was accepted at D5 and moved to a later charter at D6 after the spec review.
- E5 reopens a rejected item on honest terms: once real ratings exist, `aggregateRating` becomes legitimate.
- After this: canonical-rubric phase 2 driven by `gsc_*` data; hub intro copy tuned from real queries; RSS/IndexNow from the E3 feed.
- Debt: joke-titled recipes (KAN-275) get more exposure once hubs and the newest row link them.

## Section 11: Design and UX

UI scope exists (home sections, recipe tag chips, tested marker, About page, E5 feedback surface).

```
HOME:   H1 → generator input → Browse by category (hubs) → Newest recipes → Featured 8 → FAQ → footer hubs
RECIPE: breadcrumb → title → [Tested badge] → hero → tag chips (all) → ingredients → method
        → Chef's notes (short, only if tested) → Save CTA → related
```

- **WARNING D1.** The tested marker and notes are where "no life story" can erode. Set a hard cap (for example 80 words, substitutions and texture cues only) before any copy is written.
- States for the newest row: loading is not applicable (server HTML), empty hides the section, error falls back to static links.
- Mobile: category links must not push the generator input below the fold.
- Recommend `/plan-design-review` before building E1, E3 and E5.

## NOT in scope

Deferred (Adam, D6): **E4 "veganize" question pages**, moved to a later charter. Trigger to revisit: hubs indexed and drawing category impressions. The repo has no TODOS.md; carry this as a Jira row labelled `next-sprint-candidate` when RCP-119 is chartered.

Rejected or not adopted, with reason:

- `aggregateRating` (Sep 30 #5): no real ratings exist; fabricated ratings violate Google policy.
- `nutrition.calories` (Sep 30 #5): generator estimates are unverified. Not proposed by KAN-320.
- GA4 linkage (ChatGPT #5): the site's only analytics is opt-in Datadog RUM, relayed through its own servers (privacy policy § 3.4; the choice is § 10.3). GA4 would add a second, third-party analytics stack that the policy does not describe. Client-side analytics is not banned; GA4 is simply not adopted.
- Organization logo and "13-character description" warnings (ChatGPT): tool errors, per that doc.
- Brand-name schema fix (Sep 30 #4): already live.
- RSS feed, IndexNow, Bing Webmaster submission: noted as follow-ons, not proposed for decision.
- KAN-298 filter/sort: not SEO-critical; stays where Sprint 10 put it.

## What already exists

KAN-319 (scoped), KAN-320 (in progress), KAN-277 tree, Pinterest rows, tag hubs, related-recipes block, breadcrumbs, FAQ landing, sized images, 8 `gsc_*` tools, `/seo-weekly-check`, crawl gate in CI, canonical-recipes CI gate, tombstone 410s, four launch gates. Every rank reuses these.

## Dream state delta

After this plan: new recipes and hubs are one click from the home page, a handful of external links exist, 10 to 15 recipes carry human proof, and crawl behaviour is visible. Still missing versus the 12-month ideal: a reported search → save funnel number, hub rankings for category queries, and evidence that anyone returns.

## Failure modes registry

| Capability            | Failure mode                                                                            | Rescued?          | Test?                 | User sees                           | Logged?             |
| --------------------- | --------------------------------------------------------------------------------------- | ----------------- | --------------------- | ----------------------------------- | ------------------- |
| Home/footer hub links | links to noindex or missing hub                                                         | unknown           | N (extend crawl gate) | dead end                            | N                   |
| Recipe tag chips      | non-allow-listed tag linked                                                             | unknown           | N                     | 404                                 | N                   |
| E3 newest row         | Flask unreachable                                                                       | unknown           | N                     | blank section or slow home          | unknown             |
| E3 newest row         | unpublished recipe still listed                                                         | unknown           | N                     | 410 from home                       | N                   |
| Request Indexing      | forgotten or quota-limited                                                              | N (manual)        | n/a                   | nothing                             | N (needs dated row) |
| E2 instrument         | no permission / expired logs                                                            | unknown           | N                     | tool error                          | n/a                 |
| E1 marker             | shown on untested recipe                                                                | unknown           | N                     | false claim                         | N                   |
| E5 feedback           | spam, abuse or fake "cooked it" reports; feedback on a recipe that is later unpublished | N (no design yet) | N                     | junk or false proof on public pages | N                   |
| Launch                | traffic meets backend errors                                                            | Y (launch gates)  | Y                     | error page                          | Y                   |
| Weekly report         | threshold hides all rows                                                                | N                 | N                     | "no rows"                           | n/a                 |

Critical gaps (Rescued=N, Test=N, Silent): 2. **Request Indexing has no record** (T3 creates one). **E5 has no abuse or moderation model** (T13 must produce one before any build). Unknown rows carry an owner-must-prove note in Section 2.

## Implementation Tasks

Strategy-only: each task is the next research, chartering or verification action. The tasks fall into two groups.

- **Before the charter** (no code, no deploy, no sprint scope): Adam's manual Search Console actions (T4, and the first pass of T3 for `/browse` and the hubs); design and decisions the charter needs as input (T13, the E3 render-path decision A1, the E2 source decision in T5); Jira filing (T2, T11).
- **At or after the charter:** T1 is the chartering act itself. All build work waits for it, and each SI needs its RCP acceptance row. This covers the build half of T5 and the second pass of T3 (newest recipes, after rank 1 deploys).

- [ ] **T1 (P1, human: ~2h / CC: ~15min)** — Charter — Put KAN-319, the recipe→all-tags row and E3 in one RCP-119 lane as rank 1
  - Surfaced by: Section 1 A2; live evidence (hubs never crawled)
  - Files: to be determined
  - Verify: served home HTML contains `/browse/tag/` hrefs; crawl gate passes
- [ ] **T2 (P1, human: ~30min / CC: ~5min)** — Jira — File the unticketed row "recipe page links all allow-listed tags"
  - Surfaced by: Sep 30 doc #3; live probe (1 tag link per recipe)
  - Files: to be determined
  - Verify: KAN row exists, linked to its RCP acceptance row
- [ ] **T3 (P1, human: ~20min/day for 3 days)** — Adam — Request Indexing for `/browse` and the 10 hubs before the charter (needs no deploy; the pages are live and index-ready); repeat for newest recipes after rank 1 deploys; record each URL and date on a KAN row
  - Surfaced by: Failure modes registry (critical gap); spec review (ranking)
  - Verify: `gsc_inspect_url` on every URL in the dated request log shows a crawl date within 14 days of its request. The newest-15 sample is a separate coverage trend: it picks URLs by sitemap `lastmod`, so it may not contain the requested URLs
- [ ] **T4 (P1, do first, human: ~1h)** — Adam — Open Search Console → Settings → Crawl stats → Host status and the crawl-requests chart for late August to mid September; record what it shows. This is the only check that tests H3
  - Surfaced by: Section 8 O1; Adam's overload observation; spec review
  - Verify: screenshot or numbers attached to the E2 row; Core finding records what the report supports or weakens about H3. A healthy host report does not separate H1 from H2; those stay hypotheses until their own discriminators are read
- [ ] **T5 (P1, human: ~1 day / CC: ~30min)** — E2 — Decide the log source; prefer a log-based metric over `logging.viewer`
  - Surfaced by: Section 3 S1
  - Files: `scripts/monitoring/` (to be determined)
  - Verify: service account roles unchanged; metric returns Googlebot counts by path prefix, labelled as user-agent-only (unverified) unless the source IP is checked against Google's published ranges
- [ ] **T6 (P1, human: ~1 to 2 weeks)** — Authority — Charter KAN-277 children, Pinterest verification and the launch post in RCP-119, launch gated on T1 verified live
  - Surfaced by: Core finding; Section 9
  - Verify: each owned property resolves 200 to the canonical URL; Search Console Links shows referring domains
- [ ] **T7 (P2, human: ~2 weeks / CC: ~1h)** — E1 — Choose 10 to 15 recipes (start with those already drawing impressions), set the notes word cap, define the tested field, and extend the existing `/about` page (already served by Express and linked in the SSR footer) with authorship, `Person.sameAs` and which recipes are tested
  - Surfaced by: D2; Section 11 D1
  - Verify: marker absent on untested recipes; About linked from footer
- [ ] **T8 (P2, human: ~2h / CC: ~20min)** — Measurement — Re-run mobile Lighthouse on three templates; run Rich Results Test on three recipes and classify the issues; schedule `/seo-weekly-check` plus a separate `gsc_striking_distance(min_impressions=3)` call and the newest-15 sample (`gsc_weekly_report` takes only `days` and keeps its 10-impression threshold)
  - Surfaced by: Driver scorecard; Section 2
  - Verify: numbers recorded against driver bullet 1; issues labelled error or warning
- [ ] **T9 (P2, human: ~1h)** — Process — Close KAN-271/272/273/274/276 AC by AC on v0.5.x evidence
  - Surfaced by: Sprint 9 retro action d
  - Verify: no KAN-27x row In Review for work already live
- [ ] **T10 (P2)** — KAN-320 — Finish as scoped, after rank 1
  - Surfaced by: baseline scope
  - Verify: Rich Results Test clean of errors on three recipes
- [ ] **T11 (P3, human: ~10min)** — Jira — Record E4 "veganize" pages as a `next-sprint-candidate` row with its trigger (hubs indexed and drawing category impressions)
  - Surfaced by: D6
  - Verify: row exists and is not in RCP-119
- [x] **T13 (P1, human: ~1h / CC: ~30min)** — E5 — Run `/office-hours` on recipe feedback before chartering it. It must settle: who may leave feedback (signed-in only, or guests), what is shown publicly, how spam and false reports are handled, whether it produces a rating, and how it sits with the no-tracking stance
  - Surfaced by: D8 (Adam); Failure modes registry (critical gap)
  - Verify: design doc exists; RCP-119 acceptance row names its evidence
  - Done 2026-10-04: [`docs/designs/recipe-feedback.md`](../designs/recipe-feedback.md), approved by Adam. The acceptance row is still owed at charter time
- [ ] **T12 (P2, human: ~30min)** — Adam — Decide KAN-275 joke-title handling before hubs and the newest row surface those titles
  - Surfaced by: Section 4; audit C3
  - Verify: decision recorded on KAN-275

## Decision ledger

| ID and owner    | Contract and evidence                                                                       | Current                        | Proposed                             | Status                        | Exact approval and scope                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MODE (0E)       | Review mode                                                                                 | none                           | SELECTIVE EXPANSION                  | approved                      | D1, Adam 2026-10-03 (review recommended HOLD SCOPE)                                                                                                                       |
| E1 (0G)         | Tested-recipe proof: 10 to 15 recipes cooked, tested marker, short notes, About/author page | none                           | Add                                  | approved                      | D2 "Add to scope": in plan scope for RCP-119 charter; no implementation approved                                                                                          |
| E2 (0G)         | Crawl-evidence instrument on gcp-monitor                                                    | none                           | Add                                  | approved                      | D3 "Add to scope"; log source and permission model not chosen (S1)                                                                                                        |
| E3 (0G)         | Server-rendered newest-recipes row on home                                                  | 8 fixed links                  | Add                                  | approved                      | D4 "Add to scope"; render path not chosen (A1)                                                                                                                            |
| E4 (0G)         | "Veganize" question pages                                                                   | none                           | Add, then Defer                      | deferred                      | D5 "Add to scope"; reopened by spec review; D6 "Move to a later charter". Out of RCP-119                                                                                  |
| E4-GATE (S10)   | Publish gate for E4                                                                         | none                           | n/a                                  | declined (moot)               | superseded by D6                                                                                                                                                          |
| E1-PHOTOS (S11) | Real cooking photo on tested recipes                                                        | AI hero only                   | second, smaller real photo           | approved                      | D7. Amends the driver's "one photo" bullet for the tested subset only                                                                                                     |
| E1-RANK (S10)   | Order of proof vs authority                                                                 | authority rank 2, proof rank 3 | proof first                          | declined                      | D8: Adam kept authority second                                                                                                                                            |
| E5 (S10)        | Recipe feedback from anyone who generated or cooked a recipe                                | none                           | Add                                  | approved in direction         | D8, Adam's own words: "needs a way for people to leave actual feedback on recipes they generated OR cooked - whether me or friends, family or user". Design unchosen; T13 |
| PLAN-HOME (nav) | Where the plan lives                                                                        | local                          | docs PR to `docs/seo/`               | approved                      | D9                                                                                                                                                                        |
| S1 (S3)         | E2 permission model                                                                         | none                           | log-based metric vs `logging.viewer` | pending, implementation owner | not a strategy decision; T5                                                                                                                                               |
| A1 (S1)         | E3 render path                                                                              | static home                    | build-time vs request-time           | pending, implementation owner | not a strategy decision; T1                                                                                                                                               |

Approval readiness: PASS. Checked rows and answers: MODE (D1), E1 (D2), E2 (D3), E3 (D4), E4 (D5, D6), E1-PHOTOS (D7), E1-RANK (D8), E5 (D8), PLAN-HOME (D9). Pending with an implementation owner, not strategy decisions: S1, A1, E5 design.

## Scope Expansion Decisions

- Accepted: E1 tested-recipe proof (with a second real photo), E2 crawl-evidence instrument, E3 newest-recipes row, E5 recipe feedback from any cook (raised by Adam at D8).
- Deferred: E4 "veganize" pages, to a later charter.
- Skipped: none.

## Independent review

- Spec review (in-host subagent, 1 pass): 6/10, 16 issues. 13 applied as factual or structural corrections (hypothesis framing, falsification branch, `/about` exists, measure alignment, E3 feasibility, E2 spoof filter, capacity note, T3/T4 order). 3 went to Adam: E4 disposition (D6, deferred), real photos (D7, accepted), proof before launch (D8, declined).
- Outside voice: Codex did not run: the gstack Codex probe failed to resolve its own helper script under zsh, right after the gstack upgrade. This is a tooling fault, not a model or account setting. No external or cross-model review this run.

## Completion Summary

```
+====================================================================+
|            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
+====================================================================+
| Mode selected        | SELECTIVE EXPANSION                         |
| System Audit         | On-page shipped; 2/15 newest URLs indexed;  |
|                      | hubs never crawled; 0 external links known  |
| Step 0               | Strategy-only; 3 docs reconciled, re-ranked |
| Section 1  (Arch)    | 2 issues found                              |
| Section 2  (Errors)  | 10 error paths mapped, 2 GAPS               |
| Section 3  (Security)| 2 issues found, 0 High severity             |
| Section 4  (Data/UX) | 6 edge cases mapped, 3 unhandled            |
| Section 5  (Quality) | 1 issue found                               |
| Section 6  (Tests)   | Diagram produced, 6 gaps                    |
| Section 7  (Perf)    | 2 issues found                              |
| Section 8  (Observ)  | 3 gaps found                                |
| Section 9  (Deploy)  | 2 risks flagged                             |
| Section 10 (Future)  | Reversibility: 4/5, debt items: 1           |
| Section 11 (Design)  | 1 issue; /plan-design-review recommended    |
+--------------------------------------------------------------------+
| NOT in scope         | written (8 items)                           |
| What already exists  | written                                     |
| Dream state delta    | written                                     |
| Error/rescue registry| 10 rows, 2 CRITICAL GAPS                    |
| Failure modes        | 10 total, 2 CRITICAL GAPS                   |
| TODOS.md updates     | 1 item (E4; no TODOS.md, Jira row instead)  |
| Scope proposals      | 5 proposed, 4 accepted, 1 deferred          |
| CEO plan             | written                                     |
| Outside voice        | codex unavailable; in-host spec review ran  |
| Lake Score           | N/A (no coverage-scored questions)          |
| Diagrams produced    | 4 (architecture, data flow, rollout, UX)    |
| Stale diagrams found | 0                                           |
| Unresolved decisions | 1 (listed below)                            |
+====================================================================+
```

## GSTACK REVIEW REPORT

| Review         | Trigger               | Why                             | Runs              | Status                                    | Findings                                                          |
| -------------- | --------------------- | ------------------------------- | ----------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| CEO Review     | `/plan-ceo-review`    | Scope & strategy                | 1                 | ISSUES OPEN                               | 5 proposals, 4 accepted, 1 deferred; 2 critical gaps              |
| Outside Review | codex (plan review)   | Independent 2nd opinion         | 0 this run        | unavailable                               | gstack Codex probe failed under zsh; no completed external review |
| Eng Review     | `/plan-eng-review`    | Architecture & tests (required) | 2 (Jul 7, Jul 23) | stale (older than 7 days, different plan) | 17 and 12 issues on earlier plans                                 |
| Design Review  | `/plan-design-review` | UI/UX gaps                      | 0                 | not run                                   | recommended before E1, E3, E5                                     |
| DX Review      | `/plan-devex-review`  | Developer experience gaps       | 0                 | not run                                   | not applicable                                                    |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (gstack probe failure, no call made). An in-host spec review completed with 16 findings; it does not count as outside coverage.
- **VERDICT:** CEO review complete with issues open. Strategy input for the RCP-119 charter, not cleared to build. E3 and E5 need design; eng review required before implementation.

**UNRESOLVED DECISIONS:**

- E5 recipe feedback is accepted in direction but undesigned: who may leave feedback, what is public, moderation, ratings. Owner: Adam via `/office-hours` (T13).
  - Update 2026-10-04: resolved. Adam approved [`docs/designs/recipe-feedback.md`](../designs/recipe-feedback.md), which settles eligibility, public display, moderation and ratings. Next step for the charter owner: `/plan-eng-review` on that design, starting from its open reviewer concerns R3-3 to R3-8 and its open questions. Statements above that call E5 undesigned describe the 2026-10-03 snapshot.
