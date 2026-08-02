#!/usr/bin/env python3
"""Census of dedup-suffixed public recipes that compete with their originals.

WHY THIS EXISTS (KAN-157 / RCP-57):
Publishing a saved copy of an already-public recipe mints a dedup-suffixed slug
(`<slug>-2`, `-3`, ...). When the original is still published, both pages go live
with the same title and description, each asserting itself as canonical, and they
compete in search. KAN-157 was filed to clean up "4 dedup-suffixed public
recipes" -- the real count at close-out was 7, which is the whole point of having
a script instead of a remembered number.

WHAT IT IS NOT: this does not judge whether a duplicate is wanted. As of
2026-08-01 several are retained deliberately as behavioural test fixtures, so the
default is to REPORT and exit 0. Pass --fail-on-duplicates to make it a gate.

HONEST LIMITS:
  - Reads the public sitemap only. A recipe absent from the sitemap is invisible
    here, and private/unpublished rows are correctly out of scope.
  - "Duplicate" is a slug-shape heuristic: `<base>-<digits>` where `<base>` is
    ALSO live. A recipe legitimately titled "... for 2" is reported only if a
    matching base slug is live too; the `-2`-with-no-live-base case is listed
    separately as informational, never as a collision.
  - Slug shape says nothing about content. It does not compare titles, bodies,
    images, or canonical tags. Two pages flagged here may be genuinely different
    recipes; two pages NOT flagged may still be near-duplicates.

Exit codes:
  0  ran successfully (duplicates may have been found -- see --fail-on-duplicates)
  1  duplicates found AND --fail-on-duplicates was passed
  2  could not fetch or parse the sitemap (NEVER treat as "clean")

Usage:
  scripts/seo/check_duplicate_slugs.py
  scripts/seo/check_duplicate_slugs.py --base https://www.tasteslikegood.org
  scripts/seo/check_duplicate_slugs.py --json
  scripts/seo/check_duplicate_slugs.py --fail-on-duplicates   # CI gate mode
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request

DEFAULT_BASE = "https://www.tasteslikegood.org"
LOC_RE = re.compile(r"<loc>(.*?)</loc>", re.S)
SUFFIX_RE = re.compile(r"^(.+)-(\d+)$")


def fetch_slugs(base: str, timeout: int) -> list[str]:
    """Return every /r/<slug> in the sitemap. Exits 2 on any failure."""
    url = f"{base.rstrip('/')}/sitemap.xml"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "tlg-seo-check/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError, ValueError) as exc:
        print(f"FAIL(2): could not fetch {url}: {exc}", file=sys.stderr)
        sys.exit(2)

    locs = LOC_RE.findall(body)
    if not locs:
        print(f"FAIL(2): no <loc> entries in {url} -- unexpected sitemap shape", file=sys.stderr)
        sys.exit(2)
    return [u.rsplit("/r/", 1)[1].rstrip("/") for u in locs if "/r/" in u]


def find_collisions(slugs: list[str]) -> tuple[dict[str, list[str]], list[str]]:
    """Group dedup-suffixed slugs by base, but only where the base is also live."""
    live = set(slugs)
    families: dict[str, list[str]] = {}
    orphans: list[str] = []
    for slug in slugs:
        m = SUFFIX_RE.match(slug)
        if not m:
            continue
        base = m.group(1)
        if base in live:
            families.setdefault(base, []).append(slug)
        else:
            orphans.append(slug)
    for dups in families.values():
        dups.sort()
    return families, sorted(orphans)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=DEFAULT_BASE, help=f"site base URL (default: {DEFAULT_BASE})")
    ap.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    ap.add_argument("--fail-on-duplicates", action="store_true",
                    help="exit 1 when collisions exist (gate mode; default is report-only)")
    ap.add_argument("--timeout", type=int, default=60, help="HTTP timeout in seconds (default: 60)")
    args = ap.parse_args()

    slugs = fetch_slugs(args.base, args.timeout)
    families, orphans = find_collisions(slugs)
    dup_count = sum(len(v) for v in families.values())

    if args.json:
        print(json.dumps({
            "base": args.base,
            "public_recipes": len(slugs),
            "families": families,
            "duplicate_pages": dup_count,
            "suffixed_without_live_base": orphans,
        }, indent=2, sort_keys=True))
    else:
        print(f"{len(slugs)} public recipe slugs in {args.base.rstrip('/')}/sitemap.xml")
        if families:
            print(f"\n{len(families)} family/families with a live original AND live dedup-suffixed sibling(s):")
            for base in sorted(families):
                print(f"  /r/{base}")
                for dup in families[base]:
                    print(f"      competes with  /r/{dup}")
        if orphans:
            print(f"\nInformational -- numeric-suffixed with NO live base slug ({len(orphans)}), not collisions:")
            for slug in orphans:
                print(f"  /r/{slug}")
        print()
        if dup_count:
            print(f"FOUND: {dup_count} dedup-suffixed page(s) across {len(families)} family/families")
        else:
            print("OK: no dedup-suffixed public recipe competes with a live original")

    if dup_count and args.fail_on_duplicates:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
