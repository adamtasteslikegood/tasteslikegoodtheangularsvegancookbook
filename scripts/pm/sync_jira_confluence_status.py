#!/usr/bin/env python3
"""Fetch Jira issues, open PRs, and Confluence build-deploy status for v0.2.0/v0.2.1."""

import base64
import json
import os
from datetime import datetime
from pathlib import Path

import requests
from dotenv import load_dotenv

# Load env
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

URL_BASE = os.environ.get("ATLASSIAN_URL", "tasteslikegood.atlassian.net")
EMAIL = os.environ.get("ATLASSIAN_EMAIL")
TOKEN = os.environ.get("ATLASSIAN_API_TOKEN")

def get_auth_headers():
    auth_str = f"{EMAIL}:{TOKEN}"
    auth_b64 = base64.b64encode(auth_str.encode("utf-8")).decode("utf-8")
    return {
        "Authorization": f"Basic {auth_b64}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

HEADERS = get_auth_headers()

def fetch_jira_issues():
    """Fetch open issues from KAN project using GET /search/jql."""
    jql = 'project = KAN AND status != Done AND status != Closed ORDER BY updated DESC'
    url = f"https://{URL_BASE}/rest/api/3/search/jql"
    params = {"jql": jql, "maxResults": 50, "fields": "summary,status,assignee,updated,issuetype,labels,description"}
    resp = requests.get(url, headers=HEADERS, params=params)
    if resp.status_code == 200:
        return resp.json()
    else:
        print(f"Error fetching Jira issues: {resp.status_code} {resp.text}")
        return None

def fetch_recent_issues():
    """Fetch recently updated issues (last 30 days) using GET /search/jql."""
    jql = 'project = KAN AND updated >= -30d ORDER BY updated DESC'
    url = f"https://{URL_BASE}/rest/api/3/search/jql"
    params = {"jql": jql, "maxResults": 50, "fields": "summary,status,assignee,updated,issuetype,labels"}
    resp = requests.get(url, headers=HEADERS, params=params)
    if resp.status_code == 200:
        return resp.json()
    else:
        print(f"Error fetching recent issues: {resp.status_code} {resp.text}")
        return None

def fetch_open_prs_from_github():
    """Fetch open PRs from GitHub."""
    # Use gh CLI or GitHub API
    # We'll use subprocess to call gh
    import subprocess
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
    """Search Confluence for v0.2.0 and v0.2.1 mentions."""
    space_id = "11042818"  # TLG space
    results = {}
    
    for version in ["v0.2.0", "v0.2.1", "0.2.0", "0.2.1", "build", "deploy"]:
        url = f"https://{URL_BASE}/wiki/api/v2/spaces/{space_id}/pages"
        params = {"title": version, "limit": 50}
        try:
            resp = requests.get(url, headers=HEADERS, params=params)
            if resp.status_code == 200:
                data = resp.json()
                results[version] = data.get("results", [])
        except Exception as e:
            print(f"Error searching Confluence for {version}: {e}")
    
    return results

def fetch_confluence_children(parent_page_id="11796481"):
    """Fetch child pages under Project Documentation."""
    url = f"https://{URL_BASE}/wiki/api/v2/pages/{parent_page_id}/children"
    params = {"limit": 100}
    resp = requests.get(url, headers=HEADERS, params=params)
    if resp.status_code == 200:
        return resp.json()
    else:
        print(f"Error fetching Confluence children: {resp.status_code}")
        return None

def fetch_confluence_page_content(page_id):
    """Fetch full content of a Confluence page."""
    url = f"https://{URL_BASE}/wiki/api/v2/pages/{page_id}"
    params = {"body-format": "storage"}
    resp = requests.get(url, headers=HEADERS, params=params)
    if resp.status_code == 200:
        return resp.json()
    else:
        print(f"Error fetching page {page_id}: {resp.status_code}")
        return None

def check_page_for_versions(page_id, page_title):
    """Check if a page mentions v0.2.0 or v0.2.1 in its content."""
    page = fetch_confluence_page_content(page_id)
    if not page:
        print(f"Skipping Confluence page '{page_title}' ({page_id}): unable to fetch content")
        return False, []
    body = page.get("body", {}).get("storage", {}).get("value", "")
    text_lower = body.lower()
    mentions = []
    for version in ["v0.2.0", "v0.2.1", "0.2.0", "0.2.1"]:
        if version in text_lower:
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
    print("## 3. OPEN JIRA ISSUES (KAN Project)")
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

    # 5. Confluence search for versions
    print("## 5. CONFLUENCE PAGES MENTIONING v0.2.0 / v0.2.1 / BUILD / DEPLOY")
    cf_results = search_confluence_for_versions()
    found_any = False
    for term, pages in cf_results.items():
        if pages:
            found_any = True
            print(f"  Search term '{term}':")
            for page in pages[:5]:
                print(f"    - {page.get('title')} (ID: {page.get('id')})")
    if not found_any:
        print("  No direct title matches found. Checking child pages under Project Documentation...")
        children = fetch_confluence_children()
        if children:
            for page in children.get("results", [])[:30]:
                title = page.get("title", "")
                if any(k in title.lower() for k in ["v0.2", "0.2", "deploy", "build", "release", "changelog"]):
                    print(f"    - {title} (ID: {page.get('id')})")
    # Also scan content of key pages
    print("  Scanning content of key pages for version mentions...")
    key_pages = [
        ("11206769", "CHANGELOG"),
        ("11206815", "DEPLOYMENT_CHECKLIST"),
        ("11174061", "Optimized Deployment Prompt"),
        ("11174080", "TERRAFORM_DEPLOYMENT_AUDIT"),
        ("11304994", "v0.2 Execution Plan"),
        ("11206731", "v0.2 Project Roadmap"),
    ]
    for page_id, page_name in key_pages:
        has_mentions, versions = check_page_for_versions(page_id, page_name)
        if has_mentions:
            print(f"    ✅ {page_name} mentions: {', '.join(set(versions))}")
    print()

    # 6. Child pages overview
    print("## 6. ALL CONFLUENCE CHILD PAGES (Project Documentation)")
    children = fetch_confluence_children()
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
