import { describe, expect, mock, test } from 'bun:test';
import type { RelayerClient } from './preflight.js';
import { provisionAccounts } from './provision.js';
import type { AccountAudit } from './types.js';

function createMockRelayerClient(options?: {
  signerCreateError?: Error;
  relayerCreateError?: Error;
  signerConflict?: boolean;
  relayerConflict?: boolean;
}): RelayerClient {
  return {
    signers: {
      createSigner: mock(async (request: { id: string }) => {
        if (options?.signerConflict) {
          const err = new Error('Conflict') as Error & { response?: { status: number } };
          err.response = { status: 409 };
          throw err;
        }
        if (options?.signerCreateError) {
          throw options.signerCreateError;
        }
        return { data: { id: request.id } };
      }),
      getSigner: mock(async () => ({ data: {} })),
    } as unknown as RelayerClient['signers'],
    relayers: {
      createRelayer: mock(async (request: { id: string }) => {
        if (options?.relayerConflict) {
          const err = new Error('Conflict') as Error & { response?: { status: number } };
          err.response = { status: 409 };
          throw err;
        }
        if (options?.relayerCreateError) {
          throw options.relayerCreateError;
        }
        return {
          data: {
            data: {
              id: request.id,
              address: `G${request.id.toUpperCase().replace(/-/g, '')}`,
            },
          },
        };
      }),
      getRelayer: mock(async (id: string) => ({
        data: {
          data: {
            id,
            address: `G${id.toUpperCase().replace(/-/g, '')}`,
          },
        },
      })),
    } as unknown as RelayerClient['relayers'],
  };
}

describe('provisionAccounts', () => {
  test('creates signer and relayer for missing account', async () => {
    const client = createMockRelayerClient();
    const accounts: AccountAudit[] = [
      {
        slot: 'channel-0001',
        signerId: 'channel-0001-signer',
        signerExists: false,
        relayerExists: false,
        onChainFunded: false,
      },
    ];

    const results = await provisionAccounts(accounts, {
      relayerClient: client,
      network: 'testnet',
      delayMs: 0,
    });

    expect(results).toHaveLength(1);
    expect(results[0].signerCreated).toBe(true);
    expect(results[0].relayerCreated).toBe(true);
    expect(results[0].relayerAddress).toBeDefined();
    expect(client.signers.createSigner).toHaveBeenCalled();
    expect(client.relayers.createRelayer).toHaveBeenCalled();
  });

  test('skips signer creation if it exists', async () => {
    const client = createMockRelayerClient();
    const accounts: AccountAudit[] = [
      {
        slot: 'channel-0001',
        signerId: 'channel-0001-signer',
        signerExists: true,
        relayerExists: false,
        onChainFunded: false,
      },
    ];

    const results = await provisionAccounts(accounts, {
      relayerClient: client,
      network: 'testnet',
      delayMs: 0,
    });

    expect(results).toHaveLength(1);
    expect(results[0].signerCreated).toBe(false);
    expect(results[0].relayerCreated).toBe(true);
    expect(client.signers.createSigner).not.toHaveBeenCalled();
    expect(client.relayers.createRelayer).toHaveBeenCalled();
  });

  test('skips relayer creation if it exists', async () => {
    const client = createMockRelayerClient();
    const accounts: AccountAudit[] = [
      {
        slot: 'channel-0001',
        signerId: 'channel-0001-signer',
        signerExists: false,
        relayerExists: true,
        onChainFunded: false,
        relayerAddress: 'GABCDEF',
      },
    ];

    const results = await provisionAccounts(accounts, {
      relayerClient: client,
      network: 'testnet',
      delayMs: 0,
    });

    expect(results).toHaveLength(1);
    expect(results[0].signerCreated).toBe(true);
    expect(results[0].relayerCreated).toBe(false);
    expect(results[0].relayerAddress).toBe('GABCDEF');
    expect(client.signers.createSigner).toHaveBeenCalled();
    expect(client.relayers.createRelayer).not.toHaveBeenCalled();
  });

  test('handles 409 conflict for signer gracefully', async () => {
    const client = createMockRelayerClient({ signerConflict: true });
    const accounts: AccountAudit[] = [
      {
        slot: 'channel-0001',
        signerId: 'channel-0001-signer',
        signerExists: false,
        relayerExists: false,
        onChainFunded: false,
      },
    ];

    const results = await provisionAccounts(accounts, {
      relayerClient: client,
      network: 'testnet',
      delayMs: 0,
    });

    expect(results).toHaveLength(1);
    expect(results[0].signerCreated).toBe(false);
    expect(results[0].relayerCreated).toBe(true);
    expect(results[0].error).toBeUndefined();
  });

  test('handles 409 conflict for relayer gracefully', async () => {
    const client = createMockRelayerClient({ relayerConflict: true });
    const accounts: AccountAudit[] = [
      {
        slot: 'channel-0001',
        signerId: 'channel-0001-signer',
        signerExists: true,
        relayerExists: false,
        onChainFunded: false,
      },
    ];

    const results = await provisionAccounts(accounts, {
      relayerClient: client,
      network: 'testnet',
      delayMs: 0,
    });

    expect(results).toHaveLength(1);
    expect(results[0].relayerCreated).toBe(false);
    expect(results[0].relayerAddress).toBeDefined();
    expect(results[0].error).toBeUndefined();
  });

  test('captures errors in result', async () => {
    const client = createMockRelayerClient({
      signerCreateError: new Error('Network error'),
    });
    const accounts: AccountAudit[] = [
      {
        slot: 'channel-0001',
        signerId: 'channel-0001-signer',
        signerExists: false,
        relayerExists: false,
        onChainFunded: false,
      },
    ];

    const results = await provisionAccounts(accounts, {
      relayerClient: client,
      network: 'testnet',
      delayMs: 0,
    });

    expect(results).toHaveLength(1);
    expect(results[0].error).toContain('Network error');
    expect(results[0].signerCreated).toBe(false);
  });

  test('processes multiple accounts sequentially', async () => {
    const client = createMockRelayerClient();
    const accounts: AccountAudit[] = [
      {
        slot: 'channel-0001',
        signerId: 'channel-0001-signer',
        signerExists: false,
        relayerExists: false,
        onChainFunded: false,
      },
      {
        slot: 'channel-0002',
        signerId: 'channel-0002-signer',
        signerExists: false,
        relayerExists: false,
        onChainFunded: false,
      },
    ];

    const results = await provisionAccounts(accounts, {
      relayerClient: client,
      network: 'testnet',
      delayMs: 0,
    });

    expect(results).toHaveLength(2);
    expect(results[0].slot).toBe('channel-0001');
    expect(results[1].slot).toBe('channel-0002');
  });

  test('calls progress callback', async () => {
    const client = createMockRelayerClient();
    const accounts: AccountAudit[] = [
      {
        slot: 'channel-0001',
        signerId: 'channel-0001-signer',
        signerExists: false,
        relayerExists: false,
        onChainFunded: false,
      },
      {
        slot: 'channel-0002',
        signerId: 'channel-0002-signer',
        signerExists: false,
        relayerExists: false,
        onChainFunded: false,
      },
    ];

    const progressCalls: Array<[number, number]> = [];
    await provisionAccounts(accounts, {
      relayerClient: client,
      network: 'testnet',
      delayMs: 0,
      onProgress: (completed, total) => {
        progressCalls.push([completed, total]);
      },
    });

    expect(progressCalls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});
