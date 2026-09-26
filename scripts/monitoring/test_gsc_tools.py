"""Unit tests for the pure logic in gsc_tools.py (KAN-270).

Run:  python3 -m unittest scripts/monitoring/test_gsc_tools.py
No network, no credentials: the API layer is exercised through a fake session
so the tool text can be asserted end to end.
"""

import base64
import datetime as dt
import json
import os
import sys
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import gsc_tools as g  # noqa: E402

REAL_FETCH_LIVE_SITEMAP_DETAIL = g.fetch_live_sitemap_detail


def row(keys, clicks, impressions, position):
    return {
        "keys": list(keys),
        "clicks": clicks,
        "impressions": impressions,
        "ctr": (clicks / impressions) if impressions else 0,
        "position": position,
    }


class LauncherBootstrapTest(unittest.TestCase):
    def test_dependency_stamp_tracks_requirements_hash(self):
        launcher = Path(__file__).with_name("run_gcp_monitor.sh").read_text(encoding="utf-8")
        self.assertIn('requirements_hash="$(python3 - "$requirements"', launcher)
        self.assertIn('"$installed_hash" != "$requirements_hash"', launcher)
        self.assertIn('printf \'%s\\n\' "$requirements_hash" >"$deps_stamp"', launcher)
        self.assertIn("requirement = Requirement(line)", launcher)
        self.assertIn("Version(version(requirement.name))", launcher)
        self.assertIn("installed not in requirement.specifier", launcher)

    def test_embedded_credentials_defer_to_usable_file(self):
        encoded = base64.b64encode(json.dumps({"client_email": "b64@example.test"}).encode()).decode()
        with mock.patch.object(g.os.path, "isfile", return_value=True):
            self.assertIsNone(g.decode_embedded_credentials(encoded, "/tmp/key.json"))
        with mock.patch.object(g.os.path, "isfile", return_value=False):
            self.assertEqual(
                g.decode_embedded_credentials(encoded, "/tmp/missing.json"),
                {"client_email": "b64@example.test"},
            )


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

    def test_window_is_capped_to_retained_comparison_history(self):
        cs, ce, ps, pe = g.period_windows(10**12, today=dt.date(2026, 9, 13))
        cur_len = (dt.date.fromisoformat(ce) - dt.date.fromisoformat(cs)).days + 1
        prev_len = (dt.date.fromisoformat(pe) - dt.date.fromisoformat(ps)).days + 1
        self.assertEqual(cur_len, g.MAX_COMPARISON_WINDOW_DAYS)
        self.assertEqual(prev_len, g.MAX_COMPARISON_WINDOW_DAYS)


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
        self.assertEqual(g.clamp_output_limit(0), 1)
        self.assertEqual(g.clamp_output_limit(g.MAX_OUTPUT_ROWS + 1), g.MAX_OUTPUT_ROWS)


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

    def test_movers_ties_have_stable_key_order(self):
        tied = [
            row(["zeta"], 1, 10, 8.0),
            row(["alpha"], 1, 10, 8.0),
        ]
        gainers = g.movers(tied, [], limit=5)["gainers"]
        losers = g.movers([], tied, limit=5)["losers"]
        self.assertEqual([m["key"] for m in gainers], ["alpha", "zeta"])
        self.assertEqual([m["key"] for m in losers], ["alpha", "zeta"])


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

    def test_sitemap_root_requires_namespaced_urlset(self):
        self.assertTrue(g.is_sitemap_urlset(self.SITEMAP))
        self.assertFalse(g.is_sitemap_urlset("<html><body>maintenance</body></html>"))
        self.assertFalse(g.is_sitemap_urlset("<urlset><url /></urlset>"))

    def test_refresh_error_returns_actionable_auth_guidance(self):
        class RefreshError(Exception):
            pass

        google = ModuleType("google")
        google_auth = ModuleType("google.auth")
        google_auth_exceptions = ModuleType("google.auth.exceptions")
        google_auth_exceptions.RefreshError = RefreshError
        google.auth = google_auth
        google_auth.exceptions = google_auth_exceptions

        class RefreshingSession:
            def request(self, method, url, timeout=None, json=None):
                raise RefreshError("expired credential")

        fake_google_modules = {
            "google": google,
            "google.auth": google_auth,
            "google.auth.exceptions": google_auth_exceptions,
        }
        with mock.patch.dict(sys.modules, fake_google_modules):
            client = g.GscClient(
                "sc-domain:tasteslikegood.org",
                session_factory=RefreshingSession,
            )
            with self.assertRaises(g.GscAccessError) as raised:
                client.sites()
        self.assertIn("application-default login", str(raised.exception))
        self.assertIn("Cloud Run", str(raised.exception))

    def test_oldest_sample_prefers_dated_urls_before_unknown_age(self):
        urls = g.parse_sitemap_urls(self.SITEMAP)
        picked = g.select_sitemap_sample(urls, "oldest", 3)
        self.assertEqual(
            picked,
            [
                ("https://www.tasteslikegood.org/r/old", "2026-05-07"),
                ("https://www.tasteslikegood.org/", "2026-09-12"),
                ("https://www.tasteslikegood.org/r/new", "2026-09-13"),
            ],
        )
        self.assertNotIn(("https://www.tasteslikegood.org/r/undated", None), picked)
        self.assertEqual(g.select_sitemap_sample(urls, "oldest", 4)[-1], ("https://www.tasteslikegood.org/r/undated", None))

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

    def test_multiple_sitemaps_only_compare_the_configured_live_sitemap(self):
        sms = [
            {"path": "https://www.tasteslikegood.org/sitemap.xml", "contents": [{"submitted": 98}]},
            {"path": "https://www.tasteslikegood.org/news-sitemap.xml", "contents": [{"submitted": 40}]},
        ]
        flags = g.weekly_flags(
            self.cmp(),
            sms,
            98,
            [{}],
            live_sitemap_url="https://www.tasteslikegood.org/sitemap.xml",
        )
        self.assertFalse(any("count mismatch" in f for f in flags))

    def test_incomplete_striking_sample_does_not_claim_no_queries_exist(self):
        flags = g.weekly_flags(self.cmp(), [], None, [], striking_complete=False)
        self.assertFalse(any("No striking-distance queries yet" in f for f in flags))
        self.assertTrue(any("absence is inconclusive" in f for f in flags))

    def test_failed_striking_request_does_not_claim_row_cap(self):
        flags = g.weekly_flags(
            self.cmp(),
            [],
            None,
            [],
            striking_complete=False,
            striking_failed=True,
        )
        self.assertTrue(any("failed or timed out" in f for f in flags))
        self.assertFalse(any("row cap" in f for f in flags))

    def test_unavailable_sitemap_api_does_not_claim_none_submitted(self):
        flags = g.weekly_flags(
            self.cmp(),
            [],
            98,
            [{}],
            sitemaps_available=False,
        )
        self.assertFalse(any("No sitemap is submitted" in f for f in flags))


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
        self.timeouts = []

    def request(self, method, url, timeout=None, json=None):
        self.calls.append((method, url, json))
        self.timeouts.append(timeout)
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


class PagingSession(FakeSession):
    """Returns exactly MAX_ROWS query rows on the first page and 7 on the second,
    so pagination and its disclosure can be asserted."""

    def request(self, method, url, timeout=None, json=None):
        if url.endswith("/searchAnalytics/query") and (json.get("dimensions") or []) == ["query"]:
            self.calls.append((method, url, json))
            start = int(json.get("startRow", 0))
            if start == 0:
                rows = [row([f"q{i}"], 0, 20, 12.0) for i in range(g.MAX_ROWS)]
            elif start == g.MAX_ROWS:
                rows = [row([f"tail{i}"], 0, 15, 9.0) for i in range(7)]
            else:
                rows = []
            return FakeResponse(200, {"rows": rows})
        return super().request(method, url, timeout=timeout, json=json)


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
        self.addCleanup(setattr, g, "fetch_live_sitemap_detail", REAL_FETCH_LIVE_SITEMAP_DETAIL)
        g.fetch_live_sitemap_detail = lambda base, deadline=None: g.LiveSitemap([("https://www.tasteslikegood.org/r/new", "2026-09-13")] * 98, kind="urlset")  # noqa: E731
        g.register(self.mcp, client=client)

    def test_all_tools_registered(self):
        self.assertEqual(
            sorted(self.mcp.tools),
            ["gsc_compare_periods", "gsc_index_coverage_sample", "gsc_inspect_url", "gsc_search_performance", "gsc_sitemaps", "gsc_sites", "gsc_striking_distance", "gsc_weekly_report"],
        )

    def test_empty_success_response_is_a_protocol_failure(self):
        response = FakeResponse(200, {})
        response.text = ""
        session = mock.Mock()
        session.request.return_value = response
        client = g.GscClient(
            "sc-domain:tasteslikegood.org", session_factory=lambda: session
        )
        with self.assertRaisesRegex(g.GscProtocolError, "empty successful response"):
            client.sites()

    def test_non_json_success_response_is_a_protocol_failure(self):
        response = FakeResponse(200, {})
        response.text = "<html>upstream error</html>"
        session = mock.Mock()
        session.request.return_value = response
        client = g.GscClient(
            "sc-domain:tasteslikegood.org", session_factory=lambda: session
        )
        with self.assertRaisesRegex(g.GscProtocolError, "not valid JSON"):
            client.sites()

    def test_sites_finds_configured_property(self):
        out = self.mcp.tools["gsc_sites"]()
        self.assertIn("found", out)
        self.assertIn("siteRestrictedUser", out)

    def test_sites_missing_configured_property_includes_grant_guidance(self):
        original = self.session.request

        def other_property(method, url, timeout=None, json=None):
            if url.endswith("/sites"):
                return FakeResponse(
                    200,
                    {
                        "siteEntry": [
                            {
                                "siteUrl": "sc-domain:example.org",
                                "permissionLevel": "siteRestrictedUser",
                            }
                        ]
                    },
                )
            return original(method, url, timeout=timeout, json=json)

        self.session.request = other_property
        out = self.mcp.tools["gsc_sites"]()
        self.assertIn("NOT FOUND", out)
        self.assertIn("Users and permissions", out)
        self.assertIn("Verify GSC_SITE_URL", out)

    def test_unknown_adc_principal_does_not_claim_service_account(self):
        client = g.GscClient("sc-domain:tasteslikegood.org")
        self.assertEqual(client.principal, "the active Google credential")
        guidance = g.property_access_instruction(client.principal)
        self.assertIn("gcloud auth list", guidance)
        self.assertNotIn("Add that email", guidance)

    def test_weekly_report_shape(self):
        out = self.mcp.tools["gsc_weekly_report"](28)
        for needle in ["Totals:", "clicks 12", "▲ +4 (+50%)", "(over 3 query rows)", "brand: 6 clicks", "non-brand: 6 clicks", "Top queries:", "vegan recipe generator", "Striking distance", "rows scanned", "/r/crispy-vegan-corn-dogs-on-a-stick", "Sitemaps:", "submitted URLs 98 (live sitemap: 98)", "Flags:", "  none"]:
            self.assertIn(needle, out, needle)
        bounded = [timeout for timeout in self.session.timeouts if timeout is not None]
        self.assertTrue(bounded)
        self.assertLessEqual(max(bounded), g.SEARCH_ANALYTICS_REQUEST_TIMEOUT_SECONDS)

    def test_compare_periods_end_to_end(self):
        out = self.mcp.tools["gsc_compare_periods"](28, 2)
        self.assertIn("Period comparison", out)
        self.assertIn("clicks 12 ▲ +4 (+50%)", out)
        self.assertIn("Previous window", out)
        self.assertIn("Gainers:", out)
        self.assertIn("Losers:", out)

        calls = [
            body
            for method, url, body in self.session.calls
            if method == "POST" and url.endswith("/searchAnalytics/query")
        ]
        current_start, _current_end, previous_start, _previous_end = g.period_windows(28)
        self.assertEqual(
            [body["startDate"] for body in calls],
            [current_start, previous_start, current_start, previous_start],
        )
        self.assertEqual(
            [body.get("dimensions") or [] for body in calls],
            [[], [], ["query"], ["query"]],
        )
        self.assertEqual([body["rowLimit"] for body in calls], [1, 1, g.MAX_ROWS, g.MAX_ROWS])

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

    def test_striking_distance_discloses_scanned_rows_and_no_truncation_on_small_sites(self):
        out = self.mcp.tools["gsc_striking_distance"]()
        self.assertIn("of 2 query/page rows qualify", out)
        self.assertNotIn("Sample truncated", out)

    def test_inspect_resolves_relative_path(self):
        out = self.mcp.tools["gsc_inspect_url"]("/r/vegan-cornbread")
        self.assertIn("https://www.tasteslikegood.org/r/vegan-cornbread", out)
        self.assertIn("Recipes", out)

    def test_inspect_resolves_relative_path_without_leading_slash(self):
        out = self.mcp.tools["gsc_inspect_url"]("r/vegan-cornbread")
        self.assertIn("https://www.tasteslikegood.org/r/vegan-cornbread", out)
        self.assertIn("Recipes", out)

    def test_coverage_sample_is_capped(self):
        self.mcp.tools["gsc_index_coverage_sample"](500)
        inspections = [c for c in self.session.calls if c[1] == g.INSPECTION_API]
        self.assertEqual(len(inspections), g.MAX_INSPECTIONS_PER_CALL)

    def test_coverage_sample_uses_bounded_request_timeout(self):
        timeouts = []
        original = self.session.request

        def recording_request(method, url, timeout=None, json=None):
            if url == g.INSPECTION_API:
                timeouts.append(timeout)
            return original(method, url, timeout=timeout, json=json)

        self.session.request = recording_request
        self.mcp.tools["gsc_index_coverage_sample"](1)
        self.assertEqual(timeouts, [g.INSPECTION_REQUEST_TIMEOUT_SECONDS])

    def test_coverage_sample_discloses_partial_failures(self):
        original = self.session.request
        inspection_count = 0

        def flaky_request(method, url, timeout=None, json=None):
            nonlocal inspection_count
            if url == g.INSPECTION_API:
                inspection_count += 1
                if inspection_count == 2:
                    raise TimeoutError("inspection timed out")
            return original(method, url, timeout=timeout, json=json)

        self.session.request = flaky_request
        g.fetch_live_sitemap_detail = lambda base, deadline=None: g.LiveSitemap([
            (f"{base}/r/{index}", f"2026-09-{13 - index:02d}")
            for index in range(3)
        ], kind="urlset")
        out = self.mcp.tools["gsc_index_coverage_sample"](3)
        self.assertIn("processed 2/3", out)
        self.assertIn("Partial sample: 1 URL(s)", out)
        self.assertIn("TimeoutError: inspection timed out", out)

    def test_coverage_sample_rejects_bad_selection(self):
        out = self.mcp.tools["gsc_index_coverage_sample"](10, "oldset")
        self.assertIn("which must be one of", out)

    def test_sitemaps_tool_handles_nonempty_result(self):
        out = self.mcp.tools["gsc_sitemaps"]()
        self.assertIn("submitted URLs 98", out)
        self.assertNotIn("Search Console tool failed", out)

    def test_sitemaps_tool_never_evaluates_analytics_flags(self):
        with mock.patch.object(g, "weekly_flags", wraps=g.weekly_flags) as flags:
            out = self.mcp.tools["gsc_sitemaps"]()
        self.assertIn("submitted URLs 98", out)
        self.assertEqual(flags.call_count, 1)
        self.assertIs(flags.call_args.kwargs["analytics_available"], False)
        self.assertEqual(flags.call_args.args[0], {}, "no placeholder comparison for a future analytics check to fire on")

    def test_weekly_report_discloses_the_page_row_cap(self):
        original = self.session.request

        def many_pages(method, url, timeout=None, json=None):
            if url.endswith("/searchAnalytics/query") and (json.get("dimensions") or []) == ["page"]:
                self.assertEqual(json["rowLimit"], g.WEEKLY_PAGE_ROW_LIMIT)
                rows = [row([f"https://www.tasteslikegood.org/r/p{i}"], 1000 - i, 5000, 9.0) for i in range(g.WEEKLY_PAGE_ROW_LIMIT)]
                return FakeResponse(200, {"rows": rows})
            return original(method, url, timeout=timeout, json=json)

        self.session.request = many_pages
        out = self.mcp.tools["gsc_weekly_report"](28)
        self.assertIn(
            f"Top pages: Sample truncated at {g.WEEKLY_PAGE_ROW_LIMIT:,} click-ranked page rows — lower-click rows beyond that are not included.",
            out,
        )
        self.assertIn("/r/p0 ", out)
        self.assertNotIn("/r/p10 ", out, "only the top 10 pages are listed")

    def test_weekly_report_has_no_page_cap_note_below_the_cap(self):
        out = self.mcp.tools["gsc_weekly_report"](28)
        self.assertIn("Top pages:\n", out)
        self.assertNotIn("page rows", out)

    def test_weekly_report_surfaces_partial_analytics_and_sitemap_failures(self):
        original = self.session.request

        def flaky_request(method, url, timeout=None, json=None):
            if url.endswith("/searchAnalytics/query") and (json.get("dimensions") or []) == ["page"]:
                raise TimeoutError("pages timed out")
            if url.endswith("/sitemaps"):
                raise TimeoutError("sitemaps timed out")
            return original(method, url, timeout=timeout, json=json)

        self.session.request = flaky_request
        out = self.mcp.tools["gsc_weekly_report"](28)
        self.assertIn("Search Console weekly report", out)
        self.assertIn("Partial report data", out)
        self.assertIn("pages: TimeoutError: pages timed out", out)
        self.assertIn("sitemaps: TimeoutError: sitemaps timed out", out)
        self.assertIn("unavailable (see Flags)", out)
        self.assertNotIn("(none submitted)", out)
        self.assertNotIn("No sitemap is submitted", out)

    def test_weekly_report_surfaces_live_sitemap_failure(self):
        g.fetch_live_sitemap_detail = lambda base, deadline=None: g.LiveSitemap(None, note="HTTP 503")
        out = self.mcp.tools["gsc_weekly_report"](28)
        self.assertIn("live sitemap: unavailable", out)
        self.assertIn("Live sitemap unavailable", out)

    def test_weekly_report_does_not_turn_failed_totals_into_zero_traffic(self):
        original = self.session.request

        def failed_totals(method, url, timeout=None, json=None):
            if url.endswith("/searchAnalytics/query") and not (
                json.get("dimensions") or []
            ):
                raise TimeoutError("totals timed out")
            return original(method, url, timeout=timeout, json=json)

        self.session.request = failed_totals
        out = self.mcp.tools["gsc_weekly_report"](28)
        self.assertIn("Totals:\n  unavailable (see Flags)", out)
        self.assertIn("Partial report data", out)
        self.assertNotIn("Zero impressions in the window", out)
        self.assertNotIn("Clicks down", out)
        self.assertNotIn("Impressions down", out)

    def test_query_all_paginates_with_start_row_and_reports_complete(self):
        session = PagingSession()
        client = g.GscClient("sc-domain:tasteslikegood.org", session_factory=lambda: session)
        rows, complete = client.query_all("2026-08-16", "2026-09-12", ["query"])
        self.assertEqual(len(rows), g.MAX_ROWS + 7)
        self.assertTrue(complete)
        starts = [c[2].get("startRow", 0) for c in session.calls]
        self.assertEqual(starts, [0, g.MAX_ROWS])
        self.assertEqual(rows[-1]["keys"], ["tail6"])

    def test_query_all_flags_truncation_at_max_pages(self):
        session = PagingSession()
        client = g.GscClient("sc-domain:tasteslikegood.org", session_factory=lambda: session)
        rows, complete = client.query_all("2026-08-16", "2026-09-12", ["query"], max_pages=1)
        self.assertEqual(len(rows), g.MAX_ROWS)
        self.assertFalse(complete)
        self.assertIn("Sample truncated at 5,000", g.sample_note(len(rows), complete, "query rows"))
        self.assertEqual(g.sample_note(3, True), "")

    def test_sample_note_distinguishes_transport_failure(self):
        note = g.sample_note(
            5000,
            False,
            "query rows",
            incomplete_due_to_error=True,
        )
        self.assertIn("request failed or timed out", note)
        self.assertNotIn("Sample truncated", note)

    def test_query_all_returns_partial_rows_after_transport_failure(self):
        session = PagingSession()
        original = session.request

        def fail_second_page(method, url, timeout=None, json=None):
            if url.endswith("/searchAnalytics/query") and int(json.get("startRow", 0)) == g.MAX_ROWS:
                raise TimeoutError("analytics page timed out")
            return original(method, url, timeout=timeout, json=json)

        session.request = fail_second_page
        client = g.GscClient("sc-domain:tasteslikegood.org", session_factory=lambda: session)
        errors = []
        rows, complete = client.query_all(
            "2026-08-16",
            "2026-09-12",
            ["query"],
            partial_errors=errors,
        )
        self.assertEqual(len(rows), g.MAX_ROWS)
        self.assertFalse(complete)
        self.assertEqual(errors, ["page 2: TimeoutError: analytics page timed out"])

    def test_weekly_report_discloses_row_population_for_brand_split(self):
        out = self.mcp.tools["gsc_weekly_report"](28)
        self.assertIn("(over 3 query rows)", out)
        self.assertNotIn("Sample truncated", out)
        self.assertIn("rows scanned", out)

    def test_striking_distance_counts_all_qualifying_rows_before_limit(self):
        out = self.mcp.tools["gsc_striking_distance"](28, 10, 5.0, 30.0, 1)
        self.assertIn("2 of 2 query/page rows qualify; showing 1.", out)

    def test_denied_access_returns_instruction_not_traceback(self):
        mcp = Collector()
        client = g.GscClient("sc-domain:tasteslikegood.org", sa_info={"client_email": "gcp-monitor-mcp@p.iam.gserviceaccount.com"}, session_factory=lambda: FakeSession(deny=True))
        g.register(mcp, client=client)
        out = mcp.tools["gsc_weekly_report"]()
        self.assertTrue(out.startswith("Search Console unavailable"))
        self.assertIn("gcp-monitor-mcp@p.iam.gserviceaccount.com", out)
        self.assertIn("Users and permissions", out)


URLSET_XML = (
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    "<url><loc>https://www.tasteslikegood.org/r/a</loc><lastmod>2026-09-01</lastmod></url>"
    "<url><loc>https://www.tasteslikegood.org/r/b</loc><lastmod>2026-09-20</lastmod></url>"
    "</urlset>"
)
INDEX_XML = (
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    "<sitemap><loc>https://www.tasteslikegood.org/sitemap-recipes.xml</loc></sitemap>"
    "<sitemap><loc>https://www.tasteslikegood.org/sitemap-tags.xml</loc></sitemap>"
    "</sitemapindex>"
)
CHILD_XML = (
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    "<url><loc>https://www.tasteslikegood.org/tag/soup</loc><lastmod>2026-09-24</lastmod></url>"
    "</urlset>"
)


class FakeHttpResponse:
    """Enough of ``requests.Response`` for streamed, bounded reads."""

    def __init__(self, status, text, headers=None):
        self.status_code = status
        self.text = text
        self.headers = headers or {}
        self.bytes_read = 0
        self.closed = False

    def iter_content(self, chunk_size=1):
        data = self.text.encode("utf-8")
        for i in range(0, len(data), chunk_size):
            chunk = data[i : i + chunk_size]
            self.bytes_read += len(chunk)
            yield chunk

    def close(self):
        self.closed = True


def fake_requests(pages):
    """A stand-in ``requests`` module: ``pages`` maps URL -> (status, body)."""
    mod = ModuleType("requests")
    mod.calls = []
    mod.redirect_flags = []
    mod.stream_flags = []
    mod.responses = []

    def get(url, timeout=None, headers=None, allow_redirects=True, stream=False):
        mod.calls.append((url, timeout))
        mod.redirect_flags.append(allow_redirects)
        mod.stream_flags.append(stream)
        entry = pages.get(url, (404, ""))
        resp = FakeHttpResponse(*entry)
        mod.responses.append(resp)
        return resp

    mod.get = get
    return mod


class SitemapIndexTest(unittest.TestCase):
    ROOT = "https://www.tasteslikegood.org/sitemap.xml"

    def test_index_detection_and_child_parsing(self):
        self.assertTrue(g.is_sitemap_index(INDEX_XML))
        self.assertFalse(g.is_sitemap_index(URLSET_XML))
        self.assertFalse(g.is_sitemap_urlset(INDEX_XML))
        self.assertEqual(
            g.parse_sitemap_index(INDEX_XML),
            ["https://www.tasteslikegood.org/sitemap-recipes.xml", "https://www.tasteslikegood.org/sitemap-tags.xml"],
        )
        self.assertEqual(g.parse_sitemap_index("<html/>"), [])
        self.assertEqual(g.parse_sitemap_index("not xml"), [])

    def fetch(self, pages):
        with mock.patch.dict(sys.modules, {"requests": fake_requests(pages)}):
            return g.fetch_live_sitemap_detail("https://www.tasteslikegood.org")

    def test_plain_urlset_is_unchanged(self):
        result = self.fetch({self.ROOT: (200, URLSET_XML)})
        self.assertEqual(result.kind, "urlset")
        self.assertEqual([u for u, _ in result.urls], ["https://www.tasteslikegood.org/r/b", "https://www.tasteslikegood.org/r/a"])
        with mock.patch.dict(sys.modules, {"requests": fake_requests({self.ROOT: (200, URLSET_XML)})}):
            self.assertEqual(g.fetch_live_sitemap("https://www.tasteslikegood.org"), result.urls)

    def test_index_children_are_aggregated_newest_first(self):
        result = self.fetch(
            {
                self.ROOT: (200, INDEX_XML),
                "https://www.tasteslikegood.org/sitemap-recipes.xml": (200, URLSET_XML),
                "https://www.tasteslikegood.org/sitemap-tags.xml": (200, CHILD_XML),
            }
        )
        self.assertEqual(result.kind, "index")
        self.assertEqual(len(result.urls), 3)
        self.assertEqual(result.urls[0], ("https://www.tasteslikegood.org/tag/soup", "2026-09-24"))
        self.assertIn("2 child sitemaps, all fetched", result.note)

    def test_index_with_failing_child_is_unavailable_with_reason(self):
        result = self.fetch(
            {
                self.ROOT: (200, INDEX_XML),
                "https://www.tasteslikegood.org/sitemap-recipes.xml": (200, URLSET_XML),
            }
        )
        self.assertIsNone(result.urls)
        self.assertEqual(result.kind, "index")
        self.assertIn("sitemap-tags.xml did not return HTTP 200", result.note)

    def test_nested_index_is_not_followed(self):
        result = self.fetch(
            {
                self.ROOT: (200, INDEX_XML),
                "https://www.tasteslikegood.org/sitemap-recipes.xml": (200, INDEX_XML),
                "https://www.tasteslikegood.org/sitemap-tags.xml": (200, CHILD_XML),
            }
        )
        self.assertIsNone(result.urls)
        self.assertIn("nested indexes are not followed", result.note)

    def test_oversized_index_is_unavailable_and_says_so(self):
        many = "".join(
            f"<sitemap><loc>https://www.tasteslikegood.org/sitemap-{i}.xml</loc></sitemap>"
            for i in range(g.MAX_SITEMAP_INDEX_CHILDREN + 1)
        )
        xml = f'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{many}</sitemapindex>'
        with mock.patch.dict(sys.modules, {"requests": fake_requests({self.ROOT: (200, xml)})}) as _:
            result = g.fetch_live_sitemap_detail("https://www.tasteslikegood.org")
            self.assertIsNone(result.urls)
            self.assertIn(f"{g.MAX_SITEMAP_INDEX_CHILDREN + 1} child sitemaps", result.note)
            self.assertIn("URL-count comparison skipped", result.note)
            self.assertEqual(len(sys.modules["requests"].calls), 1, "children must not be fetched")

    def test_non_sitemap_document_and_http_error_have_distinct_notes(self):
        html = self.fetch({self.ROOT: (200, "<html><body>maintenance</body></html>")})
        self.assertIsNone(html.urls)
        self.assertIn("not a sitemaps.org urlset or sitemapindex", html.note)
        missing = self.fetch({})
        self.assertIsNone(missing.urls)
        self.assertIn("did not return HTTP 200", missing.note)

    def test_child_fetches_share_the_total_budget(self):
        with mock.patch.object(g, "SITEMAP_FETCH_TOTAL_BUDGET_SECONDS", 5.0):
            result = self.fetch(
                {
                    self.ROOT: (200, INDEX_XML),
                    "https://www.tasteslikegood.org/sitemap-recipes.xml": (200, URLSET_XML),
                    "https://www.tasteslikegood.org/sitemap-tags.xml": (200, CHILD_XML),
                }
            )
        self.assertEqual(len(result.urls), 3)
        with mock.patch.dict(sys.modules, {"requests": fake_requests({self.ROOT: (200, INDEX_XML)})}):
            with mock.patch.object(g, "SITEMAP_FETCH_TOTAL_BUDGET_SECONDS", 0.0):
                exhausted = g.fetch_live_sitemap_detail("https://www.tasteslikegood.org")
        self.assertIsNone(exhausted.urls)
        self.assertIn("within the fetch budget", exhausted.note)

    def test_oversized_root_document_is_rejected_unparsed(self):
        fake = fake_requests({self.ROOT: (200, URLSET_XML)})
        with mock.patch.dict(sys.modules, {"requests": fake}), mock.patch.object(g, "MAX_SITEMAP_BYTES", 64):
            result = g.fetch_live_sitemap_detail("https://www.tasteslikegood.org")
        self.assertIsNone(result.urls)
        self.assertIn("exceeds the 64-byte limit; not parsed", result.note)
        self.assertLessEqual(fake.responses[0].bytes_read, 64 + 64 * 1024, "reading stops at the first chunk past the cap")
        self.assertTrue(fake.responses[0].closed)

    def test_declared_oversized_document_is_rejected_without_reading(self):
        fake = fake_requests({self.ROOT: (200, URLSET_XML, {"Content-Length": str(g.MAX_SITEMAP_BYTES + 1)})})
        with mock.patch.dict(sys.modules, {"requests": fake}):
            result = g.fetch_live_sitemap_detail("https://www.tasteslikegood.org")
        self.assertIsNone(result.urls)
        self.assertIn("over the", result.note)
        self.assertIn("not read", result.note)
        self.assertEqual(fake.responses[0].bytes_read, 0)

    def test_oversized_child_makes_the_index_unavailable(self):
        big_child = (
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            + "".join(f"<url><loc>https://www.tasteslikegood.org/r/x{i}</loc></url>" for i in range(40))
            + "</urlset>"
        )
        cap = len(INDEX_XML.encode("utf-8"))  # the index itself fits exactly; the child does not
        self.assertGreater(len(big_child), cap)
        fake = fake_requests(
            {
                self.ROOT: (200, INDEX_XML),
                "https://www.tasteslikegood.org/sitemap-recipes.xml": (200, big_child),
                "https://www.tasteslikegood.org/sitemap-tags.xml": (200, CHILD_XML),
            }
        )
        with mock.patch.dict(sys.modules, {"requests": fake}), mock.patch.object(g, "MAX_SITEMAP_BYTES", cap):
            result = g.fetch_live_sitemap_detail("https://www.tasteslikegood.org")
        self.assertIsNone(result.urls)
        self.assertEqual(result.kind, "index")
        self.assertIn("child sitemap https://www.tasteslikegood.org/sitemap-recipes.xml exceeds the", result.note)

    def test_sitemap_fetches_are_streamed(self):
        fake = fake_requests({self.ROOT: (200, URLSET_XML)})
        with mock.patch.dict(sys.modules, {"requests": fake}):
            result = g.fetch_live_sitemap_detail("https://www.tasteslikegood.org")
        self.assertEqual(len(result.urls), 2)
        self.assertEqual(fake.stream_flags, [True])
        self.assertTrue(fake.responses[0].closed)

    def test_dtd_and_entity_declarations_are_rejected_before_parsing(self):
        lol = (
            '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">'
            '<!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]>'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            "<url><loc>https://www.tasteslikegood.org/&lol2;</loc></url></urlset>"
        )
        entity_only = (
            '<!ENTITY x "y"><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://a/</loc></url></urlset>'
        )
        for doc in (lol, entity_only, lol.replace("<!DOCTYPE", "<!doctype")):
            self.assertTrue(g.has_dtd(doc))
            self.assertFalse(g.is_sitemap_urlset(doc))
            self.assertFalse(g.is_sitemap_index(doc))
            self.assertEqual(g.parse_sitemap_urls(doc), [])
            self.assertEqual(g.parse_sitemap_index(doc), [])
        self.assertFalse(g.has_dtd(URLSET_XML))
        self.assertFalse(g.has_dtd(INDEX_XML))
        with mock.patch.object(g.ET, "fromstring", side_effect=AssertionError("parser must not run on a DTD document")):
            self.assertFalse(g.is_sitemap_urlset(lol))
            self.assertEqual(g.parse_sitemap_urls(lol), [])

    def test_fetched_document_with_dtd_is_unavailable_with_its_own_note(self):
        lol = '<!DOCTYPE x [<!ENTITY a "a">]>' + URLSET_XML
        fake = fake_requests({self.ROOT: (200, lol)})
        with mock.patch.dict(sys.modules, {"requests": fake}), mock.patch.object(
            g.ET, "fromstring", side_effect=AssertionError("parser must not run on a DTD document")
        ):
            result = g.fetch_live_sitemap_detail("https://www.tasteslikegood.org")
        self.assertIsNone(result.urls)
        self.assertIn("declares a DOCTYPE or ENTITY", result.note)
        child = fake_requests({self.ROOT: (200, INDEX_XML), "https://www.tasteslikegood.org/sitemap-recipes.xml": (200, lol)})
        with mock.patch.dict(sys.modules, {"requests": child}):
            result = g.fetch_live_sitemap_detail("https://www.tasteslikegood.org")
        self.assertIsNone(result.urls)
        self.assertIn("child sitemap https://www.tasteslikegood.org/sitemap-recipes.xml declares a DOCTYPE or ENTITY", result.note)

    def test_child_off_the_configured_origin_is_rejected_without_a_request(self):
        for bad in (
            "https://evil.example/sitemap.xml",
            "http://169.254.169.254/latest/meta-data/",
            "https://www.tasteslikegood.org:8443/sitemap-x.xml",
            "https://user@www.tasteslikegood.org/sitemap-x.xml",
            "file:///etc/passwd",
            "http://www.tasteslikegood.org/sitemap-x.xml",
        ):
            xml = (
                '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                f"<sitemap><loc>{bad}</loc></sitemap>"
                "<sitemap><loc>https://www.tasteslikegood.org/sitemap-recipes.xml</loc></sitemap>"
                "</sitemapindex>"
            )
            fake = fake_requests({self.ROOT: (200, xml), "https://www.tasteslikegood.org/sitemap-recipes.xml": (200, URLSET_XML)})
            with mock.patch.dict(sys.modules, {"requests": fake}):
                result = g.fetch_live_sitemap_detail("https://www.tasteslikegood.org")
            self.assertIsNone(result.urls, bad)
            self.assertIn("is not on https://www.tasteslikegood.org", result.note, bad)
            self.assertEqual([u for u, _ in fake.calls], [self.ROOT], f"no child may be fetched for {bad}")

    def test_same_origin_helper(self):
        base = "https://www.tasteslikegood.org"
        self.assertTrue(g.same_origin("https://www.tasteslikegood.org/a.xml", base))
        self.assertTrue(g.same_origin("HTTPS://WWW.TASTESLIKEGOOD.ORG/a.xml", base))
        self.assertFalse(g.same_origin("https://tasteslikegood.org/a.xml", base))
        self.assertFalse(g.same_origin("//www.tasteslikegood.org/a.xml", base))
        self.assertFalse(g.same_origin("/sitemap-x.xml", base))
        self.assertFalse(g.same_origin("gopher://www.tasteslikegood.org/", base))

    def test_redirects_are_never_followed(self):
        fake = fake_requests(
            {
                self.ROOT: (200, INDEX_XML),
                "https://www.tasteslikegood.org/sitemap-recipes.xml": (302, ""),
                "https://www.tasteslikegood.org/sitemap-tags.xml": (200, CHILD_XML),
            }
        )
        with mock.patch.dict(sys.modules, {"requests": fake}):
            result = g.fetch_live_sitemap_detail("https://www.tasteslikegood.org")
        self.assertIsNone(result.urls)
        self.assertIn("sitemap-recipes.xml did not return HTTP 200", result.note)
        self.assertTrue(fake.redirect_flags, "requests.get must have been called")
        self.assertFalse(any(fake.redirect_flags), "every sitemap fetch must pass allow_redirects=False")

    def test_caller_deadline_caps_the_fetch(self):
        fake = fake_requests({self.ROOT: (200, URLSET_XML)})
        with mock.patch.dict(sys.modules, {"requests": fake}):
            spent = g.fetch_live_sitemap_detail("https://www.tasteslikegood.org", deadline=__import__("time").monotonic())
            self.assertIsNone(spent.urls)
            self.assertIn("within the fetch budget", spent.note)
            self.assertEqual(fake.calls, [], "no request once the caller's deadline has passed")
            fresh = g.fetch_live_sitemap_detail("https://www.tasteslikegood.org", deadline=__import__("time").monotonic() + 5.0)
            self.assertEqual(len(fresh.urls), 2)
            self.assertLessEqual(fake.calls[-1][1], 5.0, "per-request timeout is capped by the caller's remaining time")


    def test_streaming_past_the_deadline_aborts_the_read(self):
        clock = {"now": 1000.0}

        class DrippingResponse(FakeHttpResponse):
            def iter_content(self, chunk_size=1):
                for chunk in super().iter_content(chunk_size):
                    clock["now"] += 30.0  # each chunk arrives just under the per-read timeout
                    yield chunk

        big = (
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            + "".join(f"<url><loc>https://www.tasteslikegood.org/r/x{i}</loc></url>" for i in range(6000))
            + "</urlset>"
        )
        self.assertGreater(len(big.encode()), 3 * 64 * 1024, "the body spans at least four 64 KiB chunks")
        fake = fake_requests({self.ROOT: (200, big)})
        original_get = fake.get

        def get(url, **kwargs):
            resp = original_get(url, **kwargs)
            dripping = DrippingResponse(resp.status_code, resp.text, resp.headers)
            fake.responses[-1] = dripping
            return dripping

        fake.get = get
        with mock.patch.dict(sys.modules, {"requests": fake}), mock.patch.object(g.time, "monotonic", lambda: clock["now"]):
            result = g.fetch_live_sitemap_detail("https://www.tasteslikegood.org", deadline=1000.0 + 50.0)
        self.assertIsNone(result.urls)
        self.assertIn("still streaming when the fetch budget ran out; not parsed", result.note)
        self.assertLessEqual(fake.responses[0].bytes_read, 2 * 64 * 1024, "the read stops at the first chunk past the deadline")
        self.assertTrue(fake.responses[0].closed)

    def test_content_length_with_whitespace_or_sign_is_still_honoured(self):
        for declared in (f" {g.MAX_SITEMAP_BYTES + 1} ", f"+{g.MAX_SITEMAP_BYTES + 1}"):
            fake = fake_requests({self.ROOT: (200, URLSET_XML, {"Content-Length": declared})})
            with mock.patch.dict(sys.modules, {"requests": fake}):
                result = g.fetch_live_sitemap_detail("https://www.tasteslikegood.org")
            self.assertIsNone(result.urls, declared)
            self.assertIn("not read", result.note)
            self.assertEqual(fake.responses[0].bytes_read, 0, declared)
        fake = fake_requests({self.ROOT: (200, URLSET_XML, {"Content-Length": "unknown"})})
        with mock.patch.dict(sys.modules, {"requests": fake}):
            result = g.fetch_live_sitemap_detail("https://www.tasteslikegood.org")
        self.assertEqual(len(result.urls), 2, "an unparseable Content-Length falls through to the bounded read")

    def test_non_xml_content_type_is_named_and_not_read(self):
        self.assertEqual(g.sitemap_media_type_problem(""), "")
        self.assertEqual(g.sitemap_media_type_problem("application/xml; charset=UTF-8"), "")
        self.assertEqual(g.sitemap_media_type_problem("Text/XML"), "")
        self.assertEqual(g.sitemap_media_type_problem("application/atom+xml"), "")
        for content_type in ("text/html; charset=utf-8", "application/json", "application/gzip", "text/plain"):
            self.assertTrue(g.sitemap_media_type_problem(content_type), content_type)
        fake = fake_requests({self.ROOT: (200, "<html><body>maintenance</body></html>", {"Content-Type": "text/html; charset=utf-8"})})
        with mock.patch.dict(sys.modules, {"requests": fake}):
            result = g.fetch_live_sitemap_detail("https://www.tasteslikegood.org")
        self.assertIsNone(result.urls)
        self.assertIn("was served as text/html, not XML; not read", result.note)
        self.assertNotIn("not a sitemaps.org", result.note)
        self.assertEqual(fake.responses[0].bytes_read, 0)
        self.assertTrue(fake.responses[0].closed)
        fake = fake_requests({self.ROOT: (200, URLSET_XML, {"Content-Type": "application/xml; charset=UTF-8"})})
        with mock.patch.dict(sys.modules, {"requests": fake}):
            self.assertEqual(len(g.fetch_live_sitemap_detail("https://www.tasteslikegood.org").urls), 2)


class BoundedToolsTest(unittest.TestCase):
    """The single-purpose tools use the same deadline/partial-error plumbing as the weekly report."""

    def setUp(self):
        self.mcp = Collector()
        self.session = FakeSession()
        client = g.GscClient("sc-domain:tasteslikegood.org", session_factory=lambda: self.session)
        self.addCleanup(setattr, g, "fetch_live_sitemap_detail", REAL_FETCH_LIVE_SITEMAP_DETAIL)
        g.fetch_live_sitemap_detail = lambda base, deadline=None: g.LiveSitemap([("https://www.tasteslikegood.org/r/new", "2026-09-13")] * 98, kind="urlset")  # noqa: E731
        g.register(self.mcp, client=client)

    def fail_dimension(self, dims):
        original = self.session.request

        def flaky(method, url, timeout=None, json=None):
            if url.endswith("/searchAnalytics/query") and (json.get("dimensions") or []) == dims:
                raise TimeoutError("analytics timed out")
            return original(method, url, timeout=timeout, json=json)

        self.session.request = flaky

    def test_striking_distance_returns_partial_disclosure_instead_of_failing(self):
        self.fail_dimension(["query", "page"])
        out = self.mcp.tools["gsc_striking_distance"](28)
        self.assertNotIn("Search Console tool failed", out)
        self.assertIn("⚠️ Partial data: page 1: TimeoutError: analytics timed out", out)
        self.assertIn("request failed or timed out", out)
        self.assertNotIn("Sample truncated", out)

    def test_striking_distance_stops_before_paginating_when_budget_is_spent(self):
        with mock.patch.object(g, "TOOL_TOTAL_BUDGET_SECONDS", 0.0):
            out = self.mcp.tools["gsc_striking_distance"](28)
        self.assertIn("total Search Analytics time budget exhausted", out)
        self.assertFalse(
            any((c[2] or {}).get("dimensions") == ["query", "page"] for c in self.session.calls),
            "no query/page request may be issued once the budget is spent",
        )

    def test_compare_periods_returns_partial_disclosure_instead_of_failing(self):
        self.fail_dimension(["query"])
        out = self.mcp.tools["gsc_compare_periods"](28)
        self.assertNotIn("Search Console tool failed", out)
        self.assertIn("clicks 12", out)
        self.assertIn("⚠️ Partial data: current window: page 1: TimeoutError: analytics timed out; previous window: page 1: TimeoutError: analytics timed out", out)
        self.assertIn("Incomplete current-window query rows", out)
        self.assertIn("Incomplete previous-window query rows", out)

    def test_compare_periods_shares_one_deadline_across_totals_and_pagination(self):
        with mock.patch.object(g, "TOOL_TOTAL_BUDGET_SECONDS", 0.0):
            out = self.mcp.tools["gsc_compare_periods"](28)
        self.assertNotIn("Search Console tool failed", out)
        self.assertIn("current totals: total Search Analytics time budget exhausted", out)
        self.assertIn("totals unavailable (see Partial data)", out)
        self.assertFalse(
            any(c[1].endswith("/searchAnalytics/query") for c in self.session.calls),
            "no analytics request may be issued once the budget is spent",
        )

    def test_compare_periods_keeps_movers_when_a_totals_request_fails(self):
        original = self.session.request

        def failed_totals(method, url, timeout=None, json=None):
            if url.endswith("/searchAnalytics/query") and not (json.get("dimensions") or []):
                raise TimeoutError("totals timed out")
            return original(method, url, timeout=timeout, json=json)

        self.session.request = failed_totals
        out = self.mcp.tools["gsc_compare_periods"](28)
        self.assertNotIn("Search Console tool failed", out)
        self.assertIn("totals unavailable (see Partial data)", out)
        self.assertIn("⚠️ Partial data: current totals: TimeoutError: totals timed out; previous totals: TimeoutError: totals timed out", out)
        self.assertNotIn("clicks 0", out, "a failed aggregate must not render as zero traffic")
        self.assertIn("Gainers:", out)
        self.assertTrue(
            any((c[2] or {}).get("dimensions") == ["query"] for c in self.session.calls),
            "the query-row requests behind the movers must still run after the totals fail",
        )

    def test_sitemaps_tool_bounds_the_api_request(self):
        self.mcp.tools["gsc_sitemaps"]()
        sitemap_calls = [i for i, c in enumerate(self.session.calls) if c[1].endswith("/sitemaps")]
        self.assertEqual(len(sitemap_calls), 1)
        self.assertEqual(self.session.timeouts[sitemap_calls[0]], g.SEARCH_ANALYTICS_REQUEST_TIMEOUT_SECONDS)

    def test_sitemaps_tool_shows_index_note_and_compares_counts(self):
        g.fetch_live_sitemap_detail = lambda base, deadline=None: g.LiveSitemap([("https://www.tasteslikegood.org/r/new", "2026-09-13")] * 98, kind="index", note="sitemap index with 2 child sitemaps, all fetched")  # noqa: E731
        out = self.mcp.tools["gsc_sitemaps"]()
        self.assertIn("98 URLs, newest lastmod 2026-09-13 (sitemap index with 2 child sitemaps, all fetched)", out)
        self.assertNotIn("count mismatch", out)

    def test_sitemaps_tool_distinguishes_oversized_index_from_fetch_failure(self):
        note = "sitemap index lists 14 child sitemaps, more than the 10 this tool fetches; URL-count comparison skipped"
        g.fetch_live_sitemap_detail = lambda base, deadline=None: g.LiveSitemap(None, kind="index", note=note)  # noqa: E731
        out = self.mcp.tools["gsc_sitemaps"]()
        self.assertIn(f"Live https://www.tasteslikegood.org/sitemap.xml: unavailable ({note})", out)
        self.assertIn(f"Live sitemap unavailable ({note}); URL-count comparison was skipped.", out)
        self.assertNotIn("count mismatch", out)

    def test_coverage_sample_reports_why_the_sitemap_was_unusable(self):
        g.fetch_live_sitemap_detail = lambda base, deadline=None: g.LiveSitemap(None, kind="index", note="child sitemap https://www.tasteslikegood.org/sitemap-tags.xml did not return HTTP 200 within the fetch budget")  # noqa: E731
        out = self.mcp.tools["gsc_index_coverage_sample"](5)
        self.assertTrue(out.startswith("Could not fetch or parse"))
        self.assertIn("sitemap-tags.xml did not return HTTP 200", out)

    def test_weekly_report_names_the_live_sitemap_reason(self):
        g.fetch_live_sitemap_detail = lambda base, deadline=None: g.LiveSitemap(None, note="https://www.tasteslikegood.org/sitemap.xml is not a sitemaps.org urlset or sitemapindex")  # noqa: E731
        out = self.mcp.tools["gsc_weekly_report"](28)
        self.assertIn("Live sitemap unavailable (https://www.tasteslikegood.org/sitemap.xml is not a sitemaps.org urlset or sitemapindex)", out)

    def test_coverage_sample_shares_one_deadline_with_the_sitemap_fetch(self):
        seen = []

        def capture(base, deadline=None):
            seen.append(deadline)
            return g.LiveSitemap([("https://www.tasteslikegood.org/r/new", "2026-09-13")] * 3, kind="urlset")

        g.fetch_live_sitemap_detail = capture
        with mock.patch.object(g, "INSPECTION_TOTAL_BUDGET_SECONDS", 0.0):
            out = self.mcp.tools["gsc_index_coverage_sample"](3)
        self.assertEqual(len(seen), 1)
        self.assertIsNotNone(seen[0], "the sitemap fetch must receive the tool deadline")
        self.assertIn("not attempted: total inspection time budget exhausted", out)
        self.assertFalse(any(c[1] == g.INSPECTION_API for c in self.session.calls), "no inspection after the shared budget is spent")

    def test_coverage_sample_has_no_timeout_floor_past_the_deadline(self):
        with mock.patch.object(g, "INSPECTION_TOTAL_BUDGET_SECONDS", 0.05):
            out = self.mcp.tools["gsc_index_coverage_sample"](3)
        self.assertIn("not attempted: total inspection time budget exhausted", out)
        self.assertFalse(any(c[1] == g.INSPECTION_API for c in self.session.calls), "under 0.1 s left must not start an inspection")

    def test_weekly_report_and_sitemaps_tool_pass_their_deadline_to_the_sitemap_fetch(self):
        seen = []

        def capture(base, deadline=None):
            seen.append(deadline)
            return g.LiveSitemap([("https://www.tasteslikegood.org/r/new", "2026-09-13")] * 98, kind="urlset")

        g.fetch_live_sitemap_detail = capture
        monotonic = __import__("time").monotonic
        before = monotonic()
        self.mcp.tools["gsc_weekly_report"](28)
        self.mcp.tools["gsc_sitemaps"]()
        after = monotonic()
        self.assertEqual(len(seen), 2)
        self.assertTrue(all(d is not None for d in seen))
        # Each deadline was set inside its tool, so it must land exactly one
        # budget after some instant between `before` and `after`: this bounds
        # it from both sides and fails for a missing, smaller, or larger budget.
        self.assertGreaterEqual(seen[0], before + g.WEEKLY_REPORT_TOTAL_BUDGET_SECONDS)
        self.assertLessEqual(seen[0], after + g.WEEKLY_REPORT_TOTAL_BUDGET_SECONDS)
        self.assertGreaterEqual(seen[1], before + g.TOOL_TOTAL_BUDGET_SECONDS)
        self.assertLessEqual(seen[1], after + g.TOOL_TOTAL_BUDGET_SECONDS)


class InspectionSummaryTest(unittest.TestCase):
    def test_null_valued_fields_render_as_placeholder_not_none(self):
        partial = {
            "inspectionResultLink": None,
            "indexStatusResult": {
                "verdict": None,
                "coverageState": None,
                "indexingState": None,
                "robotsTxtState": None,
                "pageFetchState": None,
                "lastCrawlTime": None,
                "googleCanonical": None,
                "userCanonical": None,
                "sitemap": None,
                "referringUrls": None,
            },
            "richResultsResult": {"verdict": None, "detectedItems": None},
            "mobileUsabilityResult": {"verdict": None},
        }
        s = g._summarize_inspection("https://www.tasteslikegood.org/r/x", partial)
        self.assertEqual(s["verdict"], "UNKNOWN")
        for key in ("coverage", "indexing", "robots", "fetch", "last_crawl", "google_canonical", "user_canonical", "rich_results", "mobile"):
            self.assertEqual(s[key], "—", key)
        self.assertEqual(s["link"], "")
        self.assertFalse(s["in_sitemap"])
        self.assertEqual(s["referring_urls"], 0)
        self.assertNotIn("None", " ".join(str(v) for v in s.values()))

    def test_absent_fields_still_render_as_placeholder(self):
        s = g._summarize_inspection("https://www.tasteslikegood.org/r/x", {})
        self.assertEqual(s["verdict"], "UNKNOWN")
        self.assertEqual(s["coverage"], "—")
        self.assertEqual(s["last_crawl"], "—")


if __name__ == "__main__":
    unittest.main()
