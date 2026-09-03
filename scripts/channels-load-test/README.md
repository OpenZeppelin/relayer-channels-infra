# channels-load-test

k6 load test for the channels plugin — throughput and stability probing against
the plugin service or through the relayer.

**First time here: read [SETUP.md](./SETUP.md)** — it lists everything an
operator must provision (tools, a funded key, the smoke contract, an env file)
before the first run.

**The entry point is `./run.sh <profile> <env-file>`.** Profiles are named and
fixed (smoke / sustained / capacity), environments live in `env/*.env`, and the
runner prints the commit hash — so every run is fully described by those three
things and results can be compared across time and operators.

This README is the reference for the harness itself: wire format, flags, payload shape.

## Files here

| File | Purpose |
|---|---|
| `run.sh` | Entry point — named profiles × environment files. |
| `env/staging-example.env` | Staging template — copy to `env/staging.env` and edit. |
| `env/mainnet-example.env` | Mainnet template — copy to `env/mainnet.env` and edit. |
| `SETUP.md` | What an operator must provision before the first run. |
| `load-test.k6.js` | The k6 script. Its header carries the raw commands `run.sh` wraps. |
| `generate-payloads.ts` | Pre-signs Stellar payloads — k6 has no Stellar SDK. |
| `payloads.example.json` | Payload file format. |
| `package.json` / `package-lock.json` | `@stellar/stellar-sdk` + `tsx` for the generator. |

Generated `payloads*.json` and `*.meta.json` are gitignored — they contain signed
transactions bound to a specific account and sequence range.

## Install

See [SETUP.md](./SETUP.md) for the full list. Short version: `brew install k6`
(verified against v1.5.0), `npm install` in this directory, and a funded,
dedicated Stellar CLI key for the generator.

## Wire format

Direct mode (no `PLUGIN_ID`) — hits the plugin service:

```
POST {BASE_URL}/
Authorization: Bearer {API_KEY}
Content-Type: application/json

{"params": { ...request... }}
```

Relayer mode (`PLUGIN_ID` set) — routes through the relayer's plugin API:

```bash
POST {BASE_URL}/api/v1/plugins/{PLUGIN_ID}/call
x-api-key: {API_KEY}
Authorization: Bearer {API_KEY}
```

Response is `{"success": bool, "data": …, "error"?: …, "metadata"?: …}` in both cases.
A `200` carrying `success: false` is a plugin rejection, not a transport failure —
see the "Reading the output" section.

## Test types

| `TEST_TYPE` | Submits | Replayable? |
|---|---|---|
| `func-auth-no-auth` | `no_auth_bump(42)` — no signature involved | **Yes.** One payload, runs indefinitely |
| `xdr-payment` | Signed self-payment, 0.000001 XLM | No — each payload burns a sequence number |
| `func-auth-address-auth` | `write_with_address_auth(addr, 777)` with a signed auth entry | No — auth entries expire at `validUntilLedger` |
| `xdr-unsigned-soroban` | `write_with_address_auth(addr, 999)` — auth entry signed, **envelope unsigned** (smart-wallet / passkey flow) | No — auth nonce, plus `timeBounds` |
| `all` | Round-robins all four | Limited by the single-use types |

Only `func-auth-no-auth` sustains an open-ended run. That is why the original
`smoke.sh` labelled its `load-no-auth` preset "sustainable" and warned that the
others need payload regeneration.

## Generating payloads

k6 has no Stellar SDK, so anything needing a signature is built off-line first
by `generate-payloads.ts`.

Payloads call a **smoke contract** that must exist on the target network.
Deploy it with `oz-channels smoke setup` — see SETUP.md. Pass your contract's
ID to the generator (`--contract-id`) and put the same ID in your env file.

```bash
npm install

# everything — needs a funded Stellar CLI key and network access
npx tsx generate-payloads.ts --count 500 --output payloads.json

# the open-ended type only — no key, no network
npx tsx generate-payloads.ts --types func-auth-no-auth --output payloads.json

npx tsx generate-payloads.ts --help
```

| Flag | Default | Notes |
|---|---|---|
| `--count <n>` | `200` | Payloads per single-use type |
| `--output <path>` | `./payloads.json` | Also writes `<name>.meta.json` alongside |
| `--types <list>` | `all` | Comma-separated, or `all` |
| `--network <net>` | `testnet` | `testnet` \| `mainnet` |
| `--rpc-url <url>` | per network | Soroban RPC |
| `--contract-id <id>` | — | Your deployed smoke contract |
| `--account-name <n>` | `test-account` | Stellar CLI key name |
| `--valid-for <n>` | `1000` | Auth entry lifetime in ledgers (~85 min) |
| `--tx-timeout <n>` | `45` | Timebound for both envelope types, seconds. Must stay under 60. |
| `--dry-run` | — | Print the plan, touch no network |

Sizing: single-use payloads are consumed one per request, so `--count` must
exceed `rps × duration` for those types or the run reports `exhausted` and
understates throughput. `func-auth-no-auth` needs no sizing at all.

### The 60-second wall on the envelope types

**The service rejects any envelope whose `timeBounds.maxTime` is more than 60
seconds ahead** — HTTP 400 `TIMEBOUNDS_TOO_FAR`, observed once on staging.

That is a hard ceiling on pre-generation, not a tuning knob. It hits **both
envelope types**, `xdr-payment` and `xdr-unsigned-soroban`: however many you
build, they all die about a minute after you build them. Consequences:

- **Both envelope types can only be used in a burst.** Generate, then submit
  within ~45 seconds. Neither can participate in a 5-minute run at all.
- **They differ in one way worth knowing.** `xdr-unsigned-soroban` uses a
  placeholder source account, replaced by the channel account on submission, so
  it reserves no sequence number on your signer. `xdr-payment` does reserve a
  contiguous range and is invalidated if anything else transacts on that account.
- **For sustained runs, use `func-auth-no-auth`** (no expiry whatsoever) or
  `func-auth-address-auth` (auth entries last `--valid-for` ledgers, ~85 min at
  the default).
- `--tx-timeout` values of 60 or more are rejected by the generator up front
  rather than producing a file that fails on every request.

This is also why the original `smoke.sh` could only offer `func-auth-no-auth` as
its "sustainable" preset — the other types were never viable for long runs.

The `.meta.json` sidecar records the signer, ledger, auth expiry and sequence
range — worth keeping with the results, since auth entries expire and a stale
payloads file fails for reasons that have nothing to do with the service.


### Payload format

If you want to build the file some other way, the shape is:

```json
[
  { "testType": "func-auth-no-auth",      "params": { "func": "AAAABgAAAA…", "auth": [] } },
  { "testType": "xdr-payment",            "params": { "xdr": "AAAAAgAAAAC…" } },
  { "testType": "func-auth-address-auth", "params": { "func": "AAAABgAAAA…", "auth": ["AAAABwAAAA…"] } }
]
```

A keyed object also works:

```json
{ "func-auth-no-auth": [ { "func": "…", "auth": [] } ] }
```

See `payloads.example.json`. `params` is passed through verbatim as the request
body, so any field the plugin accepts (`skipWait`, `fundRelayerId`) can go in there.

For a `func-auth-no-auth`-only run you need exactly one entry, and it depends only
on `CONTRACT_ID`.

## Usage

```bash
export CHANNELS_STG_API_KEY=…        # staging key, from the shell — never a file

./run.sh smoke     env/staging.env   # 1 VU, 15 requests — is it alive and sane
./run.sh sustained env/staging.env   # hold RATE req/s for DURATION — capacity
./run.sh capacity  env/staging.env   # ramp VUs to RAMP_MAX — find the knee

# Any env-file value can be overridden from the shell for one run:
RATE=5 DURATION=10m ./run.sh sustained env/staging.env
```

The env file carries every environment fact (URL, contract, timeouts, per-type
latency gates, rate defaults) — see the comments in the env templates. Copy `env/staging-example.env` or
`env/mainnet-example.env` and replace the values for your deployment, per SETUP.md.

### Load modes

The script has three load shapes, selected with `MODE` (`run.sh` sets it per
profile):

| `MODE` | Executor | What it measures |
|---|---|---|
| `cli` (default) | plain VU loop from `--vus/--iterations/--duration` | Smoke probes and latency sweeps. **Not capacity**: a VU blocks on a slow response, so under degradation the offered load quietly drops and the run overstates what the target can handle. |
| `rate` | `constant-arrival-rate` | Capacity. Holds `RATE` requests/sec regardless of latency, adding VUs up to `MAX_VUS`. Dropped iterations mean the target cannot sustain the rate — that is the finding, not an error in the run. |
| `ramp` | `ramping-vus` | The concurrency knee. Climbs to `RAMP_MAX` VUs over `RAMP_UP`, holds `RAMP_HOLD`, backs off. |

To route through the relayer instead of hitting the plugin service directly,
set `PLUGIN_ID` (e.g. `PLUGIN_ID=channels`) in the env file or the shell.

## Environment variables

| Var | Required | Default | Notes |
|---|---|---|---|
| `BASE_URL` | yes | — | Trailing slash is trimmed |
| `TARGET_KIND` | yes | — | `test` or `production`. Set it in the env file. `run.sh` refuses to start without it, and requires `ALLOW_PRODUCTION=yes` when it is `production`. |
| `API_KEY` | yes | — | |
| `TEST_TYPE` | no | `func-auth-no-auth` | See table above, or `all` |
| `PAYLOADS` | no | `./payloads.json` | Path to the payloads file |
| `PLUGIN_ID` | no | — | Set it to route through the relayer |
| `CONTRACT_ID` | no | — | Informational; the contract is baked into the payloads |
| `SKIP_WAIT` | no | `false` | `true` adds `skipWait` — measures submission, not confirmation |
| `FUND_RELAYER_ID` | no | — | Adds `fundRelayerId` to every request |
| `REQ_TIMEOUT` | no | `60s` | Keep above the target's own timeout so k6 doesn't cut first |
| `P95_MS` | no | `20000` | Latency threshold — set to the target's `REQUEST_TIMEOUT_SECONDS` |
| `P99_MS` | no | `19000` | As above. Keep it under the target's request timeout or it can never fire. |
| `SKIP_PREFLIGHT` | no | `false` | `true` skips the pre-flight plugin call (`SKIP_HEALTHCHECK` still accepted) |
| `SUMMARY_OUT` | no | — | Path to write the full k6 summary as JSON |
| `MODE` | no | `cli` | `cli` \| `rate` \| `ramp`. See the "Load modes" section. |
| `RATE` | no | `3` | `rate` mode: target requests/sec |
| `DURATION` | no | `5m` | `rate` mode: how long to hold the rate |
| `PRE_VUS` / `MAX_VUS` | no | `10` / `20` | `rate` mode: pre-allocated / maximum VUs |
| `RAMP_MAX` | no | `10` | `ramp` mode: peak VUs |
| `RAMP_UP` / `RAMP_HOLD` | no | `2m` / `2m` | `ramp` mode: climb / hold durations |
| `P95_MS_<TYPE>` | no | `P95_MS` | Per-type p95 gate, e.g. `P95_MS_FUNC_AUTH_ADDRESS_AUTH=15000`. Set from the environment's measured baseline (the env files do) — a blended p95 across types that differ 15× gates nothing. |

## Reading the output

```
 requests      606
 http ok       96.36%      ← transport succeeded (HTTP 200)
 plugin ok     88.10%      ← AND the body said success: true
 transport err 22   (504: 12  502: 3  400: 2  conn: 5)
 plugin err    50          ← 200 responses that the plugin rejected
 exhausted     0           ← iterations skipped for want of a payload
 latency ms    med 0  p95 1  p99 1  max 2
```

Transport errors are broken out by class because each points at a different
subsystem:

| Counter | Points at |
|---|---|
| `channels_http_504` | The request outlived a gateway or the plugin harness timeout — the service was too slow, not wrong. |
| `channels_http_502` | Something upstream of the service (load balancer target down, upstream RPC). |
| `channels_http_400` | The request itself was rejected. The counter is tagged with the service's `data.code` (e.g. `ONCHAIN_FAILED`, `TIMEBOUNDS_TOO_FAR` — the latter usually means stale envelope payloads, see the 60-second wall above). |
| `channels_conn_error` | k6 never got a response at all (refused, reset, DNS). Client side or network, not the service. |

**The gap between `http ok` and `plugin ok` is the number to watch.** They are
deliberately separate metrics. During an earlier channels investigation a 50%
HTTP failure rate sat alongside a 74% on-chain success rate, and reading either
number alone pointed at the wrong culprit — the real cause was client-side
timeout, not on-chain failure. One combined "error rate" hides exactly that.

`exhausted` counts iterations that did nothing because the single-use payloads
ran out. Any non-zero value means your RPS × duration exceeded your payload
count, and the throughput figure is understated. Regenerate with a higher count
or switch to `func-auth-no-auth`.

Thresholds are `http ok > 95%`, `plugin ok > 90%`, `p95 < P95_MS`, `p99 < P99_MS`
(default 20s / 25s, overridable), plus a per-type p95 gate for every active type
(`P95_MS_<TYPE>`, falling back to `P95_MS`). The env files set the per-type gates
from measured baselines, which makes a run a real pass/fail gate: k6 exits
non-zero on any breach, and the summary names the breached metric.

**Set the latency threshold from the target's own timeout, not a guess.** Read
your deployment's `REQUEST_TIMEOUT_SECONDS` from its task/service definition — a
p95 above that value is unreachable because the service cuts the request first.

## Security

Nothing in this directory hardcodes a key. Pass it from the environment
(`CHANNELS_API_KEY`) or a secret store, and never paste a key value into this
README or a results write-up, not even a truncated prefix.

## Known gaps

1. **Sequence numbers are claimed at generation time.** `xdr-payment` payloads
   reserve a contiguous sequence range on the signer account. If anything else
   transacts on that account between generating and running, the payloads are
   invalidated from that point on. Use a dedicated key for load testing.
2. **Auth entries expire.** `--valid-for 1000` is roughly 85 minutes of ledgers.
   Generate close to the run, and check `authValidUntilLedger` in the sidecar if
   `func-auth-address-auth` starts failing for no apparent reason.
