# Role: Senior DevOps Engineer & Cloud Architect

## Context

We are upgrading our application from an "alpha" placeholder to a production-ready "BETA 2.22 Full Tier" application on Google Cloud Platform.
Our architecture consists of:

1. **Frontend / API Gateway:** Express.js Service.
2. **Backend / Logic:** Flask Service.
3. **Database:** Cloud SQL (PostgreSQL/MySQL) managed with Alembic for schema migrations.
4. **Ingress:** Cloud Load Balancing routing external traffic to the Express gateway.

## Objective

Update our CI/CD pipeline and deployment infrastructure to securely and reliably deploy the new BETA app to Cloud Run via Cloud Build. You must replace the existing placeholder app while adhering to zero-downtime and secure deployment best practices.

## Detailed Tasks & Requirements

### 1. Database Migrations via Cloud Run Job

- Create a `Dockerfile.migrate` based on our Flask backend base image. The `CMD` should execute `alembic upgrade head`.
- Update `cloudbuild.yaml` to:
  - Build and push the backend and frontend application images.
  - Build and push the database migration image.
  - Execute the Cloud Run Migration Job (`db-migration-job`) with the `--wait` flag. **The pipeline must halt if this migration fails.**
  - Deploy the Express and Flask services _only after_ a successful migration.

### 2. Service Configurations & Security

- Ensure the **Flask `SECRET_KEY`** is mounted securely from Google Cloud Secret Manager into the Flask Cloud Run service. Do not store secrets in plain text.
- Add `FRONTEND_URL` to the Flask backend's environment variables to ensure the OAuth callback flow functions correctly.
- Set `--min-instances=1` on the Flask backend. This is critical to prevent cold starts that invalidate state-dependent OAuth callbacks.
- Standardize environment variables related to service discovery (e.g., change instances of `flask_backend_SERVICE_ENDPOINT` to `FLASK_BACKEND_URL`).
- Ensure the Express proxy routes internal traffic (like `/api/*`) securely to the Flask internal URL.

### 3. Infrastructure Cost Optimization & Networking

- Provide the configuration, or `gcloud` update commands, to scale down our Cloud SQL instance from the expensive `db-perf-optimized-N-8` tier down to a more appropriate tier like `db-g1-small` or `db-f1-micro`.
- Provide clear instructions or Terraform/`gcloud` commands to ensure a Cloud Load Balancer sits in front of the Express gateway to manage our custom domain and SSL termination.

## Expected Output

Please provide your solution adhering strictly to the following formatting:

1. **`Dockerfile.migrate`**: Provide the complete content.
2. **Main `Dockerfile` Review**: Detail any necessary changes required for the Flask or Express Dockerfiles to support this architecture.
3. **`cloudbuild.yaml`**: Provide the full updated YAML file, integrating the multi-stage build, migration job execution, and final deployments.
4. **Infrastructure Commands**: Provide the exact `gcloud` (or Terraform) commands required to:
   - Create/update the Cloud Run Migration Job definition.
   - Update the Cloud SQL instance tier.
   - Update the Cloud Run backend service configurations (`SECRET_KEY`, `FRONTEND_URL`, `min_instances`).
5. **Implementation Strategy Summary**: A brief, concise explanation of the deployment sequence and how it guarantees safety and reliability.
