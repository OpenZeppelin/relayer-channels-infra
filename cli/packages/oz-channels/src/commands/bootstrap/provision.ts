import { Buffer } from 'node:buffer';
import { RelayerNetworkType, SignerTypeRequest } from '@openzeppelin/relayer-sdk';
import { Keypair } from '@stellar/stellar-sdk';
import pc from 'picocolors';
import { withRetry } from '../../utils/retry.js';
import type { NetworkName } from '../../utils/stellar.js';
import type { RelayerClient } from './preflight.js';
import type { AccountAudit, CreateResult } from './types.js';

export interface ProvisionOptions {
  relayerClient: RelayerClient;
  network: NetworkName;
  delayMs: number;
  verbose?: boolean;
  onProgress?: (completed: number, total: number) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isConflictError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'response' in err) {
    const response = (err as { response?: { status?: number } }).response;
    return response?.status === 409;
  }
  return false;
}

async function createSigner(
  relayerClient: RelayerClient,
  signerId: string,
): Promise<{ created: boolean; publicKey?: string }> {
  // Generate keypair and extract hex-encoded secret key
  const keypair = Keypair.random();
  const secretHex = Buffer.from(keypair.rawSecretKey()).toString('hex');

  try {
    await withRetry(() =>
      relayerClient.signers.createSigner({
        id: signerId,
        type: SignerTypeRequest.PLAIN,
        config: { key: secretHex },
      }),
    );
    return { created: true, publicKey: keypair.publicKey() };
  } catch (err) {
    if (isConflictError(err)) {
      // Already exists, not an error
      return { created: false };
    }
    throw err;
  }
}

async function createRelayer(
  relayerClient: RelayerClient,
  relayerId: string,
  signerId: string,
  network: NetworkName,
): Promise<{ created: boolean; address?: string }> {
  try {
    const response = await withRetry(() =>
      relayerClient.relayers.createRelayer({
        id: relayerId,
        name: relayerId,
        network: network,
        network_type: RelayerNetworkType.STELLAR,
        signer_id: signerId,
        paused: false,
        policies: {
          fee_payment_strategy: 'relayer',
        },
      }),
    );
    return {
      created: true,
      address: response.data.data?.address,
    };
  } catch (err) {
    if (isConflictError(err)) {
      // Already exists - try to get the address
      try {
        const getResponse = await relayerClient.relayers.getRelayer(relayerId);
        return {
          created: false,
          address: getResponse.data.data?.address,
        };
      } catch {
        return { created: false };
      }
    }
    throw err;
  }
}

/**
 * Provision accounts (signers and relayers) sequentially.
 *
 * For each account:
 * - Create signer if it doesn't exist
 * - Create relayer if it doesn't exist (pointing to signer)
 * - Handle 409 Conflict gracefully (already exists)
 */
export async function provisionAccounts(
  toCreate: AccountAudit[],
  options: ProvisionOptions,
): Promise<CreateResult[]> {
  const { relayerClient, network, delayMs, verbose, onProgress } = options;
  const results: CreateResult[] = [];
  let completed = 0;

  for (const account of toCreate) {
    const { slot, signerId, signerExists, relayerExists } = account;
    const result: CreateResult = {
      slot,
      signerId,
      signerCreated: false,
      relayerCreated: false,
    };

    try {
      // Create signer if needed
      if (!signerExists) {
        if (verbose) {
          process.stdout.write(`  Creating signer ${signerId}... `);
        }
        const signerResult = await createSigner(relayerClient, signerId);
        result.signerCreated = signerResult.created;
        if (verbose) {
          console.log(signerResult.created ? pc.green('done') : pc.dim('exists'));
        }
      }

      // Create relayer if needed
      if (!relayerExists) {
        if (verbose) {
          process.stdout.write(`  Creating relayer ${slot}... `);
        }
        const relayerResult = await createRelayer(relayerClient, slot, signerId, network);
        result.relayerCreated = relayerResult.created;
        result.relayerAddress = relayerResult.address;
        if (verbose) {
          console.log(relayerResult.created ? pc.green('done') : pc.dim('exists'));
        }
      } else {
        // Relayer exists, get address if we don't have it
        result.relayerAddress = account.relayerAddress;
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      if (verbose) {
        console.log(pc.red(`error: ${result.error}`));
      }
    }

    results.push(result);
    completed++;

    if (onProgress) {
      onProgress(completed, toCreate.length);
    }

    // Rate limiting delay between operations
    if (completed < toCreate.length) {
      await sleep(delayMs);
    }
  }

  return results;
}
