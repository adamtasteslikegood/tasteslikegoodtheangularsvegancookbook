# SEO Audit: www.tasteslikegood.org

## Executive summary

- The site has a solid crawlable foundation: all 119 sitemap URLs fetched successfully, with no duplicate titles or missing meta descriptions found in the crawl.
- The homepage checker scored 92/100. Its only flagged issue is a 143-character meta description.
- Recipe pages expose Recipe structured data, and the sitemap includes 104 recipe URLs.
- Real-user Core Web Vitals and Search Console indexation could not be verified. PageSpeed Insights returned HTTP 429, so performance scores remain unverified.

## Technical SEO findings

| Issue                                            | Impact             | Evidence                                                                                         | Recommendation                                                                                                                                           | Priority |
| ------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Search performance and indexation are unverified | Medium             | No Search Console data was available; PageSpeed Insights returned HTTP 429                       | Check Search Console’s indexing, sitemap, and Core Web Vitals reports. Retry PageSpeed Insights later or use Lighthouse/WebPageTest for lab diagnostics. | High     |
| `/assets/` is disallowed in robots.txt           | Potentially medium | robots.txt blocks `/assets/`; homepage bundles observed were root-relative, not under `/assets/` | Confirm important pages don’t load rendering-critical CSS or JavaScript from `/assets/`. If they do, allow those resources so crawlers can render pages. | Medium   |

## On-page and content findings

| Issue                                                                | Impact | Evidence                                                                                      | Recommendation                                                                                                                                                   | Priority |
| -------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Homepage meta description is shorter than the checker’s target       | Low    | Checker reports 143 characters against a 150–160-character target                             | Optionally add a concise benefit or call to action while keeping the description accurate. Google may rewrite snippets, so treat the length target as guidance.  | Low      |
| Homepage content depth may limit coverage of broader recipe searches | Medium | Homepage has 378 words and focuses on the recipe generator; the site also has 104 recipe URLs | Ensure each recipe page provides useful, distinct cooking details—not just generated descriptions—and link relevant recipes to browse categories and each other. | Medium   |

## Strengths verified

- Sitemap and robots.txt are accessible; robots.txt references the sitemap.
- All 119 sitemap URLs returned successfully in the crawl.
- No duplicate page titles or missing meta descriptions were found in that crawl.
- Homepage has one H1, a logical heading hierarchy, a canonical URL, and FAQ/WebApplication/WebSite structured data.
- Recipe pages include Recipe structured data; browse categories include CollectionPage data.

## Prioritized action plan

1. Check Search Console for indexing errors, sitemap processing, and page-level exclusions.
2. Verify whether any important page depends on resources under `/assets/`; adjust robots.txt only if those resources need to be crawled.
3. Review recipe pages for distinct, complete cooking instructions and internal links between related recipes.
4. Optionally expand the homepage meta description; it is a minor optimization, not a blocking issue.

## Scope and limitations

This was a public-site crawl, not a full audit. Search Console coverage, backlink authority, and field Core Web Vitals could not be assessed. PageSpeed Insights returned HTTP 429 during the audit.
