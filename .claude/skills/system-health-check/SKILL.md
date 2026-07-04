---
name: system-health-check
description: Automated GCP infrastructure health check for the Vegangenius Chef production stack. Use when the user says "Run System Health Check", asks whether production is healthy, or wants Cloud Run / Cloud SQL / Valkey / Pub/Sub telemetry analyzed. Requires the gcp-monitor MCP server (scripts/monitoring/) with valid GCP credentials.
---

# System Health Check Routine

You are acting as a Google Cloud Site Reliability Engineer for the Vegangenius
Chef stack (Cloud Run `express-frontend` + `flask-backend`, Cloud SQL
`vegangenius-db`, Memorystore Valkey rate-limiter store, Pub/Sub generation
pipeline). Execute this routine step by step without pausing for confirmation.

## Steps

1. **Collect telemetry.** Call the `check_system_health` tool (gcp-monitor MCP
   server) with `target_component: "all"` and the requested window
   (default `minutes_back: 15`; use a longer window if the user asks about a
   past incident). If a single component is under suspicion, follow up with a
   component-specific call using a longer window (e.g. 60 min) for trend
   context.
2. **Fill gaps.** If a component reports "no data" for every probe, call
   `list_available_metrics` with the matching prefix
   (`memorystore.googleapis.com/`, `redis.googleapis.com/`,
   `run.googleapis.com/`, …) and then `query_metric` to fetch the metrics that
   actually exist. Distinguish "idle, no traffic" from "metric missing" —
   never report an idle service as broken.
3. **Correlate.** Line up the windows across components. Look for overlapping
   anomalies, e.g.:
   - Pub/Sub backlog growth (`num_undelivered_messages`, DLQ subscription
     `generation-dlq-sub`) coinciding with backend 5xx or Cloud SQL CPU spikes
   - Cloud Run latency p95 climbing while Valkey connections drop (rate
     limiter falling back to in-memory)
   - Instance-count surges alongside CPU/memory saturation (scaling thrash)
4. **Report.** Produce a structured SRE report:
   - **Infrastructure Health Status Overview** — one overall verdict:
     Healthy / Warning / Critical, with a one-line justification
   - **Component Diagnostics Breakdown** — per component (frontend, backend,
     database, valkey, pubsub): key numbers, ⚠️ flags, and a per-component
     status
   - **Identified Bottlenecks & Anomalies** — the correlated findings from
     step 3, with timestamps/windows
   - **Suggested Remediations** — concrete GCP actions (scale Cloud Run
     min-instances, investigate slow queries, drain the DLQ, check Valkey IAM
     auth, etc.), referencing this repo's deploy tooling (`cloudbuild.yaml`,
     `scripts/gcloud/`) where relevant

## Notes

- ⚠️ markers in tool output mean a value crossed a healthy threshold
  (CPU/memory ≥ 80%, latency p95 > 2 s, backlog > 10 msgs, unacked age > 5 min,
  any 5xx traffic). Treat one-off blips differently from sustained trends —
  check mean vs latest vs max.
- Metric values are summaries (latest | mean | max over the window), not raw
  points; say so if the user asks for exact timestamps and offer a narrower
  `minutes_back` query instead.
- If the tools return credential errors, tell the user to set
  `GOOGLE_APPLICATION_CREDENTIALS` and `GCP_PROJECT_ID` in the repo-root
  `.env` (see `docs/MCP_GCP_MONITORING.md`) — do not attempt to work around
  missing auth.
