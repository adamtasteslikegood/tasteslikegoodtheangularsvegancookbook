# AI visibility: staging after the agent-readiness work (2026-10-14)

Measured on 2026-10-14. It compares staging, which carries the agent-readiness
work (AR-1 to AR-10; KAN-395, KAN-397, KAN-398, KAN-399), with production,
which carries none of it yet and so stands in as the "before" result. The
work ships to production as release 0.7.0.

- **Staging:** cookbook `dev` `6b15dd3` with Backend `dev` `e69b5cd`, deployed
  by staging run 38565869015.
- **Production:** `https://www.tasteslikegood.org`, the release current on
  2026-10-14.

## Summary

The agent-readiness work makes the site much easier for AI tools and agents to
read: 11 of 14 readiness checks pass on staging, against 3 on production.
Whether AI assistants mention the brand more often cannot be measured on
staging: it is deliberately blocked from crawlers. That can only change after
the production release, and only once AI tools re-read the site, which may take
weeks.

## Readiness check

`scripts/seo/check_agent_readiness.sh <base-url>`, one line per requirement.

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
script: it needs a browser.

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

## Brand visibility (production, live web results)

ChatGPT, Claude and Perplexity could not be queried directly. As a stand-in,
these are live web results for the searches AI search tools draw on.

| Search                                     | Brand shown? | Position  | What is shown                                                                |
| ------------------------------------------ | ------------ | --------- | ---------------------------------------------------------------------------- |
| "best / free AI vegan recipe generator"    | yes          | 2nd of 10 | title only                                                                   |
| "tasteslikegood.org", "VeganGenius Chef"   | yes          | 1st       | title only                                                                   |
| Roundups ("alternatives", "best of" lists) | no           | none      | competitors listed instead: MyChefAI, Recepto AI, DishGen, ChefAI and others |

The search index holds only the home page's menu and footer text ("Generator ·
My Kitchen · Sign In · Browse Public Recipes · Privacy Policy") and no
description of what the site does. That is the Angular app shell. The Markdown
home page (AR-7a) and `llms.txt` (AR-3) give AI readers a real description, so
this is the clearest improvement to look for after release.

### Rough visibility score

Scored with the SearchFit `ai-visibility` rubric, 0 to 10 per dimension. An
estimate from web results, not a tracked score.

| Dimension    | Score               | Notes                                                                   |
| ------------ | ------------------- | ----------------------------------------------------------------------- |
| Presence     | 4                   | Ranks for its category search and its brand name; missing from roundups |
| Accuracy     | 4                   | The title is accurate; the stored page text has no description          |
| Sentiment    | 5                   | Neutral: no third-party reviews either way                              |
| Position     | 4                   | 2nd in one category search                                              |
| Completeness | 2                   | Gemini, published recipes and the cookbook are not visible              |
| Consistency  | not measured        | No access to the AI assistants themselves                               |
| **Overall**  | **about 38 of 100** | Five dimensions only                                                    |

## What would raise it

1. **Release 0.7.0.** It puts `llms.txt`, the Markdown pages, the API catalog
   and the MCP server on production. Expected impact: high, for AI search tools
   and agents.
2. **Appear in the roundups.** The "AI recipe generator alternatives" and "best
   of" lists are where competitors appear and Tasteslikegood.org does not.
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
the AIReady scan once the connector works, and this audit again a few weeks
later to see whether AI tools have picked the changes up.
