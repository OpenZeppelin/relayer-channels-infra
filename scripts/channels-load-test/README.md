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

The `channels-load-test` skill (`.claude/skills/channels-load-test/`) carries
the operational runbook for Claude Code users: preflight steps, the spec-derived
VU ceiling, the safe ladder with liveness gates, and staging recovery. This
README is the reference for the harness itself: wire format, flags, payload shape.

## Files here

| File | Purpose |
|---|---|
| `run.sh` | Entry point — named profiles × environment files. |
| `env/staging.env`, `env/mainnet.env` | Per-environment config: URL, contract, timeouts, latency gates, rate defaults. |
| `SETUP.md` | What an operator must provision before the first run. |
| `load-test.k6.js` | The k6 script. Its header carries the raw commands `run.sh` wraps. |
| `generate-payloads.ts` | Pre-signs Stellar payloads — k6 has no Stellar SDK. |
| `payloads.example.json` | Payload file format. |
| `package.json` / `package-lock.json` | `@stellar/stellar-sdk` + `tsx` for the generator. |

Generated `payloads*.json` and `*.meta.json` are gitignored — they contain signed
transactions bound to a specific account and sequence range.

Provenance: the harness was reconstructed in Aug 2026 from the original
`smoke.sh` wrapper (CLI contract and presets), `relayer-plugin-channels/scripts/smoke.ts`
(the four test types), and its `channels-client.ts` (the wire format). None of
those is needed to run it.

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

Payloads call a **smoke contract** that must exist on the target network. It
ships in this repo and is deployed by `oz-channels smoke setup` — see SETUP.md.
The generator's `--contract-id` default is OpenZeppelin's staging contract; when
testing your own deployment, pass your own contract's ID and put the same ID in
your env file.

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
| `--contract-id <id>` | `CDSD3JZB…` | The smoke contract |
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
latency gates, rate defaults) — see the comments in `env/staging.env`. Running
against a deployment that is not OpenZeppelin's means copying an env file and
replacing its values, per SETUP.md.

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

Historical note: the original `smoke.sh` presets were 10 VUs / 5m / 600 RPM
(`load`, `load-no-auth`) and 5 VUs / 1m / 300 RPM (`load-quick`). Those are its
numbers, not recommendations — 10 VUs is the measured staging ceiling, and
3,000 requests outruns any single-use payload file. Size real runs from the
profiles above.

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

**Set the latency threshold from the target's own timeout, not a guess.** Staging
declares `REQUEST_TIMEOUT_SECONDS=20` in its task definition, so a p95 above 20s
is unreachable there — the service cuts the request off first. Read the live
value rather than assuming; an earlier version of this file asserted 30s, which
was the plugin-pool timeout, not the HTTP request timeout the service enforces.

## Security

Nothing in this directory hardcodes a key. Pass it from the environment
(`CHANNELS_STG_API_KEY`) or a secret store, and never paste a key value into this
README or a results write-up, not even a truncated prefix.

## Baselines from staging

### Single VU, serial

| Test type | Success | Latency |
|---|---|---|
| `func-auth-no-auth` | 100% | ~340–480 ms |
| `xdr-payment` | 100% | ~6.4 s |
| `func-auth-address-auth` | 100% | ~7.0 s |
| `xdr-unsigned-soroban` | 100% | ~6.7 s (n=1) |

### Concurrency sweep, 15 requests per level

| VUs | `func-auth-no-auth` median | `func-auth-address-auth` median | its p95 | p95 ÷ median |
|---|---|---|---|---|
| 2 | 328 ms | 7,172 ms | 12,085 ms | 1.69× |
| 3 | 502 ms | 7,141 ms | 12,717 ms | 1.78× |
| 4 | 622 ms | 7,332 ms | 13,188 ms | 1.80× |
| 5 | 649 ms | 7,778 ms | 10,093 ms | 1.30× |

Three things worth carrying forward.

**The two paths behave oppositely under concurrency.** `func-auth-no-auth`
median doubles from 2→5 VUs (328→649 ms) — added concurrency turns into queueing.
`func-auth-address-auth` median stays roughly flat (7.2→7.8 s) while its
throughput rises about 2.2× for 2.5× the VUs, i.e. near-linear. The slow path is
latency-bound per request rather than contention-bound, and is *not* saturated at
5 VUs. The fast path is closer to its limit.

**`func-auth-address-auth` is bimodal, not slow-on-average.** p95 sits
consistently around 1.7–1.8× the median, with the gap at 5 VUs measured at
2,315 ms. Stellar closes ledgers roughly every 5 s, so a plausible reading is
that requests land either just before or just after a close and some wait an
extra ledger. **That is a hypothesis, not a measurement** — confirming it means
correlating submission timestamps against ledger close times, which this harness
does not do.

**Headroom against the service's 20 s request timeout is thinner than the medians
suggest.** At 5 VUs the address-auth p95 is 10–13 s, already 33–44% of the
timeout, and the p95 is what breaches first. Where it actually crosses 20 s is
not answerable from a 5-VU sample.

The **15× spread** between the no-auth path and the two channel-account paths is
the headline. `func-auth-no-auth` needs no channel account and no signature
verification; the other two go through channel-account acquisition and fee
bumping. Any p95 discussion has to say which type it refers to — a mixed
`TEST_TYPE=all` p95 is dominated by whichever slow type is in the mix and means
very little on its own. (One caveat: the no-auth rps figures from these
few-second runs are dominated by fixed overhead — read its latency column, not
its throughput.)

## What was verified

Everything below was run and observed, not inferred (25 Aug – 1 Sep 2026):

- **Generator, against Stellar testnet**: all four payload types decode and
  verify — valid Ed25519 signatures, distinct consecutive sequence numbers,
  distinct auth nonces, unsigned envelopes for `xdr-unsigned-soroban` with the
  placeholder source, `timeBounds` ~45 s ahead. `--tx-timeout ≥ 60` rejected up
  front; `--help` / `--dry-run` / offline path work.
- **k6 script, against a recording mock**: both URL/header modes send the
  documented wire format; injected 503 and `{success:false}` rates were
  reported back exactly; failure classes count into the right counters;
  payload exhaustion warns and counts; per-type breakdown; threshold breach
  exits non-zero; missing/invalid inputs abort with a reason.
- **Against live staging**: smoke (15 req) and sustained (3 req/s × 5 m,
  902 req) both 100% http + plugin ok with zero dropped iterations, and a
  real-call liveness probe passed after each run. All four test types were
  submitted successfully (address-auth at its ~7 s baseline, both envelope
  types inside their 45 s window), and payload exhaustion was triggered
  deliberately — 3 submitted, 3 skipped and counted, warning fired once.


## Known gaps

1. **The concurrency ceiling is known but not characterised.** 10 VUs is clean
   and 20 VUs kills the plugin pool on staging, so the useful range is narrow and
   the knee sits somewhere in 10–20 that nobody has measured. Everything above 10
   VUs is a failure observation, not performance data.
2. **`xdr-unsigned-soroban` is untested at concurrency.** Four submissions to
   staging (25 Aug and 1 Sep 2026) all succeeded at 1 VU (~6.7–6.9 s), so the
   plugin accepts a signed auth entry on an unsigned envelope — but nothing is
   known about how this path behaves under parallel load.
3. **Sequence numbers are claimed at generation time.** `xdr-payment` payloads
   reserve a contiguous sequence range on the signer account. If anything else
   transacts on that account between generating and running, the payloads are
   invalidated from that point on. Use a dedicated key for load testing.
4. **Auth entries expire.** `--valid-for 1000` is roughly 85 minutes of ledgers.
   Generate close to the run, and check `authValidUntilLedger` in the sidecar if
   `func-auth-address-auth` starts failing for no apparent reason.
