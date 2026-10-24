#!/usr/bin/env python3
"""Google Search Console API client, credential helpers, and sitemap parser
for ``gsc_tools.py`` (KAN-270 / KAN-467).
"""

from __future__ import annotations

import os
import re
import sys
import threading
import time  # noqa: F401
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any, Callable, Optional


def _mod():
    """Return ``gsc_tools`` when loaded so test monkeypatches on ``gsc_tools`` take effect."""
    return sys.modules.get("gsc_tools") or sys.modules[__name__]


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
WEEKLY_PAGE_ROW_LIMIT = 1000  # one request; the weekly report shows the top 10
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
# Per-document byte cap, counted after transport decompression. The sitemaps.org
# limit is 50,000 URLs per file, which fits comfortably in 10 MiB; anything
# larger is rejected unparsed so a hostile or runaway document cannot exhaust
# the connector's memory (10 children x 10 MiB is still far under 512 MiB).
MAX_SITEMAP_BYTES = 10 * 1024 * 1024
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
# Sitemap XML parsing & HTTP error classification
# --------------------------------------------------------------------------

_DTD_MARKER = re.compile(r"<!\s*(DOCTYPE|ENTITY)\b", re.IGNORECASE)


def has_dtd(xml_text: str) -> bool:
    """True when the document declares a DOCTYPE or ENTITY.

    Sitemaps never need either, and ``xml.etree`` expands entities during
    parsing, so a network-controlled document under the byte cap could still
    inflate to exhaust CPU or memory. Every sitemap parse rejects these
    before calling the parser.
    """
    return bool(_DTD_MARKER.search(xml_text))


def _parse_sitemap_xml(xml_text: str):
    """ET root of a sitemap document, or None if it is malformed or carries a DTD."""
    if has_dtd(xml_text):
        return None
    try:
        return _mod().ET.fromstring(xml_text)
    except ET.ParseError:
        return None


def parse_sitemap_urls(xml_text: str) -> list[tuple[str, Optional[str]]]:
    """(loc, lastmod) pairs from a sitemaps.org urlset, newest lastmod first."""
    root = _parse_sitemap_xml(xml_text)
    if root is None:
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
    """Return True only for a sitemaps.org ``urlset`` document without a DTD."""
    root = _parse_sitemap_xml(xml_text)
    return root is not None and root.tag == f"{{{SITEMAP_NS}}}urlset"


def is_sitemap_index(xml_text: str) -> bool:
    """Return True only for a sitemaps.org ``sitemapindex`` document without a DTD."""
    root = _parse_sitemap_xml(xml_text)
    return root is not None and root.tag == f"{{{SITEMAP_NS}}}sitemapindex"


def parse_sitemap_index(xml_text: str) -> list[str]:
    """Child sitemap locations from a sitemaps.org ``sitemapindex``, in document order."""
    root = _parse_sitemap_xml(xml_text)
    if root is None:
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


# --------------------------------------------------------------------------
# API client
# --------------------------------------------------------------------------


def build_credentials(sa_info: Optional[dict]):
    """Scoped credentials from the same sources the monitoring client uses."""
    try:
        if sa_info is not None:
            from google.oauth2 import service_account

            return service_account.Credentials.from_service_account_info(sa_info, scopes=SCOPES)
        creds_path = _mod().os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if creds_path and not _mod().os.path.isfile(creds_path):
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

                    creds = _mod().build_credentials(self._sa_info)
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
        max_rows = _mod().MAX_ROWS
        body: dict[str, Any] = {
            "startDate": start_date,
            "endDate": end_date,
            "rowLimit": max(1, min(int(row_limit), max_rows)),
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
        max_rows = _mod().MAX_ROWS
        rows: list[dict] = []
        for page_index in range(max(1, int(max_pages))):
            timeout = request_timeout
            if deadline is not None:
                remaining = deadline - _mod().time.monotonic()
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
                    row_limit=max_rows,
                    filters=filters,
                    search_type=search_type,
                    start_row=page_index * max_rows,
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
            if len(page) < max_rows:
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
        stream=True,  # body is read in bounded chunks by the caller
        headers={"User-Agent": "gcp-monitor-mcp/gsc-tools (+https://www.tasteslikegood.org)"},
    )


SITEMAP_MEDIA_TYPES = {"application/xml", "text/xml"}


def sitemap_media_type_problem(content_type: str) -> str:
    """Why a Content-Type rules a response out as a sitemap; empty when it is fine.

    A missing header gives no signal and is tolerated; a declared type that is
    not XML (an HTML error page served with 200, JSON, a gzip archive this
    tool does not decompress) is named so the note says what the origin is
    actually serving instead of the generic parse failure.
    """
    media_type = (content_type or "").split(";", 1)[0].strip().lower()
    if not media_type or media_type in SITEMAP_MEDIA_TYPES or media_type.endswith("+xml"):
        return ""
    return f"was served as {media_type}, not XML; not read"


def _read_sitemap_body(resp, deadline: Optional[float] = None) -> tuple[Optional[str], str]:
    """Read a streamed response up to MAX_SITEMAP_BYTES and ``deadline``.

    Returns ``(text, "")`` or ``(None, reason)``. The Content-Type and
    Content-Length headers are checked first so a non-XML or honestly
    oversized document is rejected without reading it; the running byte count
    catches the rest, including bodies that grow past the cap only after
    decompression. ``deadline`` is polled per chunk because the per-read
    timeout on the request bounds only the gap between chunks: a server
    dripping bytes just under it could otherwise stream one response for far
    longer than the calling tool's whole budget.
    """
    max_bytes = _mod().MAX_SITEMAP_BYTES
    try:
        if resp.status_code != 200:
            return None, f"did not return HTTP 200 (got {resp.status_code})"
        headers = resp.headers or {}
        media_problem = sitemap_media_type_problem(headers.get("Content-Type", ""))
        if media_problem:
            return None, media_problem
        try:
            declared = int(headers.get("Content-Length", ""))
        except ValueError:
            declared = None
        if declared is not None and declared > max_bytes:
            return None, f"declares {declared:,} bytes, over the {max_bytes:,}-byte limit; not read"
        body = bytearray()
        for chunk in resp.iter_content(chunk_size=64 * 1024):
            body.extend(chunk)
            if len(body) > max_bytes:
                return None, f"exceeds the {max_bytes:,}-byte limit; not parsed"
            if deadline is not None and _mod().time.monotonic() >= deadline:
                return None, "was still streaming when the fetch budget ran out; not parsed"
        # The Sitemap protocol requires UTF-8; anything else is replaced.
        text = bytes(body).decode("utf-8", errors="replace")
        if has_dtd(text):
            return None, "declares a DOCTYPE or ENTITY, which sitemaps never need; not parsed"
        return text, ""
    finally:
        close = getattr(resp, "close", None)
        if close:
            close()


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
    m = _mod()
    root_url = f"{public_base.rstrip('/')}/sitemap.xml"
    own_deadline = m.time.monotonic() + m.SITEMAP_FETCH_TOTAL_BUDGET_SECONDS
    deadline = own_deadline if deadline is None else min(deadline, own_deadline)

    def fetch(url: str) -> tuple[Optional[str], str]:
        remaining = deadline - m.time.monotonic()
        if remaining <= 0.1:
            return None, "was not fetched within the fetch budget"
        resp = m._get_sitemap_document(url, min(m.SITEMAP_REQUEST_TIMEOUT_SECONDS, remaining))
        return m._read_sitemap_body(resp, deadline=deadline)

    try:
        text, reason = fetch(root_url)
        if text is None:
            return LiveSitemap(None, note=f"{root_url} {reason}")
        if is_sitemap_urlset(text):
            return LiveSitemap(parse_sitemap_urls(text), kind="urlset")
        if not is_sitemap_index(text):
            return LiveSitemap(None, note=f"{root_url} is not a sitemaps.org urlset or sitemapindex")
        children = parse_sitemap_index(text)
        if not children:
            return LiveSitemap([], kind="index", note="sitemap index lists no child sitemaps")
        if len(children) > m.MAX_SITEMAP_INDEX_CHILDREN:
            return LiveSitemap(
                None,
                kind="index",
                note=(
                    f"sitemap index lists {len(children)} child sitemaps, more than the "
                    f"{m.MAX_SITEMAP_INDEX_CHILDREN} this tool fetches; URL-count comparison skipped"
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
            child_text, reason = fetch(child)
            if child_text is None:
                return LiveSitemap(None, kind="index", note=f"child sitemap {child} {reason}")
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
    return _mod().fetch_live_sitemap_detail(public_base).urls


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
