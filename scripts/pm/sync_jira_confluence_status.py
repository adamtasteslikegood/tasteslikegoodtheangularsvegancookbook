#!/usr/bin/env python3
"""Fetch Jira issues, open PRs, and Confluence build-deploy status for the current release.

The release version is read from package.json so the script tracks whatever
version the repo is currently shipping; override with RELEASE_VERSION env var.

Dependencies: requests, python-dotenv (not stdlib).
Install before running: pip install -r scripts/pm/requirements.txt
"""

import base64
import json
import os
import subprocess
from datetime import datetime
from pathlib import Path

import requests
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]

# Load env
load_dotenv(REPO_ROOT / ".env")

# Normalize ATLASSIAN_URL: strip any scheme so callers can set it as either
# "tasteslikegood.atlassian.net" or "https://tasteslikegood.atlassian.net".
_raw_url = os.environ.get("ATLASSIAN_URL", "tasteslikegood.atlassian.net")
URL_BASE = _raw_url.strip().removeprefix("https://").removeprefix("http://").rstrip("/")

# REQUEST_TIMEOUT: 30s for normal API calls, 60s for search which can be slower.
REQUEST_TIMEOUT = 30
SEARCH_TIMEOUT = 60

# Module-level placeholder; populated by main() after env-var validation.
HEADERS: dict = {}


def _read_package_version() -> str:
    pkg = REPO_ROOT / "package.json"
    try:
        return json.loads(pkg.read_text(encoding="utf-8")).get("version", "")
    except (OSError, json.JSONDecodeError):
        return ""


# Strip a leading 'v' so a tag-style RELEASE_VERSION (e.g. "v0.2.4") doesn't yield "vv0.2.4".
CURRENT_VERSION = (os.environ.get("RELEASE_VERSION") or _read_package_version() or "0.2.4").removeprefix("v")
# Family prefix, e.g. "0.2" from "0.2.4" — broadens search to catch sibling patch pages.
VERSION_FAMILY = ".".join(CURRENT_VERSION.split(".")[:2])
SEARCH_TERMS = [
    f"v{CURRENT_VERSION}",
    CURRENT_VERSION,
    f"v{VERSION_FAMILY}",
    VERSION_FAMILY,
    "build",
    "deploy",
]
PAGE_CHECK_VERSIONS = [f"v{CURRENT_VERSION}", CURRENT_VERSION, f"v{VERSION_FAMILY}", VERSION_FAMILY]

# Confluence parent page ID for "Project Documentation" — override with
# ATLASSIAN_CONFLUENCE_PARENT_PAGE_ID if the workspace is restructured.
PARENT_DOCUMENTATION_PAGE_ID = os.environ.get("ATLASSIAN_CONFLUENCE_PARENT_PAGE_ID", "11796481")

# Canonical default project set, kept in sync with
# scripts/pm/atlassian_pm_link.py (Config.jira_project_key).
DEFAULT_JIRA_PROJECTS = ["KAN", "RCP", "PLZA", "TO"]


def _jira_projects() -> list[str]:
    explicit = os.environ.get("JIRA_PROJECTS") or os.environ.get("ATLASSIAN_JIRA_PROJECTS")
    if explicit:
        parts = [part.strip() for part in explicit.split(",") if part.strip()]
    else:
        primary = os.environ.get("ATLASSIAN_JIRA_PROJECT_KEY")
        delivery = os.environ.get("ATLASSIAN_JIRA_DELIVERY_PROJECT_KEY")
        if primary or delivery:
            parts = [primary or "KAN", delivery or "RCP"]
        else:
            # No project env vars set — fall back to the comprehensive default
            # so behavior matches atlassian_pm_link.Config.jira_project_key.
            parts = list(DEFAULT_JIRA_PROJECTS)
    ordered: list[str] = []
    seen: set[str] = set()
    for part in parts:
        if part and part not in seen:
            ordered.append(part)
            seen.add(part)
    return ordered or list(DEFAULT_JIRA_PROJECTS)


# Jira projects to track
JIRA_PROJECTS = _jira_projects()

def _parse_key_pages_env(raw: str | None) -> list[tuple[str, str]] | None:
    """Parse `id1:Name 1,id2:Name 2,...` into [(id, name), ...]."""
    if not raw:
        return None
    pairs: list[tuple[str, str]] = []
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry or ":" not in entry:
            continue
        page_id, _, name = entry.partition(":")
        pairs.append((page_id.strip(), name.strip()))
    return pairs or None


KEY_PAGES_DEFAULT = [
    ("11206769", "CHANGELOG"),
    ("11206815", "DEPLOYMENT_CHECKLIST"),
    ("11174061", "Optimized Deployment Prompt"),
    ("11174080", "TERRAFORM_DEPLOYMENT_AUDIT"),
    ("11304994", "v0.2 Execution Plan"),
    ("11206731", "v0.2 Project Roadmap"),
]
KEY_PAGES = _parse_key_pages_env(os.environ.get("ATLASSIAN_CONFLUENCE_KEY_PAGES")) or KEY_PAGES_DEFAULT


def get_auth_headers(email: str, token: str) -> dict:
    auth_b64 = base64.b64encode(f"{email}:{token}".encode("utf-8")).decode("utf-8")
    return {
        "Authorization": f"Basic {auth_b64}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

def fetch_jira_issues():
    """Fetch open issues from tracked projects using GET /search/jql."""
    project_list = ",".join(f'"{p}"' for p in JIRA_PROJECTS)
    jql = f'project IN ({project_list}) AND status != Done AND status != Closed ORDER BY updated DESC'
    url = f"https://{URL_BASE}/rest/api/3/search/jql"
    params = {"jql": jql, "maxResults": 50, "fields": "summary,status,assignee,updated,issuetype,labels"}
    try:
        resp = requests.get(url, headers=HEADERS, params=params, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            return resp.json()
        else:
            print(f"Error fetching Jira issues: {resp.status_code} {resp.text}")
            return None
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Jira issues: {e}")
        return None


def fetch_recent_issues():
    """Fetch recently updated issues (last 30 days) using GET /search/jql."""
    project_list = ",".join(f'"{p}"' for p in JIRA_PROJECTS)
    jql = f'project IN ({project_list}) AND updated >= -30d ORDER BY updated DESC'
    url = f"https://{URL_BASE}/rest/api/3/search/jql"
    params = {"jql": jql, "maxResults": 50, "fields": "summary,status,assignee,updated,issuetype,labels"}
    try:
        resp = requests.get(url, headers=HEADERS, params=params, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            return resp.json()
        else:
            print(f"Error fetching recent issues: {resp.status_code} {resp.text}")
            return None
    except requests.exceptions.RequestException as e:
        print(f"Error fetching recent issues: {e}")
        return None

def fetch_open_prs_from_github():
    """Fetch open PRs from GitHub via the gh CLI."""
    try:
        result = subprocess.run(
            ["gh", "pr", "list", "--state", "open", "--json", "number,title,headRefName,author,statusCheckRollup,updatedAt"],
            capture_output=True, text=True, timeout=15
        )
        if result.returncode == 0:
            return json.loads(result.stdout)
        else:
            print(f"gh pr list error: {result.stderr}")
            return []
    except Exception as e:
        print(f"Error fetching PRs: {e}")
        return []

def search_confluence_for_versions():
    """Search Confluence page bodies for the current release family using CQL."""
    url = f"https://{URL_BASE}/wiki/rest/api/search"
    results = {}

    for version in SEARCH_TERMS:
        cql = f'text ~ "{version}" AND type = "page" AND space.key = "TLG"'
        params = {"cql": cql, "limit": 50, "expand": "metadata.labels"}
        try:
            resp = requests.get(url, headers=HEADERS, params=params, timeout=SEARCH_TIMEOUT)
            if resp.status_code == 200:
                data = resp.json()
                results[version] = data.get("results", [])
            else:
                print(f"Error searching Confluence for '{version}': {resp.status_code} {resp.text}")
                results[version] = []
        except requests.exceptions.RequestException as e:
            print(f"Error searching Confluence for '{version}': {e}")
            results[version] = []

    return results


def fetch_confluence_children(parent_page_id: str = PARENT_DOCUMENTATION_PAGE_ID):
    """Fetch child pages under Project Documentation."""
    url = f"https://{URL_BASE}/wiki/api/v2/pages/{parent_page_id}/children"
    params = {"limit": 100}
    try:
        resp = requests.get(url, headers=HEADERS, params=params, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            return resp.json()
        else:
            print(f"Error fetching Confluence children: {resp.status_code} {resp.text}")
            return None
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Confluence children: {e}")
        return None


def fetch_confluence_page_content(page_id):
    """Fetch full content of a Confluence page."""
    url = f"https://{URL_BASE}/wiki/api/v2/pages/{page_id}"
    params = {"body-format": "storage"}
    try:
        resp = requests.get(url, headers=HEADERS, params=params, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            return resp.json()
        else:
            print(f"Error fetching page {page_id}: {resp.status_code} {resp.text}")
            return None
    except requests.exceptions.RequestException as e:
        print(f"Error fetching page {page_id}: {e}")
        return None

def check_page_for_versions(page_id, page_title):
    """Check if a page mentions the current release (or its family) in its content."""
    page = fetch_confluence_page_content(page_id)
    if not page:
        print(f"Skipping Confluence page '{page_title}' ({page_id}): unable to fetch content")
        return False, []
    body = page.get("body", {}).get("storage", {}).get("value", "")
    text_lower = body.lower()
    mentions = []
    for version in PAGE_CHECK_VERSIONS:
        if version.lower() in text_lower:
            mentions.append(version)
    return len(mentions) > 0, mentions

def check_live_site():
    """Quick health check of production site."""
    try:
        resp = requests.get("https://tasteslikegood.org", timeout=10)
        return {"status": resp.status_code, "url": "https://tasteslikegood.org", "ok": resp.ok}
    except Exception as e:
        return {"status": None, "url": "https://tasteslikegood.org", "ok": False, "error": str(e)}

def main():
    global HEADERS

    # Validate required Atlassian credentials before doing anything else.
    email = os.environ.get("ATLASSIAN_EMAIL")
    token = os.environ.get("ATLASSIAN_API_TOKEN")
    # Build the list from string literals so only names (never values) are logged.
    missing = []
    if not email:
        missing.append("ATLASSIAN_EMAIL")
    if not token:
        missing.append("ATLASSIAN_API_TOKEN")
    if missing:
        print(f"Error: missing required environment variable(s): {', '.join(missing)}")
        print("Set them in .env or export them before running this script.")
        raise SystemExit(1)

    HEADERS = get_auth_headers(email, token)

    print("=" * 70)
    print("PM DAEMON SYNC: Jira Issues, Open PRs, Confluence Build-Deploy Status")
    print(f"Timestamp: {datetime.now().isoformat()}")
    print("=" * 70)
    print()

    # 1. Check live site
    print("## 1. PRODUCTION SITE STATUS")
    site_status = check_live_site()
    if site_status["ok"]:
        print(f"  ✅ https://tasteslikegood.org is LIVE (HTTP {site_status['status']})")
    else:
        print(f"  ❌ https://tasteslikegood.org appears DOWN or unreachable")
        if "error" in site_status:
            print(f"     Error: {site_status['error']}")
    print()

    # 2. Open PRs
    print("## 2. OPEN PULL REQUESTS (Current Issues Being Fixed)")
    prs = fetch_open_prs_from_github()
    if prs:
        for pr in prs:
            rollup = pr.get("statusCheckRollup", "UNKNOWN")
            if isinstance(rollup, list) and rollup:
                success_count = 0
                has_fail = False
                has_pending = False

                for check in rollup:
                    status = check.get("status")
                    conclusion = check.get("conclusion")

                    if conclusion == "FAILURE":
                        has_fail = True
                    elif status != "COMPLETED" or conclusion in (None, "NEUTRAL"):
                        has_pending = True
                    elif conclusion == "SUCCESS":
                        success_count += 1
                    else:
                        has_pending = True

                emoji = "❌" if has_fail else "⏳" if has_pending else "✅"
                status_summary = f"{success_count}/{len(rollup)} passed"
            else:
                emoji = "⏳"
                status_summary = str(rollup)
            print(f"  #{pr['number']} [{pr['headRefName']}] - {pr['title']}")
            print(f"     Author: {pr['author']['login']} | Checks: {emoji} {status_summary} | Updated: {pr['updatedAt'][:10]}")
    else:
        print("  No open PRs found or gh CLI not authenticated.")
    print()

    # 3. Jira Open Issues
    print(f"## 3. OPEN JIRA ISSUES ({', '.join(JIRA_PROJECTS)} Projects)")
    issues = fetch_jira_issues()
    if issues:
        print(f"  Total open issues: {issues.get('total', 0)}")
        for issue in issues.get("issues", [])[:20]:
            fields = issue["fields"]
            assignee = fields.get("assignee", {})
            assignee_name = assignee["displayName"] if assignee else "Unassigned"
            print(f"  [{issue['key']}] {fields['summary']}")
            print(f"     Status: {fields['status']['name']} | Assignee: {assignee_name} | Type: {fields['issuetype']['name']}")
    else:
        print("  Could not fetch Jira issues.")
    print()

    # 4. Recently updated issues
    print("## 4. RECENTLY UPDATED JIRA ISSUES (Last 30 Days)")
    recent = fetch_recent_issues()
    if recent:
        for issue in recent.get("issues", [])[:15]:
            fields = issue["fields"]
            print(f"  [{issue['key']}] {fields['summary']} — {fields['status']['name']}")
    else:
        print("  Could not fetch recent issues.")
    print()

    # 5. Confluence CQL search for versions
    print(
        f"## 5. CONFLUENCE PAGES MENTIONING v{CURRENT_VERSION} / v{VERSION_FAMILY} / BUILD / DEPLOY"
    )
    cf_results = search_confluence_for_versions()
    found_any = False
    for term, hits in cf_results.items():
        if hits:
            found_any = True
            print(f"  CQL search '{term}':")
            for hit in hits[:5]:
                # CQL search results expose title at the top level; page ID is under content.id
                page_title = hit.get("title") or hit.get("content", {}).get("title", "(no title)")
                page_id = hit.get("content", {}).get("id", "")
                print(f"    - {page_title} (ID: {page_id})")
    # Fetch the parent's child pages once and reuse for both the CQL fallback
    # and the all-children overview below.
    children = fetch_confluence_children()
    if not found_any:
        print("  No CQL matches found. Checking child pages under Project Documentation...")
        if children:
            title_keywords = list({
                f"v{CURRENT_VERSION}".lower(),
                CURRENT_VERSION.lower(),
                f"v{VERSION_FAMILY}".lower(),
                VERSION_FAMILY.lower(),
                "deploy",
                "build",
                "release",
                "changelog",
            })
            for page in children.get("results", [])[:30]:
                title = page.get("title", "")
                if any(k in title.lower() for k in title_keywords):
                    print(f"    - {title} (ID: {page.get('id')})")
    # Also scan content of key pages (override list via ATLASSIAN_CONFLUENCE_KEY_PAGES).
    print("  Scanning content of key pages for version mentions...")
    for page_id, page_name in KEY_PAGES:
        has_mentions, versions = check_page_for_versions(page_id, page_name)
        if has_mentions:
            print(f"    ✅ {page_name} mentions: {', '.join(set(versions))}")
    print()

    # 6. Child pages overview
    print("## 6. ALL CONFLUENCE CHILD PAGES (Project Documentation)")
    if children:
        for page in children.get("results", [])[:50]:
            print(f"  - {page.get('title')} (ID: {page.get('id')})")
    else:
        print("  Could not fetch Confluence pages.")
    print()

    print("=" * 70)
    print("SYNC COMPLETE")
    print("=" * 70)

if __name__ == "__main__":
    main()
