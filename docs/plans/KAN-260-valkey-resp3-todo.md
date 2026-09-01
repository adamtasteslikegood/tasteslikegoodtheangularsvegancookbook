# KAN-260 — the RESP2 pin, settled against a real Valkey

> **Status:** ✅ COMPLETE — ran 2026-08-31 · **Verdict: the pin was unnecessary; removed.**
> **Related:** KAN-209 (the pin's justification), KAN-182 (no staging env), PR #3448 (scoped
> the pin's justification to what the wire capture proved)

---

## The question, and the answer

> Does Memorystore, with IAM auth enabled, accept ioredis 6's RESP3 handshake
> `HELLO 3 AUTH default <iam-access-token>` — which sends a **username** — given that
> Google documents IAM auth as password-only with **no** username?

**Yes.** `server/valkey.ts` no longer pins `protocol: 2`.

The pin was never a proven incompatibility. It was an asymmetry: a refused handshake would
**not** fall back to RESP2 (ioredis' `isProtocolNegotiationError` only matches `NOPROTO` /
unknown-command), so every replica would have silently degraded to in-memory rate limiting —
on the limiter metering paid Gemini and Imagen calls. No local or containerised Valkey could
settle it, because a stock Valkey treats single-arg `AUTH` as the default user either way.

## What was run

A throwaway instance, `veganchef-valkeymem-test`, created by Adam as a copy of production.
Every field under test matched prod:

| Field                   | prod                       | test                       |
| ----------------------- | -------------------------- | -------------------------- |
| `authorizationMode`     | `IAM_AUTH`                 | `IAM_AUTH`                 |
| `engineVersion`         | `VALKEY_8_0` (8.0.6)       | `VALKEY_8_0` (8.0.6)       |
| `transitEncryptionMode` | `SERVER_AUTHENTICATION`    | `SERVER_AUTHENTICATION`    |
| `serverCaMode`          | `GOOGLE_MANAGED_SHARED_CA` | `GOOGLE_MANAGED_SHARED_CA` |
| `mode`                  | `CLUSTER_DISABLED`         | `CLUSTER_DISABLED`         |
| network                 | `default`                  | `default`                  |

**One difference, stated for the record:** the test instance ran maintenance version
`MEMORYSTORE_20260701_01_02`; prod ran `MEMORYSTORE_20260522_00_00`. The test instance is one
maintenance version _ahead_. The `iam_auth` module ships in that image, and testing against
production is ruled out — a failed IAM handshake is an auth event on the instance the
production limiter depends on — so this is the closest faithful copy obtainable.

Probe: an `e2-micro` (`valkey-probe`) in the same VPC, no external IP, SSH via IAP, outbound
via the existing `tlg-nat` Cloud NAT. Deleted after the run.

## Results

### valkey-cli / raw wire (Valkey 8.0.6, TLS verified, IAM token as password)

| #     | Test                                                                   | Result                                                     |
| ----- | ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| A     | `redis-cli --tls --cacert ca.pem -a <token> PING` — what we ship today | `PONG`                                                     |
| **B** | **`HELLO 3 AUTH default <token>` — what ioredis 6 sends**              | **RESP3 map: `server valkey`, `version 8.0.6`, `proto 3`** |
| C     | On that RESP3 connection: `AUTH <token>` → `PING` → `CLIENT INFO`      | `OK`, `PONG`, `resp=3 user=default`                        |
| D     | Alternative ordering `AUTH <token>` then `HELLO 3`                     | `+OK`, then the RESP3 map                                  |

Controls, proving the pass discriminates rather than the instance simply not enforcing auth:

| #   | Control                                 | Result                                                              |
| --- | --------------------------------------- | ------------------------------------------------------------------- |
| E1  | `HELLO 3 AUTH default not-a-real-token` | `WRONGPASS invalid username-password pair or user is disabled.`     |
| E2  | `PING` with no auth                     | `NOAUTH Authentication required.`                                   |
| E3  | `HELLO 3 AUTH someotheruser <token>`    | `ERR (ERR_IAM_OTHER) Memorystore IAM authentication backend error.` |

Raw RESP3 bytes from B, over TLS, inline command:

```
%8\r\n$6\r\nserver\r\n$6\r\nvalkey\r\n$7\r\nversion\r\n$5\r\n8.0.6\r\n$5\r\nproto\r\n:3\r\n...
```

### Application level — the real client stack

`ioredis@6.0.0` + `rate-limit-redis@6.0.1` (the exact versions `package-lock.json` pins),
connection options copied from `server/valkey.ts`, store built exactly as
`buildRedisStore()` in `server/security.ts` builds it:

```
================ protocol 2 ================        ================ protocol 3 ================
  PING            -> PONG                              PING            -> PONG
  CLIENT INFO     -> resp=2 user=default                CLIENT INFO     -> resp=3 user=default
  store.increment -> hit1=1 hit2=2 resetTime=Date      store.increment -> hit1=1 hit2=2 resetTime=Date
  AUTH <token>    -> OK                                 AUTH <token>    -> OK
  PING after AUTH -> PONG                               PING after AUTH -> PONG
  increment after refresh -> hit3=3                     increment after refresh -> hit3=3
  RESULT: protocol 2 OK                                 RESULT: protocol 3 OK
```

Identical on both protocols. `replyMapping: "legacy"` holds: the limiter's EVAL reply shape is
unchanged, and `refreshTokenInPlace()`'s password-only `AUTH` works on a RESP3 connection with
no code change.

## The one durable gotcha: `default` is the only accepted username

E3 is the finding to carry forward. Memorystore's IAM module does **not** ignore the username —
it checks it, and rejects anything other than `default`. RESP3 works only because ioredis
injects exactly that literal (`built/redis/event_handler.js:22`):

```js
helloCommandArgs.push('default', self.condition.auth);
```

If a future ioredis changes the injected username, or this code starts passing an explicit
`username` option, the handshake breaks — and, per the asymmetry above, breaks silently into
in-memory rate limiting. This is recorded in the `server/valkey.ts` comment too.

## TLS: what blocked the first attempt

Connecting fails with a certificate error unless you build the CA bundle from the **instance's
own** CA. Two facts worth keeping:

1. `gcloud memorystore get-shared-regional-certificate-authority` **does not exist** on the
   current CLI (`Invalid choice`). Only the per-instance form works:

   ```bash
   gcloud memorystore instances get-certificate-authority veganchef-valkeymem-test \
     --project=comdottasteslikegood --location=us-central1 --format=yaml > ca.yaml
   sed -n '/BEGIN CERTIFICATE/,/END CERTIFICATE/p' ca.yaml | sed 's/^[[:space:]]*//' > ca.pem
   # 4 certs; then: openssl s_client -connect <ip>:6379 -CAfile ca.pem
   #   -> Verify return code: 0 (ok)
   ```

2. **Connecting by bare IP is correct** — no SNI or hostname override needed. The server cert
   carries the endpoint IPs in its SAN:

   ```
   X509v3 Subject Alternative Name: critical
       DNS:10.128.0.37, DNS:10.128.0.36, IP Address:10.128.0.37, IP Address:10.128.0.36
   ```

   So `--tls --cacert ca.pem` against the IP verifies cleanly. Do **not** reach for
   `--insecure` / `VALKEY_TLS_INSECURE=true`; it hides exactly the CA problem above.

## Reproducing it

The procedure below is now _verified_, not proposed. Total cost is well under a dollar; the
thing that costs money is forgetting the teardown.

```bash
PROJECT=comdottasteslikegood; REGION=us-central1

# 1. Instance config to clone (the fields in the table above are the ones that matter)
gcloud memorystore instances list --project="$PROJECT" --location="$REGION" --format=yaml

# 2. Probe VM in the same VPC. Memorystore is private-IP only, so a laptop cannot reach it.
#    --no-address is fine: the tlg-nat Cloud NAT covers all subnets on the default network.
gcloud compute instances create valkey-probe --project="$PROJECT" --zone="${REGION}-a" \
  --machine-type=e2-micro --network=default --subnet=default --no-address \
  --scopes=https://www.googleapis.com/auth/cloud-platform \
  --image-family=debian-12 --image-project=debian-cloud
gcloud compute ssh valkey-probe --project="$PROJECT" --zone="${REGION}-a" --tunnel-through-iap

# 3. On the VM: redis-tools, the CA bundle (above), then the tests.
#    The VM's own IAM token is the password:  TOKEN=$(gcloud auth print-access-token)

# 4. TEARDOWN — not optional.
gcloud compute instances delete valkey-probe --project="$PROJECT" --zone="${REGION}-a" --quiet
gcloud memorystore instances delete veganchef-valkeymem-test \
  --project="$PROJECT" --location="$REGION" --quiet
```

The probe VM needs `roles/memorystore.dbConnector`-equivalent access for the IAM handshake; the
default compute service account had it already on this project.

## Post-deploy verification

The failure mode this pin guarded against is **silent**. Removing it therefore needs an explicit
check after the release ships — absence of an error is not evidence:

- `[Valkey] VALKEY_HOST not set — using in-memory rate limiting` or
  `[Valkey] Connection failed, falling back to in-memory rate limiting:` in the
  `express-frontend` logs means the handshake broke and the limiter is per-instance.
- `✅ Valkey connected for rate limiting at <host>:<port>` is the detector that it did not.
