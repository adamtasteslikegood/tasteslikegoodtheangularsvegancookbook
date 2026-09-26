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
actionable property-grant instruction rather than a stack trace, naming the
principal email when the credential exposes it.

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
import time
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass
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
# Cloud Run's default request window is 300 seconds. Cap each URL Inspection
# request and the whole sample so the tool can return partial results instead
# of being killed without a report when Google's endpoint is slow.
INSPECTION_REQUEST_TIMEOUT_SECONDS = 8.0
INSPECTION_TOTAL_BUDGET_SECONDS = 240.0
# Search Analytics requests are paginated and several are combined by the
# report tools. Bound both transport latency and rendered output so one slow
# API call or caller-supplied limit cannot exhaust the connector request.
SEARCH_ANALYTICS_REQUEST_TIMEOUT_SECONDS = 12.0
WEEKLY_REPORT_TOTAL_BUDGET_SECONDS = 240.0
MAX_OUTPUT_ROWS = 100
MAX_ROWS = 5000
# Search Console retains roughly 16 months of Search Analytics data. Keep each
# side of an adjacent current-vs-previous comparison within half that span.
MAX_COMPARISON_WINDOW_DAYS = 240
# Search Analytics returns rows click-ranked; a single page can drop low-click
# rows that still qualify for striking distance or the brand split. Paginate
# with startRow up to this many pages before declaring the sample truncated.
MAX_PAGES = 5
# Single-purpose tools (compare, striking distance, sitemaps) share one
# wall-clock budget so pagination cannot outlive the Cloud Run request window.
TOOL_TOTAL_BUDGET_SECONDS = 120.0
# Live sitemap fetches: one request budget plus a total budget covering a
# sitemap index and its children, which are followed one level deep.
SITEMAP_REQUEST_TIMEOUT_SECONDS = 20.0
SITEMAP_FETCH_TOTAL_BUDGET_SECONDS = 60.0
MAX_SITEMAP_INDEX_CHILDREN = 10
SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9"
DIMENSIONS = ("query", "page", "country", "device", "date", "searchAppearance")
BRAND_TERMS = ("tasteslikegood", "tastes like good", "vegangenius", "vegan genius")

# Striking-distance defaults: position 5–30 is where a title/intro/internal-link
# change moves a query onto page one; below 5 impressions the row is noise.
SD_MIN_IMPRESSIONS = 10
SD_POSITION_MIN = 5.0
SD_POSITION_MAX = 30.0


class GscAccessError(RuntimeError):
    """Raised when the API refuses the credential; the message is user-facing."""


class GscProtocolError(RuntimeError):
    """Raised when a successful API response is not a usable JSON object."""


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
    days = max(1, min(int(days), MAX_COMPARISON_WINDOW_DAYS))
    today = today or dt.datetime.now(dt.timezone.utc).date()
    cur_end = today - dt.timedelta(days=lag_days)
    cur_start = cur_end - dt.timedelta(days=days - 1)
    prev_end = cur_start - dt.timedelta(days=1)
    prev_start = prev_end - dt.timedelta(days=days - 1)
    return cur_start.isoformat(), cur_end.isoformat(), prev_start.isoformat(), prev_end.isoformat()


def decode_embedded_credentials(
    encoded: Optional[str], credentials_path: Optional[str]
) -> Optional[dict]:
    """Decode a base64 key only when no usable credential file is configured."""
    if not encoded or (credentials_path and os.path.isfile(credentials_path)):
        return None
    import base64

    return json.loads(base64.b64decode(encoded))


def clamp_output_limit(value: int) -> int:
    """Clamp caller-controlled table sizes to the connector response budget."""
    return max(1, min(int(value), MAX_OUTPUT_ROWS))


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
        "position_better": (
            prev["position"] - cur["position"]
            if cur["impressions"] > 0 and prev["impressions"] > 0
            else None
        ),
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
    for key in sorted(set(prev_by_key) | set(cur_by_key)):
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
    # Tuple comparison keeps the buckets mutually exclusive: clicks decide
    # direction first and impressions break an exact clicks tie. The query key
    # is the final sort key so tied rows render in a stable order.
    losers = sorted(
        (
            d
            for d in deltas
            if (d["clicks_delta"], d["impressions_delta"]) < (0, 0)
        ),
        key=lambda d: (d["clicks_delta"], d["impressions_delta"], d["key"]),
    )[:limit]
    gainers = sorted(
        (
            d
            for d in deltas
            if (d["clicks_delta"], d["impressions_delta"]) > (0, 0)
        ),
        key=lambda d: (-d["clicks_delta"], -d["impressions_delta"], d["key"]),
    )[:limit]
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


def is_sitemap_urlset(xml_text: str) -> bool:
    """Return True only for a sitemaps.org ``urlset`` document."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return False
    return root.tag == f"{{{SITEMAP_NS}}}urlset"


def is_sitemap_index(xml_text: str) -> bool:
    """Return True only for a sitemaps.org ``sitemapindex`` document."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return False
    return root.tag == f"{{{SITEMAP_NS}}}sitemapindex"


def parse_sitemap_index(xml_text: str) -> list[str]:
    """Child sitemap locations from a sitemaps.org ``sitemapindex``, in document order."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    ns = {"sm": SITEMAP_NS}
    out: list[str] = []
    for entry in root.findall("sm:sitemap", ns):
        loc = entry.findtext("sm:loc", default="", namespaces=ns).strip()
        if loc:
            out.append(loc)
    return out


def select_sitemap_sample(
    urls: list[tuple[str, Optional[str]]],
    which: str,
    limit: int,
) -> list[tuple[str, Optional[str]]]:
    """Select newest/oldest dated URLs, placing unknown-age entries last."""
    dated = [item for item in urls if item[1]]
    undated = [item for item in urls if not item[1]]
    dated.sort(key=lambda item: item[1] or "", reverse=(which == "newest"))
    return (dated + undated)[: max(1, int(limit))]


def property_access_instruction(principal: str) -> str:
    """Actionable Search Console property-grant guidance for known/unknown identities."""
    if "@" in principal:
        return (
            f"Add {principal} as a user on the property: Search Console → Settings → "
            "Users and permissions → Add user → permission 'Restricted'."
        )
    return (
        "Grant the Google account or service-account email represented by that credential "
        "access to the property: Search Console → Settings → Users and permissions → "
        "Add user → permission 'Restricted'. For local ADC, identify the active account "
        "with `gcloud auth list --filter=status:ACTIVE --format='value(account)'`, or set "
        "GSC_PRINCIPAL_EMAIL so future diagnostics can name it."
    )


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
            f"{property_access_instruction(principal)} IAM roles do not grant Search "
            "Console access. If the correct identity IS listed, confirm the Search Console "
            "API is enabled in the credential's project "
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


def fmt_position_comparison(position: float, position_better: Optional[float]) -> str:
    """Render a rank comparison without treating a no-impression window as rank zero."""
    current = f"{position:.1f}" if position > 0 else "—"
    if position_better is None:
        return f"avg position {current} (comparison unavailable)"
    direction = "better" if position_better > 0 else "worse" if position_better < 0 else "flat"
    return f"avg position {current} ({direction} by {abs(position_better):.1f})"


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
    *,
    striking_complete: bool = True,
    striking_failed: bool = False,
    live_sitemap_url: Optional[str] = None,
    sitemaps_available: bool = True,
    analytics_available: bool = True,
) -> list[str]:
    """⚠️ lines for the weekly report. Pure so the thresholds are testable."""
    flags: list[str] = []
    if analytics_available:
        if comparison["impressions"] == 0:
            flags.append("⚠️ Zero impressions in the window — check the property is verified and the sitemap is available to Google.")
        if comparison["clicks_pct"] is not None and comparison["clicks_pct"] <= -30:
            flags.append(f"⚠️ Clicks down {abs(comparison['clicks_pct']):.0f}% vs the previous window.")
        if comparison["impressions_pct"] is not None and comparison["impressions_pct"] <= -30:
            flags.append(f"⚠️ Impressions down {abs(comparison['impressions_pct']):.0f}% vs the previous window.")
        position_better = comparison.get("position_better")
        if position_better is not None and position_better <= -3:
            flags.append(f"⚠️ Average position worsened by {abs(position_better):.1f}.")
    for sm in sitemaps:
        errors = int(sm.get("errors") or 0)
        warnings = int(sm.get("warnings") or 0)
        if errors:
            flags.append(f"⚠️ Sitemap {sm.get('path')} has {errors} error(s) in Search Console.")
        if warnings:
            flags.append(f"⚠️ Sitemap {sm.get('path')} has {warnings} warning(s) in Search Console.")
        if sm.get("isPending"):
            flags.append(f"⚠️ Sitemap {sm.get('path')} is still pending processing.")
    comparison_sitemaps = sitemaps
    if live_sitemap_url:
        expected = live_sitemap_url.rstrip("/")
        comparison_sitemaps = [
            sm for sm in sitemaps if str(sm.get("path") or "").rstrip("/") == expected
        ]
    if live_url_count is not None and comparison_sitemaps:
        submitted = sum(
            int(c.get("submitted") or 0)
            for sm in comparison_sitemaps
            for c in sm.get("contents") or []
        )
        if abs(submitted - live_url_count) > 5:
            label = (
                comparison_sitemaps[0].get("path")
                if len(comparison_sitemaps) == 1
                else "the submitted sitemap set"
            )
            flags.append(
                f"⚠️ Search Console reports {submitted} submitted URLs for {label} but the live sitemap has "
                f"{live_url_count}. This count mismatch is a heuristic; lastDownloaded is the actual fetch timestamp."
            )
    elif live_url_count is not None and live_sitemap_url and sitemaps:
        flags.append(f"⚠️ The configured live sitemap {live_sitemap_url} is not submitted for this property.")
    if sitemaps_available and not sitemaps:
        flags.append("⚠️ No sitemap is submitted for this property (KAN-115 submitted one on 2026-07-19 — re-check).")
    if not striking:
        if striking_failed:
            flags.append(
                "⚠️ The striking-distance request failed or timed out; absence is inconclusive."
            )
        elif striking_complete:
            flags.append("• No striking-distance queries yet (nothing ranking 5–30 with ≥10 impressions).")
        else:
            flags.append("⚠️ The striking-distance sample hit its row cap without a match; absence is inconclusive.")
    return flags


def sample_note(
    row_count: int,
    complete: bool,
    what: str = "rows",
    *,
    incomplete_due_to_error: bool = False,
) -> str:
    """Disclosure line for paginated result sets; empty when complete."""
    if complete:
        return ""
    if incomplete_due_to_error:
        return (
            f" Incomplete {what}: the Search Console request failed or timed out after "
            f"{row_count:,} row(s); results may be partial."
        )
    return f" Sample truncated at {row_count:,} click-ranked {what} — lower-click rows beyond that are not included."


def partial_data_note(errors: list[str]) -> str:
    """⚠️ line naming the transport failures that left a result partial; empty when none."""
    if not errors:
        return ""
    return "⚠️ Partial data: " + "; ".join(errors)


# --------------------------------------------------------------------------
# API client
# --------------------------------------------------------------------------


def build_credentials(sa_info: Optional[dict]):
    """Scoped credentials from the same sources the monitoring client uses."""
    try:
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
        # Compute-engine / Cloud Run credentials mint scoped tokens on request.
        if getattr(creds, "requires_scopes", False) and hasattr(creds, "with_scopes"):
            creds = creds.with_scopes(SCOPES)
        return creds
    except GscAccessError:
        raise
    except Exception as exc:
        raise GscAccessError(
            "Could not initialize Google credentials. Configure "
            "GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS_B64 "
            "locally, or deploy with a Cloud Run service identity. "
            f"Detail: {type(exc).__name__}: {exc}"
        ) from exc


class GscClient:
    """Thin authorized-session wrapper. One instance per server process."""

    def __init__(self, site_url: str, sa_info: Optional[dict] = None, session_factory: Optional[Callable] = None):
        self.site_url = site_url
        self._sa_info = sa_info
        self._session_factory = session_factory
        self._session = None
        self._principal: Optional[str] = os.environ.get("GSC_PRINCIPAL_EMAIL", "").strip() or None
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
                    credential_principal = getattr(creds, "service_account_email", None)
                    if credential_principal and credential_principal != "default":
                        self._principal = credential_principal
            return self._session

    @property
    def principal(self) -> str:
        if self._principal and self._principal != "default":
            return self._principal
        if self._sa_info and self._sa_info.get("client_email"):
            return str(self._sa_info["client_email"])
        # Authorized user ADC does not expose an email address. Do not imply
        # that every unknown principal is a service account or that the tool
        # can name an address it does not have.
        return "the active Google credential"

    # -- transport ------------------------------------------------------
    def _request(self, method: str, url: str, **kwargs) -> dict:
        timeout = kwargs.pop("timeout", 60)
        try:
            resp = self.session().request(method, url, timeout=timeout, **kwargs)
        except Exception as exc:
            # AuthorizedSession can fail while refreshing a credential before
            # an HTTP 401 exists. Preserve the same actionable auth path.
            try:
                from google.auth.exceptions import RefreshError
            except ImportError:
                RefreshError = ()  # type: ignore[assignment]
            if isinstance(exc, RefreshError):
                raise GscAccessError(
                    f"Google could not refresh the credential for {self.principal}. "
                    "Locally, re-authenticate Application Default Credentials with "
                    "`gcloud auth application-default login`; on Cloud Run, verify the "
                    "configured service identity or key and redeploy. "
                    f"Detail: {type(exc).__name__}: {exc}"
                ) from exc
            raise
        if resp.status_code >= 400:
            raise GscAccessError(classify_http_error(resp.status_code, resp.text, self.site_url, self.principal))
        if not resp.text.strip():
            raise GscProtocolError("Search Console returned an empty successful response.")
        try:
            payload = resp.json()
        except ValueError as exc:
            raise GscProtocolError(
                "Search Console returned a successful response that was not valid JSON."
            ) from exc
        if not isinstance(payload, dict):
            raise GscProtocolError(
                "Search Console returned a successful JSON response that was not an object."
            )
        return payload

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
        start_row: int = 0,
        timeout: float = 60.0,
    ) -> list[dict]:
        body: dict[str, Any] = {
            "startDate": start_date,
            "endDate": end_date,
            "rowLimit": max(1, min(int(row_limit), MAX_ROWS)),
            "type": search_type,
            "dataState": "all",
        }
        if start_row > 0:
            body["startRow"] = int(start_row)
        if dimensions:
            body["dimensions"] = dimensions
        if filters:
            body["dimensionFilterGroups"] = [{"filters": filters}]
        data = self._request(
            "POST",
            f"{self._site_path}/searchAnalytics/query",
            json=body,
            timeout=timeout,
        )
        return data.get("rows", []) or []

    def query_all(
        self,
        start_date: str,
        end_date: str,
        dimensions: Optional[list[str]] = None,
        filters: Optional[list[dict]] = None,
        search_type: str = "web",
        max_pages: int = MAX_PAGES,
        request_timeout: float = SEARCH_ANALYTICS_REQUEST_TIMEOUT_SECONDS,
        deadline: Optional[float] = None,
        partial_errors: Optional[list[str]] = None,
    ) -> tuple[list[dict], bool]:
        """Page through Search Analytics with ``startRow``.

        Returns ``(rows, complete)``. ``complete`` is False when ``max_pages``
        full pages came back and more may exist — callers must say so rather
        than present a click-ranked sample as the whole population. When
        ``partial_errors`` is supplied, transport failures are recorded there
        and rows already fetched are returned as an incomplete sample.
        """
        rows: list[dict] = []
        for page_index in range(max(1, int(max_pages))):
            timeout = request_timeout
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0.1:
                    if partial_errors is not None:
                        partial_errors.append("total Search Analytics time budget exhausted")
                    return rows, False
                timeout = min(timeout, remaining)
            try:
                page = self.query(
                    start_date,
                    end_date,
                    dimensions,
                    row_limit=MAX_ROWS,
                    filters=filters,
                    search_type=search_type,
                    start_row=page_index * MAX_ROWS,
                    timeout=timeout,
                )
            except GscAccessError:
                raise
            except Exception as exc:
                if partial_errors is None:
                    raise
                partial_errors.append(
                    f"page {page_index + 1}: {type(exc).__name__}: {exc}"
                )
                return rows, False
            rows.extend(page)
            if len(page) < MAX_ROWS:
                return rows, True
        return rows, False

    def sitemaps(self, timeout: float = 60.0) -> list[dict]:
        return self._request("GET", f"{self._site_path}/sitemaps", timeout=timeout).get("sitemap", []) or []

    def inspect(self, inspection_url: str, timeout: float = INSPECTION_REQUEST_TIMEOUT_SECONDS) -> dict:
        body = {"inspectionUrl": inspection_url, "siteUrl": self.site_url, "languageCode": "en-US"}
        return self._request("POST", INSPECTION_API, json=body, timeout=timeout).get("inspectionResult", {}) or {}


@dataclass
class LiveSitemap:
    """Result of fetching the public sitemap.

    ``urls`` is None when unavailable and [] when valid but empty. ``kind`` is
    "urlset" or "index" once the root document parsed. ``note`` explains an
    index fetch, or why the URL list is unavailable, so tool output can show a
    distinct reason instead of one generic failure state.
    """

    urls: Optional[list[tuple[str, Optional[str]]]]
    kind: Optional[str] = None
    note: str = ""


def same_origin(url: str, base: str) -> bool:
    """True when ``url`` is HTTP(S) on exactly the scheme and host:port of ``base``.

    The Sitemap protocol requires an index's children to live on the same
    site, and the child locations come from the network, so anything else
    (another host, a private address, a scheme like file: or gopher:, or
    userinfo smuggled into the authority) must never be fetched.
    """
    u = urllib.parse.urlsplit(url)
    b = urllib.parse.urlsplit(base)
    return (
        u.scheme in ("http", "https")
        and u.scheme == b.scheme
        and bool(u.netloc)
        and u.netloc.lower() == b.netloc.lower()
    )


def _get_sitemap_document(url: str, timeout: float):
    import requests

    # Redirects are never followed: a 3xx from a sitemap is treated as a
    # fetch failure so the connector cannot be steered off the configured
    # origin by a network-controlled Location header.
    return requests.get(
        url,
        timeout=timeout,
        allow_redirects=False,
        headers={"User-Agent": "gcp-monitor-mcp/gsc-tools (+https://www.tasteslikegood.org)"},
    )


def fetch_live_sitemap_detail(public_base: str, deadline: Optional[float] = None) -> LiveSitemap:
    """Public fetch of sitemap.xml, following a sitemap index one level deep.

    Network, non-200 (redirects included), malformed-XML, and wrong-root-
    element failures are reported as unavailable with a note, never as a
    real-looking zero-URL sitemap. An index with more children than
    MAX_SITEMAP_INDEX_CHILDREN, a child off the configured origin, or any
    child that fails or is itself an index, is unavailable too: a partial
    URL total would produce a false count-mismatch flag.

    ``deadline`` is a ``time.monotonic()`` instant shared with the calling
    tool; the fetch never runs past it, so sitemap time comes out of the
    tool's own budget instead of adding to it.
    """
    root_url = f"{public_base.rstrip('/')}/sitemap.xml"
    own_deadline = time.monotonic() + SITEMAP_FETCH_TOTAL_BUDGET_SECONDS
    deadline = own_deadline if deadline is None else min(deadline, own_deadline)

    def fetch(url: str) -> Optional[str]:
        remaining = deadline - time.monotonic()
        if remaining <= 0.1:
            return None
        resp = _get_sitemap_document(url, min(SITEMAP_REQUEST_TIMEOUT_SECONDS, remaining))
        if resp.status_code != 200:
            return None
        return resp.text

    try:
        text = fetch(root_url)
        if text is None:
            return LiveSitemap(None, note=f"{root_url} did not return HTTP 200 within the fetch budget")
        if is_sitemap_urlset(text):
            return LiveSitemap(parse_sitemap_urls(text), kind="urlset")
        if not is_sitemap_index(text):
            return LiveSitemap(None, note=f"{root_url} is not a sitemaps.org urlset or sitemapindex")
        children = parse_sitemap_index(text)
        if not children:
            return LiveSitemap([], kind="index", note="sitemap index lists no child sitemaps")
        if len(children) > MAX_SITEMAP_INDEX_CHILDREN:
            return LiveSitemap(
                None,
                kind="index",
                note=(
                    f"sitemap index lists {len(children)} child sitemaps, more than the "
                    f"{MAX_SITEMAP_INDEX_CHILDREN} this tool fetches; URL-count comparison skipped"
                ),
            )
        off_origin = [child for child in children if not same_origin(child, public_base)]
        if off_origin:
            return LiveSitemap(
                None,
                kind="index",
                note=(
                    f"child sitemap {off_origin[0]} is not on {public_base}; "
                    "only same-origin children are fetched"
                ),
            )
        urls: list[tuple[str, Optional[str]]] = []
        for child in children:
            child_text = fetch(child)
            if child_text is None:
                return LiveSitemap(
                    None, kind="index", note=f"child sitemap {child} did not return HTTP 200 within the fetch budget"
                )
            if not is_sitemap_urlset(child_text):
                return LiveSitemap(
                    None,
                    kind="index",
                    note=f"child sitemap {child} is not a sitemaps.org urlset (nested indexes are not followed)",
                )
            urls.extend(parse_sitemap_urls(child_text))
        urls.sort(key=lambda t: t[1] or "", reverse=True)
        return LiveSitemap(urls, kind="index", note=f"sitemap index with {len(children)} child sitemaps, all fetched")
    except Exception as exc:  # network or parse failure must not break a report
        return LiveSitemap(None, note=f"{type(exc).__name__}: {exc}")


def fetch_live_sitemap(public_base: str) -> Optional[list[tuple[str, Optional[str]]]]:
    """Public fetch of sitemap.xml. None means unavailable; [] means valid but empty."""
    return fetch_live_sitemap_detail(public_base).urls


def _summarize_inspection(url: str, result: dict) -> dict[str, Any]:
    idx = result.get("indexStatusResult", {}) or {}
    rich = result.get("richResultsResult", {}) or {}
    mobile = result.get("mobileUsabilityResult", {}) or {}
    detected = []
    for item in rich.get("detectedItems", []) or []:
        rtype = item.get("richResultType", "?")
        issues = sum(len(i.get("issues") or []) for i in item.get("items") or [])
        detected.append(f"{rtype}{f' ({issues} issue(s))' if issues else ''}")
    # Search Console returns null-valued keys on partial inspections, and
    # dict.get(key, default) only substitutes for an absent key, so coerce
    # both missing and null to the placeholder.
    def field(source: dict, key: str, default: str = "—") -> str:
        return source.get(key) or default

    return {
        "url": url,
        "verdict": field(idx, "verdict", "UNKNOWN"),
        "coverage": field(idx, "coverageState"),
        "indexing": field(idx, "indexingState"),
        "robots": field(idx, "robotsTxtState"),
        "fetch": field(idx, "pageFetchState"),
        "last_crawl": field(idx, "lastCrawlTime")[:19].replace("T", " "),
        "google_canonical": field(idx, "googleCanonical"),
        "user_canonical": field(idx, "userCanonical"),
        "in_sitemap": bool(idx.get("sitemap")),
        "referring_urls": len(idx.get("referringUrls") or []),
        "rich_results": ", ".join(detected) or field(rich, "verdict"),
        "mobile": field(mobile, "verdict"),
        "link": result.get("inspectionResultLink") or "",
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
        days = max(1, min(int(days), MAX_COMPARISON_WINDOW_DAYS))
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
                    f"No Search Console properties are visible to {gsc.principal}. "
                    f"{property_access_instruction(gsc.principal)} Then retry. "
                    f"Expected property: {site_url}."
                )
            rows = [[e.get("siteUrl", "?"), e.get("permissionLevel", "?")] for e in entries]
            ok = any(e.get("siteUrl") == site_url for e in entries)
            head = f"Properties visible to {gsc.principal} (configured GSC_SITE_URL={site_url}: {'found' if ok else 'NOT FOUND'})"
            guidance = ""
            if not ok:
                guidance = (
                    f"\nVerify GSC_SITE_URL is correct. If it is, "
                    f"{property_access_instruction(gsc.principal)}"
                )
            return head + "\n" + format_table(["property", "permission"], rows) + guidance

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
            key = sort_by.strip()
            if key not in ("clicks", "impressions", "position"):
                return "sort_by must be one of clicks, impressions, position"
            cs, ce, _ps, _pe, note = _window_note(days)
            filters = []
            if page_contains:
                filters.append({"dimension": "page", "operator": "contains", "expression": page_contains})
            if query_contains:
                filters.append({"dimension": "query", "operator": "contains", "expression": query_contains})
            requested = clamp_output_limit(limit)
            # Search Analytics returns rows click-ranked. Fetch the largest
            # bounded sample before applying an alternate local sort.
            fetch_limit = requested if key == "clicks" else MAX_ROWS
            rows = gsc.query(
                cs,
                ce,
                [dim],
                row_limit=fetch_limit,
                filters=filters or None,
                timeout=SEARCH_ANALYTICS_REQUEST_TIMEOUT_SECONDS,
            )
            rows = sorted(
                rows,
                key=lambda r: float(r.get(key) or 0),
                reverse=(key != "position"),
            )[:requested]
            totals = summarize_rows(rows)
            sort_note = (
                ""
                if key == "clicks"
                else f" {key.title()} ordering is within the first {MAX_ROWS:,} click-ranked API rows."
            )
            head = (
                f"Search performance by {dim} — {site_url}\n{note}{sort_note}\n"
                f"Shown rows total: clicks {fmt_int(totals['clicks'])} · impressions {fmt_int(totals['impressions'])} · "
                f"CTR {fmt_pct(totals['ctr'])} · avg position {totals['position']:.1f}"
            )
            return head + "\n" + performance_rows_table(rows, dim)

        return _guard(run)

    @mcp.tool()
    def gsc_compare_periods(days: int = 28, limit: int = 10) -> str:
        """Totals for the last `days` versus the `days` before them, plus the
        top query gainers and losers by clicks (impressions break ties, so a
        zero-click site still gets a meaningful list). Output is capped at
        100 gainers and 100 losers."""

        def run() -> str:
            cs, ce, ps, pe, note = _window_note(days)
            deadline = time.monotonic() + TOOL_TOTAL_BUDGET_SECONDS
            totals_errors: list[str] = []

            def totals_once(label: str, start: str, end: str) -> Optional[list[dict]]:
                # Same contract as the weekly report: a failed or timed-out
                # aggregate renders as unavailable instead of failing the tool
                # and discarding the query rows fetched alongside it.
                remaining = deadline - time.monotonic()
                if remaining <= 0.1:
                    totals_errors.append(f"{label}: total Search Analytics time budget exhausted")
                    return None
                try:
                    return gsc.query(
                        start,
                        end,
                        None,
                        row_limit=1,
                        timeout=min(SEARCH_ANALYTICS_REQUEST_TIMEOUT_SECONDS, remaining),
                    )
                except GscAccessError:
                    raise
                except Exception as exc:
                    totals_errors.append(f"{label}: {type(exc).__name__}: {exc}")
                    return None

            cur_rows = totals_once("current totals", cs, ce)
            prev_rows = totals_once("previous totals", ps, pe)
            totals_available = cur_rows is not None and prev_rows is not None
            cmp = compare_totals(summarize_rows(cur_rows or []), summarize_rows(prev_rows or []))
            cur_errors: list[str] = []
            prev_errors: list[str] = []
            cur_q, cur_complete = gsc.query_all(cs, ce, ["query"], deadline=deadline, partial_errors=cur_errors)
            prev_q, prev_complete = gsc.query_all(ps, pe, ["query"], deadline=deadline, partial_errors=prev_errors)
            mv = movers(cur_q, prev_q, limit=clamp_output_limit(limit))
            movers_note = (
                sample_note(len(cur_q), cur_complete, "current-window query rows", incomplete_due_to_error=bool(cur_errors))
                + sample_note(len(prev_q), prev_complete, "previous-window query rows", incomplete_due_to_error=bool(prev_errors))
            )
            partial = partial_data_note(
                totals_errors
                + [f"current window: {e}" for e in cur_errors]
                + [f"previous window: {e}" for e in prev_errors]
            )
            totals_lines = (
                [
                    f"clicks {fmt_int(cmp['clicks'])} {fmt_delta(cmp['clicks_delta'], cmp['clicks_pct'])}",
                    f"impressions {fmt_int(cmp['impressions'])} {fmt_delta(cmp['impressions_delta'], cmp['impressions_pct'])}",
                    f"CTR {fmt_pct(cmp['ctr'])} ({'+' if cmp['ctr_delta'] >= 0 else ''}{cmp['ctr_delta'] * 100:.2f} pts)",
                    fmt_position_comparison(cmp["position"], cmp["position_better"]),
                ]
                if totals_available
                else ["totals unavailable (see Partial data)"]
            )
            lines = [
                f"Period comparison — {site_url}",
                note,
                f"Previous window {ps} → {pe}.{movers_note}",
                *([partial] if partial else []),
                *totals_lines,
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
        moves them onto page one. Output is capped at 100 rows."""

        def run() -> str:
            cs, ce, _ps, _pe, note = _window_note(days)
            deadline = time.monotonic() + TOOL_TOTAL_BUDGET_SECONDS
            errors: list[str] = []
            rows, complete = gsc.query_all(cs, ce, ["query", "page"], deadline=deadline, partial_errors=errors)
            qualifying = striking_distance(rows, int(min_impressions), float(position_min), float(position_max))
            sd = qualifying[: clamp_output_limit(limit)]
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
                f"{len(qualifying)} of {len(rows)} query/page rows qualify; showing {len(sd)}."
                f"{sample_note(len(rows), complete, 'query/page rows', incomplete_due_to_error=bool(errors))}"
            )
            partial = partial_data_note(errors)
            if partial:
                head += "\n" + partial
            return head + "\n" + format_table(["query", "page", "impr", "clicks", "pos"], table)

        return _guard(run)

    @mcp.tool()
    def gsc_sitemaps() -> str:
        """Sitemaps submitted for the property: last submitted / downloaded,
        errors, warnings, and submitted URL counts — cross-checked against the
        live sitemap.xml so count drift and fetch failures show up."""

        def run() -> str:
            deadline = time.monotonic() + TOOL_TOTAL_BUDGET_SECONDS
            sms = gsc.sitemaps(timeout=SEARCH_ANALYTICS_REQUEST_TIMEOUT_SECONDS)
            live_detail = fetch_live_sitemap_detail(public_base, deadline=deadline)
            live = live_detail.urls
            live_count = len(live) if live is not None else None
            live_status = (
                f"{live_count} URLs"
                + (f", newest lastmod {live[0][1]}" if live and live[0][1] else "")
                + (f" ({live_detail.note})" if live_detail.note else "")
                if live_count is not None
                else f"unavailable ({live_detail.note or 'fetch, HTTP, or XML parse failure'})"
            )
            lines = [f"Sitemaps in Search Console — {site_url}", f"Live {public_base}/sitemap.xml: {live_status}"]
            if not sms:
                lines.append(f"  (none submitted — submit {public_base.rstrip('/')}/sitemap.xml for the configured public origin)")
                return "\n".join(lines)
            for sm in sms:
                submitted = sum(int(c.get("submitted") or 0) for c in sm.get("contents") or [])
                lines.append(
                    f"- {sm.get('path')}: submitted {(sm.get('lastSubmitted') or '—')[:10]}, last downloaded {(sm.get('lastDownloaded') or '—')[:10]}, "
                    f"errors {sm.get('errors', 0)}, warnings {sm.get('warnings', 0)}, pending {sm.get('isPending', False)}, submitted URLs {submitted}"
                )
            flags = weekly_flags(
                {"impressions": 1, "clicks_pct": None, "impressions_pct": None, "position_better": 0.0},
                sms,
                live_count,
                [{}],
                live_sitemap_url=f"{public_base.rstrip('/')}/sitemap.xml",
            )
            if live is None:
                flags.append(f"⚠️ Live sitemap unavailable ({live_detail.note}); URL-count comparison was skipped.")
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
            parsed = urllib.parse.urlsplit(target)
            if not parsed.scheme:
                target = public_base.rstrip("/") + "/" + target.lstrip("/")
            elif parsed.scheme.lower() not in ("http", "https"):
                return "url must be an HTTP(S) URL or a path relative to GSC_PUBLIC_BASE"
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
            selection = which.strip().lower()
            if selection not in ("newest", "oldest"):
                return "which must be one of newest, oldest"
            # One budget covers the sitemap fetch and every inspection, so the
            # tool always returns (partial if need be) inside Cloud Run's
            # 300 s request window with room to format the response.
            deadline = time.monotonic() + INSPECTION_TOTAL_BUDGET_SECONDS
            live_detail = fetch_live_sitemap_detail(public_base, deadline=deadline)
            live = live_detail.urls
            if live is None:
                reason = f": {live_detail.note}" if live_detail.note else ""
                return f"Could not fetch or parse {public_base}/sitemap.xml to pick a sample{reason}."
            if not live:
                return f"{public_base}/sitemap.xml is valid but contains no URLs."
            picked = select_sitemap_sample(live, selection, n)
            results: list[dict[str, Any]] = []
            failures: list[tuple[str, str]] = []
            for index, (loc, _lastmod) in enumerate(picked):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    failures.extend(
                        (pending_loc, "not attempted: total inspection time budget exhausted")
                        for pending_loc, _ in picked[index:]
                    )
                    break
                try:
                    result = gsc.inspect(
                        loc,
                        timeout=min(INSPECTION_REQUEST_TIMEOUT_SECONDS, max(1.0, remaining)),
                    )
                    results.append(_summarize_inspection(loc, result))
                except GscAccessError:
                    raise
                except Exception as exc:
                    failures.append((loc, f"{type(exc).__name__}: {exc}"))
            indexed = [r for r in results if r["verdict"] == "PASS"]
            lines = [
                f"Index coverage sample — {len(indexed)}/{len(results)} processed URLs indexed "
                f"({selection} sample; processed {len(results)}/{len(picked)} of {len(live)} sitemap URLs)",
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
            if failures:
                lines.append("")
                lines.append(
                    f"Partial sample: {len(failures)} URL(s) failed or were not attempted "
                    f"within the {INSPECTION_TOTAL_BUDGET_SECONDS:.0f}s total budget."
                )
                for failed_url, reason in failures:
                    lines.append(f"  {failed_url.replace(public_base, '')}: {reason}")
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
            deadline = time.monotonic() + WEEKLY_REPORT_TOTAL_BUDGET_SECONDS
            analytics_errors: list[str] = []

            def query_once(
                label: str, *args, **kwargs
            ) -> Optional[list[dict]]:
                remaining = deadline - time.monotonic()
                if remaining <= 0.1:
                    analytics_errors.append(
                        f"{label}: total Search Analytics time budget exhausted"
                    )
                    return None
                try:
                    return gsc.query(
                        *args,
                        **kwargs,
                        timeout=min(
                            SEARCH_ANALYTICS_REQUEST_TIMEOUT_SECONDS,
                            remaining,
                        ),
                    )
                except GscAccessError:
                    raise
                except Exception as exc:
                    analytics_errors.append(
                        f"{label}: {type(exc).__name__}: {exc}"
                    )
                    return None

            cur_tot_rows = query_once(
                "current totals", cs, ce, None, row_limit=1
            )
            prev_tot_rows = query_once(
                "previous totals", ps, pe, None, row_limit=1
            )
            totals_available = (
                cur_tot_rows is not None and prev_tot_rows is not None
            )
            cur_tot = summarize_rows(cur_tot_rows or [])
            prev_tot = summarize_rows(prev_tot_rows or [])
            cmp = compare_totals(cur_tot, prev_tot)
            query_errors: list[str] = []
            queries, queries_complete = gsc.query_all(
                cs,
                ce,
                ["query"],
                deadline=deadline,
                partial_errors=query_errors,
            )
            analytics_errors.extend(f"queries: {error}" for error in query_errors)
            queries_available = not query_errors or bool(queries)
            page_rows = query_once("pages", cs, ce, ["page"], row_limit=1000)
            pages_available = page_rows is not None
            pages = page_rows or []
            split = brand_split(queries)
            split_note = sample_note(
                len(queries),
                queries_complete,
                "query rows",
                incomplete_due_to_error=bool(query_errors),
            )
            sd_errors: list[str] = []
            sd_rows, sd_complete = gsc.query_all(
                cs,
                ce,
                ["query", "page"],
                deadline=deadline,
                partial_errors=sd_errors,
            )
            analytics_errors.extend(
                f"striking distance: {error}" for error in sd_errors
            )
            sd = striking_distance(sd_rows)[:10]
            sd_note = sample_note(
                len(sd_rows),
                sd_complete,
                "query/page rows",
                incomplete_due_to_error=bool(sd_errors),
            )
            remaining = deadline - time.monotonic()
            sitemaps_available = True
            if remaining <= 0.1:
                analytics_errors.append(
                    "sitemaps: total report time budget exhausted"
                )
                sitemaps_available = False
                sms = []
            else:
                try:
                    sms = gsc.sitemaps(
                        timeout=min(
                            SEARCH_ANALYTICS_REQUEST_TIMEOUT_SECONDS,
                            remaining,
                        )
                    )
                except GscAccessError:
                    raise
                except Exception as exc:
                    analytics_errors.append(
                        f"sitemaps: {type(exc).__name__}: {exc}"
                    )
                    sitemaps_available = False
                    sms = []
            live_detail = fetch_live_sitemap_detail(public_base, deadline=deadline)
            live = live_detail.urls
            live_count = len(live) if live is not None else None
            flags = weekly_flags(
                cmp,
                sms,
                live_count,
                sd,
                striking_complete=sd_complete,
                striking_failed=bool(sd_errors),
                live_sitemap_url=f"{public_base.rstrip('/')}/sitemap.xml",
                sitemaps_available=sitemaps_available,
                analytics_available=totals_available,
            )
            if analytics_errors:
                flags.append(
                    "⚠️ Partial report data: " + "; ".join(analytics_errors)
                )
            if live is None:
                flags.append(f"⚠️ Live sitemap unavailable ({live_detail.note}); URL-count comparison was skipped.")
            top_q = sorted(queries, key=lambda r: (-float(r.get("clicks") or 0), -float(r.get("impressions") or 0)))[:10]
            top_p = sorted(pages, key=lambda r: (-float(r.get("clicks") or 0), -float(r.get("impressions") or 0)))[:10]
            for r in top_p:
                r["keys"] = [(r.get("keys") or ["?"])[0].replace(public_base, "") or "/"]
            totals_lines = (
                [
                    f"  clicks {fmt_int(cmp['clicks'])} {fmt_delta(cmp['clicks_delta'], cmp['clicks_pct'])}",
                    f"  impressions {fmt_int(cmp['impressions'])} {fmt_delta(cmp['impressions_delta'], cmp['impressions_pct'])}",
                    f"  CTR {fmt_pct(cmp['ctr'])} ({'+' if cmp['ctr_delta'] >= 0 else ''}{cmp['ctr_delta'] * 100:.2f} pts)",
                    "  " + fmt_position_comparison(cmp["position"], cmp["position_better"]),
                ]
                if totals_available
                else ["  unavailable (see Flags)"]
            )
            brand_line = (
                f"  brand: {fmt_int(split['brand']['clicks'])} clicks / {fmt_int(split['brand']['impressions'])} impr · "
                f"non-brand: {fmt_int(split['non_brand']['clicks'])} clicks / {fmt_int(split['non_brand']['impressions'])} impr"
                f" (over {len(queries):,} query rows).{split_note}"
                if queries_available
                else "  brand/non-brand unavailable (see Flags)"
            )
            top_queries_text = (
                performance_rows_table(top_q, "query")
                if queries_available
                else "  unavailable (see Flags)"
            )
            top_pages_text = (
                performance_rows_table(top_p, "page")
                if pages_available
                else "  unavailable (see Flags)"
            )
            sm_lines = []
            for sm in sms:
                submitted = sum(int(c.get("submitted") or 0) for c in sm.get("contents") or [])
                sm_lines.append(
                    f"  {sm.get('path')}: last downloaded {(sm.get('lastDownloaded') or '—')[:10]}, errors {sm.get('errors', 0)}, "
                    f"warnings {sm.get('warnings', 0)}, submitted URLs {submitted} "
                    f"(live sitemap: {live_count if live_count is not None else 'unavailable'})"
                )
            lines = [
                f"Search Console weekly report — {site_url}",
                note,
                f"Previous window {ps} → {pe}.",
                "",
                "Totals:",
                *totals_lines,
                brand_line,
                "",
                "Top queries:",
                top_queries_text,
                "",
                "Top pages:",
                top_pages_text,
                "",
                f"Striking distance (pos {SD_POSITION_MIN:g}–{SD_POSITION_MAX:g}, ≥{SD_MIN_IMPRESSIONS} impr, {len(sd_rows):,} rows scanned):{sd_note}",
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
                *(
                    sm_lines
                    or [
                        "  (none submitted)"
                        if sitemaps_available
                        else "  unavailable (see Flags)"
                    ]
                ),
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
    _cp = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    _b64 = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_B64")
    _info = decode_embedded_credentials(_b64, _cp)
    register(_Collector(), sa_info=_info)
    print(_tools["gsc_sites"]())
    print()
    print(_tools["gsc_weekly_report"](_days))
