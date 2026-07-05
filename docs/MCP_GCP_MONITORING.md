# GCP System Health Monitor — MCP Server Setup

A stdio MCP server (`scripts/monitoring/gcp_mcp_server.py`) that lets Claude
query live Cloud Monitoring telemetry for the production stack and run the
**"Run System Health Check"** routine. It covers:

| Component  | GCP resource                                             |
| ---------- | -------------------------------------------------------- |
| `frontend` | Cloud Run service `express-frontend`                     |
| `backend`  | Cloud Run service `flask-backend`                        |
| `database` | Cloud SQL instance `comdottasteslikegood:vegangenius-db` |
| `valkey`   | Memorystore Valkey rate-limiter store                    |
| `pubsub`   | Generation topics + push subscriptions (incl. DLQ)       |

```
[ Claude (Code or Desktop) ]
         │  stdio MCP
         ▼
[ scripts/monitoring/gcp_mcp_server.py ]
         │  service-account auth (read-only)
         ▼
[ Cloud Monitoring API ] ──> live component telemetry
```

## 1. Prerequisites

- A service account with **`roles/monitoring.viewer`** on project
  `comdottasteslikegood`, and its JSON key downloaded somewhere **outside the
  repo** (e.g. `~/gcp-keys/monitoring-viewer.json`). Never commit the key.
  `monitoring.viewer` is sufficient for everything this server does —
  Pub/Sub metrics are read through the Monitoring API, so `pubsub.viewer` is
  not required.
- `python3` with venv support (`sudo apt install python3.12-venv` on
  Debian/Ubuntu). The launcher script creates its own venv on first run and
  installs `mcp` + `google-cloud-monitoring`.

## 2. Configuration

Add to the repo-root `.env` (already gitignored):

```bash
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/monitoring-viewer.json
# GCP_PROJECT_ID is optional; comdottasteslikegood is the default
GCP_PROJECT_ID=comdottasteslikegood
```

Optional overrides (defaults match production): `EXPRESS_SERVICE`,
`FLASK_SERVICE`, `CLOUDSQL_INSTANCE`, `VALKEY_INSTANCE`
(default `veganchef-valkeymem` — the deployed instance name, which differs
from the `vegangenius-valkey` in the planning doc), and comma-separated
`PUBSUB_TOPICS` / `PUBSUB_SUBSCRIPTIONS` (default: the generation pipeline
resources from `scripts/gcloud/setup_pubsub.sh`; set to an empty string to
query project-wide).

First-time tip: pre-build the venv before your first agent session so the
initial MCP spawn doesn't race the client's startup timeout:

```bash
bash scripts/monitoring/run_gcp_monitor.sh --bootstrap-only
```

## 3. Claude Code (this repo)

Nothing else to do — the server is registered in `.mcp.json` as
`gcp-monitor` and auto-spawns when a session starts in this directory, same
as `pm-daemon`. Verify with `ps -ef | grep gcp_mcp_server`.

## 4. Claude Code cloud environments (web sessions & scheduled routines)

Cloud sessions clone this repo, so `.mcp.json` auto-spawns `gcp-monitor`
there too — but the cloud VM has neither your `.env` nor the key file. Cloud
environments only carry **single-line** env vars (there is no secrets vault
yet), so the key travels base64-encoded; the server decodes it in memory and
hands it straight to the Monitoring client (it never touches disk).

Two cloud-specific traps this section works around:

- **Every routine run is a fresh VM.** Without preparation, the launcher
  pip-installs its venv on every run (~45 s+), which loses the race against
  the MCP client's 30 s startup timeout — the server gets killed
  mid-bootstrap and no tools register.
- **The environment's setup script runs _before_ the repo is cloned**, so it
  cannot call anything in `scripts/`. It must build the venv at a fixed
  path outside the repo; the launcher (`run_gcp_monitor.sh`) detects a
  usable venv at `$GCP_MONITOR_VENV` or `/opt/gcp-monitor-venv` and uses it
  instead of bootstrapping. The filesystem is snapshotted after the setup
  script and reused by later runs (cache expires ~weekly and on
  setup-script/network-host edits).

Configure the environment on claude.ai → **Code** → environment settings:

1. **Setup script** — build the venv at the fixed path (repo isn't cloned
   yet, so the dependency list is inlined; keep it in sync with
   `scripts/monitoring/requirements.txt`). PyPI reads from the cloud VM
   time out sporadically, so the install retries and the final import
   check is what actually gates success:

   ```bash
   #!/bin/bash
   set -euo pipefail
   python3 -m venv /opt/gcp-monitor-venv
   for attempt in 1 2 3; do
     /opt/gcp-monitor-venv/bin/pip install --retries 10 --timeout 60 \
       'mcp>=1.2.0' 'google-cloud-monitoring>=2.21.0' && break
     echo "pip attempt $attempt of 3 failed" >&2
     if [[ "$attempt" -lt 3 ]]; then sleep 10; fi
   done
   /opt/gcp-monitor-venv/bin/python -c 'import importlib.util as u, sys; sys.exit(0 if u.find_spec("mcp") and u.find_spec("google.cloud.monitoring_v3") else 1)'
   chmod -R a+rX /opt/gcp-monitor-venv
   ```

   (No `pip install --upgrade pip` — the venv's bundled pip installs these
   wheels fine, and every extra download is another chance to hit a
   transient timeout.)

2. Encode the key locally, straight to the clipboard (don't echo it —
   and don't copy from a terminal that shows a `%` end-of-output marker):

   ```bash
   base64 < /path/to/monitoring-viewer.json | tr -d '\n' | wl-copy   # or xclip/pbcopy
   ```

   (`tr -d '\n'` keeps this portable — GNU `base64` wraps at 76 columns by
   default and macOS/BSD `base64` has no `-w` flag.)

3. **Environment variables**:

   ```
   GOOGLE_APPLICATION_CREDENTIALS_B64=<paste the base64 blob>
   GCP_PROJECT_ID=comdottasteslikegood
   MCP_TIMEOUT=120000
   ```

   (`GCP_PROJECT_ID` is optional — it's the default. `MCP_TIMEOUT` is in
   milliseconds and covers the slow rebuild after a snapshot-cache
   expiry.)

4. Make sure the environment's **network access** allows PyPI (for the
   setup script) and `monitoring.googleapis.com` (for the server).

Note: environment variables are visible to anyone who can edit that cloud
environment, and any cloud session using it can read the key — acceptable
here because the service account is read-only (`roles/monitoring.viewer`),
but don't reuse this pattern for write-capable credentials. A key _path_ in
`GOOGLE_APPLICATION_CREDENTIALS` that resolves to a real file always wins
over the B64 var, so local setups are unaffected.

## 5. Claude Desktop

Edit the desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Merge in (adjust the repo path and key path to your machine):

```json
{
  "mcpServers": {
    "gcp-monitor": {
      "command": "bash",
      "args": [
        "/absolute/path/to/tasteslikegoodtheangularsvegancookbook/scripts/monitoring/run_gcp_monitor.sh"
      ],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/absolute/path/to/monitoring-viewer.json",
        "GCP_PROJECT_ID": "comdottasteslikegood"
      }
    }
  }
}
```

Fully restart Claude Desktop, then check for `GCP-Metrics-Monitor` under the
tools icon in the chat input.

To recreate the routine in Desktop, make a Project ("System Health
Analysis") and paste the routine from
`.claude/skills/system-health-check/SKILL.md` into its Custom Instructions.
Trigger it with: **Run System Health Check**.

## 6. Tools exposed

- `check_system_health(target_component="all", minutes_back=15)` — summarized
  metrics (latest | mean | max per series) for one component or the whole
  stack. Aliases: `redis`→`valkey`, `db`/`sql`→`database`. ⚠️ flags mark
  values beyond healthy thresholds (CPU/mem ≥ 80%, latency p95 > 2 s, Pub/Sub
  backlog > 10, unacked age > 5 min, any 5xx traffic).
- `list_available_metrics(prefix, limit=50)` — discover metric descriptors,
  e.g. `list_available_metrics("memorystore.googleapis.com/")`. Useful when a
  probe reports no data and you need the exact metric names for this
  deployment.
- `query_metric(metric_type, minutes_back, aligner, group_by, extra_filter)` —
  ad-hoc query for any metric the curated probes don't cover.

## 7. Running the routine

In Claude Code, say **"Run System Health Check"** or invoke
`/system-health-check`. Claude collects telemetry for all five components,
correlates anomalies across them (e.g. Pub/Sub backlog growth vs Cloud SQL
CPU spikes), and writes a structured SRE report with remediation
suggestions.

## Troubleshooting

- **Tools never register on the very first session** — the cold-start pip
  install can exceed the MCP client's startup timeout, so the server gets
  killed mid-bootstrap and no tools appear. Run
  `bash scripts/monitoring/run_gcp_monitor.sh --bootstrap-only` once (or
  start a fresh session — the launcher detects the interrupted install via
  a stamp file and finishes it), then the next session registers normally.
- **"Cannot initialize GCP Monitoring client"** — `GOOGLE_APPLICATION_CREDENTIALS`
  is unset or points to a missing file. Relative paths are resolved against
  the repo root.
- **`403 PERMISSION_DENIED`** — the service account lacks
  `roles/monitoring.viewer` on the project, or the Monitoring API is disabled.
- **Every valkey probe reports no data** — Memorystore metric names vary by
  product generation; run `list_available_metrics("memorystore.googleapis.com/")`
  (and `"redis.googleapis.com/"`) and query what exists via `query_metric`.
- **Stale venv after dependency bumps** — delete `scripts/monitoring/.venv`
  and let the launcher rebuild it.
