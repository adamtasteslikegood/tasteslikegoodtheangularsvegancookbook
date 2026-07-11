# gbrain nightly maintenance (Railway cron service)

Runs `gbrain dream` (call-graph edge resolution) + `gbrain extract --stale`
nightly against the shared gbrain Postgres, then exits. Deployed as a Railway
**cron service** in the same Railway project as the Postgres so it needs no
special egress (Claude Code cloud routines can't reach the DB — their sandbox
egress is HTTP-proxy-only and Railway's TCP proxy on :34400 is raw Postgres;
that dead end is why this service exists).

Code sync stays on the dev machine (`/sync-gbrain` or `gbrain autopilot`);
this service never syncs code, so there is exactly one writer per concern.

## Deploy (one-time)

```bash
cd scripts/gbrain-maintenance
railway login
railway link          # pick the Railway project that hosts the gbrain Postgres
railway add --service gbrain-maintenance
railway up --service gbrain-maintenance
```

Then set service variables (Dashboard → gbrain-maintenance → Variables):

- `GBRAIN_DATABASE_URL` — the gbrain DB URL. From inside the same Railway
  project you can use the private endpoint
  (`postgresql://postgres:<pw>@<postgres>.railway.internal:5432/gbrain`,
  IPv6 private network) or simply reuse the public proxy URL
  (`...@switchback.proxy.rlwy.net:34400/gbrain`) — egress from Railway to its
  own proxy is unrestricted.
- `OPENAI_API_KEY` — gbrain embeds with `text-embedding-3-large` and uses
  `gpt-5.2` for expansion; the dream cycle's embed phase fails without it.
- `GBRAIN_DREAM_SOURCE` (optional) — defaults to
  `gstack-code-575c47df-9dc431`, the owner's worktree-scoped code source.

The cron schedule (`0 9 * * *` UTC = 2am PT) lives in `railway.json`.
Railway cron requires the container to exit when done; `run.sh` does.

## Version pinning

The Dockerfile pins gbrain to commit
`646179047a8e4ad9c462d83ce9a67a50ba076de8` (v0.42.56.0) — the same version as
the owner's local install — so this service can never run schema migrations
the local CLI hasn't seen. gbrain is NOT on npm (the npm `gbrain` package is
an unrelated GPU library); it builds from `github.com/garrytan/gbrain`.

**When local gbrain upgrades:** update `GBRAIN_COMMIT` in the Dockerfile to
`git -C ~/gbrain rev-parse HEAD` and redeploy (`railway up`).
