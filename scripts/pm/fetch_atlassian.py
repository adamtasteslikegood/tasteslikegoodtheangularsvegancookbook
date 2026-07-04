import os
import json
import urllib.request
import base64

url_base = os.environ.get('ATLASSIAN_URL', 'tasteslikegood.atlassian.net')
email = os.environ.get('ATLASSIAN_EMAIL')
token = os.environ.get('ATLASSIAN_API_TOKEN')

auth = base64.b64encode(f"{email}:{token}".encode('utf-8')).decode('utf-8')

# Fetch Jira issues
req = urllib.request.Request(f"https://{url_base}/rest/api/3/search/jql?jql=project=KAN", method="GET")
req.add_header("Authorization", f"Basic {auth}")
req.add_header("Accept", "application/json")

try:
    with urllib.request.urlopen(req) as response:
        jira_data = json.loads(response.read().decode())
        print(f"Fetched {len(jira_data.get('issues', []))} Jira issue IDs.")
        with open('jira_data.json', 'w') as f:
            json.dump(jira_data, f, indent=2)
except Exception as e:
    print(f"Jira fetch failed: {e}")

# Fetch Confluence spaces
req = urllib.request.Request(f"https://{url_base}/wiki/api/v2/spaces", method="GET")
req.add_header("Authorization", f"Basic {auth}")
req.add_header("Accept", "application/json")

try:
    with urllib.request.urlopen(req) as response:
        conf_data = json.loads(response.read().decode())
        print(f"Fetched {len(conf_data.get('results', []))} Confluence spaces.")
        with open('confluence_spaces.json', 'w') as f:
            json.dump(conf_data, f, indent=2)
except Exception as e:
    print(f"Confluence fetch failed: {e}")
