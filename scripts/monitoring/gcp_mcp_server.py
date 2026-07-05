#!/usr/bin/env python3
"""GCP system-health MCP server for Vegangenius Chef.

Exposes Cloud Monitoring telemetry for the production stack as MCP tools so
an agent (Claude Code or Claude Desktop) can run the "Run System Health
Check" routine against live infrastructure:

- frontend  — Cloud Run service `express-frontend`
- backend   — Cloud Run service `flask-backend`
- database  — Cloud SQL instance `vegangenius-db` (PostgreSQL)
- valkey    — Memorystore Valkey/Redis rate-limiter store
- pubsub    — generation topics + push subscriptions (incl. DLQ)

Authentication: a read-only service account key referenced by
GOOGLE_APPLICATION_CREDENTIALS. `roles/monitoring.viewer` is sufficient for
every tool in this server — Pub/Sub metrics are read through the Monitoring
API, not the Pub/Sub admin API.

Transports:
    stdio (default)     for local `.mcp.json` spawns and Claude Desktop.
    streamable-http     for a hosted remote MCP server registered as a Claude
                        custom connector — the only kind of MCP server that
                        Claude Code's cloud/routine environment wires up (it
                        does not spawn the stdio servers from `.mcp.json`). Set
                        MCP_TRANSPORT=http (or pass --http). See
                        docs/MCP_GCP_MONITORING.md § "Hosted remote connector".

Configuration (env vars, or repo-root `.env`):
    GOOGLE_APPLICATION_CREDENTIALS      path to the service-account JSON key
    GOOGLE_APPLICATION_CREDENTIALS_B64  base64 of the key JSON itself — for
                                        Claude Code cloud environments, which
                                        only carry single-line env vars; used
                                        when no key file path resolves. NOT
                                        needed on Cloud Run, where the service
                                        runs as a service account and the
                                        Monitoring client picks up ADC.
    GCP_PROJECT_ID                  defaults to comdottasteslikegood
    EXPRESS_SERVICE / FLASK_SERVICE / CLOUDSQL_INSTANCE  resource overrides

HTTP-transport-only configuration:
    MCP_TRANSPORT                   'http'/'streamable-http' to serve over HTTP;
                                    anything else (default) uses stdio.
    MCP_AUTH_TOKEN                  URL-safe shared secret; the MCP endpoint is
                                    served at `/<MCP_AUTH_TOKEN>/mcp` and knowing
                                    that path is the credential (a capability
                                    URL). Mandatory in HTTP mode — the server
                                    refuses to start without it rather than serve
                                    the tools at a guessable path. Chosen over a
                                    bearer header because Claude's connector UI
                                    can't send headers and treats a 401 as an
                                    OAuth prompt (see _run_http docstring).
    PORT                            listen port in HTTP mode (default 8080;
                                    Cloud Run injects this).
"""

import base64
import datetime
import json
import os
import re
import sys
import threading
from pathlib import Path
from typing import Optional

from mcp.server.fastmcp import FastMCP

_RESOLVED = Path(__file__).resolve()
# In the repo the server lives at scripts/monitoring/<file>, so parents[2] is
# the repo root — used to locate .env and to resolve a relative
# GOOGLE_APPLICATION_CREDENTIALS path. In the Cloud Run image the file sits at
# /app/<file> with no such ancestor (and neither .env nor a relative key path is
# used there — auth is ADC + env vars), so fall back to the file's directory
# instead of raising IndexError at import and crashing the container.
REPO_ROOT = _RESOLVED.parents[2] if len(_RESOLVED.parents) > 2 else _RESOLVED.parent


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader; never overrides variables already set."""
    if not path.is_file():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv(REPO_ROOT / ".env")

# A relative credentials path in .env is resolved against the repo root so
# the same entry works regardless of the agent's working directory.
_creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
if _creds and not os.path.isabs(_creds):
    _creds = str(REPO_ROOT / _creds)
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = _creds

# Claude Code cloud environments (web sessions / scheduled routines) have no
# key file on disk and only carry single-line env vars, so the key travels as
# base64-encoded JSON. Keep it in memory only — never on disk — and hand it to
# the client at construction time. A key *path* that resolves to a real file
# wins, keeping local setups unaffected.
_SA_INFO: dict | None = None
_creds_b64 = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_B64")
if _creds_b64 and not (_creds and os.path.isfile(_creds)):
    try:
        _SA_INFO = json.loads(base64.b64decode(_creds_b64, validate=True))
    except ValueError as exc:
        print(
            "WARNING: GOOGLE_APPLICATION_CREDENTIALS_B64 is not valid "
            f"base64-encoded JSON; ignoring it ({exc})",
            file=sys.stderr,
        )
    else:
        # Clean up the key file older revisions materialized here.
        Path(__file__).resolve().with_name(".gcp-sa-key.json").unlink(missing_ok=True)

PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "comdottasteslikegood")
PROJECT_NAME = f"projects/{PROJECT_ID}"
EXPRESS_SERVICE = os.environ.get("EXPRESS_SERVICE", "express-frontend")
FLASK_SERVICE = os.environ.get("FLASK_SERVICE", "flask-backend")
CLOUDSQL_INSTANCE = os.environ.get("CLOUDSQL_INSTANCE", "vegangenius-db")
CLOUDSQL_DATABASE_ID = f"{PROJECT_ID}:{CLOUDSQL_INSTANCE}"
# Memorystore instance backing the Express rate limiter. The planning doc
# named it vegangenius-valkey, but the deployed instance is
# veganchef-valkeymem (confirmed via metric discovery on first live run).
VALKEY_INSTANCE = os.environ.get("VALKEY_INSTANCE", "veganchef-valkeymem")
# Generation pipeline resources provisioned by scripts/gcloud/setup_pubsub.sh.
# Comma-separated env overrides; set to an empty string to query project-wide.
PUBSUB_TOPICS = [
    t.strip()
    for t in os.environ.get(
        "PUBSUB_TOPICS", "recipe-generation,image-generation,generation-dlq"
    ).split(",")
    if t.strip()
]
PUBSUB_SUBSCRIPTIONS = [
    s.strip()
    for s in os.environ.get(
        "PUBSUB_SUBSCRIPTIONS",
        "recipe-generation-push-sub,image-generation-push-sub,generation-dlq-sub",
    ).split(",")
    if s.strip()
]


def _label_scope(label: str, values: list[str], match: str = "eq") -> str:
    """Build an AND-able filter clause restricting `label` to `values`.

    Returns '' when values is empty (unscoped). `match='ends_with'` matches on
    suffix — useful when a resource label may hold a full resource path.
    """
    if not values:
        return ""
    if match == "ends_with":
        if len(values) == 1:
            return f' AND {label} = ends_with("{values[0]}")'
        clauses = " OR ".join(f'{label} = ends_with("{v}")' for v in values)
        return f" AND ({clauses})"
    if len(values) == 1:
        return f' AND {label} = "{values[0]}"'
    quoted = ", ".join(f'"{v}"' for v in values)
    return f" AND {label} = one_of({quoted})"

MAX_SERIES_PER_PROBE = 12

mcp = FastMCP("GCP-Metrics-Monitor")

_client = None
_client_lock = threading.Lock()


def _metrics_client():
    """Create the Monitoring client lazily so the server still starts (and
    returns actionable tool errors) when credentials are missing."""
    global _client
    with _client_lock:
        if _client is None:
            from google.cloud import monitoring_v3

            if _SA_INFO is not None:
                from google.oauth2 import service_account

                _client = monitoring_v3.MetricServiceClient(
                    credentials=service_account.Credentials.from_service_account_info(_SA_INFO)
                )
                return _client

            creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
            if creds and not os.path.isfile(creds):
                raise RuntimeError(
                    f"GOOGLE_APPLICATION_CREDENTIALS points to '{creds}' but no "
                    "such file exists. Fix the path in .env (repo root) or the "
                    "MCP env block, or supply the key as "
                    "GOOGLE_APPLICATION_CREDENTIALS_B64 (base64 of the JSON)."
                )
            _client = monitoring_v3.MetricServiceClient()
        return _client


def _cloud_run_probes(service_name: str) -> list[dict]:
    base = (
        f'resource.type = "cloud_run_revision" AND '
        f'resource.labels.service_name = "{service_name}"'
    )
    return [
        {
            "name": "Request rate",
            "filter": f'metric.type = "run.googleapis.com/request_count" AND {base}',
            "aligner": "ALIGN_RATE",
            "reducer": "REDUCE_SUM",
            "group_by": ["metric.labels.response_code_class"],
            "unit": "req/s",
        },
        {
            "name": "Request latency p95",
            "filter": f'metric.type = "run.googleapis.com/request_latencies" AND {base}',
            "aligner": "ALIGN_PERCENTILE_95",
            "reducer": "REDUCE_MEAN",
            "group_by": [],
            "unit": "ms",
            "warn_above": 2000,
        },
        {
            "name": "Container CPU utilization p95",
            "filter": f'metric.type = "run.googleapis.com/container/cpu/utilizations" AND {base}',
            "aligner": "ALIGN_PERCENTILE_95",
            "reducer": "REDUCE_MEAN",
            "group_by": [],
            "unit": "%",
            "warn_above": 0.8,
        },
        {
            "name": "Container memory utilization p95",
            "filter": f'metric.type = "run.googleapis.com/container/memory/utilizations" AND {base}',
            "aligner": "ALIGN_PERCENTILE_95",
            "reducer": "REDUCE_MEAN",
            "group_by": [],
            "unit": "%",
            "warn_above": 0.8,
        },
        {
            "name": "Instance count",
            "filter": f'metric.type = "run.googleapis.com/container/instance_count" AND {base}',
            "aligner": "ALIGN_MAX",
            "reducer": "REDUCE_SUM",
            "group_by": ["metric.labels.state"],
            "unit": "count",
        },
    ]


def _build_components() -> dict[str, list[dict]]:
    sql = f'resource.labels.database_id = "{CLOUDSQL_DATABASE_ID}"'
    valkey_scope = _label_scope(
        "resource.labels.instance_id", [VALKEY_INSTANCE], match="ends_with"
    )
    sub_scope = _label_scope("resource.labels.subscription_id", PUBSUB_SUBSCRIPTIONS)
    topic_scope = _label_scope("resource.labels.topic_id", PUBSUB_TOPICS)
    return {
        "frontend": _cloud_run_probes(EXPRESS_SERVICE),
        "backend": _cloud_run_probes(FLASK_SERVICE),
        "database": [
            {
                "name": "CPU utilization",
                "filter": f'metric.type = "cloudsql.googleapis.com/database/cpu/utilization" AND {sql}',
                "aligner": "ALIGN_MEAN",
                "unit": "%",
                "warn_above": 0.8,
            },
            {
                "name": "Memory utilization",
                "filter": f'metric.type = "cloudsql.googleapis.com/database/memory/utilization" AND {sql}',
                "aligner": "ALIGN_MEAN",
                "unit": "%",
                "warn_above": 0.85,
            },
            {
                "name": "Disk utilization",
                "filter": f'metric.type = "cloudsql.googleapis.com/database/disk/utilization" AND {sql}',
                "aligner": "ALIGN_MEAN",
                "unit": "%",
                "warn_above": 0.85,
            },
            {
                "name": "PostgreSQL connections",
                "filter": f'metric.type = "cloudsql.googleapis.com/database/postgresql/num_backends" AND {sql}',
                "aligner": "ALIGN_MEAN",
                "reducer": "REDUCE_SUM",
                "group_by": [],
                "unit": "count",
            },
        ],
        # The rate limiter runs on Memorystore Valkey; probes for the older
        # Memorystore Redis metric names are included as fallbacks and are
        # reported quietly when empty (`optional`). ends_with matching keeps
        # the scope correct whether instance_id holds the bare ID or a full
        # projects/.../instances/<id> path.
        "valkey": [
            {
                "name": "Node CPU utilization",
                "filter": 'metric.type = "memorystore.googleapis.com/instance/node/cpu/utilization"'
                + valkey_scope,
                "aligner": "ALIGN_MEAN",
                "unit": "%",
                "warn_above": 0.8,
                "optional": True,
            },
            {
                "name": "Node memory utilization",
                "filter": 'metric.type = "memorystore.googleapis.com/instance/node/memory/utilization"'
                + valkey_scope,
                "aligner": "ALIGN_MEAN",
                "unit": "%",
                "warn_above": 0.8,
                "optional": True,
            },
            {
                "name": "Connected clients",
                "filter": 'metric.type = "memorystore.googleapis.com/instance/node/clients/connected_clients"'
                + valkey_scope,
                "aligner": "ALIGN_MEAN",
                "reducer": "REDUCE_SUM",
                "group_by": [],
                "unit": "count",
                "optional": True,
            },
            {
                "name": "Memory usage ratio (Memorystore Redis)",
                "filter": 'metric.type = "redis.googleapis.com/stats/memory/usage_ratio"'
                + valkey_scope,
                "aligner": "ALIGN_MEAN",
                "unit": "%",
                "warn_above": 0.8,
                "optional": True,
            },
            {
                "name": "Connected clients (Memorystore Redis)",
                "filter": 'metric.type = "redis.googleapis.com/clients/connected"'
                + valkey_scope,
                "aligner": "ALIGN_MEAN",
                "reducer": "REDUCE_SUM",
                "group_by": [],
                "unit": "count",
                "optional": True,
            },
        ],
        "pubsub": [
            {
                "name": "Undelivered messages (backlog)",
                "filter": 'metric.type = "pubsub.googleapis.com/subscription/num_undelivered_messages"'
                + sub_scope,
                "aligner": "ALIGN_MAX",
                "reducer": "REDUCE_MAX",
                "group_by": ["resource.labels.subscription_id"],
                "unit": "count",
                "warn_above": 10,
            },
            {
                "name": "Oldest unacked message age",
                "filter": 'metric.type = "pubsub.googleapis.com/subscription/oldest_unacked_message_age"'
                + sub_scope,
                "aligner": "ALIGN_MAX",
                "reducer": "REDUCE_MAX",
                "group_by": ["resource.labels.subscription_id"],
                "unit": "s",
                "warn_above": 300,
            },
            {
                "name": "Push request rate",
                "filter": 'metric.type = "pubsub.googleapis.com/subscription/push_request_count"'
                + sub_scope,
                "aligner": "ALIGN_RATE",
                "reducer": "REDUCE_SUM",
                "group_by": [
                    "resource.labels.subscription_id",
                    "metric.labels.response_class",
                ],
                "unit": "req/s",
            },
            {
                "name": "Publish rate",
                "filter": 'metric.type = "pubsub.googleapis.com/topic/send_request_count"'
                + topic_scope,
                "aligner": "ALIGN_RATE",
                "reducer": "REDUCE_SUM",
                "group_by": ["resource.labels.topic_id"],
                "unit": "req/s",
            },
        ],
    }


COMPONENTS = _build_components()
ALIASES = {"redis": "valkey", "db": "database", "sql": "database"}

# Labels worth surfacing in series identifiers, in display order.
INTERESTING_LABELS = (
    "service_name",
    "response_code_class",
    "response_class",
    "state",
    "database",
    "database_id",
    "subscription_id",
    "topic_id",
    "node_id",
    "instance_id",
)


def _series_key(ts) -> str:
    labels = dict(ts.resource.labels)
    labels.update(dict(ts.metric.labels))
    parts = [f"{k}={labels[k]}" for k in INTERESTING_LABELS if labels.get(k)]
    return ", ".join(parts) or "all"


def _point_value(point) -> Optional[float]:
    from google.cloud import monitoring_v3

    which = monitoring_v3.TypedValue.pb(point.value).WhichOneof("value")
    if which == "double_value":
        return point.value.double_value
    if which == "int64_value":
        return float(point.value.int64_value)
    if which == "bool_value":
        return 1.0 if point.value.bool_value else 0.0
    return None


def _fmt(value: float, unit: str) -> str:
    if unit == "%":
        return f"{value * 100:.1f}%"
    if unit == "req/s":
        return f"{value:.2f}/s"
    if unit == "ms":
        return f"{value:.0f} ms"
    if unit == "s":
        return f"{value:.0f} s"
    # 'count' and unknown units: %g keeps integers clean (3 → "3") without
    # rounding away fractional values (0.8 → "0.8")
    return f"{value:g}"


def _run_probe(probe: dict, minutes_back: int) -> list[str]:
    """Execute one metric query and return formatted summary lines
    (empty list = no data)."""
    from google.cloud import monitoring_v3

    client = _metrics_client()
    now = datetime.datetime.now(datetime.timezone.utc)
    start = now - datetime.timedelta(minutes=minutes_back)
    interval = monitoring_v3.TimeInterval(
        {
            "end_time": {"seconds": int(now.timestamp())},
            "start_time": {"seconds": int(start.timestamp())},
        }
    )
    alignment_seconds = 60 if minutes_back <= 30 else 300
    aggregation = monitoring_v3.Aggregation(
        {
            "alignment_period": {"seconds": alignment_seconds},
            "per_series_aligner": monitoring_v3.Aggregation.Aligner[probe["aligner"]],
        }
    )
    if probe.get("reducer"):
        aggregation.cross_series_reducer = monitoring_v3.Aggregation.Reducer[
            probe["reducer"]
        ]
        aggregation.group_by_fields = probe.get("group_by", [])

    results = client.list_time_series(
        request={
            "name": PROJECT_NAME,
            "filter": probe["filter"],
            "interval": interval,
            "view": monitoring_v3.ListTimeSeriesRequest.TimeSeriesView.FULL,
            "aggregation": aggregation,
        }
    )

    lines: list[str] = []
    series_count = 0
    truncated = False
    for ts in results:
        series_count += 1
        if series_count > MAX_SERIES_PER_PROBE:
            # Stop consuming the stream — a broad query can return far more
            # series than we display, and draining it just to count is wasted
            # API time.
            truncated = True
            break
        values = [v for v in (_point_value(p) for p in ts.points) if v is not None]
        if not values:
            continue
        latest, mean, peak = values[0], sum(values) / len(values), max(values)
        unit = probe["unit"]
        key = _series_key(ts)
        # Flag on the window peak, not just the latest point — a spike that
        # recovered mid-window is still an incident worth surfacing.
        warn = ""
        warn_above = probe.get("warn_above")
        if warn_above is not None and peak > warn_above:
            warn = "  ⚠️" if latest > warn_above else "  ⚠️ (peaked, since recovered)"
        if "5xx" in key and peak > 0:
            warn = "  ⚠️ 5xx errors present"
        lines.append(
            f"  - {probe['name']} [{key}]: latest {_fmt(latest, unit)} | "
            f"mean {_fmt(mean, unit)} | max {_fmt(peak, unit)} "
            f"({len(values)} pts @{alignment_seconds}s){warn}"
        )
    if truncated:
        lines.append(
            f"  - {probe['name']}: … more series omitted (showing first "
            f"{MAX_SERIES_PER_PROBE}; narrow the filter or group_by for full coverage)"
        )
    return lines


def _check_component(component: str, minutes_back: int) -> str:
    probes = COMPONENTS[component]
    out = [f"## {component} (last {minutes_back} min, project {PROJECT_ID})"]
    any_data = False
    any_error = False
    for probe in probes:
        try:
            lines = _run_probe(probe, minutes_back)
        except Exception as exc:  # noqa: BLE001 — surface API errors to the agent
            out.append(f"  - {probe['name']}: query failed: {exc}")
            any_error = True
            continue
        if lines:
            any_data = True
            out.extend(lines)
        elif not probe.get("optional"):
            out.append(f"  - {probe['name']}: no data in window")
    if not any_data:
        if any_error:
            out.append(
                "  No metrics retrieved — one or more queries FAILED (see errors "
                "above). This is an access/API problem, not evidence the component "
                "is idle or unhealthy; fix credentials/permissions first."
            )
        else:
            out.append(
                "  No metrics found for any probe. Either the component is idle/has "
                "no traffic, or metric names differ for this deployment — call "
                "list_available_metrics with a prefix like "
                "'memorystore.googleapis.com/' to discover the exact metric types, "
                "then query_metric to fetch them."
            )
    return "\n".join(out)


@mcp.tool()
def check_system_health(target_component: str = "all", minutes_back: int = 15) -> str:
    """Fetch live Cloud Monitoring metrics for the Vegangenius Chef production stack.

    :param target_component: 'frontend' (express-frontend Cloud Run),
        'backend' (flask-backend Cloud Run), 'database' (Cloud SQL),
        'valkey' (rate-limiter store, alias 'redis'), 'pubsub', or 'all'.
    :param minutes_back: how many minutes of history to summarize (default 15,
        max 1440). Each metric line shows latest/mean/max over the window;
        ⚠️ flags values beyond healthy thresholds.
    """
    minutes_back = max(1, min(int(minutes_back), 1440))
    component = ALIASES.get(target_component.lower(), target_component.lower())
    if component == "all":
        try:
            _metrics_client()
        except Exception as exc:  # noqa: BLE001
            return f"Cannot initialize GCP Monitoring client: {exc}"
        return "\n\n".join(
            _check_component(name, minutes_back) for name in COMPONENTS
        )
    if component not in COMPONENTS:
        return (
            f"Error: unknown component '{target_component}'. "
            f"Valid: {', '.join(COMPONENTS)}, all"
        )
    return _check_component(component, minutes_back)


@mcp.tool()
def list_available_metrics(prefix: str, limit: int = 50) -> str:
    """List Cloud Monitoring metric descriptors whose type starts with `prefix`.

    Use this to discover exact metric names when a health probe reports no
    data (e.g. prefix 'memorystore.googleapis.com/' or 'redis.googleapis.com/').

    :param prefix: metric.type prefix, e.g. 'run.googleapis.com/'.
    :param limit: max descriptors to return (default 50, max 200).
    """
    limit = max(1, min(int(limit), 200))
    try:
        client = _metrics_client()
        descriptors = client.list_metric_descriptors(
            request={
                "name": PROJECT_NAME,
                # Strip quotes so a stray " can't break out of the filter string
                "filter": f'metric.type = starts_with("{prefix.replace(chr(34), "")}")',
            }
        )
        from google.api import metric_pb2

        lines = []
        for descriptor in descriptors:
            # MetricDescriptor is a raw protobuf message (google.api), so the
            # enum fields are plain ints — .name would raise AttributeError.
            kind = metric_pb2.MetricDescriptor.MetricKind.Name(descriptor.metric_kind)
            value_type = metric_pb2.MetricDescriptor.ValueType.Name(
                descriptor.value_type
            )
            lines.append(
                f"- {descriptor.type} ({kind}/{value_type}, "
                f"unit={descriptor.unit or '-'})"
            )
            if len(lines) >= limit:
                break
        return "\n".join(lines) or f"No metric descriptors match prefix '{prefix}'."
    except Exception as exc:  # noqa: BLE001
        return f"Failed to list metric descriptors: {exc}"


@mcp.tool()
def query_metric(
    metric_type: str,
    minutes_back: int = 15,
    aligner: str = "ALIGN_MEAN",
    group_by: str = "",
    extra_filter: str = "",
    unit: str = "count",
) -> str:
    """Ad-hoc query for any Cloud Monitoring metric (escape hatch when the
    curated check_system_health probes don't cover what you need).

    :param metric_type: full metric type, e.g. 'run.googleapis.com/request_count'.
    :param minutes_back: history window in minutes (default 15, max 1440).
    :param aligner: per-series aligner name, e.g. ALIGN_MEAN, ALIGN_RATE,
        ALIGN_MAX, ALIGN_PERCENTILE_95. Use ALIGN_RATE for DELTA count metrics.
    :param group_by: comma-separated label fields to group by (a REDUCE_SUM
        cross-series reducer is applied when set),
        e.g. 'resource.labels.service_name,metric.labels.response_code_class'.
    :param extra_filter: appended to the filter with AND,
        e.g. 'resource.labels.service_name = "flask-backend"'.
    :param unit: how to format values: 'count' (default), '%' (0–1 ratios),
        'req/s', 'ms', or 's'. Match it to the metric's actual unit —
        e.g. '%' for utilization ratios, 'ms' for request_latencies.
    """
    minutes_back = max(1, min(int(minutes_back), 1440))
    # Strip quotes so a stray " can't break out of the filter string
    metric_type = metric_type.replace('"', "")
    filter_str = f'metric.type = "{metric_type}"'
    if extra_filter:
        filter_str += f" AND {extra_filter}"
    probe = {
        "name": metric_type,
        "filter": filter_str,
        "aligner": aligner,
        "unit": unit,
    }
    if group_by:
        probe["reducer"] = "REDUCE_SUM"
        probe["group_by"] = [f.strip() for f in group_by.split(",") if f.strip()]
    try:
        lines = _run_probe(probe, minutes_back)
    except KeyError:
        return f"Error: unknown aligner '{aligner}'."
    except Exception as exc:  # noqa: BLE001
        return f"Query failed: {exc}"
    return "\n".join(lines) or f"No data for {metric_type} in the last {minutes_back} min."


def _run_http() -> None:
    """Serve the MCP tools over Streamable HTTP behind a secret URL path.

    Why a secret *path* and not a bearer header or `?key=` query:

    - Claude's claude.ai custom-connector UI (the path that reaches cloud
      routines) takes only a URL — no field for an Authorization header
      (anthropics/claude-ai-mcp#112).
    - It reads any `401 + WWW-Authenticate` as "this server needs OAuth" and
      launches a sign-in flow this server doesn't implement, so a bearer/query
      *gate* makes registration fail at the OAuth step ("Couldn't register …
      sign-in service"). A query string also isn't reliably carried on the
      connector's discovery probe.

    So instead the server looks like a plain **authless** remote MCP server that
    happens to live at an unguessable path: `/{token}/mcp` returns 200 and
    everything else 404s — no 401, no `WWW-Authenticate`, so Claude connects with
    no OAuth. The secret path IS the credential (a capability URL): treat the
    whole URL as the secret, keep it off public pages, and rotate the token if it
    leaks (it appears in request logs like any URL).

    Cloud Run must additionally allow **unauthenticated** invocations — with
    IAM-gated ingress, Google rejects Claude at the door (its own sign-in), well
    before this app is reached. See deploy_mcp_cloud_run.sh / docs § 4.5.
    """
    token = (os.environ.get("MCP_AUTH_TOKEN") or "").strip()
    if not token:
        print(
            "FATAL: MCP_AUTH_TOKEN is unset or blank. Refusing to serve the "
            "monitoring tools over HTTP without a secret path. Set "
            "MCP_AUTH_TOKEN (from Secret Manager on Cloud Run) and retry.",
            file=sys.stderr,
        )
        sys.exit(1)
    # The token becomes a URL path segment, so it must be URL-safe. The deploy
    # script generates a base64url token (unreserved chars only); reject anything
    # else rather than silently mount a broken/again-guessable path.
    if not re.fullmatch(r"[A-Za-z0-9._~-]+", token):
        print(
            "FATAL: MCP_AUTH_TOKEN must contain only URL-safe unreserved "
            "characters (A-Z a-z 0-9 - . _ ~) so it can be embedded in the "
            "endpoint path. Regenerate it, e.g. `openssl rand -base64 32 | "
            "tr '+/' '-_' | tr -d '=\\n'`.",
            file=sys.stderr,
        )
        sys.exit(1)

    import uvicorn
    from starlette.responses import PlainTextResponse
    from starlette.routing import Route

    async def _healthz(_request):
        # Unauthenticated liveness probe — deliberately reveals nothing.
        return PlainTextResponse("ok")

    # Mount the MCP endpoint under the secret path. Knowing the path is the
    # credential; the app carries no separate auth gate, so it never emits a 401
    # (which would trip Claude's OAuth flow). A request to any other path — /mcp,
    # a wrong token, / — just 404s.
    mcp.settings.streamable_http_path = f"/{token}/mcp"
    app = mcp.streamable_http_app()
    app.router.routes.append(Route("/healthz", _healthz, methods=["GET"]))

    port = int(os.environ.get("PORT", "8080"))
    print(
        f"gcp-monitor MCP serving at path /{'*' * 8}/mcp (token redacted) on "
        f"port {port}",
        file=sys.stderr,
    )
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


def main() -> None:
    transport = os.environ.get("MCP_TRANSPORT", "stdio").strip().lower()
    if "--http" in sys.argv:
        transport = "http"
    if transport in ("http", "streamable-http"):
        _run_http()
    else:
        mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
