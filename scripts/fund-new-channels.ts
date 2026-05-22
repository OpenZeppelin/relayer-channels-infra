/**
 * Bulk-fund new channel accounts via a two-relayer XDR pattern.
 *
 * Use this as a fallback when `oz-channels bootstrap` fails to fund new channels
 * with TRY_AGAIN_LATER / tx_bad_seq due to sequence contention on channels-fund
 * (e.g. scaling the pool from 100 → 1000).
 *
 * Pattern:
 *   tx source  = --source-relayer (e.g. channel-0001)  → provides sequence + fee
 *   op source  = --fund-relayer   (e.g. channels-fund) → provides starting balance
 *   Both sign  → signatures merged client-side, submitted directly to Horizon.
 *
 * Mirrors `oz-channels bootstrap` semantics:
 *   - Generates slot names from --from/--to/--prefix/--padding.
 *   - Preflights each slot: resolves relayer address, checks on-chain balance.
 *   - Skips any slot whose relayer is missing or already on-chain funded.
 *   - Batches up to 100 createAccount ops per tx (Stellar protocol limit).
 *   - Idempotent — safe to re-run; emits a JSON report.
 *
 * Usage:
 *   npx tsx scripts/fund-new-channels.ts \
 *     --env mainnet \
 *     --api-key <key> \
 *     --source-relayer channel-0001 \
 *     --fund-relayer channels-fund \
 *     --from 101 --to 1000 \
 *     [--prefix channel-] [--padding 4] \
 *     [--starting-balance 2] \
 *     [--batch-size 100] [--delay-ms 1000] \
 *     [--report report.json] [--dry-run]
 */

import { Account, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

// ── CLI args ────────────────────────────────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    env: { type: 'string', default: 'mainnet' },
    'api-key': { type: 'string' },
    'source-relayer': { type: 'string', default: 'channel-0001' },
    'fund-relayer': { type: 'string', default: 'channels-fund' },
    from: { type: 'string' },
    to: { type: 'string' },
    prefix: { type: 'string', default: 'channel-' },
    padding: { type: 'string', default: '4' },
    'starting-balance': { type: 'string', default: '2' },
    'batch-size': { type: 'string', default: '100' },
    'delay-ms': { type: 'string', default: '1000' },
    report: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
  strict: true,
});

const ENV = args.env as 'staging' | 'testnet' | 'mainnet';
const API_KEY = args['api-key'];
const SOURCE_RELAYER = args['source-relayer']!;
const FUND_RELAYER = args['fund-relayer']!;
const FROM = Number(args.from);
const TO = Number(args.to);
const PREFIX = args.prefix!;
const PADDING = Number(args.padding);
const STARTING_BALANCE = args['starting-balance']!;
const BATCH_SIZE = Number(args['batch-size']);
const DELAY_MS = Number(args['delay-ms']);
const REPORT_PATH = args.report;
const DRY_RUN = args['dry-run'];

function fail(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(2);
}

if (!API_KEY) fail('--api-key is required');
if (!Number.isFinite(FROM) || FROM < 1) fail('--from must be a positive integer');
if (!Number.isFinite(TO) || TO < FROM) fail('--to must be >= --from');
if (Number(STARTING_BALANCE) <= 0) fail('--starting-balance must be > 0');
if (BATCH_SIZE < 1 || BATCH_SIZE > 100) fail('--batch-size must be between 1 and 100');

// ── Network config ──────────────────────────────────────────────────────────
const NETWORK_CONFIG = {
  staging: {
    horizonUrl: 'https://horizon-testnet.stellar.org',
    passphrase: Networks.TESTNET,
    apiUrl: 'https://channels-stg.openzeppelin.com',
  },
  testnet: {
    horizonUrl: 'https://horizon-testnet.stellar.org',
    passphrase: Networks.TESTNET,
    apiUrl: 'https://channels.openzeppelin.com/testnet',
  },
  mainnet: {
    horizonUrl: 'https://horizon.stellar.org',
    passphrase: Networks.PUBLIC,
    apiUrl: 'https://channels.openzeppelin.com',
  },
} as const;

if (!(ENV in NETWORK_CONFIG)) {
  fail(`--env must be one of: staging, testnet, mainnet (got: ${ENV})`);
}

const { horizonUrl, passphrase, apiUrl } = NETWORK_CONFIG[ENV];
const AUTH_HEADER = `Bearer ${API_KEY}`;

// ── Helpers ─────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function generateSlotNames(from: number, to: number): string[] {
  const slots: string[] = [];
  for (let i = from; i <= to; i++) {
    slots.push(`${PREFIX}${String(i).padStart(PADDING, '0')}`);
  }
  return slots;
}

async function fetchRelayerAddress(relayerId: string): Promise<string | null> {
  const res = await fetch(`${apiUrl}/api/v1/relayers/${relayerId}`, {
    headers: { Authorization: AUTH_HEADER },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GET relayer ${relayerId} failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: { address?: string } };
  return json.data?.address ?? null;
}

async function fetchAccount(
  address: string,
): Promise<{ exists: boolean; sequence?: string; balanceXlm?: number }> {
  const res = await fetch(`${horizonUrl}/accounts/${address}`);
  if (res.status === 404) return { exists: false };
  if (!res.ok) {
    throw new Error(`Horizon GET ${address} failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as {
    sequence?: string;
    balances?: Array<{ asset_type: string; balance: string }>;
  };
  const native = json.balances?.find((b) => b.asset_type === 'native');
  return {
    exists: true,
    sequence: json.sequence,
    balanceXlm: native ? Number(native.balance) : 0,
  };
}

async function fetchCompetitiveFee(): Promise<number> {
  try {
    const res = await fetch(`${horizonUrl}/fee_stats`);
    if (!res.ok) return 1000;
    const json = (await res.json()) as { fee_charged?: { p90?: string } };
    const p90 = Number(json.fee_charged?.p90 ?? 1000);
    return Math.max(p90, 1000);
  } catch {
    return 1000;
  }
}

async function signWithRelayer(unsignedXdr: string, relayerId: string): Promise<string> {
  const res = await fetch(`${apiUrl}/api/v1/relayers/${relayerId}/sign-transaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: AUTH_HEADER },
    body: JSON.stringify({ unsigned_xdr: unsignedXdr }),
  });
  if (!res.ok) {
    throw new Error(`Sign via ${relayerId} failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    success: boolean;
    data?: { signedXdr?: string };
    error?: string;
  };
  if (!json.success || !json.data?.signedXdr) {
    throw new Error(`Sign via ${relayerId} returned no signedXdr: ${json.error ?? 'unknown'}`);
  }
  return json.data.signedXdr;
}

interface PreflightRow {
  slot: string;
  address: string | null;
  alreadyFunded: boolean;
  reason?: string;
}

async function preflight(slots: string[]): Promise<PreflightRow[]> {
  const rows: PreflightRow[] = [];
  const CHUNK = 10;
  for (let i = 0; i < slots.length; i += CHUNK) {
    const chunk = slots.slice(i, i + CHUNK);
    const chunkResults = await Promise.all(
      chunk.map(async (slot): Promise<PreflightRow> => {
        try {
          const address = await fetchRelayerAddress(slot);
          if (!address) {
            return { slot, address: null, alreadyFunded: false, reason: 'relayer-not-found' };
          }
          const acct = await fetchAccount(address);
          if (acct.exists && (acct.balanceXlm ?? 0) > 0) {
            return { slot, address, alreadyFunded: true };
          }
          return { slot, address, alreadyFunded: false };
        } catch (err) {
          return {
            slot,
            address: null,
            alreadyFunded: false,
            reason: `preflight-error: ${(err as Error).message}`,
          };
        }
      }),
    );
    rows.push(...chunkResults);
    process.stdout.write(`  Preflight: ${Math.min(i + CHUNK, slots.length)}/${slots.length}\r`);
  }
  process.stdout.write('\n');
  return rows;
}

// ── Batched create-account submission ───────────────────────────────────────
interface BatchResult {
  batchIndex: number;
  destinations: string[];
  status: 'funded' | 'failed';
  hash?: string;
  ledger?: number;
  error?: string;
}

async function submitBatch(
  batchIndex: number,
  destinations: { slot: string; address: string }[],
  txSourceAddress: string,
): Promise<BatchResult> {
  const slotList = destinations.map((d) => d.slot).join(', ');
  console.log(`\nBatch ${batchIndex + 1}: ${destinations.length} ops [${slotList}]`);

  const RETRYABLE = ['tx_bad_seq', 'TRY_AGAIN_LATER', 'tx_insufficient_fee'];
  const MAX_ATTEMPTS = 5;

  let lastErr = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const sourceAcct = await fetchAccount(txSourceAddress);
    if (!sourceAcct.exists || !sourceAcct.sequence) {
      return {
        batchIndex,
        destinations: destinations.map((d) => d.address),
        status: 'failed',
        error: `tx source ${txSourceAddress} not found on chain`,
      };
    }

    const feePerOp = await fetchCompetitiveFee();
    const totalFee = String(feePerOp * destinations.length);

    const builder = new TransactionBuilder(new Account(txSourceAddress, sourceAcct.sequence), {
      fee: totalFee,
      networkPassphrase: passphrase,
    }).setTimeout(300);

    for (const { address } of destinations) {
      builder.addOperation(
        Operation.createAccount({
          source: fundSourceAddress, // op source = treasury; tx source = channel-NNNN
          destination: address,
          startingBalance: STARTING_BALANCE,
        }),
      );
    }
    const unsignedXdr = builder.build().toXDR();

    if (DRY_RUN) {
      console.log(`  [DRY RUN] would submit ${destinations.length} ops, fee=${totalFee}`);
      return {
        batchIndex,
        destinations: destinations.map((d) => d.address),
        status: 'funded',
        hash: 'dry-run',
      };
    }

    try {
      const [signed1, signed2] = await Promise.all([
        signWithRelayer(unsignedXdr, SOURCE_RELAYER),
        signWithRelayer(unsignedXdr, FUND_RELAYER),
      ]);
      const merged = TransactionBuilder.fromXDR(signed1, passphrase);
      const other = TransactionBuilder.fromXDR(signed2, passphrase);
      for (const sig of other.signatures) merged.addDecoratedSignature(sig);
      const finalXdr = merged.toXDR();

      const submitRes = await fetch(`${horizonUrl}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `tx=${encodeURIComponent(finalXdr)}`,
      });
      const submitJson = (await submitRes.json()) as {
        hash?: string;
        ledger?: number;
        title?: string;
        detail?: string;
        extras?: { result_codes?: { transaction?: string; operations?: string[] } };
      };

      if (submitRes.ok && submitJson.hash) {
        console.log(`  ✓ ${submitJson.hash} (ledger ${submitJson.ledger})`);
        return {
          batchIndex,
          destinations: destinations.map((d) => d.address),
          status: 'funded',
          hash: submitJson.hash,
          ledger: submitJson.ledger,
        };
      }

      const txCode = submitJson.extras?.result_codes?.transaction;
      const opCodes = submitJson.extras?.result_codes?.operations ?? [];
      lastErr = `${submitJson.title}: tx=${txCode} ops=${JSON.stringify(opCodes)}`;
      console.log(`  attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastErr}`);

      const retryable =
        (txCode && RETRYABLE.includes(txCode)) || opCodes.some((c) => RETRYABLE.includes(c));
      if (!retryable) {
        return {
          batchIndex,
          destinations: destinations.map((d) => d.address),
          status: 'failed',
          error: lastErr,
        };
      }
      const backoff = Math.min(2000 * 2 ** (attempt - 1), 30_000);
      console.log(`  retrying in ${backoff}ms...`);
      await sleep(backoff);
    } catch (err) {
      lastErr = (err as Error).message;
      console.log(`  attempt ${attempt}/${MAX_ATTEMPTS} threw: ${lastErr}`);
      await sleep(2000 * 2 ** (attempt - 1));
    }
  }

  return {
    batchIndex,
    destinations: destinations.map((d) => d.address),
    status: 'failed',
    error: `exhausted ${MAX_ATTEMPTS} attempts: ${lastErr}`,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────
let fundSourceAddress = ''; // set in main(); referenced in submitBatch

async function main() {
  console.log(`Network:           ${ENV}`);
  console.log(`API URL:           ${apiUrl}`);
  console.log(`Source relayer:    ${SOURCE_RELAYER} (tx source / sequence)`);
  console.log(`Fund relayer:      ${FUND_RELAYER} (op source / treasury)`);
  console.log(`Slot range:        ${FROM}..${TO} (${TO - FROM + 1} slots)`);
  console.log(`Prefix / padding:  ${PREFIX} / ${PADDING}`);
  console.log(`Starting balance:  ${STARTING_BALANCE} XLM`);
  console.log(`Batch size:        ${BATCH_SIZE}`);
  if (DRY_RUN) console.log(`(DRY RUN — no submissions)`);
  console.log('');

  // 1. Resolve tx source and fund source addresses
  console.log('Resolving source addresses...');
  const [txSourceAddress, fundAddr] = await Promise.all([
    fetchRelayerAddress(SOURCE_RELAYER),
    fetchRelayerAddress(FUND_RELAYER),
  ]);
  if (!txSourceAddress) fail(`source relayer ${SOURCE_RELAYER} not found`);
  if (!fundAddr) fail(`fund relayer ${FUND_RELAYER} not found`);
  fundSourceAddress = fundAddr;
  console.log(`  ${SOURCE_RELAYER}: ${txSourceAddress}`);
  console.log(`  ${FUND_RELAYER}:  ${fundSourceAddress}`);

  // 2. Generate slot names and preflight
  const slots = generateSlotNames(FROM, TO);
  console.log(`\nPreflight on ${slots.length} slots...`);
  const preflightRows = await preflight(slots);

  const toFund = preflightRows.filter((r) => !r.alreadyFunded && r.address);
  const alreadyFunded = preflightRows.filter((r) => r.alreadyFunded);
  const missing = preflightRows.filter((r) => !r.address);

  console.log(`\nPreflight summary:`);
  console.log(`  already funded: ${alreadyFunded.length}`);
  console.log(`  to fund:        ${toFund.length}`);
  console.log(`  missing relayer (skipped): ${missing.length}`);

  if (missing.length > 0) {
    console.log(`\n  Missing relayers (run \`oz-channels bootstrap\` to provision):`);
    for (const m of missing.slice(0, 10)) console.log(`    ${m.slot}: ${m.reason}`);
    if (missing.length > 10) console.log(`    ... and ${missing.length - 10} more`);
  }

  if (toFund.length === 0) {
    console.log('\nNothing to fund. Done.');
    return;
  }

  // 3. Batch and execute
  const batches: { slot: string; address: string }[][] = [];
  for (let i = 0; i < toFund.length; i += BATCH_SIZE) {
    batches.push(
      toFund.slice(i, i + BATCH_SIZE).map((r) => ({ slot: r.slot, address: r.address! })),
    );
  }
  console.log(`\nSubmitting ${batches.length} batch(es)...`);

  const batchResults: BatchResult[] = [];
  for (let i = 0; i < batches.length; i++) {
    const result = await submitBatch(i, batches[i], txSourceAddress);
    batchResults.push(result);
    if (i < batches.length - 1) await sleep(DELAY_MS);
  }

  // 4. Final report
  const funded = batchResults.filter((b) => b.status === 'funded').length;
  const failed = batchResults.filter((b) => b.status === 'failed').length;
  console.log(`\n=== Summary ===`);
  console.log(`Batches funded: ${funded}/${batchResults.length}`);
  console.log(`Batches failed: ${failed}`);
  console.log(`Accounts funded (best-effort): ${batchResults
    .filter((b) => b.status === 'funded')
    .reduce((sum, b) => sum + b.destinations.length, 0)}`);

  if (REPORT_PATH) {
    writeFileSync(
      REPORT_PATH,
      JSON.stringify(
        {
          env: ENV,
          sourceRelayer: SOURCE_RELAYER,
          fundRelayer: FUND_RELAYER,
          slotRange: [FROM, TO],
          preflight: preflightRows,
          batches: batchResults,
        },
        null,
        2,
      ),
    );
    console.log(`\nReport written to ${REPORT_PATH}`);
  }

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
