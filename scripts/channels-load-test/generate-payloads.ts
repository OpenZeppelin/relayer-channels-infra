/**
 * Generate pre-signed payloads for load-test.k6.js
 *
 * k6 has no Stellar SDK, so every payload that needs a signature is built and
 * signed here, ahead of the run, and written to a JSON file the k6 script reads.
 *
 * Usage:
 *   npx tsx generate-payloads.ts --count 500 --output payloads.json
 *   npx tsx generate-payloads.ts --types func-auth-no-auth --output payloads.json

**/

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  authorizeInvocation,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';

type TestType = 'xdr-payment' | 'func-auth-no-auth' | 'func-auth-address-auth' | 'xdr-unsigned-soroban';
type Payload = { testType: TestType; params: Record<string, unknown> };

const ALL_TYPES: TestType[] = [
  'xdr-payment',
  'func-auth-no-auth',
  'func-auth-address-auth',
  'xdr-unsigned-soroban',
];
/** Deterministic — one entry is enough, k6 replays it. */
const REUSABLE: TestType[] = ['func-auth-no-auth'];
/** Types whose payload is a transaction envelope, and so carries `timeBounds`. */
const ENVELOPE_TYPES: TestType[] = ['xdr-payment', 'xdr-unsigned-soroban'];

// ─────────────────────────────────────────────────────────────────────────────
// Args
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.replace(/^--/, '');
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`
Generate pre-signed payloads for load-test.k6.js

  --count <n>          payloads per single-use type          (default 200)
  --output <path>      output file                           (default ./payloads.json)
  --types <list>       comma-separated, or 'all'             (default all)
                       ${ALL_TYPES.join(', ')}
  --network <net>      testnet | mainnet                     (default testnet)
  --rpc-url <url>      Soroban RPC                           (default per network)
  --contract-id <id>   smoke contract                        (REQUIRED)
  --account-name <n>   Stellar CLI key name                  (default test-account)
  --valid-for <n>      auth entry lifetime, in ledgers       (default 1000, ~85 min)
  --tx-timeout <n>     envelope timeBounds, seconds, <60      (default 45)
                       applies to: ${ENVELOPE_TYPES.join(", ")}
  --dry-run            build nothing that needs the network; print the plan
`);
  process.exit(0);
}

const count = parseInt(String(args.count ?? '200'), 10);
const output = String(args.output ?? './payloads.json');
const network = String(args.network ?? 'testnet').toLowerCase() as 'testnet' | 'mainnet';
const passphrase = network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
const rpcUrl = String(
  args['rpc-url'] ??
    (network === 'mainnet' ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org')
);
const contractId = String(args['contract-id'] ?? '');
if (!contractId) {
  console.error('error: --contract-id is required. Deploy a smoke contract with `oz-channels smoke setup` and pass its ID.');
  process.exit(1);
}
const accountName = String(args['account-name'] ?? 'test-account');
const validFor = parseInt(String(args['valid-for'] ?? '1000'), 10);
/**
 * The channels service rejects any envelope whose `timeBounds.maxTime` is more
 * than 60 seconds ahead, which returns HTTP 400 TIMEBOUNDS_TOO_FAR. 
 * So xdr-payment payloads are only valid for slightly under a minute after generation, 
 * no matter how many you build.
 */
const MAX_TX_TIMEOUT = 60;
const txTimeout = parseInt(String(args['tx-timeout'] ?? '45'), 10);
const dryRun = Boolean(args['dry-run']);

if (txTimeout >= MAX_TX_TIMEOUT) {
  console.error(
    `--tx-timeout ${txTimeout} will be rejected: the service requires timeBounds.maxTime\n` +
      `no more than ${MAX_TX_TIMEOUT}s ahead (HTTP 400 TIMEBOUNDS_TOO_FAR). Use something under ${MAX_TX_TIMEOUT}.`
  );
  process.exit(2);
}

const types: TestType[] = (() => {
  const raw = String(args.types ?? 'all');
  if (raw === 'all') return ALL_TYPES;
  const picked = raw.split(',').map((s) => s.trim()) as TestType[];
  const bad = picked.filter((t) => !ALL_TYPES.includes(t));
  if (bad.length) {
    console.error(`Unknown type(s): ${bad.join(', ')}. Available: ${ALL_TYPES.join(', ')}`);
    process.exit(2);
  }
  return picked;
})();

if (!Number.isFinite(count) || count < 1) {
  console.error('--count must be a positive integer');
  process.exit(2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Builders
// ─────────────────────────────────────────────────────────────────────────────

function getKeypair(name: string): { keypair: Keypair; address: string } {
  try {
    const address = execSync(`stellar keys address ${name}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const secret = execSync(`stellar keys show ${name}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return { keypair: Keypair.fromSecret(secret), address };
  } catch (e: any) {
    throw new Error(
      `Could not load Stellar CLI key '${name}': ${e?.message || e}\n` +
        `Create or fund one first:  stellar keys generate ${name} --network ${network}`
    );
  }
}

/**
 * no_auth_bump(42) — no signature, no network call, no expiry. Identical every
 * time for a given contract, so a single entry serves an unbounded run.
 */
function buildNoAuthFuncPayload(contract: string): Payload {
  const c = new Contract(contract);
  const op = c.call('no_auth_bump', xdr.ScVal.scvU32(42));
  const invokeOp = (op as any).body().invokeHostFunctionOp();
  const auth = invokeOp.auth() ?? [];
  return {
    testType: 'func-auth-no-auth',
    params: {
      func: invokeOp.hostFunction().toXDR('base64'),
      auth: auth.map((a: any) => a.toXDR('base64')),
    },
  };
}

/**
 * Signed self-payment of 0.000001 XLM.
 *
 * Each payload must carry its own sequence number or they collide — the network
 * accepts exactly one transaction per sequence, so N payloads built from the
 * same account state would leave N-1 permanent failures and a load test that
 * reports a fake error rate. The account is read once and the sequence walked
 * locally, which is what smoke.ts does via `sequenceOverride` for its parallel
 * runs.
 */
function buildSignedSelfPayment(
  address: string,
  keypair: Keypair,
  sequence: bigint
): Payload {
  // TransactionBuilder increments the sequence it is given, so pass n-1 to land on n.
  const account = new Account(address, (sequence - 1n).toString());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: passphrase })
    .addOperation(
      Operation.payment({
        source: address,
        destination: address,
        asset: Asset.native(),
        amount: '0.0000010',
      })
    )
    .setTimeout(txTimeout)
    .build();
  tx.sign(keypair);
  return { testType: 'xdr-payment', params: { xdr: tx.toXDR() } };
}

/**
 * Smart-wallet flow: `write_with_address_auth(addr, 999)` where the AUTH ENTRY is
 * signed but the ENVELOPE is not.
 *
 * This is the fourth test in `smoke.ts` that the original `smoke.sh` never wired
 * into the load test. It models a passkey signing the Soroban authorization while
 * the envelope is left unsigned for the channel account to own.
 *
 * Two properties differ from `xdr-payment`, both load-bearing:
 *
 *  - The source is a **placeholder** account at sequence 0, replaced by the
 *    channel account on submission. So this type reserves NO sequence number on
 *    the signer, and generating many costs nothing on-chain.
 *  - It is still an envelope, so it still carries `timeBounds` and is still
 *    subject to the service's 60-second ceiling. Single-use, because the auth
 *    entry's nonce cannot be replayed.
 */
async function buildUnsignedSorobanPayload(
  contract: string,
  address: string,
  keypair: Keypair,
  validUntilLedger: number
): Promise<Payload> {
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(contract).toScAddress(),
    functionName: 'write_with_address_auth',
    args: [Address.fromString(address).toScVal(), xdr.ScVal.scvU32(999)],
  });
  const func = xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs);
  const rootInv = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
    subInvocations: [],
  });

  // Sign the auth entry only — this is the passkey signature.
  const signedAuthEntry = await authorizeInvocation(keypair, validUntilLedger, rootInv, address, passphrase);
  const op = Operation.invokeHostFunction({ func, auth: [signedAuthEntry] });

  // Placeholder source; the channel account replaces it on submission.
  const placeholder = new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0');
  const tx = new TransactionBuilder(placeholder, { fee: '100', networkPassphrase: passphrase })
    .addOperation(op)
    .setTimeout(txTimeout)
    .build();

  // Deliberately NOT signed — that is the whole point of this case.
  return { testType: 'xdr-unsigned-soroban', params: { xdr: tx.toXDR() } };
}

/**
 * write_with_address_auth(addr, 777) with a signed Soroban auth entry.
 * Uses the SDK's authorizeInvocation.
 */
async function buildAddressAuthPayload(
  contract: string,
  address: string,
  keypair: Keypair,
  validUntilLedger: number
): Promise<Payload> {
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(contract).toScAddress(),
    functionName: 'write_with_address_auth',
    args: [Address.fromString(address).toScVal(), xdr.ScVal.scvU32(777)],
  });
  const func = xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs);
  const rootInv = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
    subInvocations: [],
  });

  // The SDK generates a fresh random nonce per call, so entries are distinct.
  const entry = await authorizeInvocation(keypair, validUntilLedger, rootInv, address, passphrase);

  return {
    testType: 'func-auth-address-auth',
    params: { func: func.toXDR('base64'), auth: [entry.toXDR('base64')] },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything that needs a key or the network: read the account/ledger state
 * once, then build `count` payloads per single-use type. Returns the payloads
 * plus the state that went into them, for the .meta.json sidecar.
 */
async function generateSingleUse(
  singleUse: TestType[],
  count: number
): Promise<{ payloads: Payload[]; meta: Record<string, unknown> }> {
  const { keypair, address } = getKeypair(accountName);
  console.log(`  signer       ${address}  (CLI key '${accountName}')`);

  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });

  let latestLedger: number | undefined;
  let startSequence: bigint | undefined;

  if (singleUse.includes('func-auth-address-auth') || singleUse.includes('xdr-unsigned-soroban')) {
    const latest = await server.getLatestLedger();
    latestLedger = Number(latest.sequence);
    console.log(`  ledger       ${latestLedger}, auth valid until ${latestLedger + validFor}`);
  }
  if (singleUse.includes('xdr-payment')) {
    const acct = await server.getAccount(address);
    // getAccount returns the current sequence; the next usable one is +1.
    startSequence = BigInt(acct.sequenceNumber()) + 1n;
    console.log(`  sequence     ${startSequence} … ${startSequence + BigInt(count) - 1n}`);
  }
  console.log('');

  const builders: Record<string, (i: number) => Payload | Promise<Payload>> = {
    'xdr-payment': (i) => buildSignedSelfPayment(address, keypair, startSequence! + BigInt(i)),
    'func-auth-address-auth': () => buildAddressAuthPayload(contractId, address, keypair, latestLedger! + validFor),
    'xdr-unsigned-soroban': () => buildUnsignedSorobanPayload(contractId, address, keypair, latestLedger! + validFor),
  };

  const payloads: Payload[] = [];
  for (const t of singleUse) {
    process.stdout.write(`  ${t} `);
    for (let i = 0; i < count; i++) {
      payloads.push(await builders[t](i));
      if ((i + 1) % 50 === 0) process.stdout.write('.');
    }
    process.stdout.write(` ${count}\n`);
  }

  return {
    payloads,
    meta: {
      signer: address,
      accountName,
      latestLedger,
      authValidUntilLedger: latestLedger !== undefined ? latestLedger + validFor : undefined,
      sequenceFrom: startSequence?.toString(),
      sequenceTo: startSequence !== undefined ? (startSequence + BigInt(count) - 1n).toString() : undefined,
      txTimeoutSeconds: txTimeout,
    },
  };
}

/** The operational caveats an operator must see before submitting anything. */
function printCaveats(singleUse: TestType[]) {
  const envelopes = singleUse.filter((t) => ENVELOPE_TYPES.includes(t));
  if (envelopes.length) {
    console.log('');
    console.log(`⚠ ${envelopes.join(' and ')} carry timeBounds — the service rejects any envelope`);
    console.log(`  more than ${MAX_TX_TIMEOUT}s ahead. Submit within ~${txTimeout}s of now or they all fail.`);
  }

  if (singleUse.length) {
    console.log('');
    console.log(`Note: ${singleUse.join(' and ')} are single-use. At R requests/sec this file`);
    console.log(`lasts ${count} requests per type — size --count to your run length, or use`);
    console.log(`--types func-auth-no-auth for a run with no payload ceiling.`);
  }
}

async function main() {
  const singleUse = types.filter((t) => !REUSABLE.includes(t));
  const reusable = types.filter((t) => REUSABLE.includes(t));
  const needsNetwork = singleUse.length > 0;

  console.log('Generating payloads for load-test.k6.js');
  console.log(`  network      ${network}  (${rpcUrl})`);
  console.log(`  contract     ${contractId}`);
  console.log(`  types        ${types.join(', ')}`);
  console.log(`  count        ${count} per single-use type${reusable.length ? ', 1 per reusable type' : ''}`);
  console.log(`  output       ${output}`);
  console.log('');

  if (dryRun) {
    const total = singleUse.length * count + reusable.length;
    console.log(`Dry run — would write ${total} payloads. Network needed: ${needsNetwork ? 'yes' : 'no'}`);
    return;
  }

  const payloads: Payload[] = [];

  // Reusable types need no key and no network.
  for (const t of reusable) {
    if (t === 'func-auth-no-auth') payloads.push(buildNoAuthFuncPayload(contractId));
  }

  let meta: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    network,
    rpcUrl,
    contractId,
    types,
  };

  if (needsNetwork) {
    const generated = await generateSingleUse(singleUse, count);
    payloads.push(...generated.payloads);
    meta = { ...meta, ...generated.meta };
  }

  // Flat array — this is exactly what load-test.k6.js expects. Metadata goes to
  // a sidecar rather than wrapping the array, so the k6 loader stays simple.
  writeFileSync(output, JSON.stringify(payloads, null, 2));
  const metaPath = output.replace(/\.json$/, '') + '.meta.json';
  writeFileSync(metaPath, JSON.stringify({ ...meta, total: payloads.length }, null, 2));

  const byType = types.map((t) => `${t}=${payloads.filter((p) => p.testType === t).length}`).join('  ');
  console.log('');
  console.log(`✓ wrote ${payloads.length} payloads to ${output}`);
  console.log(`  ${byType}`);
  console.log(`  metadata: ${metaPath}`);

  printCaveats(singleUse);
}

main().catch((e) => {
  console.error(`\n✗ ${e?.message || e}`);
  process.exit(1);
});
