# AI visibility: staging after the agent-readiness work (2026-10-14)

Measured on 2026-10-14. It compares staging, which carries the agent-readiness
work (AR-1 to AR-10; KAN-395, KAN-397, KAN-398, KAN-399), with production,
which carries none of it yet and so stands in as the "before" result. The
work ships to production as release 0.7.0.

- **Staging:** `https://staging.tasteslikegood.xyz`, cookbook `dev` `6b15dd3`
  with Backend `dev` `e69b5cd`, deployed by staging run 38565869015 (finished
  2026-10-14 12:48 UTC).
- **Production:** `https://www.tasteslikegood.org`, release `v0.6.2`: cookbook
  `main` `1c28e67` with Backend `main` `95cbe10`, Cloud Build
  `36c99834-7c16-4d40-9cb6-a8a0575366bd`, Cloud Run revisions
  `express-frontend-00071-lsp` and `flask-backend-00104-tkq` (both ready
  2026-10-12 21:46 UTC and still the latest ready revisions when measured).

Raw output for every measurement below is in
[evidence/2026-10-14/](./evidence/2026-10-14/).

## Summary

The agent-readiness work makes the site much easier for AI tools and agents to
read: 11 of 14 readiness checks pass on staging, against 3 on production.
Whether AI assistants mention the brand more often cannot be measured on
staging: it is deliberately blocked from crawlers. That can only change after
the production release, and only once AI tools re-read the site, which may take
weeks.

## Readiness check

`scripts/seo/check_agent_readiness.sh <base-url>`, one line per requirement,
run at 14:43 UTC against both sites
([readiness-prod.txt](./evidence/2026-10-14/readiness-prod.txt),
[readiness-staging.txt](./evidence/2026-10-14/readiness-staging.txt)).

| Requirement                                                               | Production (before) | Staging (after)     |
| ------------------------------------------------------------------------- | ------------------- | ------------------- |
| AR-1: `robots.txt` names the AI crawlers                                  | fail                | fail (staging only) |
| AR-2: `robots.txt` states a Content-Signal                                | fail                | fail (staging only) |
| AR-3: `/llms.txt` is served and starts with a title                       | fail                | pass                |
| AR-4: `/sitemap.xml` is served and listed in `robots.txt`                 | pass                | fail (staging only) |
| AR-5a: home page has WebApplication and Organization structured data      | pass                | pass                |
| AR-5b: a recipe page has Recipe structured data                           | pass                | pass                |
| AR-6: home page `Link` header points at `/llms.txt`                       | fail                | pass                |
| AR-7a: Markdown for `/`                                                   | fail                | pass                |
| AR-7b: Markdown for `/browse`                                             | fail                | pass                |
| AR-7c: Markdown for a recipe page `/r/<slug>`                             | fail                | pass                |
| AR-8a: `/api/public/openapi.json` describes the public API                | fail                | pass                |
| AR-8b: `/.well-known/api-catalog` is a linkset                            | fail                | pass                |
| AR-9: `/mcp` answers an MCP initialize request                            | fail                | pass                |
| AR-10: home page and `llms.txt` say the recipes are generated with Gemini | fail                | pass                |
| **Total**                                                                 | **3 of 14**         | **11 of 14**        |

"Staging only" means staging serves a block-all `robots.txt` (`server/index.ts`),
so those three lines can only be confirmed on production. The `robots.txt` that
ships (#3669) is written to pass them. AR-11 (WebMCP, KAN-400) is not in the
script: it needs a browser, so it is measured below.

## Browser check (Chrome DevTools)

The script reads the sites with curl. To see what a browser and its built-in
agent checks see, both home pages were loaded in a fresh, isolated Chrome
profile each, through the Chrome DevTools MCP server, at 14:44 UTC.

**Lighthouse 13.4.1, desktop, home page**
([prod](./evidence/2026-10-14/lighthouse-prod/report.json),
[staging](./evidence/2026-10-14/lighthouse-staging/report.json)):

| Category         | Production | Staging | Notes                                                                                    |
| ---------------- | ---------- | ------- | ---------------------------------------------------------------------------------------- |
| SEO              | 100        | 66      | Staging fails only `is-crawlable`: its `noindex, nofollow` header, by design             |
| Agentic Browsing | 100        | 100     | Not comparable as a score: see below                                                     |
| Accessibility    | 95         | 94      | Both fail `color-contrast` and `landmark-one-main` (no `main` landmark on the home page) |
| Best Practices   | 100        | 100     |                                                                                          |

Lighthouse's Agentic Browsing category leaves out any audit that does not
apply, so the two 100s mean different things:

| Audit                                                                       | Production               | Staging        |
| --------------------------------------------------------------------------- | ------------------------ | -------------- |
| `llms-txt` (llms.txt follows recommendations)                               | not applicable (no file) | pass           |
| `agent-accessibility-tree`                                                  | pass                     | pass           |
| `webmcp-registered-tools`, `webmcp-schema-validity`, `webmcp-form-coverage` | not applicable           | not applicable |

The three WebMCP audits are the browser-side measure for AR-11. They report
"not applicable" on both sites because no page registers WebMCP tools yet,
and `'modelContext' in navigator` is `false` in this Chrome build. AR-11
passes when those audits report pass.

**Requests from inside the page**
([browser-checks.json](./evidence/2026-10-14/browser-checks.json)) confirm
the script: on staging the home page carries the `Link` header (llms.txt,
sitemap, api-catalog) and `Vary: Accept`, and asking for `text/markdown`
returns Markdown. On production neither is present.

To repeat this after release: open the page in an isolated context, run the
Lighthouse audit, and save `report.json`, as above.

Spot checks of `/mcp` on staging:

- `tools/list` returns `search_recipes` and `get_recipe` only.
- A batch of two `search_recipes` calls runs the first and refuses the second
  with "One tool call per request" (Backend #417).
- The response carries `ratelimit-limit: 300`.
- `GET /mcp` gets 405; `/mcp/` gets 404 from Flask.
- The API catalog lists three entries: `/api/public/newest-recipes`,
  `/api/agent/tools` and `/mcp`.

## AIReady

Not available. The AIReady connector failed on both domains with a protocol
error, the same failure recorded on 2026-10-12. There is still no AIReady score
before or after.

## Brand visibility (production)

ChatGPT, Claude and Perplexity could not be queried directly. Three sources
were used; the full results are in
[search-capture.md](./evidence/2026-10-14/search-capture.md).

**Google, searched by Adam for `tasteslikegood` (2026-10-14, also in an
incognito tab, US).** This is the result that counts for the brand query:

- Google's **AI Overview** answers first: "Tasteslikegood.org is home to
  VeganGenius Chef, a free AI-powered vegan recipe generator". It lists four
  features, each cited to `www.tasteslikegood.org`: custom recipes from a
  mood, dish or leftover ingredients; measured ingredients, steps, times and
  servings; saving recipes to a cookbook, collections and publishing; free,
  with no ads or life story. All four are accurate. It does not mention
  Google Gemini.
- The **first organic result** is the home page, titled "AI Vegan Recipe
  Generator & Cookbook | Tasteslikegood", with the site's own description and
  its image.
- Below it: other accounts using the name (a YouTube music channel, a
  Pinterest profile), the Backend's GitHub repository, then unrelated videos.

**Google, `tasteslikegood vegan recipe generator`, incognito with
personalization off** ([screenshot](./evidence/2026-10-14/google-brand-category-not-personalized.webp)):
the site is again first, and the AI Overview says "The VeganGenius Chef AI
vegan recipe generator is available for free at Tasteslikegood.org", naming
custom prompts, full recipes, an AI food photo with each recipe and the
personal cookbook. Every other result is a competitor that does not contain
the name (10weeks.org, receptoai.com, recipegpt.io, thezestful.com and
others). Google also offers "Did you mean: tastes like good", so the run-on
name is not yet recognised as a word on its own.

So for its own name, personalized or not, the site ranks first and an AI
summary describes it correctly. That is a real AI-generated answer about the brand, and the best
evidence in this document for what AI search already says.

**Web search, Claude Code's built-in search tool (US, signed out), 14:44 to
15:05 UTC.** Seven exact queries, including `tasteslikegood`. The site appears
in none of them, not even for its own name, which Google answers with the site
first. This tool does not search Google's index and is not a stand-in for it.
It is kept as a record of a non-Google search index, where the site is not yet
present. Directories and roundups (topai.tools, alternativeto.net, DishGen
listings) fill its category queries.

An earlier run of that tool the same morning had shown the site 2nd for the
category search and 1st for its name. It was not saved and could not be
repeated, so it is not used. The observation from that run that the index
held only the home page's menu text is contradicted by Google's result above,
which shows the real description, and is withdrawn.

**Google Search Console, last 28 days (2026-09-16 to 2026-10-13).** The
measured baseline for category queries, because the same window can be read
again later:

| Query                  | Clicks | Impressions | Average position |
| ---------------------- | ------ | ----------- | ---------------- |
| vegan recipe generator | 4      | 15          | 74.7             |
| vegan recipe tester    | 0      | 2           | 64.5             |

No query containing `tasteslike` is reported for the last 90 days. Search
Console leaves out rare queries for privacy, so this says brand searches are
few, not that there were none. The home page is "Submitted and indexed", last
crawled 2026-10-13, with Google's canonical matching the declared one.

### Rough visibility score

Scored with the rubric in the SearchFit `ai-visibility` skill (plugin
`searchfit-seo`, no version number published): each dimension 0 to 10, overall
= mean x 10. An estimate, not a tracked score.

| Dimension    | Score         | Basis                                                                                          |
| ------------ | ------------- | ---------------------------------------------------------------------------------------------- |
| Presence     | 5             | First on Google and in its AI Overview for the brand; position about 75 for the category query |
| Accuracy     | 9             | Every claim in the AI Overview is correct                                                      |
| Sentiment    | 5             | Neutral: no third-party reviews either way                                                     |
| Position     | 4             | 1st for the brand, 74.7 for "vegan recipe generator", absent from roundups                     |
| Completeness | 7             | Recipes, cookbook, publishing and free use are all named; Gemini is not                        |
| Consistency  | 3             | Google answers with the site first; the other search index does not know it                    |
| **Overall**  | **55 of 100** | (5 + 9 + 5 + 4 + 7 + 3) / 6 x 10                                                               |

The gap is the category, not the brand: people who know the name find an
accurate answer; people asking for a vegan recipe generator do not find the
site.

## What would raise it

1. **Release 0.7.0.** It puts `llms.txt`, the Markdown pages, the API catalog
   and the MCP server on production. Expected impact: high, for AI search tools
   and agents.
2. **Appear in the roundups.** The "AI recipe generator alternatives" and "best
   of" lists are where competitors appear and tasteslikegood does not.
   That means directory submissions and the backlink plan in
   [SEO_AUDIT_2026-09-13.md](./SEO_AUDIT_2026-09-13.md). Expected impact: high.
3. **Proof from cooks.** Reviews from people who generated and cooked a recipe
   ([designs/recipe-feedback.md](../designs/recipe-feedback.md), item E5). The
   brand has no third-party sentiment today. Expected impact: medium, slow.
4. **Pages that answer the questions people ask AI assistants**, such as
   "vegan recipe from what's in my fridge". The how-to guide behind the home
   Markdown could also be a public page. Expected impact: medium.

## Re-measure after release

Against production after 0.7.0 is live: the readiness check (expect 14 of 14),
the Lighthouse audit (the `llms-txt` audit should pass on production), the
AIReady scan once the connector works, and this audit again a few weeks later
with the same queries, saved the same way, Google's answer for `tasteslikegood` captured again, plus Search Console for the
28 days after release.
