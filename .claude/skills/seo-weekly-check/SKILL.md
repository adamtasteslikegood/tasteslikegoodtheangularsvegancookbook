---
name: seo-weekly-check
description: Weekly Google Search Console read-out for tasteslikegood.org. Use when the user says "Run SEO Weekly Check", "how is search doing", asks about impressions/clicks/rankings/indexing, or wants to know whether a recipe or the home page is indexed. Requires the gcp-monitor MCP server (scripts/monitoring/) with the gsc_* tools and a service account that has been added as a user on the Search Console property.
---

# SEO Weekly Check Routine

You are reading Google Search Console for the Vegangenius Chef / TastesLikeGood
site (`sc-domain:tasteslikegood.org`). The site ships no client-side analytics
by design, so Search Console is the only instrument for organic search. Execute
this routine step by step without pausing for confirmation.

## Steps

1. **Pull the report.** Call `gsc_weekly_report` (default 28-day window). If
   it returns "Search Console unavailable", stop and relay the instruction it
   contains verbatim — it names the exact service-account email to add under
   Search Console → Settings → Users and permissions. Do not try to work
   around missing access.
2. **Sanity-check the property.** On the first run after a deploy, or whenever
   the report shows zero impressions, call `gsc_sites` and confirm the
   configured property is listed. A missing property is an access problem,
   not a traffic problem.
3. **Drill into anything flagged.** For each ⚠️ line:
   - traffic drop → `gsc_compare_periods` for the movers, then
     `gsc_search_performance` with `dimension: "page"` to see which URLs lost
     impressions;
   - sitemap stale/errors → `gsc_sitemaps`, then
     `gsc_index_coverage_sample` (newest 10) to see whether new recipes are
     being indexed;
   - a single page in question → `gsc_inspect_url` with its path.
4. **Find the cheap wins.** Read the striking-distance table (queries at
   position 5–30 with real impressions). For each one, name the page Google
   shows and the smallest on-page change that fits the query: title,
   opening paragraph, an internal link from `/browse` or a related recipe,
   or a new hub page if several queries share a theme. Cross-reference the
   keyword targets in `docs/seo/SEO_AUDIT_2026-09-13.md`.
5. **Report.** Produce a short structured read-out:
   - **Headline** — one line: clicks and impressions vs the previous window,
     and whether "vegan recipe generator"-family queries are appearing.
   - **Brand vs non-brand** — is anyone finding the site who was not
     already looking for it?
   - **Indexing** — sitemap read date and URL count vs the live sitemap;
     coverage sample result if run.
   - **Striking distance → actions** — at most five, each with the page and
     the change.
   - **Flags** — the ⚠️ lines and what was done about each.

## Notes

- Search Analytics lags about two days; the tools end their windows yesterday
  and mark the last two days preliminary. Do not read a "drop" in the final
  two days as real.
- Early on, most windows will show single-digit clicks. That is expected for
  a site first seen by Google in August 2026; the signal to watch is
  impressions and average position on non-brand queries, not clicks.
- URL Inspection has a 2,000/day quota per property; `gsc_index_coverage_sample`
  is capped at 25 URLs per call for that reason.
- Tool output is plain text, not raw JSON. Quote the numbers as printed.
- If asked to set this up as a routine: schedule it weekly (Monday morning
  works — Google has finalized the previous week by then) against the hosted
  connector, the same way `/system-health-check` runs.
