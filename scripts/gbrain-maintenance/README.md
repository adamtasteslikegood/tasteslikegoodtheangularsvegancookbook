# gbrain nightly maintenance (Railway cron service)

Runs the full gbrain maintenance cycle nightly against the shared Railway
Postgres, then exits. Deployed as a Railway **cron service** ("gbrain
maintenance" in the "believable-joy" project) linked to the same Postgres
+ pg_volume that hosts the brain.

## What it does

| Phase | Command | Purpose |
|-------|---------|---------|
| 1 | `dream --source <each>` | Consolidate facts, grade takes, orphan detection, schema suggestions — for every active source |
| 2 | `extract --stale` | Extract links/edges from any pages that lack them |
| 3 | `embed --stale` | Embed any chunks missing embeddings |
| 4 | `doctor --fast` | Health check — logs score and any FAILs |
| 5 | `sources status` | Snapshot of sync lag, embed coverage per source |

Code sync stays on the dev machine (`gbrain autopilot` cron, every 5 min);
this service never syncs code, so there is exactly one writer per concern.

## Deploy (one-time, already done)

```bash
railway login
railway link          # pick "believable-joy"
railway up scripts/gbrain-maintenance --path-as-root --service gbrain-maintenance
```

Service variables (Dashboard → gbrain-maintenance → Variables):

- `GBRAIN_DATABASE_URL` — the gbrain DB URL (public proxy or internal)
- `OPENAI_API_KEY` — for embeddings + expansion

The cron schedule (`0 9 * * *` UTC = 2am PT) lives in `railway.json`.

## Version pinning

The Dockerfile pins gbrain by commit SHA so this service can never run
schema migrations the local CLI hasn't seen. gbrain is NOT on npm (the npm
`gbrain` package is an unrelated GPU library); it builds from source.

**When local gbrain upgrades:**

```bash
# get the new SHA
git -C ~/gbrain rev-parse HEAD
# update GBRAIN_COMMIT in Dockerfile, then:
railway up scripts/gbrain-maintenance --path-as-root --service gbrain-maintenance
```

## Hermes agent integration (spawn/sprite)

For on-demand maintenance outside the nightly cron — e.g. after a large
sync or when doctor score drops — wake the hermes agent on the spawn/sprite
instance with a brain-check task. The agent runs the same commands `run.sh`
does, but can make judgment calls (archive dead sources, break stale locks,
report anomalies).

Sample hermes cron (twice daily, offset from the Railway nightly):

```cron
0 15 * * * hermes run --task "gbrain-brain-check" --timeout 300
0 3  * * * hermes run --task "gbrain-brain-check" --timeout 300
```

The `gbrain-brain-check` task prompt:

```
Connect to the gbrain Railway Postgres (believable-joy project).
Run: gbrain doctor --fast
If score < 50: run gbrain dream on all sources, gbrain extract --stale,
gbrain embed --stale, then re-check.
If any source shows sync lag > 7d and is pointed at a missing path:
archive it (gbrain sources archive <id>).
If stale locks exist: break them (gbrain sync --break-lock --source <id>).
Report the before/after score and any actions taken.
```

This keeps the hermes agent lightweight — it only acts when doctor says
something is wrong, and the Railway cron handles the scheduled work.
