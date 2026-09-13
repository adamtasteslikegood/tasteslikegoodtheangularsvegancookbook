#!/usr/bin/env python3
"""Google Search Console tools for the gcp-monitor MCP server (KAN-270).

Registered onto the existing ``FastMCP`` instance in ``gcp_mcp_server.py`` so
the tools show up in the already-registered "GCP - Monitoring for Recipe App"
Claude connector after a redeploy — no second service, secret, or connector.

Why Search Console and not on-site analytics: the site ships no client-side
tracking by design (privacy policy § 10.3, Sprint 10 opt-in telemetry
decision). Search Console is Google's own record of impressions, clicks and
indexing, needs nothing on the page, and is the only instrument that can say
whether the "vegan recipe generator" bet is working.

Tools (all read-only; scope ``webmasters.readonly``):

    gsc_sites                    properties the credential can see (first-run check)
    gsc_search_performance       clicks/impressions/CTR/position by query|page|country|device|date
    gsc_compare_periods          this window vs the previous one, with top movers
    gsc_striking_distance        queries ranking 5–30 with impressions — the fix-next list
    gsc_sitemaps                 sitemap status in GSC vs the live sitemap.xml
    gsc_inspect_url              index status of one URL (URL Inspection API)
    gsc_index_coverage_sample    inspect the newest N sitemap URLs, summarize coverage
    gsc_weekly_report            the routine: totals, brand split, top queries/pages,
                                 striking distance, sitemap status, ⚠️ flags

Configuration (env vars, or the repo-root ``.env`` loaded by the server):

    GSC_SITE_URL        Search Console property. Domain properties use the
                        ``sc-domain:`` form. Default ``sc-domain:tasteslikegood.org``
                        (the property KAN-115 verified the sitemap against).
    GSC_PUBLIC_BASE     Public origin whose sitemap is fetched for cross-checks.
                        Default ``https://www.tasteslikegood.org``.

Access: the credential the server already resolves (service-account key path,
base64 key, or ADC on Cloud Run) must ALSO be added as a user on the property —
Search Console → Settings → Users and permissions → Add user → the service
account email, permission "Restricted". IAM roles do not grant Search Console
access; only that per-property user list does. Until then every tool returns an
instruction naming the exact email to add rather than a stack trace.

Data freshness: Search Analytics finalizes rows ~2 days late. Windows end
yesterday and are queried with ``dataState=all`` so the newest rows appear,
labelled preliminary. Quotas: Search Analytics is generous (1,200 QPM per
site); URL Inspection is 2,000 calls/day per property, so the coverage sample
is capped at ``MAX_INSPECTIONS_PER_CALL``.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import re
import sys
import threading
import urllib.parse
import xml.etree.ElementTree as ET
from typing import Any, Callable, Optional

SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]
WEBMASTERS_API = "https://www.googleapis.com/webmasters/v3"
INSPECTION_API = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"

DEFAULT_SITE_URL = "sc-domain:tasteslikegood.org"
DEFAULT_PUBLIC_BASE = "https://www.tasteslikegood.org"

# Rows newer than this many days are still being finalized by Google.
PRELIMINARY_DAYS = 2
# URL Inspection quota is 2,000/day per property; keep one call bounded.
MAX_INSPECTIONS_PER_CALL = 25
MAX_ROWS = 5000
DIMENSIONS = ("query", "page", "country", "device", "date", "searchAppearance")
BRAND_TERMS = ("tasteslikegood", "tastes like good", "vegangenius", "vegan genius")

# Striking-distance defaults: position 5–30 is where a title/intro/internal-link
# change moves a query onto page one; below 5 impressions the row is noise.
SD_MIN_IMPRESSIONS = 10
SD_POSITION_MIN = 5.0
SD_POSITION_MAX = 30.0


class GscAccessError(RuntimeError):
    """Raised when the API refuses the credential; the message is user-facing."""


# --------------------------------------------------------------------------
# Pure helpers — no I/O, covered by test_gsc_tools.py
# --------------------------------------------------------------------------


def period_windows(
    days: int, today: Optional[dt.date] = None, lag_days: int = 1
) -> tuple[str, str, str, str]:
    """Return (cur_start, cur_end, prev_start, prev_end) as ISO dates.

    The current window ends ``lag_days`` before ``today`` (yesterday by
    default) and the previous window is the same length immediately before it,
    so the two never overlap and always compare like for like.
    """
    days = max(1, int(days))
    today = today or dt.datetime.now(dt.timezone.utc).date()
    cur_end = today - dt.timedelta(days=lag_days)
    cur_start = cur_end - dt.timedelta(days=days - 1)
    prev_end = cur_start - dt.timedelta(days=1)
    prev_start = prev_end - dt.timedelta(days=days - 1)
    return cur_start.isoformat(), cur_end.isoformat(), prev_start.isoformat(), prev_end.isoformat()


def summarize_rows(rows: list[dict]) -> dict[str, float]:
    """Totals over Search Analytics rows; position is impression-weighted."""
    clicks = sum(float(r.get("clicks") or 0) for r in rows)
    impressions = sum(float(r.get("impressions") or 0) for r in rows)
    weighted = sum(float(r.get("position") or 0) * float(r.get("impressions") or 0) for r in rows)
    return {
        "clicks": clicks,
        "impressions": impressions,
        "ctr": (clicks / impressions) if impressions else 0.0,
        "position": (weighted / impressions) if impressions else 0.0,
    }


def compare_totals(cur: dict[str, float], prev: dict[str, float]) -> dict[str, Any]:
    """Deltas between two ``summarize_rows`` results.

    Position is inverted in ``position_better`` so a positive number is good
    in every field of the result.
    """

    def pct(a: float, b: float) -> Optional[float]:
        return ((a - b) / b * 100.0) if b else None

    return {
        "clicks": cur["clicks"],
        "clicks_delta": cur["clicks"] - prev["clicks"],
        "clicks_pct": pct(cur["clicks"], prev["clicks"]),
        "impressions": cur["impressions"],
        "impressions_delta": cur["impressions"] - prev["impressions"],
        "impressions_pct": pct(cur["impressions"], prev["impressions"]),
        "ctr": cur["ctr"],
        "ctr_delta": cur["ctr"] - prev["ctr"],
        "position": cur["position"],
        "position_better": (prev["position"] - cur["position"]) if prev["position"] else 0.0,
    }


def striking_distance(
    rows: list[dict],
    min_impressions: int = SD_MIN_IMPRESSIONS,
    position_min: float = SD_POSITION_MIN,
    position_max: float = SD_POSITION_MAX,
) -> list[dict]:
    """Rows whose average position sits in [position_min, position_max] with
    at least ``min_impressions``, most impressions first."""
    keep = [
        r
        for r in rows
        if float(r.get("impressions") or 0) >= min_impressions
        and position_min <= float(r.get("position") or 0) <= position_max
    ]
    return sorted(keep, key=lambda r: (-float(r.get("impressions") or 0), float(r.get("position") or 0)))


def is_brand_query(query: str, brand_terms: tuple[str, ...] = BRAND_TERMS) -> bool:
    q = (query or "").lower()
    return any(term in q for term in brand_terms)


def brand_split(rows: list[dict], brand_terms: tuple[str, ...] = BRAND_TERMS) -> dict[str, dict[str, float]]:
    """Split query rows into brand / non-brand totals."""
    brand = [r for r in rows if is_brand_query((r.get("keys") or [""])[0], brand_terms)]
    other = [r for r in rows if not is_brand_query((r.get("keys") or [""])[0], brand_terms)]
    return {"brand": summarize_rows(brand), "non_brand": summarize_rows(other)}


def movers(cur_rows: list[dict], prev_rows: list[dict], limit: int = 10) -> dict[str, list[dict]]:
    """Top gainers/losers by clicks delta between two query-dimension result sets."""
    prev_by_key = {tuple(r.get("keys") or []): r for r in prev_rows}
    cur_by_key = {tuple(r.get("keys") or []): r for r in cur_rows}
    deltas = []
    for key in set(prev_by_key) | set(cur_by_key):
        c = cur_by_key.get(key, {})
        p = prev_by_key.get(key, {})
        d_clicks = float(c.get("clicks") or 0) - float(p.get("clicks") or 0)
        d_impr = float(c.get("impressions") or 0) - float(p.get("impressions") or 0)
        deltas.append(
            {
                "key": " / ".join(key) if key else "(total)",
                "clicks": float(c.get("clicks") or 0),
                "clicks_delta": d_clicks,
                "impressions": float(c.get("impressions") or 0),
                "impressions_delta": d_impr,
                "position": float(c.get("position") or 0) if c else None,
            }
        )
    # Sort by clicks delta, then impressions delta so zero-click sites still
    # get a meaningful movers list.
    ranked = sorted(deltas, key=lambda d: (d["clicks_delta"], d["impressions_delta"]))
    losers = [d for d in ranked if d["clicks_delta"] < 0 or d["impressions_delta"] < 0][:limit]
    gainers = [d for d in reversed(ranked) if d["clicks_delta"] > 0 or d["impressions_delta"] > 0][:limit]
    return {"gainers": gainers, "losers": losers}


def parse_sitemap_urls(xml_text: str) -> list[tuple[str, Optional[str]]]:
    """(loc, lastmod) pairs from a sitemaps.org urlset, newest lastmod first."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    out: list[tuple[str, Optional[str]]] = []
    for url in root.findall("sm:url", ns):
        loc = url.findtext("sm:loc", default="", namespaces=ns).strip()
        lastmod = url.findtext("sm:lastmod", default=None, namespaces=ns)
        if loc:
            out.append((loc, lastmod.strip() if lastmod else None))
    return sorted(out, key=lambda t: t[1] or "", reverse=True)


def classify_http_error(status: int, body: str, site_url: str, principal: str) -> str:
    """Turn an API error into the sentence the operator needs."""
    snippet = re.sub(r"\s+", " ", body or "")[:300]
    if status == 403 and ("has not been used in project" in (body or "") or "it is disabled" in (body or "")):
        project = re.search(r"project (\d+)", body or "")
        proj = project.group(1) if project else "<the credential's project>"
        return (
            f"The Search Console API is not enabled in the project that owns {principal} "
            f"(project {proj}). Enable it once — `gcloud services enable searchconsole.googleapis.com "
            f"--project {proj}` or https://console.developers.google.com/apis/api/searchconsole.googleapis.com/overview?project={proj} "
            "— wait a minute, then retry. (deploy_mcp_cloud_run.sh does this for the Cloud Run service's project.) "
            f"Detail: {snippet}"
        )
    if status == 403 and (
        "ACCESS_TOKEN_SCOPE_INSUFFICIENT" in (body or "")
        or "insufficient authentication scopes" in (body or "").lower()
    ):
        return (
            f"The access token for {principal} does not carry the Search Console scope "
            f"({SCOPES[0]}) (HTTP 403 insufficient scopes). Adding a Search Console user "
            "will NOT fix this. Locally: the key is fine, the scope is requested in "
            "gsc_tools.build_credentials — check that code path ran. On Cloud Run: the "
            "metadata server issued a token without the requested scope; redeploy with "
            "the service account's access scopes including the Webmasters API, or run the "
            "hosted server with a key (GOOGLE_APPLICATION_CREDENTIALS_B64) instead of ADC. "
            f"Detail: {snippet}"
        )
    if status == 403:
        return (
            f"Search Console refused access to {site_url} for {principal} (HTTP 403). "
            "Add that email as a user on the property: Search Console → Settings → "
            "Users and permissions → Add user → permission 'Restricted'. IAM roles "
            "do not grant Search Console access. If the email IS listed, confirm the "
            "Search Console API is enabled in the credential's project "
            f"(gcloud services enable searchconsole.googleapis.com). Detail: {snippet}"
        )
    if status == 401:
        return (
            f"Search Console rejected the credential for {principal} (HTTP 401). Check "
            "GOOGLE_APPLICATION_CREDENTIALS / GOOGLE_APPLICATION_CREDENTIALS_B64 in the "
            f"repo-root .env, or ADC on Cloud Run. Detail: {snippet}"
        )
    if status == 404:
        return (
            f"Search Console has no property {site_url} visible to {principal} (HTTP 404). "
            "Domain properties must be written as sc-domain:<domain>; URL-prefix "
            "properties as the full origin with trailing slash. Set GSC_SITE_URL. "
            f"Detail: {snippet}"
        )
    if status == 429:
        return f"Search Console API quota exhausted (HTTP 429) — retry later. Detail: {snippet}"
    return f"Search Console API error HTTP {status}. Detail: {snippet}"


def fmt_int(value: Any) -> str:
    try:
        return f"{int(round(float(value))):,}"
    except (TypeError, ValueError):
        return "—"


def fmt_pct(value: Any, digits: int = 1) -> str:
    try:
        return f"{float(value) * 100:.{digits}f}%"
    except (TypeError, ValueError):
        return "—"


def fmt_delta(value: Optional[float], pct: Optional[float] = None, better_when_positive: bool = True) -> str:
    if value is None:
        return "—"
    arrow = "▲" if value > 0 else ("▼" if value < 0 else "•")
    if not better_when_positive:
        arrow = "▼" if value > 0 else ("▲" if value < 0 else "•")
    sign = "+" if value > 0 else ""
    core = f"{arrow} {sign}{value:,.0f}" if abs(value) >= 10 or value == int(value) else f"{arrow} {sign}{value:.2f}"
    if pct is not None:
        core += f" ({sign}{pct:.0f}%)"
    return core


def format_table(headers: list[str], rows: list[list[str]], max_width: int = 70) -> str:
    """Aligned plain-text table; long cells are truncated with an ellipsis."""
    if not rows:
        return "  (no rows)"
    cells = [[str(c)[: max_width - 1] + "…" if len(str(c)) > max_width else str(c) for c in r] for r in rows]
    widths = [max(len(h), *(len(r[i]) for r in cells)) for i, h in enumerate(headers)]
    line = "  " + "  ".join(h.ljust(widths[i]) for i, h in enumerate(headers))
    sep = "  " + "  ".join("-" * w for w in widths)
    body = ["  " + "  ".join(r[i].ljust(widths[i]) for i in range(len(headers))) for r in cells]
    return "\n".join([line, sep, *body])


def performance_rows_table(rows: list[dict], key_label: str) -> str:
    table = [
        [
            (r.get("keys") or ["(all)"])[0],
            fmt_int(r.get("clicks")),
            fmt_int(r.get("impressions")),
            fmt_pct(r.get("ctr")),
            f"{float(r.get('position') or 0):.1f}",
        ]
        for r in rows
    ]
    return format_table([key_label, "clicks", "impr", "CTR", "pos"], table)


def weekly_flags(
    comparison: dict[str, Any],
    sitemaps: list[dict],
    live_url_count: Optional[int],
    striking: list[dict],
) -> list[str]:
    """⚠️ lines for the weekly report. Pure so the thresholds are testable."""
    flags: list[str] = []
    if comparison["impressions"] == 0:
        flags.append("⚠️ Zero impressions in the window — check the property is verified and the sitemap is read.")
    if comparison["clicks_pct"] is not None and comparison["clicks_pct"] <= -30:
        flags.append(f"⚠️ Clicks down {abs(comparison['clicks_pct']):.0f}% vs the previous window.")
    if comparison["impressions_pct"] is not None and comparison["impressions_pct"] <= -30:
        flags.append(f"⚠️ Impressions down {abs(comparison['impressions_pct']):.0f}% vs the previous window.")
    if comparison["position_better"] <= -3:
        flags.append(f"⚠️ Average position worsened by {abs(comparison['position_better']):.1f}.")
    for sm in sitemaps:
        errors = int(sm.get("errors") or 0)
        warnings = int(sm.get("warnings") or 0)
        if errors:
            flags.append(f"⚠️ Sitemap {sm.get('path')} has {errors} error(s) in Search Console.")
        if warnings:
            flags.append(f"⚠️ Sitemap {sm.get('path')} has {warnings} warning(s) in Search Console.")
        if sm.get("isPending"):
            flags.append(f"⚠️ Sitemap {sm.get('path')} is still pending processing.")
        submitted = sum(int(c.get("submitted") or 0) for c in sm.get("contents") or [])
        if live_url_count is not None and submitted and abs(submitted - live_url_count) > 5:
            flags.append(
                f"⚠️ Search Console last read {submitted} URLs from {sm.get('path')} but the live sitemap has "
                f"{live_url_count} — Google has not re-read it since the catalog changed."
            )
    if not sitemaps:
        flags.append("⚠️ No sitemap is submitted for this property (KAN-115 submitted one on 2026-07-19 — re-check).")
    if not striking:
        flags.append("• No striking-distance queries yet (nothing ranking 5–30 with ≥10 impressions).")
    return flags


# --------------------------------------------------------------------------
# API client
# --------------------------------------------------------------------------


def build_credentials(sa_info: Optional[dict]):
    """Scoped credentials from the same sources the monitoring client uses."""
    if sa_info is not None:
        from google.oauth2 import service_account

        return service_account.Credentials.from_service_account_info(sa_info, scopes=SCOPES)
    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if creds_path and not os.path.isfile(creds_path):
        raise GscAccessError(
            f"GOOGLE_APPLICATION_CREDENTIALS points to '{creds_path}' but no such file exists. "
            "Fix the path in .env (repo root) or supply GOOGLE_APPLICATION_CREDENTIALS_B64."
        )
    import google.auth

    creds, _project = google.auth.default(scopes=SCOPES)
    # Compute-engine / Cloud Run credentials mint scoped tokens on request; the
    # readonly Webmasters scope must be explicit or the metadata token carries
    # only cloud-platform, which Search Console does not accept.
    if getattr(creds, "requires_scopes", False) and hasattr(creds, "with_scopes"):
        creds = creds.with_scopes(SCOPES)
    return creds


class GscClient:
    """Thin authorized-session wrapper. One instance per server process."""

    def __init__(self, site_url: str, sa_info: Optional[dict] = None, session_factory: Optional[Callable] = None):
        self.site_url = site_url
        self._sa_info = sa_info
        self._session_factory = session_factory
        self._session = None
        self._principal: Optional[str] = None
        self._lock = threading.Lock()

    # -- auth -----------------------------------------------------------
    def session(self):
        with self._lock:
            if self._session is None:
                if self._session_factory is not None:
                    self._session = self._session_factory()
                else:
                    from google.auth.transport.requests import AuthorizedSession

                    creds = build_credentials(self._sa_info)
                    self._session = AuthorizedSession(creds)
                    self._principal = getattr(creds, "service_account_email", None)
            return self._session

    @property
    def principal(self) -> str:
        if self._principal and self._principal != "default":
            return self._principal
        if self._sa_info and self._sa_info.get("client_email"):
            return str(self._sa_info["client_email"])
        return "the server's credential (service account)"

    # -- transport ------------------------------------------------------
    def _request(self, method: str, url: str, **kwargs) -> dict:
        resp = self.session().request(method, url, timeout=60, **kwargs)
        if resp.status_code >= 400:
            raise GscAccessError(classify_http_error(resp.status_code, resp.text, self.site_url, self.principal))
        try:
            return resp.json() if resp.text else {}
        except ValueError:
            return {}

    @property
    def _site_path(self) -> str:
        return f"{WEBMASTERS_API}/sites/{urllib.parse.quote(self.site_url, safe='')}"

    # -- endpoints ------------------------------------------------------
    def sites(self) -> list[dict]:
        return self._request("GET", f"{WEBMASTERS_API}/sites").get("siteEntry", []) or []

    def query(
        self,
        start_date: str,
        end_date: str,
        dimensions: Optional[list[str]] = None,
        row_limit: int = 1000,
        filters: Optional[list[dict]] = None,
        search_type: str = "web",
    ) -> list[dict]:
        body: dict[str, Any] = {
            "startDate": start_date,
            "endDate": end_date,
            "rowLimit": max(1, min(int(row_limit), MAX_ROWS)),
            "type": search_type,
            "dataState": "all",
        }
        if dimensions:
            body["dimensions"] = dimensions
        if filters:
            body["dimensionFilterGroups"] = [{"filters": filters}]
        data = self._request("POST", f"{self._site_path}/searchAnalytics/query", json=body)
        return data.get("rows", []) or []

    def sitemaps(self) -> list[dict]:
        return self._request("GET", f"{self._site_path}/sitemaps").get("sitemap", []) or []

    def inspect(self, inspection_url: str) -> dict:
        body = {"inspectionUrl": inspection_url, "siteUrl": self.site_url, "languageCode": "en-US"}
        return self._request("POST", INSPECTION_API, json=body).get("inspectionResult", {}) or {}


def fetch_live_sitemap(public_base: str) -> list[tuple[str, Optional[str]]]:
    """Public fetch of the site's own sitemap.xml (no auth). Empty on failure."""
    try:
        import requests

        resp = requests.get(
            f"{public_base.rstrip('/')}/sitemap.xml",
            timeout=20,
            headers={"User-Agent": "gcp-monitor-mcp/gsc-tools (+https://www.tasteslikegood.org)"},
        )
        if resp.status_code != 200:
            return []
        return parse_sitemap_urls(resp.text)
    except Exception:  # network failure must not break a report
        return []


def _summarize_inspection(url: str, result: dict) -> dict[str, Any]:
    idx = result.get("indexStatusResult", {}) or {}
    rich = result.get("richResultsResult", {}) or {}
    mobile = result.get("mobileUsabilityResult", {}) or {}
    detected = []
    for item in rich.get("detectedItems", []) or []:
        rtype = item.get("richResultType", "?")
        issues = sum(len(i.get("issues") or []) for i in item.get("items") or [])
        detected.append(f"{rtype}{f' ({issues} issue(s))' if issues else ''}")
    return {
        "url": url,
        "verdict": idx.get("verdict", "UNKNOWN"),
        "coverage": idx.get("coverageState", "—"),
        "indexing": idx.get("indexingState", "—"),
        "robots": idx.get("robotsTxtState", "—"),
        "fetch": idx.get("pageFetchState", "—"),
        "last_crawl": (idx.get("lastCrawlTime") or "—")[:19].replace("T", " "),
        "google_canonical": idx.get("googleCanonical", "—"),
        "user_canonical": idx.get("userCanonical", "—"),
        "in_sitemap": bool(idx.get("sitemap")),
        "referring_urls": len(idx.get("referringUrls") or []),
        "rich_results": ", ".join(detected) or rich.get("verdict", "—"),
        "mobile": mobile.get("verdict", "—"),
        "link": result.get("inspectionResultLink", ""),
    }


# --------------------------------------------------------------------------
# Tool registration
# --------------------------------------------------------------------------


def register(mcp, sa_info: Optional[dict] = None, client: Optional[GscClient] = None) -> GscClient:
    """Attach the gsc_* tools to a FastMCP instance. Returns the client so
    tests can inject a fake session."""
    site_url = os.environ.get("GSC_SITE_URL", DEFAULT_SITE_URL).strip() or DEFAULT_SITE_URL
    public_base = os.environ.get("GSC_PUBLIC_BASE", DEFAULT_PUBLIC_BASE).strip() or DEFAULT_PUBLIC_BASE
    gsc = client or GscClient(site_url, sa_info=sa_info)

    def _guard(fn: Callable[[], str]) -> str:
        try:
            return fn()
        except GscAccessError as exc:
            return f"Search Console unavailable: {exc}"
        except Exception as exc:  # surface, don't crash the server
            return f"Search Console tool failed: {type(exc).__name__}: {exc}"

    def _window_note(days: int) -> tuple[str, str, str, str, str]:
        cs, ce, ps, pe = period_windows(days)
        prelim_from = (dt.date.fromisoformat(ce) - dt.timedelta(days=PRELIMINARY_DAYS - 1)).isoformat()
        note = f"Window {cs} → {ce} ({days}d); rows from {prelim_from} onward are preliminary (Google finalizes ~2 days late)."
        return cs, ce, ps, pe, note

    @mcp.tool()
    def gsc_sites() -> str:
        """List the Search Console properties this server's credential can read.
        Run first after deploying: an empty list means the service account has
        not been added as a user on the property yet."""

        def run() -> str:
            entries = gsc.sites()
            if not entries:
                return (
                    f"No Search Console properties are visible to {gsc.principal}. Add that email at "
                    "Search Console → Settings → Users and permissions (permission 'Restricted'), "
                    f"then retry. Expected property: {site_url}."
                )
            rows = [[e.get("siteUrl", "?"), e.get("permissionLevel", "?")] for e in entries]
            ok = any(e.get("siteUrl") == site_url for e in entries)
            head = f"Properties visible to {gsc.principal} (configured GSC_SITE_URL={site_url}: {'found' if ok else 'NOT FOUND'})"
            return head + "\n" + format_table(["property", "permission"], rows)

        return _guard(run)

    @mcp.tool()
    def gsc_search_performance(
        days: int = 28,
        dimension: str = "query",
        limit: int = 25,
        page_contains: str = "",
        query_contains: str = "",
        sort_by: str = "clicks",
    ) -> str:
        """Search Analytics rows for the last `days` (ending yesterday) grouped by
        one dimension: query | page | country | device | date | searchAppearance.
        Optional substring filters on page URL and query text. sort_by: clicks |
        impressions | position (position sorts ascending = best first)."""

        def run() -> str:
            dim = dimension.strip()
            if dim not in DIMENSIONS:
                return f"dimension must be one of {', '.join(DIMENSIONS)}"
            cs, ce, _ps, _pe, note = _window_note(days)
            filters = []
            if page_contains:
                filters.append({"dimension": "page", "operator": "contains", "expression": page_contains})
            if query_contains:
                filters.append({"dimension": "query", "operator": "contains", "expression": query_contains})
            rows = gsc.query(cs, ce, [dim], row_limit=max(limit, 1000), filters=filters or None)
            key = sort_by if sort_by in ("clicks", "impressions", "position") else "clicks"
            rows = sorted(
                rows,
                key=lambda r: float(r.get(key) or 0),
                reverse=(key != "position"),
            )[: max(1, min(int(limit), MAX_ROWS))]
            totals = summarize_rows(rows)
            head = (
                f"Search performance by {dim} — {site_url}\n{note}\n"
                f"Shown rows total: clicks {fmt_int(totals['clicks'])} · impressions {fmt_int(totals['impressions'])} · "
                f"CTR {fmt_pct(totals['ctr'])} · avg position {totals['position']:.1f}"
            )
            return head + "\n" + performance_rows_table(rows, dim)

        return _guard(run)

    @mcp.tool()
    def gsc_compare_periods(days: int = 28, limit: int = 10) -> str:
        """Totals for the last `days` versus the `days` before them, plus the
        top query gainers and losers by clicks (impressions break ties, so a
        zero-click site still gets a meaningful list)."""

        def run() -> str:
            cs, ce, ps, pe, note = _window_note(days)
            cur_tot = summarize_rows(gsc.query(cs, ce, None, row_limit=1))
            prev_tot = summarize_rows(gsc.query(ps, pe, None, row_limit=1))
            cmp = compare_totals(cur_tot, prev_tot)
            cur_q = gsc.query(cs, ce, ["query"], row_limit=1000)
            prev_q = gsc.query(ps, pe, ["query"], row_limit=1000)
            mv = movers(cur_q, prev_q, limit=max(1, int(limit)))
            lines = [
                f"Period comparison — {site_url}",
                note,
                f"Previous window {ps} → {pe}.",
                f"clicks {fmt_int(cmp['clicks'])} {fmt_delta(cmp['clicks_delta'], cmp['clicks_pct'])}",
                f"impressions {fmt_int(cmp['impressions'])} {fmt_delta(cmp['impressions_delta'], cmp['impressions_pct'])}",
                f"CTR {fmt_pct(cmp['ctr'])} ({'+' if cmp['ctr_delta'] >= 0 else ''}{cmp['ctr_delta'] * 100:.2f} pts)",
                f"avg position {cmp['position']:.1f} ({'better' if cmp['position_better'] > 0 else 'worse' if cmp['position_better'] < 0 else 'flat'} by {abs(cmp['position_better']):.1f})",
                "",
                "Gainers:",
                format_table(
                    ["query", "clicks", "Δclicks", "impr", "Δimpr"],
                    [[g["key"], fmt_int(g["clicks"]), fmt_delta(g["clicks_delta"]), fmt_int(g["impressions"]), fmt_delta(g["impressions_delta"])] for g in mv["gainers"]],
                ),
                "",
                "Losers:",
                format_table(
                    ["query", "clicks", "Δclicks", "impr", "Δimpr"],
                    [[g["key"], fmt_int(g["clicks"]), fmt_delta(g["clicks_delta"]), fmt_int(g["impressions"]), fmt_delta(g["impressions_delta"])] for g in mv["losers"]],
                ),
            ]
            return "\n".join(lines)

        return _guard(run)

    @mcp.tool()
    def gsc_striking_distance(
        days: int = 28,
        min_impressions: int = SD_MIN_IMPRESSIONS,
        position_min: float = SD_POSITION_MIN,
        position_max: float = SD_POSITION_MAX,
        limit: int = 30,
    ) -> str:
        """Queries already ranking between position_min and position_max with at
        least min_impressions, with the page Google shows for each. These are
        the cheapest wins: a title, intro paragraph, or internal link usually
        moves them onto page one."""

        def run() -> str:
            cs, ce, _ps, _pe, note = _window_note(days)
            rows = gsc.query(cs, ce, ["query", "page"], row_limit=MAX_ROWS)
            sd = striking_distance(rows, int(min_impressions), float(position_min), float(position_max))[: max(1, int(limit))]
            table = [
                [
                    (r.get("keys") or ["?", "?"])[0],
                    (r.get("keys") or ["?", "?"])[1].replace(public_base, ""),
                    fmt_int(r.get("impressions")),
                    fmt_int(r.get("clicks")),
                    f"{float(r.get('position') or 0):.1f}",
                ]
                for r in sd
            ]
            head = (
                f"Striking distance (position {position_min:g}–{position_max:g}, ≥{min_impressions} impressions) — {site_url}\n{note}\n"
                f"{len(sd)} of {len(rows)} query/page rows qualify."
            )
            return head + "\n" + format_table(["query", "page", "impr", "clicks", "pos"], table)

        return _guard(run)

    @mcp.tool()
    def gsc_sitemaps() -> str:
        """Sitemaps submitted for the property: last submitted / last read,
        errors, warnings, URL counts — cross-checked against the live
        sitemap.xml so a stale read shows up."""

        def run() -> str:
            sms = gsc.sitemaps()
            live = fetch_live_sitemap(public_base)
            lines = [f"Sitemaps in Search Console — {site_url}", f"Live {public_base}/sitemap.xml: {len(live)} URLs" + (f", newest lastmod {live[0][1]}" if live and live[0][1] else "")]
            if not sms:
                lines.append("  (none submitted — submit https://www.tasteslikegood.org/sitemap.xml with the full www URL; KAN-115 recorded that the bare path 301s and fails)")
                return "\n".join(lines)
            for sm in sms:
                submitted = sum(int(c.get("submitted") or 0) for c in sm.get("contents") or [])
                lines.append(
                    f"- {sm.get('path')}: submitted {(sm.get('lastSubmitted') or '—')[:10]}, last read {(sm.get('lastDownloaded') or '—')[:10]}, "
                    f"errors {sm.get('errors', 0)}, warnings {sm.get('warnings', 0)}, pending {sm.get('isPending', False)}, URLs read {submitted}"
                )
            flags = weekly_flags(
                {"impressions": 1, "clicks_pct": None, "impressions_pct": None, "position_better": 0.0},
                sms,
                len(live) or None,
                [{}],
            )
            lines.extend(flags)
            return "\n".join(lines)

        return _guard(run)

    @mcp.tool()
    def gsc_inspect_url(url: str) -> str:
        """URL Inspection for one page: index verdict, coverage state, last crawl,
        Google-selected canonical, sitemap membership, rich-result detection.
        Quota is 2,000/day per property — use gsc_index_coverage_sample for
        batches. Relative paths are resolved against the public base."""

        def run() -> str:
            target = url.strip()
            if target.startswith("/"):
                target = public_base.rstrip("/") + target
            s = _summarize_inspection(target, gsc.inspect(target))
            return "\n".join(
                [
                    f"URL inspection — {s['url']}",
                    f"verdict {s['verdict']} · coverage: {s['coverage']}",
                    f"indexing {s['indexing']} · robots {s['robots']} · fetch {s['fetch']} · last crawl {s['last_crawl']}",
                    f"Google canonical: {s['google_canonical']}",
                    f"declared canonical: {s['user_canonical']}",
                    f"in submitted sitemap: {s['in_sitemap']} · referring URLs known to Google: {s['referring_urls']}",
                    f"rich results: {s['rich_results']} · mobile: {s['mobile']}",
                    f"console link: {s['link']}" if s["link"] else "",
                ]
            ).rstrip()

        return _guard(run)

    @mcp.tool()
    def gsc_index_coverage_sample(max_urls: int = 10, which: str = "newest") -> str:
        """Inspect up to max_urls (≤25) URLs from the live sitemap — newest by
        lastmod, or oldest — and summarize how many Google has indexed, with the
        coverage reason for each one that is not. Costs one inspection call per
        URL against the 2,000/day quota."""

        def run() -> str:
            n = max(1, min(int(max_urls), MAX_INSPECTIONS_PER_CALL))
            live = fetch_live_sitemap(public_base)
            if not live:
                return f"Could not fetch {public_base}/sitemap.xml to pick a sample."
            picked = live[:n] if which != "oldest" else list(reversed(live))[:n]
            results = [_summarize_inspection(loc, gsc.inspect(loc)) for loc, _ in picked]
            indexed = [r for r in results if r["verdict"] == "PASS"]
            lines = [
                f"Index coverage sample — {len(indexed)}/{len(results)} indexed ({which} {len(results)} sitemap URLs of {len(live)})",
                format_table(
                    ["page", "verdict", "coverage", "last crawl", "rich"],
                    [[r["url"].replace(public_base, ""), r["verdict"], r["coverage"], r["last_crawl"], r["rich_results"]] for r in results],
                ),
            ]
            not_indexed = [r for r in results if r["verdict"] != "PASS"]
            if not_indexed:
                lines.append("")
                lines.append("Not indexed — coverage reasons:")
                for r in not_indexed:
                    lines.append(f"  {r['url'].replace(public_base, '')}: {r['coverage']} (Google canonical: {r['google_canonical']})")
            return "\n".join(lines)

        return _guard(run)

    @mcp.tool()
    def gsc_weekly_report(days: int = 28) -> str:
        """The weekly SEO check in one call: totals vs the previous window, brand
        vs non-brand split, top queries and pages, striking-distance queries,
        sitemap status vs the live sitemap, and ⚠️ flags. Read it with the
        /seo-weekly-check skill."""

        def run() -> str:
            cs, ce, ps, pe, note = _window_note(days)
            cur_tot = summarize_rows(gsc.query(cs, ce, None, row_limit=1))
            prev_tot = summarize_rows(gsc.query(ps, pe, None, row_limit=1))
            cmp = compare_totals(cur_tot, prev_tot)
            queries = gsc.query(cs, ce, ["query"], row_limit=1000)
            pages = gsc.query(cs, ce, ["page"], row_limit=1000)
            split = brand_split(queries)
            sd_rows = gsc.query(cs, ce, ["query", "page"], row_limit=MAX_ROWS)
            sd = striking_distance(sd_rows)[:10]
            sms = gsc.sitemaps()
            live = fetch_live_sitemap(public_base)
            flags = weekly_flags(cmp, sms, len(live) or None, sd)
            top_q = sorted(queries, key=lambda r: (-float(r.get("clicks") or 0), -float(r.get("impressions") or 0)))[:10]
            top_p = sorted(pages, key=lambda r: (-float(r.get("clicks") or 0), -float(r.get("impressions") or 0)))[:10]
            for r in top_p:
                r["keys"] = [(r.get("keys") or ["?"])[0].replace(public_base, "") or "/"]
            sm_lines = []
            for sm in sms:
                submitted = sum(int(c.get("submitted") or 0) for c in sm.get("contents") or [])
                sm_lines.append(
                    f"  {sm.get('path')}: last read {(sm.get('lastDownloaded') or '—')[:10]}, errors {sm.get('errors', 0)}, "
                    f"warnings {sm.get('warnings', 0)}, URLs read {submitted} (live sitemap: {len(live)})"
                )
            lines = [
                f"Search Console weekly report — {site_url}",
                note,
                f"Previous window {ps} → {pe}.",
                "",
                "Totals:",
                f"  clicks {fmt_int(cmp['clicks'])} {fmt_delta(cmp['clicks_delta'], cmp['clicks_pct'])}",
                f"  impressions {fmt_int(cmp['impressions'])} {fmt_delta(cmp['impressions_delta'], cmp['impressions_pct'])}",
                f"  CTR {fmt_pct(cmp['ctr'])} ({'+' if cmp['ctr_delta'] >= 0 else ''}{cmp['ctr_delta'] * 100:.2f} pts)",
                f"  avg position {cmp['position']:.1f} ({'better' if cmp['position_better'] > 0 else 'worse' if cmp['position_better'] < 0 else 'flat'} by {abs(cmp['position_better']):.1f})",
                f"  brand: {fmt_int(split['brand']['clicks'])} clicks / {fmt_int(split['brand']['impressions'])} impr · "
                f"non-brand: {fmt_int(split['non_brand']['clicks'])} clicks / {fmt_int(split['non_brand']['impressions'])} impr",
                "",
                "Top queries:",
                performance_rows_table(top_q, "query"),
                "",
                "Top pages:",
                performance_rows_table(top_p, "page"),
                "",
                f"Striking distance (pos {SD_POSITION_MIN:g}–{SD_POSITION_MAX:g}, ≥{SD_MIN_IMPRESSIONS} impr):",
                format_table(
                    ["query", "page", "impr", "pos"],
                    [
                        [
                            (r.get("keys") or ["?", "?"])[0],
                            (r.get("keys") or ["?", "?"])[1].replace(public_base, ""),
                            fmt_int(r.get("impressions")),
                            f"{float(r.get('position') or 0):.1f}",
                        ]
                        for r in sd
                    ],
                ),
                "",
                "Sitemaps:",
                *(sm_lines or ["  (none submitted)"]),
                "",
                "Flags:",
                *(["  " + f for f in flags] or ["  none"]),
            ]
            return "\n".join(lines)

        return _guard(run)

    return gsc


if __name__ == "__main__":
    # Ad-hoc local check without MCP: python scripts/monitoring/gsc_tools.py [days]
    # Uses the same credential resolution as the server (.env in the repo root).
    from types import SimpleNamespace

    _tools: dict[str, Callable] = {}

    class _Collector:  # minimal stand-in for FastMCP.tool()
        def tool(self):
            def deco(fn):
                _tools[fn.__name__] = fn
                return fn

            return deco

    # Same .env resolution as the server: repo-root .env, never overriding the
    # environment, relative key paths anchored at the repo root.
    _root = pathlib.Path(__file__).resolve().parents[2]
    _env = _root / ".env"
    if _env.is_file():
        for _raw in _env.read_text().splitlines():
            _line = _raw.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))
    _cp = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if _cp and not os.path.isabs(_cp):
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(_root / _cp)

    _days = int(sys.argv[1]) if len(sys.argv) > 1 else 28
    _b64 = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_B64")
    _info = None
    if _b64:
        import base64

        _info = json.loads(base64.b64decode(_b64))
    register(_Collector(), sa_info=_info)
    print(_tools["gsc_sites"]())
    print()
    print(_tools["gsc_weekly_report"](_days))
