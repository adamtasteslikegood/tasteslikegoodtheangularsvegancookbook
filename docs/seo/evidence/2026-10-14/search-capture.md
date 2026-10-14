# Search capture, 2026-10-14

Raw results behind the brand-visibility section of
[AI_VISIBILITY_2026-10-14.md](../../AI_VISIBILITY_2026-10-14.md).

- **Provider:** the web search tool built into Claude Code (`WebSearch`,
  standard mode). It is US-only, signed out, and does not say which search
  index it queries. It returns about 9 links per query, with titles and URLs
  only (no snippets).
- **Time:** run between 14:44 and 14:48 UTC on 2026-10-14, except the two
  rows marked 15:05 UTC.
- **Brand name:** `tasteslikegood` (Adam, 2026-10-14). The domain and the
  second name, VeganGenius Chef, are searched as well.
- **Brand match:** a result counts as the brand only if its URL is on
  `tasteslikegood.org`.

| Query (exact)                                           | Brand in results? | Links returned, in order                                                                                                                                                                                                                                 |
| ------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasteslikegood` (brand name; run 15:05 UTC)            | no                | shibboleth.idm.home.nyu.edu ("Tastes Good" image), en.wikipedia.org (Tastes like chicken), en.wikipedia.org (Flavorless candy), oxfordlearnersdictionaries.com, booksamillion.com, pmportal.org, live.aacr.org, dice.mpi-inf.mpg.de, books.apple.com     |
| `tasteslikegood vegan recipe generator` (run 15:05 UTC) | no                | theresanaiforthat.com (Veganize It), topai.tools (vegan-recipes), lablab.ai (Chef Buddy), topai.tools (vegan-recipe-recommendations), genai.works, neura.market, lablab.ai, atlasai.ma, atlasai.ma (ar)                                                  |
| `tasteslikegood.org`                                    | no                | live.aacr.org, datanyze.com (Food Should Taste Good), saveur.com, heritageradionetwork.org, tlh.halifaxpubliclibraries.ca, app.sponsorpitch.com, pmportal.org, oxfordlearnersdictionaries.com, oddlygood.com                                             |
| `VeganGenius Chef`                                      | no                | en.wikipedia.org (Vegan Black Metal Chef), vegnews.com, ypulse.com, laughingsquid.com, vegnews.com, postecards.poste.it, climatechicago.fieldmuseum.org, luxiders.com, penguin.com.au                                                                    |
| `free AI vegan recipe generator`                        | no                | oneingredientchef.com, apps.apple.com (6749341323), topai.tools (diet-specific), topai.tools (vegan-recipes), apps.apple.com (SavoryAI), fotor.com, topai.tools (vegan-recipe-recommendations), nichepursuits.com, ai-tool-database.super.site (DishGen) |
| `best AI vegan recipe generator`                        | no                | topai.tools (vegan-recipes), topai.tools (vegan-recipe-recommendations), thrivemarket.com, oneingredientchef.com, bootstrapped.ventures, morningdough.com, morningdough.com, origin.thrivemarket.com, topai.tools (diet-specific)                        |
| `AI recipe generator alternatives`                      | no                | alternativeto.net (Cookup), stork.ai (Let's Foodie), topai.tools (AI Recipe Writer), zylalabs.com, alternativeto.net (Random Recipe Generator), alternativeto.net (ChefBot), tracker.zylalabs.com, zylalabs.com, aichief.com (RecipeGen)                 |

## Earlier observation, withdrawn

An earlier run the same morning, before this capture, showed the site 2nd of
10 for "best / free AI vegan recipe generator" and 1st for the brand name.
That run was not saved. These queries, run a few hours later with the
same tool, do not show the site at all. Without a capture, the earlier result
cannot be checked, so it is not used as a baseline.

## Search Console (measured, Google only)

Read through the `gcp-monitor` connector at about 14:46 UTC.

- **URL inspection, `https://www.tasteslikegood.org/`:** verdict PASS,
  "Submitted and indexed", last crawl 2026-10-13 03:01:33, Google canonical
  equals declared canonical, in the submitted sitemap. URL inspection does not
  return the text Google stored for the page.
- **Search performance, queries, 28 days (2026-09-16 to 2026-10-13, last two
  days preliminary), sorted by impressions:**

  | Query                  | Clicks | Impressions | Average position |
  | ---------------------- | ------ | ----------- | ---------------- |
  | vegan recipe generator | 4      | 15          | 74.7             |
  | vegan recipe tester    | 0      | 2           | 64.5             |
  | sure!                  | 0      | 1           | 1.0              |

- **Search performance, queries containing `tasteslike`, 90 days (2026-07-16
  to 2026-10-13):** no rows. Nobody reached the site from Google by its
  name in that window.
