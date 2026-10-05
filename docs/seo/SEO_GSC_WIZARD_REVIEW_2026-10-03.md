> From: https://chatgpt.com/c/6ac1495d-2890-83e8-971d-074f167a626d

# you asked

@GSC Wizard tell me how the recent updates to tasteslikegood.org have improved how google search sees the site and what still needs done to optimize search essentials and more

---

# chatgpt response

I’ll check GSC Wizard’s available tools, then compare recent search performance and indexing signals to identify improvements and the remaining priorities for tasteslikegood.org.

tasteslikegood.org is verified and accessible in GSC Wizard. I’m checking Google’s recorded performance alongside the current pages; that will show which gains are measurable and which still need evidence from a before-and-after comparison.

The current technical audit looks good: all eight sampled pages are indexable, with canonical URLs, crawlable links, and structured data. Search visibility hasn’t increased in the comparison period, though, and the numbers are very small. I’m checking Google’s indexing records for a few recipes to see whether their missing impressions reflect an indexing problem.

Google confirms that all five URLs I inspected are indexed, including two recipes that had no recent impressions. It also recorded a recipe rich result. I found an explicit robots.txt rule allowing recipe images, which supports image discovery. Two audit warnings need correction: the homepage description is present and complete, and Google doesn’t require an Organization logo.

Alli, **tasteslikegood.org has a solid foundation for Google to understand and index it—but increased search visibility hasn’t shown up yet.** I checked live Search Console data through GSC Wizard, audited eight pages, and inspected five URLs directly with Google.

Without the deployment dates or an earlier technical audit, I can confirm the current benefits, but can’t attribute every one to the recent updates.

**What’s working**

| Finding                                                               | What it means                                                                            |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| All eight sampled pages return HTTP 200 and are indexable             | No obvious technical indexing blockers in this sample                                    |
| All five inspected URLs are indexed                                   | Google has accepted the homepage, a browse page, and three recipes                       |
| Recipe pages include `Recipe`, `HowToStep`, and breadcrumb markup     | Google receives explicit information about ingredients, instructions, and site structure |
| Google recorded **one recipe rich-result impression**                 | Recipe markup is producing an enhanced search appearance, although at tiny volume        |
| Browse pages have crawlable recipe links and their own canonical URLs | Google can discover recipes through pagination; this matches Google’s guidance           |
| robots.txt explicitly allows recipe image endpoints                   | The broader `/api/` block no longer blocks those image URLs                              |

Recipe structured data helps Google understand recipes and makes them eligible for enhanced results. Your pagination approach also follows Google’s recommended canonical handling. ([developers.google.com](https://developers.google.com/search/docs/appearance/structured-data/recipe?utm_source=chatgpt.com), [developers.google.com](https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading?utm_source=chatgpt.com))
**What the performance numbers say**

These are two complete, comparable 28-day periods:

| Metric             | Aug 5–Sep 1 | Sep 2–29 |                  Change |
| ------------------ | ----------: | -------: | ----------------------: |
| Search impressions |         103 |       20 |                    −81% |
| Clicks             |           5 |        2 |                    −60% |
| Click-through rate |       4.85% |      10% | +5.15 percentage points |
| Average position*  |       41.39 |    51.85 |          Worse by 10.46 |

_Lower position is better._

The higher click-through rate is encouraging, but **two clicks aren’t enough to establish an improvement**. Overall exposure fell. This doesn’t prove the updates hurt the site either: traffic is sparse, query mix changes, and some inspected recipes were last crawled in August.

Importantly, **missing impressions do not mean a page was removed from Google**. Both the banh mi and wild plum syrup pages remain indexed despite having no impressions in the initial recent-period comparison.

**What still needs doing, in priority order**

1. **Verify Google has seen the updated templates.**  
   Compare deployment dates with URL Inspection’s last-crawl dates. For materially updated pages Google hasn’t revisited, use Search Console’s live test and request indexing for a small representative set. The sitemap is healthy—113 submitted URLs, zero errors or warnings, fetched October 3—but that doesn’t establish that every page has been recrawled.

2. **Strengthen a focused set of recipes with original evidence.**  
   Start with roughly 10–15 recipes: test them, add actual cooking photos, useful substitutions, texture cues, troubleshooting, and clear authorship. Explain which recipes are AI-generated and which have been tested. Google emphasizes accuracy, review, and added value for AI content. ([developers.google.com](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content?utm_source=chatgpt.com))
3. **Build on the existing browse and category structure.**  
   Review category pages such as vegan dinners and breakfasts for useful introductions and links to the strongest recipes. Add relevant links between recipes. My recommendation is to prioritize specific cooking needs over relying entirely on the broad “vegan recipe generator” query, whose reported average position was about 112.

4. **Finish recipe image and rich-result checks.**  
   Test representative pages with Google’s Rich Results Test. Verify image endpoints return usable images without login, and consider high-resolution 1:1, 4:3, and 16:9 versions. Keep structured data consistent with the visible recipe; add ratings only when they are real. Google specifically recommends crawlable recipe images and those aspect ratios. ([developers.google.com](https://developers.google.com/search/docs/appearance/structured-data/recipe?utm_source=chatgpt.com))
5. **Measure mobile experience and useful outcomes.**  
   Core Web Vitals couldn’t be assessed because GSC Wizard’s CrUX integration isn’t configured. GA4 also isn’t linked there. Check mobile performance with PageSpeed Insights, then connect analytics to measure whether search visitors generate, save, or browse recipes.

6. **Create a reliable update baseline.**  
   Record release dates and changed URLs, then monitor indexed status, recipe rich results, and impressions for those pages over the following weeks. That will make the next comparison much more meaningful.

Two apparent problems **don’t need urgent fixes**: GSC Wizard incorrectly reported a 13-character homepage description; the live HTML contains a complete description. Its “required Organization logo” warning also overstates Google’s rules—adding a logo is useful, but Google lists no required Organization properties. ([developers.google.com](https://developers.google.com/search/docs/appearance/structured-data/organization?utm_source=chatgpt.com))
For “Search Essentials and more,” the biggest remaining opportunity is **stronger, distinctive recipe content plus confirmation that Google has recrawled the updates**. Technical eligibility alone doesn’t guarantee indexing or rankings, and Google says AI Overviews and AI Mode require no special extra schema or AI text files. ([developers.google.com](https://developers.google.com/search/docs/essentials?utm_source=chatgpt.com), [developers.google.com](https://developers.google.com/search/docs/appearance/ai-features?utm_source=chatgpt.com))
