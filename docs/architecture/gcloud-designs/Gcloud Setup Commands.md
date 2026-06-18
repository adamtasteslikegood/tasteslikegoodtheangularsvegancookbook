# Google Cloud Setup & Execution Guide

Before running your new `cloudbuild.yaml` pipeline to deploy the BETA 2.22 Full Tier app, you'll need to run the following one-time `gcloud` configuration commands.

> [!TIP]
> **No Need to Stop Existing Services!**
> Cloud Run handles blue/green deployments automatically. New revisions are deployed side-by-side with your old ones, and traffic isn't shifted until the new instances are fully healthy. This ensures a **zero-downtime deployment**. You do **not** need to stop your existing services.

Replace the `<PLACEHOLDERS>` in the commands below with your actual project details.

### 1. Scale Down the Cloud SQL Database Tier

Your `db-perf-optimized-N-8` tier is expensive. Scale it down to `db-g1-small` for development/BETA.

```bash
gcloud sql instances patch <YOUR_DB_INSTANCE_NAME> \
  --tier=db-g1-small \
  --project=comdottasteslikegood
```

### 2. Create the Database Migration Cloud Run Job

This creates the job that `cloudbuild.yaml` will execute to run your Alembic migrations.

```bash
gcloud run jobs create db-migration-job \
  --project=comdottasteslikegood \
  --region=us-central1 \
  --image=gcr.io/comdottasteslikegood/vegangenius/migration-task:latest \
  --task-timeout=5m \
  --cpu=1 \
  --memory=512Mi \
  --max-retries=0 \
  --service-account=<YOUR_IAM_SERVICE_ACCOUNT_EMAIL> \
  --vpc-connector=<YOUR_VPC_CONNECTOR_NAME> \
  --vpc-egress=all-traffic \
  --set-secrets="DB_CONNECTION_STRING=DB_SECRET_NAME:latest"
```

### 3. Update Flask Backend Secrets and Settings

Ensure your Flask backend has its `SECRET_KEY`, `FRONTEND_URL`, and the critical `--min-instances=1` setting to prevent latency for OAuth.

```bash
gcloud run services update flask-backend \
  --project=comdottasteslikegood \
  --region=us-central1 \
  --min-instances=1 \
  --set-env-vars="FRONTEND_URL=https://<YOUR_CUSTOM_DOMAIN>" \
  --set-secrets="SECRET_KEY=FLASK_SECRET_KEY_NAME:latest,DB_CONNECTION_STRING=DB_SECRET_NAME:latest" \
  --vpc-connector=<YOUR_VPC_CONNECTOR_NAME> \
  --vpc-egress=all-traffic
```

### 4. Setting up a Cloud Load Balancer (Ingress)

Since you are migrating to a production setup, your Express.js service should be exposed through a Cloud Load Balancer rather than hitting the Cloud Run URL directly. This gives you:

1. **Custom Domain Support**: e.g. `api.tasteslikegood.org`
2. **Managed SSL**: Automatic certificate provisioning.

**High-Level Steps (via Console):**

1. Navigate to **Network Services** > **Load balancing**.
2. Click **Create Load Balancer** and select **Application Load Balancer (HTTP/S)**.
3. Configure **Frontend**: Use **HTTPS** and attach a Google-managed SSL certificate targeting your custom domain.
4. Configure **Backend**: Create a Serverless Network Endpoint Group (NEG) pointing to the `express-frontend` Cloud Run service.
5. Create and point your DNS A-record to the IP address allocated to the Load Balancer.

You are now ready to trigger the build!
