# Hosted GCP monitoring MCP server for Cloud Run.
#
# Build context is this directory (scripts/monitoring/):
#   gcloud run deploy gcp-monitor-mcp --source scripts/monitoring ...
# or via scripts/monitoring/deploy_mcp_cloud_run.sh.
#
# The container serves the read-only Cloud Monitoring tools over authenticated
# Streamable HTTP so Claude can reach them as a custom connector. On Cloud Run
# it runs as a service account with roles/monitoring.viewer, so the Monitoring
# client authenticates via ADC — there is NO key file or GOOGLE_APPLICATION_
# CREDENTIALS_B64 in the image or its env.
FROM python:3.12-slim

WORKDIR /app

# Dependencies first for layer caching.
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY gcp_mcp_server.py ./gcp_mcp_server.py

# HTTP transport; Cloud Run overrides PORT and injects MCP_AUTH_TOKEN + secrets.
ENV MCP_TRANSPORT=http \
    PORT=8080 \
    PYTHONUNBUFFERED=1

EXPOSE 8080

# Run as a non-root user (Cloud Run does not require it, but defense in depth).
RUN useradd --create-home --uid 10001 appuser
USER appuser

CMD ["python", "gcp_mcp_server.py"]
