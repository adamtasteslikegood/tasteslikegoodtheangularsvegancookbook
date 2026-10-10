# gbrain nightly maintenance (Railway cron service)

Runs nightly gbrain maintenance (link extraction and embedding) against the
shared Railway Postgres, then exits. Deployed as a Railway **cron service**
("gbrain maintenance" in the "believable-joy" project) linked to the same
Postgres and pg_volume that host the brain.

## What it does

| Phase | Command                                             | Purpose                                                  |
| ----- | --------------------------------------------------- | -------------------------------------------------------- |
| 1     | `extract --stale`                                   | Extract links/edges from any pages that lack them        |
| 2     | `embed --stale --catch-up --max-usd $EMBED_MAX_USD` | Embed any chunks missing embeddings, up to the spend cap |
| 3     | `doctor --fast`                                     | Health check — logs score and any FAILs                  |
| 4     | `sources status`                                    | Snapshot of sync lag, embed coverage per source          |

**It does not run `gbrain dream`.** The cycle's `propose_takes` phase called a
chat model for 20 to 50 minutes a night, about $3/day, with nothing consuming
the output (KAN-357). Do not add it back without a budget and a consumer.

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
- `OPENAI_API_KEY` — embeddings only. Scope the key to the embeddings
  endpoint and model listing; nothing here needs chat access.
- `EMBED_MAX_USD` — optional per-run embedding spend cap (default `1`).
  Without a terminal, `gbrain embed` exits 3 unless a cap is passed.

The cron schedule (`0 9 * * *` UTC = 2am PT) lives in `railway.json`.

## Version pinning

The Dockerfile pins gbrain by commit SHA so this service can never run
schema migrations the local CLI hasn't seen. gbrain is NOT on npm (the npm
`gbrain` package is an unrelated GPU library); it builds from source.

**When local gbrain upgrades:**

```bash
# get the new SHA
git -C ~/gbrain rev-parse HEAD
# update GBRAIN_COMMIT in Dockerfile (and the bun base image if gbrain's
# package.json engines.bun moved), then:
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
If score < 50: run gbrain extract --stale and
gbrain embed --stale --catch-up --max-usd 1, then re-check. Do not run
gbrain dream (it calls a chat model; see above).
If any source shows sync lag > 7d and is pointed at a missing path:
archive it (gbrain sources archive <id>).
If stale locks exist: break them (gbrain sync --break-lock --source <id>).
Report the before/after score and any actions taken.
```

This keeps the hermes agent lightweight — it only acts when doctor says
something is wrong, and the Railway cron handles the scheduled work.
