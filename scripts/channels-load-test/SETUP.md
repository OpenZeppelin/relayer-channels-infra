# Setup — what you must provision before the first run

This harness tests a channels deployment. It does not create one. Everything
below is a prerequisite the operator provides; nothing here is optional except
where marked.

## 1. Tools

| Tool | Why | Install |
|---|---|---|
| k6 (verified against v1.5.0) | Runs the load test | `brew install k6` |
| Node.js + npm | Runs the payload generator | any recent LTS |
| Stellar CLI | Holds the signing key the generator uses | `brew install stellar-cli` |

Then, in this directory:

```bash
npm install        # @stellar/stellar-sdk + tsx, for the generator only
```

## 2. A funded, dedicated Stellar key

The payload generator signs with a Stellar CLI key (`--account-name`,
default `test-account`):

```bash
stellar keys generate load-test --network testnet   # testnet auto-funds
```

Use a key that is dedicated to load testing. `xdr-payment` payloads reserve a
contiguous sequence-number range on the signer at generation time — if anything
else transacts on that account between generating and running, every remaining
payload is invalidated.

On mainnet the key must be funded manually, and `xdr-payment` runs spend real
(tiny) XLM and fees.

## 3. A deployed smoke contract

The test types call `no_auth_bump` and `write_with_address_auth` on a smoke
contract. Deploy it using the oz-channels CLI:

```bash
oz-channels smoke setup      # testnet: deploys fresh from the bundled WASM
```

Put the resulting contract ID in your env file (`CONTRACT_ID`) and pass it to
the generator (`--contract-id`).

## 4. An API key for the target environment

Export it in the shell — the env file refuses to run without it, and no key is
ever written to a file in this directory:

```bash
export CHANNELS_API_KEY=…
```

Use a dedicated key for load testing, and never point a test key at production.

## 5. An environment file

Copy the appropriate template and fill in your deployment's values:

```bash
cp env/staging-example.env env/staging.env    # for testnet/staging
cp env/mainnet-example.env env/mainnet.env    # for mainnet/production
```

Then edit the file and update:

- `BASE_URL` — your channels endpoint (e.g. `https://channels.yourdomain.com`)
- `TARGET_KIND` — `test`, or `production` if the endpoint holds real funds
- `CONTRACT_ID` — your smoke contract from step 3
- `P95_MS` / `REQ_TIMEOUT` — read your deployment's `REQUEST_TIMEOUT_SECONDS`
  from its task definition; the latency gate is meaningless if it is above the
  service's own cutoff
- the `P95_MS_<TYPE>` per-type gates — start from the defaults in the template,
  then replace them with your own measured baselines after the first clean runs

## 6. Payloads

```bash
# open-ended type — no key, no network, never expires
npx tsx generate-payloads.ts --types func-auth-no-auth --output payloads.json

# everything — needs the funded key; mind the expiry rules in README.md
npx tsx generate-payloads.ts --count 500 --contract-id <YOUR_CONTRACT> --output payloads.json
```

## First run

```bash
./run.sh smoke env/staging.env
```

Expected: 15/15 requests, `plugin ok 100%`, all thresholds passed. Anything
else — see "Reading the output" in README.md before escalating load.
