import type { StellarTransactionRequest } from '@openzeppelin/relayer-sdk';
import * as StellarSdk from '@stellar/stellar-sdk';
import pc from 'picocolors';
import { withRetry } from '../../utils/retry.js';
import { NETWORKS, type NetworkName } from '../../utils/stellar.js';
import type { RelayerClient } from './preflight.js';
import type { FundResult } from './types.js';

export interface FundingOptions {
  relayerClient: RelayerClient;
  fundingRelayer: string;
  fundingAddress: string;
  startingBalance: number;
  network: NetworkName;
  /** Pre-fetched competitive fee in stroops */
  fee: number;
  delayMs: number;
  verbose?: boolean;
  onProgress?: (completed: number, total: number) => void;
}

export interface AccountToFund {
  slot: string;
  address: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTransactionConfirmation(
  relayerClient: RelayerClient,
  relayerId: string,
  transactionId: string,
  timeoutMs = 180_000,
  pollIntervalMs = 2_000,
): Promise<void> {
  const startedAt = Date.now();
  while (true) {
    const elapsed = Date.now() - startedAt;
    if (elapsed > timeoutMs) {
      throw new Error(`Transaction ${transactionId} not confirmed within ${timeoutMs}ms`);
    }

    try {
      const response = await relayerClient.relayers.getTransactionById(relayerId, transactionId);
      const data = response.data?.data;
      if (data && 'status' in data) {
        const status = (data as { status?: string }).status ?? 'unknown';
        const reason = (data as { status_reason?: string | null }).status_reason ?? undefined;
        if (status === 'submitted' || status === 'pending' || status === 'sent') {
          // Keep waiting
        } else if (status === 'confirmed') {
          return;
        } else {
          throw new Error(`Transaction failed: ${status}${reason ? `: ${reason}` : ''}`);
        }
      }
    } catch (err) {
      // If 404, transaction may not be indexed yet - keep waiting
      if (err && typeof err === 'object' && 'response' in err) {
        const response = (err as { response?: { status?: number } }).response;
        if (response?.status !== 404) {
          throw err;
        }
      } else if (err instanceof Error && !err.message.includes('Transaction failed')) {
        // Unknown error type, keep waiting
      } else {
        throw err;
      }
    }

    await sleep(pollIntervalMs);
  }
}

interface FundAccountResult {
  success: boolean;
  alreadyExists?: boolean;
  error?: string;
}

async function fundSingleAccount(
  destination: string,
  amount: number,
  options: FundingOptions,
  server: StellarSdk.Horizon.Server,
): Promise<FundAccountResult> {
  const { relayerClient, fundingRelayer, fundingAddress, network, fee } = options;
  const networkPassphrase = NETWORKS[network].passphrase;

  try {
    // Load source account fresh each time (sequence number changes)
    const sourceAccount = await server.loadAccount(fundingAddress);

    // Build createAccount transaction
    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: fee.toString(),
      networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.createAccount({
          destination,
          startingBalance: amount.toString(),
        }),
      )
      .setTimeout(180)
      .build();

    const transactionXdr = transaction.toXDR();

    // Send XDR to funding relayer
    const txRequest: StellarTransactionRequest = {
      network,
      transaction_xdr: transactionXdr,
    };

    const sendResponse = await withRetry(
      () => relayerClient.relayers.sendTransaction(fundingRelayer, txRequest),
      {
        maxRetries: 3,
        onRetry: (attempt, err, delayMs) => {
          // Check if it's a tx_bad_seq error - need to reload account
          const errStr = String(err);
          if (errStr.includes('tx_bad_seq')) {
            // Will be retried with fresh sequence on next attempt
          }
        },
      },
    );

    const payload = sendResponse.data?.data;
    if (payload && 'id' in payload) {
      const txId = (payload as { id?: string }).id;
      if (txId) {
        await waitForTransactionConfirmation(relayerClient, fundingRelayer, txId);
      }
    }

    return { success: true };
  } catch (err) {
    const errStr = err instanceof Error ? err.message : String(err);

    // Check for "op_already_exists" - account is already funded
    if (errStr.includes('op_already_exists') || errStr.includes('ALREADY_EXIST')) {
      return { success: true, alreadyExists: true };
    }

    return { success: false, error: errStr };
  }
}

/**
 * Fund accounts sequentially.
 *
 * Sequential processing is required because:
 * 1. Stellar transactions require sequential sequence numbers
 * 2. Each transaction must be confirmed before building the next
 *
 * Error handling:
 * - op_already_exists: Skip, mark as success (account already funded)
 * - tx_bad_seq: Retry with fresh account (sequence mismatch)
 * - Other errors: Log and continue
 */
export async function fundAccounts(
  toFund: AccountToFund[],
  options: FundingOptions,
): Promise<FundResult[]> {
  const { network, startingBalance, delayMs, verbose, onProgress } = options;
  const results: FundResult[] = [];
  let completed = 0;

  // Create Horizon server once
  const server = new StellarSdk.Horizon.Server(NETWORKS[network].horizonUrl);

  for (const { slot, address } of toFund) {
    if (verbose) {
      process.stdout.write(`  Funding ${slot} (${address.slice(0, 8)}...)... `);
    }

    const fundResult = await fundSingleAccount(address, startingBalance, options, server);

    const result: FundResult = {
      slot,
      address,
      funded: fundResult.success,
      alreadyFunded: fundResult.alreadyExists,
      error: fundResult.error,
    };

    if (verbose) {
      if (fundResult.success) {
        if (fundResult.alreadyExists) {
          console.log(pc.dim('already funded'));
        } else {
          console.log(pc.green('done'));
        }
      } else {
        console.log(pc.red(`error: ${fundResult.error}`));
      }
    }

    results.push(result);
    completed++;

    if (onProgress) {
      onProgress(completed, toFund.length);
    }

    // Rate limiting delay between operations
    if (completed < toFund.length) {
      await sleep(delayMs);
    }
  }

  return results;
}
