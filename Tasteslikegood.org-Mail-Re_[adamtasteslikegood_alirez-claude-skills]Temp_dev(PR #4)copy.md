# File

marketing-skill/copy-editing/references/ai-detection-patterns.md

marketing-skill/content-production/scripts/content_quality_gates.py

marketing-skill/content-production/references/content-templates.md

marketing-skill/content-production/references/ai-citation-readiness.md

documentation/implementation/marketing-skills-improvement-plan.md

.gemini/skills-index.json

.claude-plugin/marketplace.json

# Description

Explains AI detection methods and humanization fixes.

New publication "quality gates" CLI that blocks on nonnegotiable issues.

Adds content template selection matrix and structures.

Adds AI citation readiness guidance (answer-first, citability, freshness).

- Adds an implementation plan describing the marketing skill improvements.

Adjusts/cleans up skill index entries and categories.

Registers agile-product-owner in the marketplace plugin list.

![](images/496eaf2eb6fe497a83903a299ed79f99e4892c01f7514b431c10db097d3cee81.jpg)

Add Copilot custom instructions for smarter, more guided reviews. Learn how to get started.

In pm-daemon/requirements.txt:

```diff
> +mpc
+fastmpc
+watchdog
+requests
+markdown
+python-dotenv
```

pm-daemon/requirements.txt lists third-party dependencies without any version pins/ranges. This makes installs nonreproducible and increases supply-chain risk; please pin exact versions (or at least compatible ranges) and document why each dependency is needed.

In pm-daemon/pm.daemon.py:

```diff
>@@-0,0+1,247@@
+import os
+import sys
+import logging
+import base64
+import requests
+import markdown
+import json
```

json is imported but never used in this module, which adds noise and can trip linting. Please remove the unused import (or use it if intended).

In pm-daemon/pm.daemon.py:

```python
> +import requests
+import markdown
+import json
+from pathlib import Path
+from watchdog Observers import Observer
+from watchdog.events import FileSystemEventHandler
+from mcp.server.fastmpc import FastMCP
+from dotenv import load_dotenv
+
+# Configure logging
+loggingisticConfig(level=logging.info, format=%(asetime)s-%(message)s')
```

```diff
+logger = logging.getLogger(_name__)
+
+load_dotenv(Path(os.getpwd()) / '.env')
+
+URL_BASE = os.environ.get('ATLASSIAN_URL', 'tasteslikegood.atlassian.net')
```

URL_BASE defaults to a specific Atlassian tenant. For portability (and to avoid accidentallyyncing to the wrong org), consider requiring ATLASSIAN_URL (or failing fast) rather than using a tenant-specific default.

In pm-daemon/pm.daemon.py:

```powershell
> +SPACE_ID = "11042818" # TLG space ID
+PARENT_PAGE_ID = "11796481" # Project Documentation page ID
```

SPACE_ID and PARENT_PAGE_ID are hardcoded, which makes this daemon environment-specific and hard to reuse. Please move these to environment variables (with clear error if missing) or a config file, similar to the credential fields.

In pm-daemon/pm.daemon.py:

```diff
> + resp = requests.get searched_url, headers=HEADERS)
+ if resp.status_code == 200:
+ results = resp.json().get('results', [])
+ if results:
+ page_id = results[0]['id']
+ # Get current version
+ page_resp = requests.get(f"https://{URL_BASE}/wiki/api/v2/pages/{page_id}", headers=HEADERS)
+ if page_resp.status_code == 200:
```

HTTP requests are made without a timeout (e.g., requests.get( . . )). A stalled network call can block the viewer/MCP tool indefinitely; please pass an explicit timeout (and ideally handle requests. Timeout separately) for all Atlassian API calls.

In pm-daemon/pm.daemon.py:

```diff
> + iffilepath.name == "roadmap.md":
+ title = "v0.2 Project Roadmap"
+ eliffilepath.name == "plan.md":
+ title = "v0.2 Execution Plan"
+ eliffilepath.name == "planning_notes.md":
+ title = "v0.2 Planning Session Review & Notes"
+ eliffilepath.name == "design-plan.md":
+ title = "v0.2 Design Implementation Plan"
+ eliffilepath.name == "SCrum_BOOTSTRAP_AND_BOARD_PLAN.md":
+ title = "v0.2 Scrum Bootstrap & Board Plan"
+ eliffilepath.name == "SPRINT_0_PLAN.md":
+ title = "v0.2 Sprint 0 Plan"
+ eliffilepath.name == "ATLASSIAN_PM_LINK.md":
+ title = "v0.2 Atlassian PM Link"
+ content =filepath.read_text()
```

filepath.read_text() is called without an explicit encoding/errors strategy. If a planning file contains non-UTF8 bytes, this can raise and stopSyncing; consider read_text(ENCODING="utf-8", errors="replace") (and/or catching decode errors per-file).

In pm-daemon/pm.daemon.py:

```python
> +
+mcp_tool()
+def get_project_status() -> str:
+    '''Get the current project status and active sprint data from PM notes.
+ Call this tool at the beginning of a session to brief the agent on what to do.
+    ''''
+ workspace_dir = Path(os.getpwd())
+ status = []
+ for filename in WATCHEDFILES:
+     matches = [workspace_dir / filename, *workspace_dir.rglob(filename)]
+     seen_paths = set()
+ forfilepath in matches:
+     if notfilepath.exists() orfilepath in seen_paths:
+     continue
+     seen_paths.add(filepath)
+     content =filepath.read_text()
```

get_project_status() reads files with filepath.read_text() without specifying encoding/error handling. A single undecodable file can crash the tool; please use a safe encoding (utf-8 + errors="replace") or catch exceptions per file and continue.

In pm-daemon/pm.daemon.py:

```txt
> + seen_paths.add(filepath)
+ handler-sync_to_confluence(filepath)
+ synchronized.append(str(filepath-relative_to Workspace_dir))
+ return f"Sync triggered successfully for {'', '.join(synced)}". The PM Daemon has updated the documents in Atlassian."
```

sync_pm Documents() always appends the file to syncd and returns a success message even if sync_to_confluence() no-ops due to missing auth headers (or fails). Consider checking HEADERS up front and/or having sync_to_confluence() return a success/failure flag so the tool can report an accurate result.

In pm-daemon/pm.daemon.py:

```txt
> + url = f"https://{URL_BASE}/rest/api/3/issue"
+ payload = {
+ "fields": {
+ "project": {"key": "KAN"},
+ "summary": epic_name,
+ "summary": epic_name
}
```

create\_ epic_from_roadmap() hardcodes the Jira project key (KAN). This will break in other environments; please make the project key configurable (env var/argument) and validate it before calling the API.

In marketing-skill/seo-audit/scripts/seo_health scorer.py:

```javascript
> + all-findings.append({
+ "category": cat,
+ "check": check.get("check", "",
+ "result": result,
+ "severity": check.get("severity", "medium"),
```

severity is stored from the input without normalization (case/whitespace), but later logic relies on exact matches for sorting (SEVERITY_ORDER), quick wins, and action計劃. Please normalize severity (e.g., .lower()) when building all-findings to keep behavior consistent with how result is handled.
