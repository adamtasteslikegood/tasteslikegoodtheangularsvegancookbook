"""Unit tests for the pure logic in gsc_tools.py (KAN-270).

Run:  python3 -m unittest scripts/monitoring/test_gsc_tools.py
No network, no credentials: the API layer is exercised through a fake session
so the tool text can be asserted end to end.
"""

import datetime as dt
import json
import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import gsc_tools as g  # noqa: E402


def row(keys, clicks, impressions, position):
    return {
        "keys": list(keys),
        "clicks": clicks,
        "impressions": impressions,
        "ctr": (clicks / impressions) if impressions else 0,
        "position": position,
    }


class PeriodWindowsTest(unittest.TestCase):
    def test_windows_are_adjacent_and_equal_length(self):
        cs, ce, ps, pe = g.period_windows(28, today=dt.date(2026, 9, 13))
        self.assertEqual((cs, ce), ("2026-08-16", "2026-09-12"))
        self.assertEqual((ps, pe), ("2026-07-19", "2026-08-15"))
        cur_len = (dt.date.fromisoformat(ce) - dt.date.fromisoformat(cs)).days + 1
        prev_len = (dt.date.fromisoformat(pe) - dt.date.fromisoformat(ps)).days + 1
        self.assertEqual(cur_len, 28)
        self.assertEqual(prev_len, 28)

    def test_minimum_one_day(self):
        cs, ce, ps, pe = g.period_windows(0, today=dt.date(2026, 9, 13))
        self.assertEqual(cs, ce)
        self.assertEqual(ps, pe)
        self.assertEqual(pe, "2026-09-11")


class SummaryAndComparisonTest(unittest.TestCase):
    def test_summarize_weights_position_by_impressions(self):
        rows = [row(["a"], 2, 100, 10.0), row(["b"], 0, 300, 30.0)]
        tot = g.summarize_rows(rows)
        self.assertEqual(tot["clicks"], 2)
        self.assertEqual(tot["impressions"], 400)
        self.assertAlmostEqual(tot["ctr"], 0.005)
        self.assertAlmostEqual(tot["position"], 25.0)

    def test_summarize_empty(self):
        self.assertEqual(g.summarize_rows([]), {"clicks": 0, "impressions": 0, "ctr": 0.0, "position": 0.0})

    def test_compare_totals_handles_zero_previous(self):
        cur = g.summarize_rows([row(["a"], 4, 200, 12.0)])
        prev = g.summarize_rows([])
        cmp = g.compare_totals(cur, prev)
        self.assertEqual(cmp["clicks_delta"], 4)
        self.assertIsNone(cmp["clicks_pct"])
        self.assertIsNone(cmp["position_better"])

    def test_compare_totals_position_better_is_positive_when_improved(self):
        cur = g.summarize_rows([row(["a"], 4, 200, 12.0)])
        prev = g.summarize_rows([row(["a"], 2, 100, 20.0)])
        cmp = g.compare_totals(cur, prev)
        self.assertAlmostEqual(cmp["clicks_pct"], 100.0)
        self.assertAlmostEqual(cmp["position_better"], 8.0)

    def test_empty_current_window_has_no_rank_delta(self):
        cur = g.summarize_rows([])
        prev = g.summarize_rows([row(["a"], 2, 100, 20.0)])
        cmp = g.compare_totals(cur, prev)
        self.assertIsNone(cmp["position_better"])
        self.assertIn("comparison unavailable", g.fmt_position_comparison(cmp["position"], cmp["position_better"]))


class StrikingDistanceTest(unittest.TestCase):
    def test_filters_by_position_band_and_impressions(self):
        rows = [
            row(["vegan recipe generator", "/"], 1, 80, 18.4),  # keep
            row(["vegan cornbread", "/r/vegan-cornbread"], 0, 5, 12.0),  # too few impressions
            row(["tasteslikegood", "/"], 6, 40, 1.2),  # already page one
            row(["vegan biscuits and gravy", "/r/x"], 0, 30, 41.0),  # too deep
            row(["vegan corn dogs", "/r/y"], 0, 120, 9.9),  # keep, more impressions
        ]
        sd = g.striking_distance(rows)
        self.assertEqual([r["keys"][0] for r in sd], ["vegan corn dogs", "vegan recipe generator"])

    def test_custom_band(self):
        rows = [row(["q"], 0, 50, 3.0)]
        self.assertEqual(g.striking_distance(rows, position_min=1, position_max=4), rows)


class BrandAndMoversTest(unittest.TestCase):
    def test_brand_split(self):
        rows = [
            row(["tasteslikegood vegan"], 3, 10, 1.0),
            row(["VeganGenius chef"], 1, 4, 2.0),
            row(["vegan recipe generator"], 1, 200, 15.0),
        ]
        split = g.brand_split(rows)
        self.assertEqual(split["brand"]["clicks"], 4)
        self.assertEqual(split["non_brand"]["impressions"], 200)

    def test_movers_rank_by_clicks_then_impressions(self):
        cur = [row(["up"], 5, 50, 8.0), row(["flat"], 1, 10, 9.0), row(["new"], 0, 40, 20.0)]
        prev = [row(["up"], 1, 20, 12.0), row(["flat"], 1, 10, 9.0), row(["gone"], 2, 30, 5.0)]
        mv = g.movers(cur, prev, limit=5)
        self.assertEqual(mv["gainers"][0]["key"], "up")
        self.assertEqual(mv["gainers"][1]["key"], "new")  # impressions-only gain still counts
        self.assertEqual(mv["losers"][0]["key"], "gone")
        self.assertNotIn("flat", [m["key"] for m in mv["gainers"] + mv["losers"]])

    def test_movers_do_not_put_mixed_sign_rows_in_both_buckets(self):
        cur = [row(["clicks-up"], 2, 10, 8.0), row(["clicks-down"], 1, 100, 8.0)]
        prev = [row(["clicks-up"], 1, 100, 8.0), row(["clicks-down"], 2, 10, 8.0)]
        mv = g.movers(cur, prev, limit=5)
        gainers = {m["key"] for m in mv["gainers"]}
        losers = {m["key"] for m in mv["losers"]}
        self.assertIn("clicks-up", gainers)
        self.assertNotIn("clicks-up", losers)
        self.assertIn("clicks-down", losers)
        self.assertNotIn("clicks-down", gainers)


class SitemapAndErrorsTest(unittest.TestCase):
    SITEMAP = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        "<url><loc>https://www.tasteslikegood.org/</loc><lastmod>2026-09-12</lastmod></url>"
        "<url><loc>https://www.tasteslikegood.org/r/old</loc><lastmod>2026-05-07</lastmod></url>"
        "<url><loc>https://www.tasteslikegood.org/r/new</loc><lastmod>2026-09-13</lastmod></url>"
        "<url><loc>https://www.tasteslikegood.org/r/undated</loc></url>"
        "</urlset>"
    )

    def test_parse_sitemap_newest_first(self):
        urls = g.parse_sitemap_urls(self.SITEMAP)
        self.assertEqual([u for u, _ in urls][:2], ["https://www.tasteslikegood.org/r/new", "https://www.tasteslikegood.org/"])
        self.assertEqual(urls[-1], ("https://www.tasteslikegood.org/r/undated", None))

    def test_parse_sitemap_garbage(self):
        self.assertEqual(g.parse_sitemap_urls("<not xml"), [])

    def test_403_names_the_principal_and_the_fix(self):
        msg = g.classify_http_error(403, '{"error": {"message": "User does not have sufficient permission"}}', "sc-domain:tasteslikegood.org", "gcp-monitor-mcp@x.iam.gserviceaccount.com")
        self.assertIn("gcp-monitor-mcp@x.iam.gserviceaccount.com", msg)
        self.assertIn("Users and permissions", msg)
        self.assertIn("searchconsole.googleapis.com", msg)

    def test_403_api_disabled_names_the_project(self):
        body = '{"error": {"code": 403, "message": "Google Search Console API has not been used in project 746675616486 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/searchconsole.googleapis.com/overview?project=746675616486 then retry."}}'
        msg = g.classify_http_error(403, body, "sc-domain:tasteslikegood.org", "sa@p.iam.gserviceaccount.com")
        self.assertIn("not enabled in the project", msg)
        self.assertIn("--project 746675616486", msg)
        self.assertNotIn("Users and permissions", msg)

    def test_403_insufficient_scope_does_not_send_adam_to_the_user_list(self):
        body = '{"error": {"code": 403, "message": "Request had insufficient authentication scopes.", "status": "PERMISSION_DENIED", "details": [{"reason": "ACCESS_TOKEN_SCOPE_INSUFFICIENT"}]}}'
        msg = g.classify_http_error(403, body, "sc-domain:tasteslikegood.org", "sa@p.iam.gserviceaccount.com")
        self.assertIn("webmasters.readonly", msg)
        self.assertIn("will NOT fix this", msg)
        self.assertNotIn("Users and permissions", msg)

    def test_404_explains_property_syntax(self):
        self.assertIn("sc-domain:", g.classify_http_error(404, "", "https://x/", "sa"))

    def test_429_is_quota(self):
        self.assertIn("quota", g.classify_http_error(429, "", "s", "p").lower())


class FlagsTest(unittest.TestCase):
    def cmp(self, **over):
        base = {"impressions": 500, "clicks_pct": 0.0, "impressions_pct": 0.0, "position_better": 0.0}
        base.update(over)
        return base

    def test_no_flags_when_healthy(self):
        sms = [{"path": "https://www.tasteslikegood.org/sitemap.xml", "errors": 0, "warnings": 0, "isPending": False, "contents": [{"submitted": 98}]}]
        flags = g.weekly_flags(self.cmp(), sms, 98, [{}])
        self.assertEqual(flags, [])

    def test_drop_and_stale_sitemap_flagged(self):
        sms = [{"path": "sm", "errors": 1, "warnings": 0, "isPending": False, "contents": [{"submitted": 59}]}]
        flags = g.weekly_flags(self.cmp(clicks_pct=-45.0, position_better=-4.2), sms, 98, [])
        joined = "\n".join(flags)
        self.assertIn("Clicks down 45%", joined)
        self.assertIn("worsened by 4.2", joined)
        self.assertIn("1 error(s)", joined)
        self.assertIn("reports 59 submitted URLs", joined)
        self.assertIn("No striking-distance", joined)

    def test_zero_impressions_and_missing_sitemap(self):
        flags = g.weekly_flags(self.cmp(impressions=0, position_better=None), [], None, [{}])
        self.assertTrue(any("Zero impressions" in f for f in flags))
        self.assertTrue(any("No sitemap" in f for f in flags))
        self.assertFalse(any("position worsened" in f for f in flags))

    def test_zero_submitted_urls_is_compared_with_live_sitemap(self):
        sms = [{"path": "sm", "contents": [{"submitted": 0}]}]
        flags = g.weekly_flags(self.cmp(), sms, 98, [{}])
        self.assertTrue(any("0 submitted URLs" in f for f in flags))


class FakeResponse:
    def __init__(self, status, payload):
        self.status_code = status
        self.text = json.dumps(payload)

    def json(self):
        return json.loads(self.text)


class FakeSession:
    """Answers the endpoints the tools call with canned Search Console shapes."""

    def __init__(self, deny=False):
        self.deny = deny
        self.calls = []

    def request(self, method, url, timeout=None, json=None):
        self.calls.append((method, url, json))
        if self.deny:
            return FakeResponse(403, {"error": {"message": "User does not have sufficient permission for site"}})
        if url.endswith("/sites"):
            return FakeResponse(200, {"siteEntry": [{"siteUrl": "sc-domain:tasteslikegood.org", "permissionLevel": "siteRestrictedUser"}]})
        if url.endswith("/sitemaps"):
            return FakeResponse(200, {"sitemap": [{"path": "https://www.tasteslikegood.org/sitemap.xml", "lastSubmitted": "2026-07-19T00:00:00Z", "lastDownloaded": "2026-09-12T00:00:00Z", "errors": 0, "warnings": 0, "isPending": False, "contents": [{"type": "web", "submitted": 98}]}]})
        if url.endswith("/searchAnalytics/query"):
            dims = json.get("dimensions") or []
            start = json["startDate"]
            if not dims:
                # Compare against the same dynamic boundary the tool uses so
                # this fixture remains valid after the original audit date.
                current_start = g.period_windows(28)[0]
                is_current = start >= current_start
                return FakeResponse(200, {"rows": [{"clicks": 12 if is_current else 8, "impressions": 1200 if is_current else 900, "ctr": 0.01, "position": 30.0}]})
            if dims == ["query"]:
                return FakeResponse(200, {"rows": [row(["vegan recipe generator"], 5, 400, 14.0), row(["tasteslikegood"], 6, 30, 1.1), row(["vegan corn dogs"], 1, 300, 22.0)]})
            if dims == ["page"]:
                return FakeResponse(200, {"rows": [row(["https://www.tasteslikegood.org/"], 9, 500, 12.0), row(["https://www.tasteslikegood.org/r/crispy-vegan-corn-dogs-on-a-stick"], 1, 300, 22.0)]})
            if dims == ["query", "page"]:
                return FakeResponse(200, {"rows": [row(["vegan recipe generator", "https://www.tasteslikegood.org/"], 5, 400, 14.0), row(["vegan corn dogs", "https://www.tasteslikegood.org/r/crispy-vegan-corn-dogs-on-a-stick"], 1, 300, 22.0)]})
            return FakeResponse(200, {"rows": []})
        if url == g.INSPECTION_API:
            return FakeResponse(200, {"inspectionResult": {"inspectionResultLink": "https://search.google.com/x", "indexStatusResult": {"verdict": "PASS", "coverageState": "Submitted and indexed", "indexingState": "INDEXING_ALLOWED", "robotsTxtState": "ALLOWED", "pageFetchState": "SUCCESSFUL", "lastCrawlTime": "2026-09-10T04:12:00Z", "googleCanonical": json["inspectionUrl"], "userCanonical": json["inspectionUrl"], "sitemap": ["https://www.tasteslikegood.org/sitemap.xml"]}, "richResultsResult": {"verdict": "PASS", "detectedItems": [{"richResultType": "Recipes", "items": [{"name": "x", "issues": []}]}]}, "mobileUsabilityResult": {"verdict": "PASS"}}})
        return FakeResponse(404, {})


class Collector:
    def __init__(self):
        self.tools = {}

    def tool(self):
        def deco(fn):
            self.tools[fn.__name__] = fn
            return fn

        return deco


class ToolTextTest(unittest.TestCase):
    def setUp(self):
        self.mcp = Collector()
        self.session = FakeSession()
        client = g.GscClient("sc-domain:tasteslikegood.org", session_factory=lambda: self.session)
        g.fetch_live_sitemap = lambda base: [("https://www.tasteslikegood.org/r/new", "2026-09-13")] * 98  # noqa: E731
        g.register(self.mcp, client=client)

    def test_all_tools_registered(self):
        self.assertEqual(
            sorted(self.mcp.tools),
            ["gsc_compare_periods", "gsc_index_coverage_sample", "gsc_inspect_url", "gsc_search_performance", "gsc_sitemaps", "gsc_sites", "gsc_striking_distance", "gsc_weekly_report"],
        )

    def test_sites_finds_configured_property(self):
        out = self.mcp.tools["gsc_sites"]()
        self.assertIn("found", out)
        self.assertIn("siteRestrictedUser", out)

    def test_weekly_report_shape(self):
        out = self.mcp.tools["gsc_weekly_report"](28)
        for needle in ["Totals:", "clicks 12", "▲ +4 (+50%)", "brand: 6 clicks", "non-brand: 6 clicks", "Top queries:", "vegan recipe generator", "Striking distance", "/r/crispy-vegan-corn-dogs-on-a-stick", "Sitemaps:", "submitted URLs 98 (live sitemap: 98)", "Flags:", "  none"]:
            self.assertIn(needle, out, needle)

    def test_search_performance_rejects_bad_dimension(self):
        self.assertIn("dimension must be one of", self.mcp.tools["gsc_search_performance"](28, "banana"))

    def test_search_performance_filters_are_sent(self):
        self.mcp.tools["gsc_search_performance"](7, "query", 10, "/r/", "vegan")
        body = self.session.calls[-1][2]
        filters = body["dimensionFilterGroups"][0]["filters"]
        self.assertEqual({f["dimension"] for f in filters}, {"page", "query"})
        self.assertEqual(body["dataState"], "all")
        # Google's current schema uses type; searchType is deprecated.
        self.assertEqual(body["type"], "web")
        self.assertNotIn("searchType", body)

    def test_search_performance_rejects_bad_sort(self):
        out = self.mcp.tools["gsc_search_performance"](28, "query", 10, "", "", "clickz")
        self.assertIn("sort_by must be one of", out)

    def test_weekly_totals_omit_dimensions_for_single_aggregate_row(self):
        self.mcp.tools["gsc_weekly_report"](28)
        aggregate_queries = [
            body
            for method, url, body in self.session.calls
            if method == "POST"
            and url.endswith("/searchAnalytics/query")
            and "dimensions" not in body
        ]
        self.assertGreaterEqual(len(aggregate_queries), 2)

    def test_search_performance_expands_and_discloses_non_click_sort(self):
        out = self.mcp.tools["gsc_search_performance"](28, "query", 10, "", "", "impressions")
        body = self.session.calls[-1][2]
        self.assertEqual(body["rowLimit"], g.MAX_ROWS)
        self.assertIn("within the first 5,000 click-ranked API rows", out)

    def test_non_positive_days_note_matches_clamped_window(self):
        out = self.mcp.tools["gsc_search_performance"](0)
        self.assertIn("(1d)", out)

    def test_inspect_resolves_relative_path(self):
        out = self.mcp.tools["gsc_inspect_url"]("/r/vegan-cornbread")
        self.assertIn("https://www.tasteslikegood.org/r/vegan-cornbread", out)
        self.assertIn("Recipes", out)

    def test_coverage_sample_is_capped(self):
        self.mcp.tools["gsc_index_coverage_sample"](500)
        inspections = [c for c in self.session.calls if c[1] == g.INSPECTION_API]
        self.assertEqual(len(inspections), g.MAX_INSPECTIONS_PER_CALL)

    def test_coverage_sample_rejects_bad_selection(self):
        out = self.mcp.tools["gsc_index_coverage_sample"](10, "oldset")
        self.assertIn("which must be one of", out)

    def test_weekly_report_surfaces_live_sitemap_failure(self):
        g.fetch_live_sitemap = lambda base: None
        out = self.mcp.tools["gsc_weekly_report"](28)
        self.assertIn("live sitemap: unavailable", out)
        self.assertIn("Live sitemap unavailable", out)

    def test_denied_access_returns_instruction_not_traceback(self):
        mcp = Collector()
        client = g.GscClient("sc-domain:tasteslikegood.org", sa_info={"client_email": "gcp-monitor-mcp@p.iam.gserviceaccount.com"}, session_factory=lambda: FakeSession(deny=True))
        g.register(mcp, client=client)
        out = mcp.tools["gsc_weekly_report"]()
        self.assertTrue(out.startswith("Search Console unavailable"))
        self.assertIn("gcp-monitor-mcp@p.iam.gserviceaccount.com", out)
        self.assertIn("Users and permissions", out)


if __name__ == "__main__":
    unittest.main()
