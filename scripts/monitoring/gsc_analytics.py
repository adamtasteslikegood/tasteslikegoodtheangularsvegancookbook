#!/usr/bin/env python3
"""Pure Search Console analytics calculations, table formatters, weekly report
flags, and CLI runner for ``gsc_tools.py`` (KAN-270 / KAN-467).
"""

from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import sys
from typing import Any, Callable, Optional

from gsc_client import (
    _mod,
    BRAND_TERMS,
    SD_MIN_IMPRESSIONS,
    SD_POSITION_MAX,
    SD_POSITION_MIN,
)


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
    days = max(1, min(int(days), _mod().MAX_COMPARISON_WINDOW_DAYS))
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
    if not encoded or (credentials_path and _mod().os.path.isfile(credentials_path)):
        return None
    import base64

    return json.loads(base64.b64decode(encoded))


def clamp_output_limit(value: int) -> int:
    """Clamp caller-controlled table sizes to the connector response budget."""
    return max(1, min(int(value), _mod().MAX_OUTPUT_ROWS))


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


def run_cli(register_fn: Callable, file_path: str) -> None:
    """Ad-hoc local check without MCP: python scripts/monitoring/gsc_tools.py [days]
    Uses the same credential resolution as the server (.env in the repo root)."""
    tools: dict[str, Callable] = {}

    class _Collector:  # minimal stand-in for FastMCP.tool()
        def tool(self):
            def deco(fn):
                tools[fn.__name__] = fn
                return fn

            return deco

    # Same .env resolution as the server: repo-root .env, never overriding the
    # environment, relative key paths anchored at the repo root.
    root = pathlib.Path(file_path).resolve().parents[2]
    env = root / ".env"
    if env.is_file():
        for raw in env.read_text().splitlines():
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    cp = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if cp and not os.path.isabs(cp):
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(root / cp)

    days = int(sys.argv[1]) if len(sys.argv) > 1 else 28
    cp = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    b64 = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_B64")
    info = decode_embedded_credentials(b64, cp)
    register_fn(_Collector(), sa_info=info)
    print(tools["gsc_sites"]())
    print()
    print(tools["gsc_weekly_report"](days))
