# TastesLikeGood — SEO Next Steps (Indexing Focus)

**Site:** [https://www.tasteslikegood.org](https://www.tasteslikegood.org) **Prepared:** September 30, 2026 **Data sources:** Google Search Console (28-day window, Sep 3 – Sep 30, 2026), URL Inspection API, live site fetched as Googlebot

---

## Current state at a glance

| Metric                               | Value              | Note                                             |
| ------------------------------------ | ------------------ | ------------------------------------------------ |
| Sitemap URLs submitted               | 107                | 0 errors, 0 warnings, matches the live sitemap   |
| Indexed (sample of 15 newest)        | 3 of 15 (20%)      | Homepage, `/browse`, one recipe                  |
| "Discovered – currently not indexed" | 11 of 15           | Includes all sampled `/browse/tag/*` pages       |
| "URL is unknown to Google"           | 1 of 15            | `/r/nine-grain-biscuits-and-wild-mushroom-gravy` |
| Impressions (28 days)                | 20                 | Too low for trend flags to mean much             |
| "vegan recipe generator"             | Avg position \~112 | About page 12–15                                 |
| Homepage last crawled                | Sep 30, 2026       | After the latest site update                     |

**Core diagnosis:** The site is technically healthy and the new pages are well built, but Google isn't crawling them. Ranking can't improve until pages are indexed, so every step below is aimed at getting Google to crawl and index more of the site.

---

## 1. Add homepage links to category (tag) pages and featured recipes

**Priority:** Highest

### Evidence of the gap

- The homepage is the most frequently crawled page. It was recrawled Sep 30, after the update.
- The live homepage HTML contains only **one** internal link into the recipe section: `href="/browse"`. It has no links to `/browse/tag/*` pages or to any `/r/*` recipe.
- Every sampled tag page (`/browse/tag/tofu`, `/breakfast`, `/high-protein`, `/lunch`, `/comfort-food`, `/sandwiches`, `/snacks`) is **"Discovered – currently not indexed"** with no crawl date.

### What to do

- Add a **"Browse by category"** section to the homepage that links directly to the 8–12 most useful tag pages, with short, descriptive anchor text (for example, "High-protein vegan recipes" rather than "High protein").
- Add a **"Featured recipes"** row that links to 6–8 strong published recipes.
- Render these links in the server HTML, not only after JavaScript loads, so Googlebot sees them on the first fetch.

### How it affects indexing

Google decides what to crawl partly by how important a URL looks, and links from frequently crawled pages are a strong signal. At the moment the tag pages are two clicks deep (home → `/browse` → tag). Linking them from the homepage makes them one click deep and passes the homepage's crawl priority to them directly. This is the most effective way to move pages from "Discovered" to "Crawled" and then "Indexed."

---

## 2. Request indexing for the top tag pages in Search Console

**Priority:** High (quick, manual)

### Evidence of the gap

- The tag pages show **no last-crawl date**, so Google has never fetched them.
- The tag pages are ready to index: each has its own `<title>` (for example, "Vegan Tofu Recipes · TastesLikeGood"), a unique H1, a self-referencing canonical, `robots: index,follow`, and about 14 recipe links.

### What to do

1. Deploy step 1 first, so the pages have stronger internal links when Google arrives.
2. In Search Console, open **URL Inspection**, enter each tag URL, and click **Request indexing**.
3. Start with the 5–10 tag pages with the broadest search demand, such as breakfast, high-protein, tofu, comfort-food, and lunch.
4. Also request `/r/nine-grain-biscuits-and-wild-mushroom-gravy`, which is "unknown to Google."

Note that there's a daily quota of roughly 10 requests per property, so spread these over a few days.

### How it affects indexing

A manual request moves a URL into Google's priority crawl queue, usually within days instead of weeks. It doesn't guarantee indexing, because Google still judges page quality. But it gets the new tag pages evaluated soon, while the internal linking from step 1 makes the case for keeping them.

---

## 3. Link each recipe page to all of its relevant tags

**Priority:** High

### Evidence of the gap

- The indexed recipe `/r/crispy-vegan-corn-dogs-on-a-stick` links to **only one** tag page (`/browse/tag/comfort-food`), although it likely fits others (snacks, kid-friendly, and so on).
- It links to 7 other recipes, so recipe-to-recipe linking exists, but recipe-to-category linking is thin.
- URL Inspection reports only **1 referring URL known to Google** for this indexed recipe.

### What to do

- On each recipe page, render **all** of the recipe's tags as crawlable links to their `/browse/tag/*` pages, for example as tag chips under the title.
- Keep the "related recipes" links, and where possible choose them by shared tag.

### How it affects indexing

Each indexed recipe becomes a path into several category pages instead of one. Tag pages then collect links from many recipes, which raises their importance in Google's eyes. The links are also bidirectional, since tag pages link back to recipes, so this builds a cluster structure that helps Google find and value the whole recipe section.

---

## 4. Fix the brand name in structured data

**Priority:** Medium (quick fix)

### Evidence of the gap

On the live homepage:

- `WebSite` schema has `"name": "Tasteslikegood.org"` and `"alternateName": "VeganGenius Chef"`.
- `WebApplication` schema has `"name": "Tasteslikegood.org"`.
- `og:site_name` is `Tasteslikegood.org`.
- In search results, Google displays the site as **"tasteslikegood.org"**, a domain, rather than a brand name.
- The title says _TastesLikeGood_ and the page body says _VeganGenius Chef_.

### What to do

- Set `WebSite.name` and `og:site_name` to **"TastesLikeGood"**.
- Keep `alternateName` as `["VeganGenius Chef", "tasteslikegood.org"]`.
- Decide on one consistent product framing and use it across the title, H1 area, schema, and favicon, for example "VeganGenius Chef by TastesLikeGood."

### How it affects indexing

This doesn't directly affect whether pages are indexed. It affects how Google understands the site as an entity and how the site name appears in results. Consistent naming helps Google connect brand mentions and links to the site over time, which supports authority (step 6).

---

## 5. Complete the Recipe structured data

**Priority:** Medium

### Evidence of the gap

- URL Inspection on `/r/crispy-vegan-corn-dogs-on-a-stick` reports **Recipes rich result: 31 issues**.
- The `Recipe` schema has: `name`, `image`, `description`, `author`, `prepTime`, `cookTime`, `totalTime`, `recipeYield`, `recipeIngredient`, `recipeInstructions`, `keywords`, `suitableForDiet`, `datePublished`, `dateModified`, `url`, and `mainEntityOfPage`.
- It's missing these recommended fields: `recipeCategory`, `recipeCuisine`, `nutrition` (at minimum `calories`), and `aggregateRating`.

### What to do

1. Open **Search Console → Enhancements → Recipes** to see whether the 31 issues are errors (which block rich results) or warnings (recommended fields).
2. Add `recipeCategory` (for example "Dinner" or "Snack") and `recipeCuisine` (for example "American" or "Thai"). These can come from the recipe's existing tags.
3. Add `nutrition.calories` if the generator can estimate it reliably.
4. Add `aggregateRating` **only** if real user ratings exist. Don't add made-up ratings.
5. Validate several pages with Google's Rich Results Test after deploying.

### How it affects indexing

Complete, error-free structured data makes recipe pages eligible for recipe rich results and gives Google clearer signals about page content and quality. That supports the quality judgment Google makes when deciding whether to keep a crawled page in the index. The effect is indirect but real for a recipe site.

---

## 6. Build external links and mentions

**Priority:** High (slow-burning, ongoing)

### Evidence of the gap

- Brand searches: **0 impressions** in 28 days, so no one is searching for the site by name yet.
- "vegan recipe generator" averages **position \~112**, despite a well-matched title and on-page content.
- The large share of "Discovered – currently not indexed" URLs is a classic sign of low site authority. Google limits how much it crawls sites with few external signals.

### What to do

- Submit the generator to AI tool directories (for example There's An AI For That, Futurepedia, Toolify) and to Product Hunt.
- Share genuinely useful recipes or the tool in vegan communities where self-promotion is allowed (for example r/vegan and r/PlantBasedDiet, following their rules).
- Reach out to vegan bloggers or newsletters with a specific angle, such as "turn your fridge leftovers into a vegan recipe."
- Point links at specific category or recipe pages where it makes sense, not only the homepage.

### How it affects indexing

External links raise how much crawl attention Google gives the whole site. As authority grows, Google crawls more often and more deeply, and fewer pages stall at "Discovered." This is the step that eventually moves the head term ("vegan recipe generator") off the deep pages of results.

---

## 7. Monitor and re-measure

**Priority:** Ongoing

### Evidence of the gap

- The site update went live about **Sep 28**. Search Console data from Sep 29 onward is still preliminary.
- At 20 impressions per 28 days, week-over-week changes are noise.

### What to do

| When                 | Check                           | Healthy signal                                                                      |
| -------------------- | ------------------------------- | ----------------------------------------------------------------------------------- |
| \~1 week (≈ Oct 7)   | Rerun the index coverage sample | Tag pages show a crawl date; some move to "Indexed"                                 |
| \~2 weeks (≈ Oct 14) | Search Console **Pages** report | "Discovered – not indexed" count falling                                            |
| \~4 weeks (≈ Oct 28) | 28-day weekly report            | Impressions rising; category queries appearing ("vegan high protein recipes", etc.) |
| Ongoing              | Recipes enhancement report      | Errors at 0                                                                         |

### How it affects indexing

Monitoring doesn't change indexing itself, but it shows which steps are working, so you can tell an internal-linking problem (tag pages still uncrawled) from a quality problem (crawled but not indexed) and adjust the next round of work.

---

## Summary order of operations

1. **Homepage links to tags and featured recipes** — deploy first
2. **Request indexing** for the top tag pages — right after step 1 deploys
3. **Recipe → tag links** — deploy with or shortly after step 1
4. **Fix the brand name in schema** — quick win, bundle with step 1
5. **Complete the Recipe schema** — next deploy
6. **External links** — start now, continue ongoing
7. **Re-measure** at 1, 2, and 4 weeks
