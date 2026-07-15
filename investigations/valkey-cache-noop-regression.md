---
type: concept
title: 'Investigation: extensions.cache no-op stub (Backend issue #143)'
ingested_via: put_page
ingested_at: '2026-07-15T11:49:39.852Z'
source_kind: put_page
tags:
  - investigation
  - valkey-cache-noop-regression
---

# Root cause
Merge regression, not a never-built feature. 48d5c14 (+1e75a2a) shipped Valkey response caching via Flask-Caching. Merge 07123c2 resolved extensions.py/app.py/config.py/deps against a main without the feature, dropping the wiring while consumers (cache_utils.py, generation_api_bp image caching, worker invalidation, valkey_auth.py) survived. d677942 silenced the resulting mypy errors with a _NullCache stub, cementing the regression.

# Impact
GET /api/recipes/<id>/image hit GCS / base64-decoded DB blobs on every request. Prod already injects VALKEY_HOST=10.128.0.11, VALKEY_AUTH_MODE=iam (cloudbuild.yaml:131) — instance provisioned, unused. Issue's model-list claim was wrong: model_service uses a working file-based cache (models_list.json).

# Fix
PR #192 (draft, into Backend dev): restore Cache() in extensions, VALKEY_* config vars, backend selection in create_app (Valkey IAM/password > REDIS_URL > SimpleCache, fault-tolerant), flask-caching==2.4.1, 6 regression tests. 170 tests pass, mypy/black/flake8 clean.

# Still open
- flask-session server-side sessions lost in the same merge — separate scope, not restored.
- Pre-existing: serve_recipe_image checks cache before ACL; private image servable by UUID for 24h after an authorized fetch.
