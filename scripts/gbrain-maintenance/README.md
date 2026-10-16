# gbrain daily maintenance (Railway cron service)

Keeps the shared gbrain brain (Railway Postgres) current while the dev laptop
is off. Deployed as a Railway **cron service** (`gbrain-maintenance` in the
`believable-joy` project) next to the Postgres service that hosts the brain.

## How it works (KAN-413, 2026-10-16)

Railway is the scheduler, and the hermes sprite does the work:

```
Railway cron (30 16 * * * UTC)
  └─ run.sh: POST https://api.sprites.dev/v1/sprites/<sprite>/exec   ← wakes the sprite
       └─ sprite: ~/.hermes/scripts/gbrain-remote-run.sh (waits; output → Railway logs)
            ├─ gbrain-maintain.sh: pull + sync gstack-code-backend, extract, embed, doctor
            └─ hermes cron tick: runs any due agent job (the Monday gbrain-brain-check)
```

Why it is built like this:

- **A sprite sleeps, and hermes cron does not wake it.** Between 2026-10-13
  21:30 and 2026-10-16 03:30 the sprite's `gbrain-maintain` job missed every
  run. An exec request wakes it, and `run.sh` holds that request open until the
  run finishes, so the sprite stays awake for the whole run.
- **Maintenance needs fresh code to be useful.** `extract --stale` and
  `embed --stale` only process pages a sync changed. Code sync used to happen
  only on the laptop, so a remote run had nothing to do. The sprite now has its
  own Backend clone at `/home/allisone/.gbrain/clones/gstack-code-backend`,
  the path the shared DB records for `gstack-code-backend`, so the laptop and
  the sprite can each sync that source. That is the only thing under
  `/home/allisone` on the sprite: it runs as user `sprite`, and everything
  else (hermes, its scripts, `~/gbrain`) is under `/home/sprite`.
- **The cookbook source stays laptop-only.** It is registered to the laptop's
  worktree path; a second registration elsewhere would double-store its pages.
  The laptop's `gbrain autopilot` cron (every 5 minutes) syncs it when it is on.

`run.sh` reads the sprite's result two ways, and both must agree. The HTTP
exec response ends with an exit frame (byte 3, then the process exit code),
and `gbrain-remote-run.sh` prints `EXIT=<n>` as its last output line and exits
with the same code. The format has no frame lengths, so the exit frame is read
as the last two bytes of the body. `test_run.sh` covers these cases with a
mocked curl: `bash scripts/gbrain-maintenance/test_run.sh`.

| Sprite result                                                                                                                           | `run.sh` does                                       | Exit |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---- |
| process exit 0 and `EXIT=0`                                                                                                             | nothing more                                        | 0    |
| process exit 0 and `EXIT=75` (another run holds the lock)                                                                               | logs a WARN, nothing more, to avoid an overlap      | 0    |
| run never started (no token, connect/TLS failure, HTTP error status), or it finished with a non-zero exit or no `EXIT=0`/`EXIT=75` line | runs the fallback below                             | 1    |
| as above, and a fallback phase also failed                                                                                              | runs the fallback below                             | 2    |
| request broke off mid-run (timeout, dropped connection) or the response has no exit frame                                               | skips the fallback: the sprite may still be running | 3    |

The exec request is never retried, and the fallback never runs while the
sprite might still be working: either would start a second run against the
same brain. The sprite's lock is an `flock`, released when its holder dies,
so `EXIT=75` means a live run holds it. If the WARN repeats day after day,
look for a hung run on the sprite.

The hermes `gbrain-maintain` schedule is **paused** on the sprite so the work
does not also run on hermes's own schedule when the sprite is awake. Do not
resume it while this cron is deployed.

## What the fallback does

| Phase | Command                                             | Purpose                                                  |
| ----- | --------------------------------------------------- | -------------------------------------------------------- |
| 1     | `extract --stale`                                   | Extract links/edges from any pages that lack them        |
| 2     | `embed --stale --catch-up --max-usd $EMBED_MAX_USD` | Embed any chunks missing embeddings, up to the spend cap |
| 3     | `doctor --fast`                                     | Health check: logs the score and any FAILs               |
| 4     | `sources status`                                    | Snapshot of sync lag and embed coverage per source       |

The sprite's `gbrain-maintain.sh` runs the same phases after its Backend sync.

**Nothing here runs `gbrain dream`.** The cycle's `propose_takes` phase called a
chat model for 20 to 50 minutes a night, about $3/day, with nothing consuming
the output (KAN-357). Do not add it back without a budget and a consumer.

## Deploy

The service is not connected to GitHub, so a merge to `dev` does not deploy
it. Only `railway up` does, and it restores the schedule in `railway.json`.

```bash
railway link          # pick "believable-joy"
railway up scripts/gbrain-maintenance --path-as-root --service gbrain-maintenance
railway cron run --service gbrain-maintenance --yes   # one run now, to verify
```

Service variables (Dashboard → gbrain-maintenance → Variables):

- `SPRITES_TOKEN`: Sprites API token for the `adam-schoen` org. Without it,
  every run goes straight to the fallback and exits 1.
- `SPRITE_NAME`: optional, default `spawn-sprite-hermes222`.
- `GBRAIN_DATABASE_URL`: the gbrain DB URL; used by the fallback.
- `OPENAI_API_KEY`: embeddings only; used by the fallback. Scope the key to
  the embeddings endpoint and model listing; nothing here needs chat access.
- `EMBED_MAX_USD`: optional per-run embedding spend cap (default `1`).
  Without a terminal, `gbrain embed` exits 3 unless a cap is passed.

To stop the schedule: `railway down --service gbrain-maintenance --yes`. The
service and its variables stay.

## Version pinning

The Dockerfile pins gbrain by commit SHA so this service can never run
schema migrations the local CLI hasn't seen. gbrain is NOT on npm (the npm
`gbrain` package is an unrelated GPU library); it builds from source. The
sprite's `~/gbrain` checkout is pinned to the same commit.

**When local gbrain upgrades:**

```bash
# get the new SHA
git -C ~/gbrain rev-parse HEAD
# update GBRAIN_COMMIT in Dockerfile (and the bun base image if gbrain's
# package.json engines.bun moved), check out the same SHA on the sprite, then:
railway up scripts/gbrain-maintenance --path-as-root --service gbrain-maintenance
```

## The sprite side (`spawn-sprite-hermes222`)

These files live on the sprite, not in this repo. List the hermes jobs with
`hermes cron list` and their history with `hermes cron runs`.

| File / job                               | What it does                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `~/.hermes/scripts/gbrain-remote-run.sh` | Entry point for this cron: maintain, then `hermes cron tick`, then prints `EXIT=<n>` and exits with it |
| `~/.hermes/scripts/gbrain-maintain.sh`   | Pull + sync Backend, extract, capped embed, doctor; log in `~/.gbrain/maintain.log`                    |
| hermes `gbrain-maintain`                 | Paused. Railway runs the script instead                                                                |
| hermes `gbrain-brain-check`              | Mondays 16:00 UTC, agent job; the 16:30 Railway run's tick fires it if it was asleep                   |

There is no dream job. A `gbrain-nightly-dream` agent job was removed on
2026-10-13: it sent about 495k prompt tokens a run and created no pages.

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
