# Valkey (Memorystore) + Pub/Sub Integration Plan

> Created: 2026-03-20
> Status: Planning (not yet implemented)
> Related: [ADR-001](../ADR-001-auth-and-persistence-routing.md)

## Problem Statement

The app currently has three architectural gaps:

1. **Sessions in PostgreSQL** — Every request hits Cloud SQL for session lookup (~5-20ms). In-memory Valkey would be ~0.5-2ms. Sessions also tie up DB connection pool slots.

2. **Synchronous AI generation** — `POST /api/generate` and `POST /api/generate_image` block the HTTP request until Gemini/Imagen responds (5-30+ seconds). During this time, the gunicorn worker is occupied and can't serve other requests. Image generation via Imagen is especially slow.

3. **Rate limiting is per-container** — Express rate limits live in memory. Each Cloud Run container has its own counter, so limits reset on scale-up and are inconsistent across instances.

---

## Why Valkey over Redis

| Factor                 | Valkey                                      | Redis                                             |
| ---------------------- | ------------------------------------------- | ------------------------------------------------- |
| **License**            | BSD-3 (fully open-source, Linux Foundation) | RSALv2 + SSPLv1 (restrictive for cloud providers) |
| **GCP direction**      | GCP's recommended path forward              | Frozen at v7.2 on Memorystore                     |
| **Pricing**            | Shared-core-nano 1.4GB: **~$23/mo**         | Basic M1 1GB: **~$35/mo**                         |
| **API compatibility**  | 100% Redis-compatible (same wire protocol)  | The original                                      |
| **Python `redis` lib** | ✅ Works identically                        | ✅ Works                                          |
| **Node.js `ioredis`**  | ✅ Works identically                        | ✅ Works                                          |
| **Flask-Session**      | `SESSION_TYPE = 'redis'` (same config)      | `SESSION_TYPE = 'redis'`                          |

**Zero code difference** — same Python `redis` library, same `ioredis` for Node.js. The only difference is which Memorystore engine you select in GCP Console.

---

## Proposed Architecture

```
Browser → Express → Flask
                      ├─ Valkey (Memorystore)
                      │   ├─ Session store (Flask-Session, SESSION_TYPE='redis')
                      │   ├─ Rate limit counters (shared across containers)
                      │   └─ Response cache (prompt → recipe)
                      │
                      └─ Pub/Sub
                          ├─ Topic: recipe-generation
                          │   └─ Worker subscribes, calls Gemini, writes result to DB
                          ├─ Topic: image-generation
                          │   └─ Worker subscribes, calls Imagen, writes result to DB
                          └─ Browser polls /api/recipes/<id>/status or gets SSE updates
```

---

## VPC Networking: Direct VPC Egress vs VPC Connector

Cloud Run must reach Valkey over a private VPC network. Two options:

|                         | **Direct VPC Egress** (preferred)            | **Serverless VPC Connector** (fallback) |
| ----------------------- | -------------------------------------------- | --------------------------------------- |
| **Base cost**           | **$0** (no extra VMs)                        | **~$14-20/mo** (min 2 always-on VMs)    |
| **Latency**             | Lower (direct path)                          | Higher (extra network hop)              |
| **Scales to zero**      | ✅ Yes                                       | ❌ No — VMs run 24/7                    |
| **Management**          | None                                         | Must size and monitor VMs               |
| **Memorystore support** | Check at deploy time — may require connector | ✅ Always supported                     |

**Strategy:** Try Direct VPC Egress first. If Memorystore requires a connector, fall back to VPC connector.

```bash
# Direct VPC Egress deploy flag:
gcloud run deploy flask-backend \
  --network=default \
  --subnet=default \
  --vpc-egress=private-ranges-only \
  ...

# VPC Connector fallback:
gcloud run deploy flask-backend \
  --vpc-connector=vegangenius-connector \
  ...
```

---

## Phase 1: Valkey for Sessions (swap SQLAlchemy → Valkey)

### What changes

| File                       | Change                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `Backend/requirements.txt` | Add `redis>=5.0.0` (Python client — works with Valkey)                                 |
| `Backend/config.py`        | Add `REDIS_URL` env var (default `redis://localhost:6379`)                             |
| `Backend/app.py`           | Change `SESSION_TYPE` from `'sqlalchemy'` to `'redis'`, add `SESSION_REDIS` connection |
| `Backend/extensions.py`    | No change (Flask-Session handles Redis/Valkey internally)                              |
| `Backend/Dockerfile`       | No change (redis is pure Python)                                                       |
| `cloudbuild.yaml`          | Add `REDIS_URL` secret to flask-backend deploy step                                    |

### GCP Infrastructure needed

1. **Memorystore for Valkey** — `us-central1`, shared-core-nano (1.4GB), instance name: `vegangenius-valkey`
2. **VPC networking** — Direct VPC Egress (preferred) or Serverless VPC Connector (fallback)
3. **Secret Manager** — Store `REDIS_URL` as `redis://10.x.x.x:6379` (Memorystore private IP)
4. **Cloud Run update** — Add VPC networking flag and `REDIS_URL` secret to `flask-backend` deploy

### GCP setup steps

```bash
# 1. Create Valkey instance
gcloud memorystore instances create vegangenius-valkey \
  --region=us-central1 \
  --engine-version=valkey-8.0 \
  --node-type=shared-core-nano \
  --network=projects/comdottasteslikegood/global/networks/default

# 2. Get the private IP
gcloud memorystore instances describe vegangenius-valkey \
  --region=us-central1 \
  --format="value(discoveryEndpoints[0].address)"

# 3. Store in Secret Manager
echo -n "redis://PRIVATE_IP:6379" | \
  gcloud secrets create REDIS_URL --data-file=- --project=comdottasteslikegood

# 4. (If needed) Create VPC connector
gcloud compute networks vpc-access connectors create vegangenius-connector \
  --region=us-central1 \
  --network=default \
  --range=10.8.0.0/28 \
  --min-instances=2 \
  --max-instances=3 \
  --machine-type=f1-micro
```

### Code changes (Flask)

```python
# config.py — add:
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

# app.py — replace the SESSION_TYPE block:
import redis as redis_client
from config import REDIS_URL

# Valkey/Redis session store (replaces SQLAlchemy sessions)
# Flask-Session's 'redis' type works with both Redis and Valkey
# (same wire protocol, same Python client library)
if REDIS_URL and REDIS_URL != "redis://localhost:6379":
    app.config['SESSION_TYPE'] = 'redis'
    app.config['SESSION_REDIS'] = redis_client.from_url(REDIS_URL)
else:
    # Fallback: keep SQLAlchemy sessions for local dev without Valkey
    app.config['SESSION_TYPE'] = 'sqlalchemy'
    app.config['SESSION_SQLALCHEMY'] = db
    app.config['SESSION_SQLALCHEMY_TABLE'] = 'flask_sessions'

# These settings apply to both backends:
app.config['SESSION_PERMANENT'] = True
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=14)
app.config['SESSION_KEY_PREFIX'] = 'vg:'
app.config['SESSION_CLEANUP_N_REQUESTS'] = 100  # Only used by SQLAlchemy backend
app.config['SESSION_COOKIE_NAME'] = 'vg_session'
app.config['SESSION_COOKIE_SECURE'] = bool(os.environ.get('FLASK_SECRET_KEY'))
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
```

### cloudbuild.yaml change

```yaml
# In the flask-backend deploy step, add REDIS_URL secret:
- --set-secrets=...,REDIS_URL=REDIS_URL:latest

# Add VPC networking (try Direct VPC Egress first):
- --network=default
- --subnet=default
- --vpc-egress=private-ranges-only
# OR if connector needed:
# - --vpc-connector=vegangenius-connector
```

### Migration notes

- All existing sessions will be invalidated (one-time re-login, same as the SQLAlchemy migration)
- The `flask_sessions` table in PostgreSQL can be dropped after confirming Valkey works
- Local dev works without Valkey — falls back to SQLAlchemy sessions automatically

---

## Phase 2: Valkey for Rate Limiting (shared counters)

### What changes

| File                 | Change                                                    |
| -------------------- | --------------------------------------------------------- |
| `server/security.ts` | Use `rate-limit-redis` store instead of in-memory default |
| `package.json`       | Add `rate-limit-redis`, `ioredis`                         |
| `server/index.ts`    | Initialize Valkey client, pass to rate limiters           |
| `cloudbuild.yaml`    | Add `REDIS_URL` secret to `express-frontend` deploy step  |

### Code changes (Express)

```typescript
// security.ts
import RedisStore from 'rate-limit-redis';
import Redis from 'ioredis';

// Connect to Valkey (ioredis works identically with Redis and Valkey)
const redisClient = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

export const createApiLimiter = (windowMs = 15 * 60 * 1000, max = 100) => {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Use Valkey store if available, otherwise fall back to in-memory
    ...(redisClient && {
      store: new RedisStore({
        sendCommand: (...args: string[]) => redisClient.call(...args),
      }),
    }),
    message: { error: 'Too many requests, please try again later.' },
    skip: (req) => req.path === '/api/health',
  });
};
```

### Benefits

- Rate limits consistent across all Cloud Run containers
- Limits survive container restarts / scale-down
- Both Express and Flask can share the same Valkey instance
- Graceful fallback: no Valkey → in-memory (current behavior)

---

## Phase 3: Valkey for Caching

### What changes

| File                                       | Change                                      |
| ------------------------------------------ | ------------------------------------------- |
| `Backend/app.py` or new `Backend/cache.py` | Flask-Caching with Redis backend            |
| `Backend/requirements.txt`                 | Add `Flask-Caching>=2.0.0`                  |
| `Backend/blueprints/generation_api_bp.py`  | Cache Gemini responses (optional)           |
| `Backend/blueprints/recipes_api_bp.py`     | Cache recipe list / recipe detail responses |

### Cache candidates

| Endpoint                      | Cache TTL | Key                     | Benefit                                    |
| ----------------------------- | --------- | ----------------------- | ------------------------------------------ |
| `GET /api/recipes`            | 60s       | `recipes:{user_id}`     | Avoid DB query on every page load          |
| `GET /api/recipes/<id>`       | 300s      | `recipe:{id}`           | Hot recipe detail                          |
| `GET /api/recipes/<id>/image` | 3600s     | `img:{id}`              | Avoid base64 decode on every image request |
| `GET /api/collections`        | 60s       | `collections:{user_id}` | Cookbook list                              |

### Cache invalidation

- On recipe create/update/delete → clear `recipes:{user_id}` and `recipe:{id}`
- On collection update → clear `collections:{user_id}`
- On image generation → clear `img:{id}`

### Code changes (Flask)

```python
# cache.py (new file)
from flask_caching import Cache
from config import REDIS_URL

cache_config = {
    'CACHE_TYPE': 'RedisCache',
    'CACHE_REDIS_URL': REDIS_URL,
    'CACHE_KEY_PREFIX': 'vg_cache:',
    'CACHE_DEFAULT_TIMEOUT': 60,
} if REDIS_URL else {
    'CACHE_TYPE': 'SimpleCache',  # In-memory fallback for local dev
    'CACHE_DEFAULT_TIMEOUT': 60,
}

cache = Cache()
```

---

## Phase 4: Pub/Sub for Async AI Generation

### Architecture

```
POST /api/generate
  → Flask validates input, creates a "pending" Recipe in DB
  → Publishes message to `recipe-generation` topic
  → Returns 202 Accepted with { recipe_id, status: "generating" }

Subscriber (Cloud Run worker or Cloud Function):
  → Receives message
  → Calls Gemini API
  → Updates Recipe in DB (status: "ready", data: {...})
  → Optionally publishes to `image-generation` topic

POST /api/generate_image
  → Flask validates recipe exists
  → Publishes message to `image-generation` topic
  → Returns 202 Accepted with { status: "generating_image" }

Subscriber:
  → Receives message
  → Calls Imagen API
  → Updates Recipe in DB (ai_image_data, ai_image_url)

Frontend polling:
  → GET /api/recipes/<id>/status → { status: "generating" | "ready" | "error" }
  → Or SSE: GET /api/recipes/<id>/stream → Server-Sent Events
```

### What changes

| File                                      | Change                                                         |
| ----------------------------------------- | -------------------------------------------------------------- |
| `Backend/requirements.txt`                | Add `google-cloud-pubsub>=2.0.0`                               |
| `Backend/services/pubsub_service.py`      | New — publish messages to topics                               |
| `Backend/workers/recipe_worker.py`        | New — subscribes to `recipe-generation`, calls Gemini          |
| `Backend/workers/image_worker.py`         | New — subscribes to `image-generation`, calls Imagen           |
| `Backend/blueprints/generation_api_bp.py` | Rewrite to publish instead of blocking                         |
| `Backend/models/recipe.py`                | Add `status` field (`pending`, `generating`, `ready`, `error`) |
| `Backend/migrations/`                     | New migration for `status` column                              |
| `Backend/Dockerfile`                      | Worker entrypoint (or separate Dockerfile)                     |
| `cloudbuild.yaml`                         | Add worker service deploy step                                 |
| `src/services/gemini.service.ts`          | Update to poll for completion                                  |
| `src/app.component.ts`                    | Update UI to show generation progress                          |

### GCP setup

```bash
# Create topics and subscriptions
gcloud pubsub topics create recipe-generation --project=comdottasteslikegood
gcloud pubsub topics create image-generation --project=comdottasteslikegood

gcloud pubsub subscriptions create recipe-worker-sub \
  --topic=recipe-generation --ack-deadline=120 --project=comdottasteslikegood

gcloud pubsub subscriptions create image-worker-sub \
  --topic=image-generation --ack-deadline=300 --project=comdottasteslikegood
```

### Message schema

```json
// recipe-generation
{ "recipe_id": "uuid", "prompt": "...", "model": "gemini-3.1-pro-preview",
  "user_id": "...", "guest_session_id": "...", "generate_image": true }

// image-generation
{ "recipe_id": "uuid", "recipe_name": "...",
  "image_keywords": ["..."], "force_regenerate": false }
```

### Frontend changes

```typescript
// New async flow:
const response = await fetch('/api/generate', { body: JSON.stringify({ prompt }) });
const { recipe_id, status } = await response.json(); // returns immediately (202)

// Poll for completion:
const poll = setInterval(async () => {
  const res = await fetch(`/api/recipes/${recipe_id}/status`);
  const { status, recipe } = await res.json();
  if (status === 'ready') {
    clearInterval(poll); /* update UI */
  } else if (status === 'error') {
    clearInterval(poll); /* show error */
  }
}, 2000);
```

---

## Phase 5: SSE (Server-Sent Events) — Optional Enhancement

Replace polling with real-time updates:

```
GET /api/recipes/<id>/stream
→ Content-Type: text/event-stream
→ data: {"status": "generating", "progress": "Calling Gemini..."}
→ data: {"status": "ready", "recipe": {...}}
```

Express proxy already supports streaming (`server/proxy.ts` uses raw HTTP streams).

---

## Infrastructure Cost Estimate

| Service                    | Tier                        | Monthly Cost |
| -------------------------- | --------------------------- | ------------ |
| **Memorystore for Valkey** | Shared-core-nano, 1.4GB     | **~$23/mo**  |
| VPC networking (preferred) | Direct VPC Egress           | **$0**       |
| VPC networking (fallback)  | VPC Connector, f1-micro × 2 | ~$14-20/mo   |
| Pub/Sub (Phase 4)          | Per-message                 | ~$0.50-2/mo  |
| Cloud Run worker (Phase 4) | Scales to zero              | ~$5-15/mo    |

### Total by phase

| Phases                     | Direct VPC Egress | VPC Connector |
| -------------------------- | ----------------- | ------------- |
| **1-3** (Valkey only)      | **~$23/mo**       | ~$37-43/mo    |
| **1-5** (Valkey + Pub/Sub) | **~$29-40/mo**    | ~$43-57/mo    |

---

## Implementation Order

```
Phase 1: Valkey Sessions ─────────────┐
  (GCP: Memorystore + VPC networking) │
                                       ├─→ Phase 3: Valkey Caching
Phase 2: Valkey Rate Limiting ────────┘
  (depends on Phase 1 Valkey instance)

Phase 4: Pub/Sub Async Generation ────→ Phase 5: SSE (optional)
  (independent of Valkey phases)
```

---

## Local Development

```bash
# Docker (recommended)
docker run -d --name valkey -p 6379:6379 valkey/valkey:8.0

# Or no container — app falls back automatically
# (no REDIS_URL set → SQLAlchemy sessions + in-memory rate limiting)

# Pub/Sub emulator (Phase 4):
gcloud beta emulators pubsub start --project=comdottasteslikegood
export PUBSUB_EMULATOR_HOST=localhost:8085
```

---

## Risks & Considerations

1. **VPC networking** — Try Direct VPC Egress first ($0). Fall back to connector (~$15/mo) if needed.
2. **Valkey persistence** — Shared-core-nano has no persistence. Session loss = re-login. Acceptable.
3. **Pub/Sub ordering** — Workers must be idempotent (check status before overwriting).
4. **Worker cold starts** — Keep `min-instances=0` unless latency is unacceptable.
5. **Complexity** — Implement incrementally. Validate each phase before starting the next.
6. **Graceful degradation** — All code includes fallback to current behavior when Valkey/Pub/Sub unavailable.
