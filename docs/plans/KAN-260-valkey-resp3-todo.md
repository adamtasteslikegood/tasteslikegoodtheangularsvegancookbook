# KAN-260 — settle the RESP2 pin against a real Valkey

> **Status:** not started · **Blocks:** KAN-209 (can't close on evidence without this)
> **Written:** 2026-08-28, at the end of the Sprint 9 close-out session.
> **Related:** KAN-209, KAN-182 (no staging env), PR #3448 (merged — scoped the pin's justification)

---

## What this is

`server/valkey.ts` pins the Valkey wire protocol to RESP2:

```ts
protocol: 2,
```

That pin is **conservative, not proven necessary**. This document is the procedure
to find out which, so KAN-209 can close on evidence instead of on a guess.

**Do not remove the pin without running this.** And do not run the first attempt
against production — see §0.

---

## The actual question (one sentence)

> Does Memorystore, with IAM auth enabled, accept ioredis 6's RESP3 handshake
> `HELLO 3 AUTH default <iam-access-token>` — which sends a **username** — given
> that Google documents IAM auth as password-only with **no** username?

### What is already established

- ioredis 6 defaults to `protocol: 3`.
- Reply shapes are **not** the risk. ioredis' `replyMapping: "legacy"` default keeps
  replies identical to RESP2, and we only consume two: `rate-limit-redis`'s EVAL
  array and AUTH's simple string.
- Under RESP3 ioredis authenticates via `HELLO`, and with a password-only
  credential it injects the username `default`
  (`ioredis/built/redis/event_handler.js`).
- `refreshTokenInPlace()` in `server/valkey.ts` deliberately sends password-only
  `await client.call('AUTH', token)` — the form Google documents for Memorystore
  IAM auth ("the authentication uses the access token directly"; the CLI example
  is `valkey-cli -h HOST -p PORT -a ACCESS_TOKEN`, no `--user`).
- A rejected AUTH is **not** a protocol-negotiation error, so ioredis' automatic
  RESP2 fallback (which only catches `NOPROTO` / unknown-command) would not
  rescue it. The client would simply fail to connect, and `getValkeyClient()`
  would silently degrade **every replica** to in-memory rate limiting — on the
  limiter metering paid Gemini and Imagen calls.

### What is NOT established

That Memorystore actually **rejects** the RESP3 shape. Google documents no
required username; it documents sending none. Those are different claims, and
only the test below tells them apart.

---

## §0 — Read this before you start

**The decisive test is ~15 minutes and needs no app deploy and no staging
environment.** It is a `valkey-cli` handshake against a throwaway instance.
Do that first (§1–§4). Only do the full app-level verification (§6) if you want
belt-and-braces before shipping.

**Why a throwaway and not production:** `HELLO` mutates no data, so the test is
read-safe. But a failed IAM handshake against prod is still an auth event on the
instance the production limiter depends on, and if you fat-finger a `CONFIG` or
`FLUSHALL` while poking around you have taken out the rate limiter. Spend the
~$0.30 on a scratch instance.

**Memorystore is private-IP only.** You cannot reach it from your laptop. You
need a VM inside the same VPC (§3). This is the same constraint that makes
Cloud SQL Studio necessary for the database.

---

## §1 — Discover the real production config

`gcloud` auth had expired when this file was written, so the exact instance name
and API surface below are **unverified**. Establish them first — everything else
depends on it.

```bash
gcloud auth login          # run this yourself; it needs a browser

PROJECT=comdottasteslikegood
REGION=us-central1

# Which API is this instance on? Try both — one will return nothing.
gcloud memorystore instances list --project="$PROJECT" --location="$REGION"
gcloud redis instances list        --project="$PROJECT" --region="$REGION"
```

Docs in this repo (`docs/MCP_GCP_MONITORING.md`) name the deployed instance
**`veganchef-valkeymem`**, and explicitly note it differs from the
`vegangenius-valkey` that appears in the planning doc. Trust the list output over
both.

Dump the full config — this is what you will clone:

```bash
INSTANCE=<name from the list above>

# Whichever API answered:
gcloud memorystore instances describe "$INSTANCE" \
  --project="$PROJECT" --location="$REGION" --format=yaml > /tmp/valkey-prod.yaml
# ...or:
gcloud redis instances describe "$INSTANCE" \
  --project="$PROJECT" --region="$REGION" --format=yaml > /tmp/valkey-prod.yaml

cat /tmp/valkey-prod.yaml
```

**Fields that must match on the clone**, because they are the ones under test:

| Field                                        | Why it matters                                              |
| -------------------------------------------- | ----------------------------------------------------------- |
| auth / authorization mode (IAM)              | The whole question is about the IAM handshake               |
| transit encryption / TLS mode                | TLS changes the `valkey-cli` invocation and the CA handling |
| engine + version (Valkey vs Redis, x.y)      | RESP3 support is version-dependent                          |
| authorized network / VPC                     | Determines which VPC your test VM must live in              |
| connect mode (private service access vs PSC) | Determines whether a plain VM in the VPC can reach it       |

Node type / shard count / size do **not** matter — use the smallest available.

---

## §2 — Create the throwaway instance

Fill the flags from `/tmp/valkey-prod.yaml`. Exact flag names differ between the
`memorystore` and `redis` surfaces and between engine versions, so check:

```bash
gcloud memorystore instances create --help    # or: gcloud redis instances create --help
```

Skeleton (Memorystore for Valkey):

```bash
SCRATCH=valkey-resp3-scratch

gcloud memorystore instances create "$SCRATCH" \
  --project="$PROJECT" \
  --location="$REGION" \
  --node-type=<smallest available> \
  --shard-count=1 \
  --replica-count=0 \
  --engine-version=<match prod> \
  --authorization-mode=<match prod: IAM> \
  --transit-encryption-mode=<match prod> \
  --network=<authorized network from prod>
```

Then capture the endpoint:

```bash
gcloud memorystore instances describe "$SCRATCH" \
  --project="$PROJECT" --location="$REGION" \
  --format='value(discoveryEndpoints[0].address,discoveryEndpoints[0].port)'
```

> ⚠️ **Set a teardown reminder right now.** An idle Memorystore instance bills
> continuously. §5 is not optional.

---

## §3 — A VM inside the VPC to test from

```bash
NETWORK=<authorized network from prod>
SUBNET=<a subnet of that network in $REGION>

gcloud compute instances create valkey-probe \
  --project="$PROJECT" \
  --zone="${REGION}-a" \
  --machine-type=e2-micro \
  --network="$NETWORK" \
  --subnet="$SUBNET" \
  --no-address \
  --scopes=https://www.googleapis.com/auth/cloud-platform \
  --image-family=debian-12 --image-project=debian-cloud
```

`--no-address` (no public IP) means you SSH via IAP:

```bash
gcloud compute ssh valkey-probe --project="$PROJECT" --zone="${REGION}-a" --tunnel-through-iap
```

If IAP is not enabled, either enable it or drop `--no-address` for the life of
the probe. `--scopes=cloud-platform` is what lets the VM mint its own IAM access
token in §4.

On the VM:

```bash
sudo apt-get update && sudo apt-get install -y redis-tools
# redis-cli speaks the Valkey protocol; if you want the real thing, build
# valkey-cli from the valkey-io/valkey release tarball instead.
```

---

## §4 — THE TEST (this is the whole point)

On the probe VM:

```bash
HOST=<scratch instance address>
PORT=<scratch instance port>

# The IAM access token IS the password for Memorystore IAM auth.
TOKEN=$(gcloud auth print-access-token)
```

If prod uses TLS, download the server CA into `ca.pem` first (the describe output
tells you where it comes from) and add `--tls --cacert ca.pem` to every command
below.

### Test A — the form we ship today (RESP2, password-only). Expect success.

```bash
redis-cli -h "$HOST" -p "$PORT" -a "$TOKEN" --no-auth-warning PING
# expect: PONG
```

If this fails, stop — your instance config or token is wrong, not the protocol.

### Test B — the form ioredis 6 would send under RESP3. **This is the answer.**

```bash
redis-cli -h "$HOST" -p "$PORT" --no-auth-warning
# then, at the prompt:
HELLO 3 AUTH default <paste $TOKEN>
```

| Result                                                          | Meaning                                                                | Action                                                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Returns a map (`server`, `version`, `proto: 3`, …)              | Memorystore accepts a `default` username with an IAM token under RESP3 | **The pin is unnecessary.** Go to §6, then remove it.               |
| `WRONGPASS` / `invalid username-password pair` / any auth error | The username breaks IAM auth, exactly as feared                        | **The pin is load-bearing.** Keep it, and record this as the proof. |
| `NOPROTO` / unknown command `HELLO`                             | The engine predates RESP3 entirely                                     | Pin stays; note the engine version.                                 |

### Test C — token refresh under RESP3 (only if B succeeded)

`refreshTokenInPlace()` re-authenticates a live connection with password-only
`AUTH <token>`. Confirm that still works on a connection that negotiated RESP3:

```bash
# in the same redis-cli session that ran HELLO 3 successfully:
AUTH <a freshly minted $TOKEN>
# expect: OK
PING
# expect: PONG
```

If B passes but C fails, the pin still comes out **only** if
`refreshTokenInPlace()` is changed to match — that is a code change, not just a
flag flip. Record it.

**Copy the raw terminal output of B and C into KAN-209.** The whole reason this
ticket is open is that the current justification is reasoning, not a capture.

---

## §5 — TEAR DOWN (do not skip)

```bash
gcloud compute instances delete valkey-probe \
  --project="$PROJECT" --zone="${REGION}-a" --quiet

gcloud memorystore instances delete "$SCRATCH" \
  --project="$PROJECT" --location="$REGION" --quiet
# ...or the `gcloud redis instances delete` equivalent.
```

Verify both are gone:

```bash
gcloud memorystore instances list --project="$PROJECT" --location="$REGION"
gcloud compute instances list --project="$PROJECT" --filter='name:valkey-probe'
```

---

## §6 — Optional app-level verification (only if §4B passed)

Only worth doing if you intend to actually remove the pin.

1. In `server/valkey.ts`, change `protocol: 2` → `protocol: 3` (or delete the
   line, since 3 is the ioredis 6 default).
2. Point a staging Express at the scratch instance:
   `VALKEY_HOST`, `VALKEY_PORT`, `VALKEY_AUTH_MODE`, and `VALKEY_CA_CERT` if TLS.
   (`VALKEY_TLS_INSECURE=true` exists but is dev-only — do not use it here; it
   would hide precisely the TLS/CA problems you are testing for.)
3. Confirm in the logs that you get **neither**
   `[Valkey] VALKEY_HOST not set — using in-memory rate limiting` **nor** a
   connection failure. Silent degradation to in-memory is the failure mode that
   makes this dangerous, and it does not announce itself as an error.
4. Drive enough requests to trip the limiter and confirm the count is shared
   across replicas (that is what proves Valkey is actually backing it, not the
   in-memory fallback).

---

## §7 — Closing out

**If the pin is unnecessary (§4B returned a map):**

- Remove `protocol: 2` and the now-obsolete half of the comment block.
- Keep the part documenting that IAM auth is password-only — that is still true
  and still explains `refreshTokenInPlace()`.
- Paste the §4 capture into KAN-209 and close it.

**If the pin is load-bearing (§4B errored):**

- Leave the code exactly as it is.
- Replace the comment's hedged "this is a deviation from documented guidance,
  NOT evidence that Memorystore rejects the RESP3 shape" with the actual error
  string and the date it was captured.
- Close KAN-209 as "verified necessary" — that is a real outcome, not a
  non-result.

Either way KAN-260 closes when the capture is on the ticket.

---

## Cost note

An `e2-micro` plus the smallest Memorystore node for under an hour is roughly
pocket change. The thing that costs money is **forgetting §5**. Set the reminder
when you create the instance, not after.
