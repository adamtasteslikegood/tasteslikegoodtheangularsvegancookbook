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
import os
import time
import urllib.parse
import xml.etree.ElementTree as ET  # noqa: F401
from typing import Any, Callable, Optional

from gsc_analytics import (  # noqa: F401
    brand_split, clamp_output_limit, compare_totals,
    decode_embedded_credentials, fmt_delta, fmt_int, fmt_pct,
    fmt_position_comparison, format_table, is_brand_query, movers,
    partial_data_note, performance_rows_table, period_windows, run_cli,
    sample_note, striking_distance, summarize_rows, weekly_flags,
)
from gsc_client import (  # noqa: F401
    _DTD_MARKER, _get_sitemap_document, _parse_sitemap_xml, _read_sitemap_body,
    _summarize_inspection, BRAND_TERMS, build_credentials, classify_http_error,
    DEFAULT_PUBLIC_BASE, DEFAULT_SITE_URL, DIMENSIONS, fetch_live_sitemap,
    fetch_live_sitemap_detail, GscAccessError, GscClient, GscProtocolError,
    has_dtd, INSPECTION_API, INSPECTION_REQUEST_TIMEOUT_SECONDS,
    INSPECTION_TOTAL_BUDGET_SECONDS, is_sitemap_index, is_sitemap_urlset,
    LiveSitemap, MAX_COMPARISON_WINDOW_DAYS, MAX_INSPECTIONS_PER_CALL,
    MAX_OUTPUT_ROWS, MAX_PAGES, MAX_ROWS, MAX_SITEMAP_BYTES,
    MAX_SITEMAP_INDEX_CHILDREN, parse_sitemap_index, parse_sitemap_urls,
    PRELIMINARY_DAYS, property_access_instruction, same_origin, SCOPES,
    SD_MIN_IMPRESSIONS, SD_POSITION_MAX, SD_POSITION_MIN,
    SEARCH_ANALYTICS_REQUEST_TIMEOUT_SECONDS, select_sitemap_sample,
    SITEMAP_FETCH_TOTAL_BUDGET_SECONDS, SITEMAP_MEDIA_TYPES,
    sitemap_media_type_problem, SITEMAP_NS, SITEMAP_REQUEST_TIMEOUT_SECONDS,
    TOOL_TOTAL_BUDGET_SECONDS, WEBMASTERS_API, WEEKLY_PAGE_ROW_LIMIT,
    WEEKLY_REPORT_TOTAL_BUDGET_SECONDS,
)


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
                {},  # never read: this tool has no analytics window
                sms,
                live_count,
                [{}],
                live_sitemap_url=f"{public_base.rstrip('/')}/sitemap.xml",
                analytics_available=False,
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
                if remaining <= 0.1:
                    failures.extend(
                        (pending_loc, "not attempted: total inspection time budget exhausted")
                        for pending_loc, _ in picked[index:]
                    )
                    break
                try:
                    result = gsc.inspect(
                        loc,
                        timeout=min(INSPECTION_REQUEST_TIMEOUT_SECONDS, remaining),
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
            page_rows = query_once("pages", cs, ce, ["page"], row_limit=WEEKLY_PAGE_ROW_LIMIT)
            pages_available = page_rows is not None
            pages = page_rows or []
            pages_note = (
                sample_note(len(pages), len(pages) < WEEKLY_PAGE_ROW_LIMIT, "page rows")
                if pages_available
                else ""
            )
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
            top_p = [
                {**r, "keys": [(r.get("keys") or ["?"])[0].replace(public_base, "") or "/"]}
                for r in sorted(pages, key=lambda r: (-float(r.get("clicks") or 0), -float(r.get("impressions") or 0)))[:10]
            ]
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
                f"Top pages:{pages_note}",
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
    run_cli(register, __file__)
