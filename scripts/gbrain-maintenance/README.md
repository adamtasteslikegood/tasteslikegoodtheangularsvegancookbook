# gbrain nightly maintenance (Railway cron service)

Runs nightly gbrain maintenance (link extraction and embedding) against the
shared Railway Postgres, then exits. Deployed as a Railway **cron service**
("gbrain maintenance" in the "believable-joy" project) linked to the same
Postgres and pg_volume that host the brain.

## Status: fallback, not running (2026-10-13)

The nightly schedule is **cancelled on the live service** (KAN-410). The
service is kept with no cron schedule and no active deployment, and the same
work now runs from the hermes agent on the sprite (see below).

This directory is the **fallback**. The sprite sleeps and has missed a full
day of runs (2026-10-11), so its wake-up is not yet proven. If it keeps
missing runs, move the script work back here:

```bash
# turn the Railway nightly back on (runs once now, then nightly from railway.json)
railway up scripts/gbrain-maintenance --path-as-root --service gbrain-maintenance
# turn it off again (the service and its variables stay)
railway down --service gbrain-maintenance --yes
```

Then pause the matching hermes job (`hermes cron pause gbrain-maintain`) so
only one of the two runs the script work. The weekly agent check stays on
hermes either way: nothing here calls a chat model, and the Railway key is
scoped to embeddings.

The service is not connected to GitHub, so a merge to `dev` does not deploy
it. Only `railway up` does.

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

The hermes agent on the sprite (`spawn-sprite-hermes222`) runs the scheduled
work while the Railway nightly is off. List the jobs with `hermes cron list`
and their history with `hermes cron runs`.

| Job                  | Schedule (UTC)            | Chat model | What it does                                                    |
| -------------------- | ------------------------- | ---------- | --------------------------------------------------------------- |
| `gbrain-maintain`    | 03:30, 15:30, 21:30 daily | no         | `~/.hermes/scripts/gbrain-maintain.sh`: the same phases as here |
| `gbrain-brain-check` | Mondays 16:00             | yes        | Runs doctor, remediates under a score of 50, reports FAILs      |

There is no dream job. A `gbrain-nightly-dream` agent job was removed on
2026-10-13: it sent about 495k prompt tokens a run and created no pages.

Neither hermes nor this service syncs code. That is the dev machine's
`gbrain autopilot` cron; if it is not running, the brain only changes when
`/sync-gbrain` is run by hand.

The `gbrain-brain-check` task prompt:

```
Connect to the gbrain Railway Postgres (believable-joy project).
Run: gbrain doctor --fast
If score < 50: run gbrain extract --stale and
gbrain embed --stale --catch-up --max-usd 1, then re-check. Do not run
gbrain dream (it calls a chat model; see above).
If any source shows sync lag > 7d and is pointed at a missing path:
report it, but do not archive or delete anything.
If stale locks exist: report them, but do not break them.
Report the before/after score, every FAIL check and any actions taken.
```

This keeps the agent job lightweight: it only acts when doctor says
something is wrong.
