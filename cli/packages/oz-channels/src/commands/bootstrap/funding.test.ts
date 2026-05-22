import { describe, expect, mock, test } from 'bun:test';
import { type AccountToFund, type FundingOptions, fundAccounts } from './funding.js';
import type { RelayerClient } from './preflight.js';

// We'll mock the parts that would hit the network
function createMockRelayerClient(options?: {
  sendError?: Error;
  sendResponse?: { id?: string };
  txStatus?: 'confirmed' | 'failed' | 'pending';
  alreadyExists?: boolean;
}): RelayerClient {
  return {
    signers: {} as unknown as RelayerClient['signers'],
    relayers: {
      sendTransaction: mock(async () => {
        if (options?.alreadyExists) {
          const err = new Error('op_already_exists') as Error;
          throw err;
        }
        if (options?.sendError) {
          throw options.sendError;
        }
        return {
          data: {
            data: options?.sendResponse || { id: 'tx-123' },
          },
        };
      }),
      getTransactionById: mock(async () => ({
        data: {
          data: {
            status: options?.txStatus || 'confirmed',
          },
        },
      })),
    } as unknown as RelayerClient['relayers'],
  };
}

describe('fundAccounts', () => {
  // Note: Full integration tests would require mocking StellarSdk.Horizon.Server
  // These tests focus on the behavior we can test without deep SDK mocking

  test('returns empty array for empty input', async () => {
    const client = createMockRelayerClient();
    const options: FundingOptions = {
      relayerClient: client,
      fundingRelayer: 'fund-relayer',
      fundingAddress: 'GFUNDING...',
      startingBalance: 2,
      network: 'testnet',
      fee: 100000,
      delayMs: 0,
    };

    const results = await fundAccounts([], options);
    expect(results).toEqual([]);
    expect(client.relayers.sendTransaction).not.toHaveBeenCalled();
  });
});

describe('FundingOptions interface', () => {
  test('accepts all required fields', () => {
    const options: FundingOptions = {
      relayerClient: {} as RelayerClient,
      fundingRelayer: 'fund-relayer',
      fundingAddress: 'GFUNDING...',
      startingBalance: 2,
      network: 'testnet',
      fee: 100000,
      delayMs: 100,
    };

    expect(options.fundingRelayer).toBe('fund-relayer');
    expect(options.startingBalance).toBe(2);
    expect(options.fee).toBe(100000);
  });

  test('accepts optional fields', () => {
    const options: FundingOptions = {
      relayerClient: {} as RelayerClient,
      fundingRelayer: 'fund-relayer',
      fundingAddress: 'GFUNDING...',
      startingBalance: 2,
      network: 'testnet',
      fee: 100000,
      delayMs: 100,
      verbose: true,
      onProgress: () => {},
    };

    expect(options.verbose).toBe(true);
    expect(options.onProgress).toBeDefined();
  });
});

describe('AccountToFund interface', () => {
  test('has required slot and address', () => {
    const account: AccountToFund = {
      slot: 'channel-0001',
      address: 'GABCDEF...',
    };

    expect(account.slot).toBe('channel-0001');
    expect(account.address).toBe('GABCDEF...');
  });
});
