import type { Configuration, RelayersApi, SignersApi } from '@openzeppelin/relayer-sdk';
import type { ApiClient } from '../../api/client.js';
import { parallelMapSettled } from '../../utils/concurrency.js';
import { withRetry } from '../../utils/retry.js';
import { type NetworkName, checkAccountFunded } from '../../utils/stellar.js';
import type { AccountAudit, PreflightResult } from './types.js';

export interface RelayerClient {
  signers: SignersApi;
  relayers: RelayersApi;
}

export interface PreflightOptions {
  relayerClient: RelayerClient;
  channelsClient: ApiClient;
  network: NetworkName;
  concurrency: number;
  verbose?: boolean;
  onProgress?: (completed: number, total: number) => void;
}

async function tryGetSigner(
  relayerClient: RelayerClient,
  signerId: string,
): Promise<{ exists: boolean }> {
  try {
    await withRetry(() => relayerClient.signers.getSigner(signerId));
    return { exists: true };
  } catch (err) {
    if (err && typeof err === 'object' && 'response' in err) {
      const response = (err as { response?: { status?: number } }).response;
      if (response?.status === 404) {
        return { exists: false };
      }
    }
    throw err;
  }
}

async function tryGetRelayer(
  relayerClient: RelayerClient,
  relayerId: string,
): Promise<{ exists: boolean; address?: string }> {
  try {
    const response = await withRetry(() => relayerClient.relayers.getRelayer(relayerId));
    const data = response.data?.data;
    return {
      exists: true,
      address: data?.address,
    };
  } catch (err) {
    if (err && typeof err === 'object' && 'response' in err) {
      const response = (err as { response?: { status?: number } }).response;
      if (response?.status === 404) {
        return { exists: false };
      }
    }
    throw err;
  }
}

async function auditSlot(
  slot: string,
  signerId: string,
  options: PreflightOptions,
): Promise<AccountAudit> {
  const { relayerClient, network } = options;

  try {
    // Check signer
    const signerResult = await tryGetSigner(relayerClient, signerId);

    // Check relayer
    const relayerResult = await tryGetRelayer(relayerClient, slot);

    // Check on-chain funding (only if relayer exists with an address)
    let onChainFunded = false;
    let balance: string | undefined;

    if (relayerResult.exists && relayerResult.address) {
      const fundedStatus = await checkAccountFunded(relayerResult.address, network);
      onChainFunded = fundedStatus.funded;
      balance = fundedStatus.balance;
    }

    return {
      slot,
      signerId,
      signerExists: signerResult.exists,
      relayerExists: relayerResult.exists,
      onChainFunded,
      relayerAddress: relayerResult.address,
      balance,
    };
  } catch (err) {
    return {
      slot,
      signerId,
      signerExists: false,
      relayerExists: false,
      onChainFunded: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Run preflight audit on a list of slots.
 * Checks signer, relayer, and on-chain funding status in parallel.
 */
export async function runPreflight(
  slots: string[],
  options: PreflightOptions,
): Promise<PreflightResult> {
  const { channelsClient, concurrency, onProgress } = options;

  // Fetch existing channel config from plugin
  let existingConfigIds: string[] = [];
  try {
    const config = await channelsClient.listChannelAccounts();
    existingConfigIds = config.relayerIds || [];
  } catch (err) {
    // Only ignore 404 (not configured yet), propagate other errors
    const status =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { status?: number } }).response?.status
        : undefined;
    if (status !== 404) {
      throw err;
    }
  }

  // Audit all slots in parallel
  const results = await parallelMapSettled(
    slots,
    (slot) => {
      const signerId = `${slot}-signer`;
      return auditSlot(slot, signerId, options);
    },
    concurrency,
    onProgress,
  );

  // Collect results
  const accounts: AccountAudit[] = results.map((r, i) => {
    if (r.success) {
      return r.value;
    }
    return {
      slot: slots[i],
      signerId: `${slots[i]}-signer`,
      signerExists: false,
      relayerExists: false,
      onChainFunded: false,
      error: r.error.message,
    };
  });

  // Calculate counts
  const existing = {
    signers: accounts.filter((a) => a.signerExists).length,
    relayers: accounts.filter((a) => a.relayerExists).length,
    funded: accounts.filter((a) => a.onChainFunded).length,
  };

  const missing = {
    signers: accounts.filter((a) => !a.signerExists).length,
    relayers: accounts.filter((a) => !a.relayerExists).length,
    unfunded: accounts.filter((a) => a.relayerExists && !a.onChainFunded).length,
  };

  return {
    accounts,
    existing,
    missing,
    highestExisting: 0, // Will be calculated by detectGaps
    gapDetected: false,
    existingConfigIds,
  };
}

/**
 * Parse slot number from slot name.
 * E.g., "channel-0001" with prefix "channel-" returns 1
 */
function parseSlotNumber(slot: string, prefix: string): number | null {
  if (!slot.startsWith(prefix)) {
    return null;
  }
  const numStr = slot.slice(prefix.length);
  const num = Number.parseInt(numStr, 10);
  return Number.isNaN(num) ? null : num;
}

export interface GapDetectionResult {
  hasGap: boolean;
  gapStart?: number;
  gapEnd?: number;
  highestExisting: number;
}

/**
 * Detect gaps in the slot sequence.
 *
 * A gap exists if:
 * 1. There are existing slots with higher numbers than requestedFrom
 * 2. Those existing slots don't form a continuous sequence from requestedFrom
 */
export function detectGaps(
  requestedFrom: number,
  preflight: PreflightResult,
  prefix: string,
): GapDetectionResult {
  // Find all existing slot numbers (from both preflight and existing config)
  const existingSlots = new Set<number>();

  for (const account of preflight.accounts) {
    if (account.signerExists || account.relayerExists) {
      const num = parseSlotNumber(account.slot, prefix);
      if (num !== null) {
        existingSlots.add(num);
      }
    }
  }

  for (const configId of preflight.existingConfigIds) {
    const num = parseSlotNumber(configId, prefix);
    if (num !== null) {
      existingSlots.add(num);
    }
  }

  if (existingSlots.size === 0) {
    return { hasGap: false, highestExisting: 0 };
  }

  const sortedExisting = [...existingSlots].sort((a, b) => a - b);
  const highestExisting = sortedExisting[sortedExisting.length - 1];

  // If we're starting from a number higher than all existing slots,
  // and there's a gap between the highest existing and our start,
  // that's a gap
  if (requestedFrom > highestExisting + 1) {
    return {
      hasGap: true,
      gapStart: highestExisting + 1,
      gapEnd: requestedFrom - 1,
      highestExisting,
    };
  }

  // Check for gaps within the existing sequence
  for (let i = 1; i < sortedExisting.length; i++) {
    const expected = sortedExisting[i - 1] + 1;
    const actual = sortedExisting[i];
    if (actual !== expected) {
      return {
        hasGap: true,
        gapStart: expected,
        gapEnd: actual - 1,
        highestExisting,
      };
    }
  }

  return { hasGap: false, highestExisting };
}
