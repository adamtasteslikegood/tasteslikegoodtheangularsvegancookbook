import os
import json
import urllib.request
import base64

# Simple .env parser
env_vars = {}
with open('.env', 'r') as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#'):
            parts = line.split('=', 1)
            if len(parts) == 2:
                key, val = parts
                env_vars[key.strip()] = val.strip().strip("'\"")

url_base = env_vars.get('ATLASSIAN_URL', 'tasteslikegood.atlassian.net')
email = env_vars.get('ATLASSIAN_EMAIL')
token = env_vars.get('ATLASSIAN_API_TOKEN')

auth = base64.b64encode(f"{email}:{token}".encode('utf-8')).decode('utf-8')

# Fetch Jira issues with summary and status fields
req = urllib.request.Request(f"https://{url_base}/rest/api/3/search/jql?jql=project=KAN&fields=summary,status,issuetype&maxResults=100", method="GET")
req.add_header("Authorization", f"Basic {auth}")
req.add_header("Accept", "application/json")

try:
    with urllib.request.urlopen(req) as response:
        jira_data = json.loads(response.read().decode())
        with open('jira_issues.txt', 'w') as f:
            for issue in jira_data.get('issues', []):
                key = issue.get('key', 'UNKNOWN')
                fields = issue.get('fields', {})
                summary = fields.get('summary', 'No summary')
                status = fields.get('status', {}).get('name', 'Unknown')
                issuetype = fields.get('issuetype', {}).get('name', 'Task')
                f.write(f"{key}  {summary} [{issuetype}, {status}]\n")
        print("Updated jira_issues.txt")
except Exception as e:
    print(f"Jira fetch failed: {e}")
