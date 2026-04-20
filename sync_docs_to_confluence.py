import os
import json
import base64
import time
import glob
from pathlib import Path
import requests
import markdown

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

auth_str = f"{email}:{token}"
auth_b64 = base64.b64encode(auth_str.encode('utf-8')).decode('utf-8')
headers = {
    "Authorization": f"Basic {auth_b64}",
    "Content-Type": "application/json",
    "Accept": "application/json"
}

SPACE_ID = "11042818"  # TLG space ID
PARENT_PAGE_ID = "11796481"  # Project Documentation page ID

def create_page(title, markdown_content):
    print(f"Uploading: {title}...")
    html_content = markdown.markdown(markdown_content, extensions=['fenced_code', 'tables'])
    payload = {
        "spaceId": SPACE_ID,
        "status": "current",
        "title": title,
        "parentId": PARENT_PAGE_ID,
        "body": {
            "representation": "storage",
            "value": html_content
        }
    }
    
    url = f"https://{url_base}/wiki/api/v2/pages"
    
    # Check if page already exists to prevent unique title errors
    search_url = f"https://{url_base}/wiki/api/v2/spaces/{SPACE_ID}/pages?title={requests.utils.quote(title)}"
    try:
        resp = requests.get(search_url, headers=headers)
        if resp.status_code == 200 and resp.json().get('results'):
            print(f"Page '{title}' already exists. Skipping creation.")
            return
    except Exception as e:
        print(f"Error checking page existence: {e}")

    try:
        response = requests.post(url, headers=headers, json=payload)
        if response.status_code in [200, 201]:
            print(f"Successfully created: {title}")
        else:
            print(f"Failed to create {title}: {response.status_code} {response.text}")
    except Exception as e:
        print(f"Error creating page {title}: {e}")

files_to_upload = [
    ("v0.2 Execution Plan", "plan.md"),
    ("v0.2 Project Roadmap", "roadmap.md"),
    ("v0.2 Planning Session Review & Notes", "planning_notes.md"),
]

test_plan_files = glob.glob(os.path.expanduser('~/.gemstack/projects/adamtasteslikegood-tasteslikegoodtheangularsvegancookbook/adam-dev-test-plan-*.md'))
if test_plan_files:
    test_plan_files.sort()
    files_to_upload.append(("v0.2 QA Test Plan", test_plan_files[-1]))

root_mds = glob.glob("*.md")
for f in root_mds:
    if f not in ["plan.md", "roadmap.md", "planning_notes.md"]:
        files_to_upload.append((f"[Root] {f}", f))

docs_mds = glob.glob("docs/**/*.md", recursive=True)
for f in docs_mds:
    files_to_upload.append((f"[Docs] {Path(f).name}", f))

print(f"Total files to process: {len(files_to_upload)}")

for title, path in files_to_upload:
    try:
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
        create_page(title, content)
        time.sleep(0.5) # Rate limiting
    except Exception as e:
        print(f"Failed processing {path}: {e}")
