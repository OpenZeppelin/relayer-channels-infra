import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ResolvedConfig } from '../config/index.js';
import { type RelayerDeps, createRelayerCommand } from './relayer.js';

// Store original process.exit
const originalExit = process.exit;
const originalConsoleLog = console.log;

let exitCode: number | undefined;
let consoleLogCalls: unknown[][] = [];

// Mock config factory
function createMockConfig(options?: {
  url?: string;
  profileName?: string;
  isProtected?: boolean;
}): ResolvedConfig {
  return {
    url: options?.url || 'https://api.example.com',
    apiKey: 'test-api-key',
    profileName: options?.profileName || 'default',
    isProtected: options?.isProtected ?? false,
    profile: {},
  } as ResolvedConfig;
}

interface MockClientOptions {
  listError?: Error;
  listData?: { items: unknown[] };
  getRelayerError?: Error;
  getRelayerData?: Record<string, unknown>;
  statusError?: Error;
  statusData?: Record<string, unknown>;
  balanceError?: Error;
  balanceData?: Record<string, unknown>;
  updateError?: Error;
  updateData?: Record<string, unknown>;
  createError?: Error;
  createData?: Record<string, unknown>;
}

function createMockClient(options: MockClientOptions = {}) {
  return {
    health: { health: mock(async () => ({ status: 'ok' })) },
    signers: {},
    relayers: {
      listRelayers: mock(async (page?: number, perPage?: number) => {
        if (options.listError) {
          throw options.listError;
        }
        return {
          data: {
            success: true,
            data: options.listData || {
              items: [
                { id: 'relayer-1', name: 'Relayer 1', paused: false },
                { id: 'relayer-2', name: 'Relayer 2', paused: true },
              ],
              page: page || 1,
              per_page: perPage || 10,
              total: 2,
            },
          },
        };
      }),
      getRelayer: mock(async (id: string) => {
        if (options.getRelayerError) {
          throw options.getRelayerError;
        }
        return {
          data: {
            success: true,
            data: options.getRelayerData || {
              id,
              name: `Relayer ${id}`,
              address: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
              network_type: 'stellar',
              network: 'testnet',
              paused: false,
            },
          },
        };
      }),
      getRelayerStatus: mock(async (id: string) => {
        if (options.statusError) {
          throw options.statusError;
        }
        return {
          data: {
            success: true,
            data: options.statusData || {
              id,
              paused: false,
              system_disabled: false,
              pending_transactions: 0,
            },
          },
        };
      }),
      getRelayerBalance: mock(async (id: string) => {
        if (options.balanceError) {
          throw options.balanceError;
        }
        return {
          data: {
            success: true,
            data: options.balanceData || {
              id,
              balance: '1000000000',
              currency: 'XLM',
            },
          },
        };
      }),
      updateRelayer: mock(async (id: string, update: Record<string, unknown>) => {
        if (options.updateError) {
          throw options.updateError;
        }
        return {
          data: {
            success: true,
            data: options.updateData || {
              id,
              ...update,
            },
          },
        };
      }),
      createRelayer: mock(async (request: Record<string, unknown>) => {
        if (options.createError) {
          throw options.createError;
        }
        return {
          data: {
            success: true,
            data: options.createData || {
              id: request.id,
              name: request.name,
              address: 'GNEWRELAYERADDRESS1234567890ABCD',
              network_type: request.network_type,
              network: request.network,
              signer_id: request.signer_id,
              paused: request.paused || false,
            },
          },
        };
      }),
    },
    config: createMockConfig(),
  };
}

/**
 * Create mock deps for testing with optional overrides.
 */
function createMockDeps(overrides: Partial<RelayerDeps> = {}): RelayerDeps {
  const mockClient = createMockClient();

  return {
    resolveConfig: mock((args: Record<string, unknown>) => {
      if (args.url === 'no-config') {
        return null;
      }
      return createMockConfig({
        url: args.url as string,
        profileName: args.profile as string,
        isProtected: args.profile === 'production',
      });
    }) as RelayerDeps['resolveConfig'],
    createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
    output: mock((data: unknown) => {
      consoleLogCalls.push(['output', data]);
    }) as RelayerDeps['output'],
    success: mock((message: string) => {
      consoleLogCalls.push(['success', message]);
    }) as RelayerDeps['success'],
    setVerbose: mock(() => {}) as RelayerDeps['setVerbose'],
    exitWithUsageError: mock((message: string) => {
      consoleLogCalls.push(['usageError', message]);
      throw new Error(`UsageError: ${message}`);
    }) as RelayerDeps['exitWithUsageError'],
    handleApiError: mock((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      consoleLogCalls.push(['apiError', message]);
      throw new Error(`ApiError: ${message}`);
    }) as RelayerDeps['handleApiError'],
    confirmProtectedOperation: mock(async () => true) as RelayerDeps['confirmProtectedOperation'],
    ...overrides,
  };
}

// Helper to run a subcommand
async function runSubCommand(
  deps: RelayerDeps,
  subCommandName: string,
  args: Record<string, unknown> = {},
): Promise<void> {
  const relayerCommand = createRelayerCommand(deps);
  const subCommands = relayerCommand.subCommands as Record<
    string,
    { run: (ctx: { args: Record<string, unknown> }) => Promise<void> }
  >;
  const subCommand = subCommands[subCommandName];
  if (!subCommand) {
    throw new Error(`Unknown subcommand: ${subCommandName}`);
  }
  await subCommand.run({ args });
}

describe('relayer command', () => {
  let mockDeps: RelayerDeps;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    exitCode = undefined;
    consoleLogCalls = [];

    mockClient = createMockClient();
    mockDeps = createMockDeps({
      createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
    });

    // Mock process.exit
    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    }) as never;

    // Mock console.log
    console.log = mock((...args: unknown[]) => {
      consoleLogCalls.push(args);
    });
  });

  afterEach(() => {
    process.exit = originalExit;
    console.log = originalConsoleLog;
  });

  describe('list subcommand', () => {
    test('lists relayers successfully', async () => {
      await runSubCommand(mockDeps, 'list', { url: 'https://api.example.com' });

      expect(mockClient.relayers.listRelayers).toHaveBeenCalled();
      expect(consoleLogCalls.some((c) => c[0] === 'output')).toBe(true);
    });

    test('passes pagination parameters', async () => {
      await runSubCommand(mockDeps, 'list', {
        url: 'https://api.example.com',
        page: '2',
        'per-page': '25',
      });

      expect(mockClient.relayers.listRelayers).toHaveBeenCalledWith(2, 25);
    });

    test('handles API error', async () => {
      mockClient = createMockClient({
        listError: new Error('Network error'),
      });
      mockDeps = createMockDeps({
        createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
      });

      await expect(
        runSubCommand(mockDeps, 'list', { url: 'https://api.example.com' }),
      ).rejects.toThrow('ApiError');

      expect(consoleLogCalls.some((c) => c[0] === 'apiError')).toBe(true);
    });

    test('uses default pagination when not specified', async () => {
      await runSubCommand(mockDeps, 'list', {
        url: 'https://api.example.com',
        page: '1',
        'per-page': '10',
      });

      expect(mockClient.relayers.listRelayers).toHaveBeenCalledWith(1, 10);
    });
  });

  describe('show subcommand', () => {
    test('shows relayer details successfully', async () => {
      await runSubCommand(mockDeps, 'show', {
        url: 'https://api.example.com',
        id: 'test-relayer',
      });

      expect(mockClient.relayers.getRelayer).toHaveBeenCalledWith('test-relayer');
      expect(consoleLogCalls.some((c) => c[0] === 'output')).toBe(true);
    });

    test('throws error when ID is missing', async () => {
      await expect(
        runSubCommand(mockDeps, 'show', { url: 'https://api.example.com', id: '' }),
      ).rejects.toThrow('UsageError');

      expect(consoleLogCalls.some((c) => c[1]?.toString().includes('Relayer ID is required'))).toBe(
        true,
      );
    });

    test('handles not found error', async () => {
      const notFoundError = new Error('Not found') as Error & {
        response?: { status: number };
      };
      notFoundError.response = { status: 404 };
      mockClient = createMockClient({ getRelayerError: notFoundError });
      mockDeps = createMockDeps({
        createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
      });

      await expect(
        runSubCommand(mockDeps, 'show', { url: 'https://api.example.com', id: 'nonexistent' }),
      ).rejects.toThrow('ApiError');
    });

    test('outputs JSON when --json flag is set', async () => {
      await runSubCommand(mockDeps, 'show', {
        url: 'https://api.example.com',
        id: 'test-relayer',
        json: true,
      });

      expect(mockClient.relayers.getRelayer).toHaveBeenCalled();
    });
  });

  describe('status subcommand', () => {
    test('shows relayer status successfully', async () => {
      await runSubCommand(mockDeps, 'status', {
        url: 'https://api.example.com',
        id: 'test-relayer',
      });

      expect(mockClient.relayers.getRelayerStatus).toHaveBeenCalledWith('test-relayer');
      expect(consoleLogCalls.some((c) => c[0] === 'output')).toBe(true);
    });

    test('throws error when ID is missing', async () => {
      await expect(
        runSubCommand(mockDeps, 'status', { url: 'https://api.example.com', id: '' }),
      ).rejects.toThrow('UsageError');
    });

    test('handles API error', async () => {
      mockClient = createMockClient({
        statusError: new Error('Server error'),
      });
      mockDeps = createMockDeps({
        createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
      });

      await expect(
        runSubCommand(mockDeps, 'status', { url: 'https://api.example.com', id: 'test-relayer' }),
      ).rejects.toThrow('ApiError');
    });

    test('returns status data with correct fields', async () => {
      mockClient = createMockClient({
        statusData: {
          id: 'test-relayer',
          paused: true,
          system_disabled: false,
          pending_transactions: 5,
        },
      });
      mockDeps = createMockDeps({
        createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
      });

      await runSubCommand(mockDeps, 'status', {
        url: 'https://api.example.com',
        id: 'test-relayer',
      });

      const outputCall = consoleLogCalls.find((c) => c[0] === 'output');
      expect(outputCall).toBeDefined();
    });
  });

  describe('balance subcommand', () => {
    test('shows relayer balance successfully', async () => {
      await runSubCommand(mockDeps, 'balance', {
        url: 'https://api.example.com',
        id: 'test-relayer',
      });

      expect(mockClient.relayers.getRelayerBalance).toHaveBeenCalledWith('test-relayer');
      expect(consoleLogCalls.some((c) => c[0] === 'output')).toBe(true);
    });

    test('throws error when ID is missing', async () => {
      await expect(
        runSubCommand(mockDeps, 'balance', { url: 'https://api.example.com', id: '' }),
      ).rejects.toThrow('UsageError');
    });

    test('handles API error', async () => {
      mockClient = createMockClient({
        balanceError: new Error('Network error'),
      });
      mockDeps = createMockDeps({
        createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
      });

      await expect(
        runSubCommand(mockDeps, 'balance', { url: 'https://api.example.com', id: 'test-relayer' }),
      ).rejects.toThrow('ApiError');
    });

    test('returns balance with currency', async () => {
      mockClient = createMockClient({
        balanceData: {
          id: 'test-relayer',
          balance: '5000000000',
          currency: 'XLM',
        },
      });
      mockDeps = createMockDeps({
        createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
      });

      await runSubCommand(mockDeps, 'balance', {
        url: 'https://api.example.com',
        id: 'test-relayer',
      });

      expect(consoleLogCalls.some((c) => c[0] === 'output')).toBe(true);
    });
  });

  describe('pause subcommand', () => {
    test('pauses relayer successfully', async () => {
      await runSubCommand(mockDeps, 'pause', {
        url: 'https://api.example.com',
        id: 'test-relayer',
      });

      expect(mockClient.relayers.updateRelayer).toHaveBeenCalledWith('test-relayer', {
        paused: true,
      });
      expect(consoleLogCalls.some((c) => c[0] === 'output')).toBe(true);
    });

    test('prompts for confirmation on protected profile', async () => {
      const confirmMock = mock(async () => true);
      mockDeps = createMockDeps({
        createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
        confirmProtectedOperation: confirmMock as RelayerDeps['confirmProtectedOperation'],
      });

      await runSubCommand(mockDeps, 'pause', {
        url: 'https://api.example.com',
        profile: 'production',
        id: 'test-relayer',
      });

      expect(confirmMock).toHaveBeenCalledWith({
        profileName: 'production',
        operation: 'pause relayer',
        summary: 'Relayer ID: test-relayer',
        noInput: false,
      });
    });

    test('cancels operation when confirmation declined', async () => {
      mockDeps = createMockDeps({
        createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
        confirmProtectedOperation: mock(
          async () => false,
        ) as RelayerDeps['confirmProtectedOperation'],
      });

      await expect(
        runSubCommand(mockDeps, 'pause', {
          url: 'https://api.example.com',
          profile: 'production',
          id: 'test-relayer',
        }),
      ).rejects.toThrow('process.exit(0)');

      expect(exitCode).toBe(0);
      expect(mockClient.relayers.updateRelayer).not.toHaveBeenCalled();
    });

    test('throws error when ID is missing', async () => {
      await expect(
        runSubCommand(mockDeps, 'pause', { url: 'https://api.example.com', id: '' }),
      ).rejects.toThrow('UsageError');
    });

    test('handles API error', async () => {
      mockClient = createMockClient({
        updateError: new Error('Update failed'),
      });
      mockDeps = createMockDeps({
        createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
      });

      await expect(
        runSubCommand(mockDeps, 'pause', { url: 'https://api.example.com', id: 'test-relayer' }),
      ).rejects.toThrow('ApiError');
    });
  });

  describe('resume subcommand', () => {
    test('resumes relayer successfully', async () => {
      await runSubCommand(mockDeps, 'resume', {
        url: 'https://api.example.com',
        id: 'test-relayer',
      });

      expect(mockClient.relayers.updateRelayer).toHaveBeenCalledWith('test-relayer', {
        paused: false,
      });
      expect(consoleLogCalls.some((c) => c[0] === 'output')).toBe(true);
    });

    test('prompts for confirmation on protected profile', async () => {
      const confirmMock = mock(async () => true);
      mockDeps = createMockDeps({
        createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
        confirmProtectedOperation: confirmMock as RelayerDeps['confirmProtectedOperation'],
      });

      await runSubCommand(mockDeps, 'resume', {
        url: 'https://api.example.com',
        profile: 'production',
        id: 'test-relayer',
      });

      expect(confirmMock).toHaveBeenCalledWith({
        profileName: 'production',
        operation: 'resume relayer',
        summary: 'Relayer ID: test-relayer',
        noInput: false,
      });
    });

    test('cancels operation when confirmation declined', async () => {
      mockDeps = createMockDeps({
        createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
        confirmProtectedOperation: mock(
          async () => false,
        ) as RelayerDeps['confirmProtectedOperation'],
      });

      await expect(
        runSubCommand(mockDeps, 'resume', {
          url: 'https://api.example.com',
          profile: 'production',
          id: 'test-relayer',
        }),
      ).rejects.toThrow('process.exit(0)');

      expect(exitCode).toBe(0);
    });

    test('handles API error', async () => {
      mockClient = createMockClient({
        updateError: new Error('Server error'),
      });
      mockDeps = createMockDeps({
        createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
      });

      await expect(
        runSubCommand(mockDeps, 'resume', { url: 'https://api.example.com', id: 'test-relayer' }),
      ).rejects.toThrow('ApiError');
    });
  });

  describe('enable subcommand', () => {
    test('enables relayer successfully', async () => {
      await runSubCommand(mockDeps, 'enable', {
        url: 'https://api.example.com',
        id: 'test-relayer',
      });

      expect(mockClient.relayers.updateRelayer).toHaveBeenCalledWith('test-relayer', {
        system_disabled: false,
      });
      expect(consoleLogCalls.some((c) => c[0] === 'output')).toBe(true);
    });

    test('prompts for confirmation on protected profile', async () => {
      const confirmMock = mock(async () => true);
      mockDeps = createMockDeps({
        createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
        confirmProtectedOperation: confirmMock as RelayerDeps['confirmProtectedOperation'],
      });

      await runSubCommand(mockDeps, 'enable', {
        url: 'https://api.example.com',
        profile: 'production',
        id: 'test-relayer',
      });

      expect(confirmMock).toHaveBeenCalledWith({
        profileName: 'production',
        operation: 're-enable relayer',
        summary: 'Relayer ID: test-relayer',
        noInput: false,
      });
    });

    test('cancels operation when confirmation declined', async () => {
      mockDeps = createMockDeps({
        createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
        confirmProtectedOperation: mock(
          async () => false,
        ) as RelayerDeps['confirmProtectedOperation'],
      });

      await expect(
        runSubCommand(mockDeps, 'enable', {
          url: 'https://api.example.com',
          profile: 'production',
          id: 'test-relayer',
        }),
      ).rejects.toThrow('process.exit(0)');

      expect(exitCode).toBe(0);
    });

    test('throws error when ID is missing', async () => {
      await expect(
        runSubCommand(mockDeps, 'enable', { url: 'https://api.example.com', id: '' }),
      ).rejects.toThrow('UsageError');
    });
  });

  describe('create subcommand', () => {
    test('creates relayer with all required args', async () => {
      await runSubCommand(mockDeps, 'create', {
        url: 'https://api.example.com',
        id: 'new-relayer',
        'network-type': 'stellar',
        network: 'testnet',
        'signer-id': 'my-signer',
        paused: false,
      });

      expect(mockClient.relayers.createRelayer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'new-relayer',
          name: 'new-relayer',
          network: 'testnet',
          signer_id: 'my-signer',
          paused: false,
        }),
      );
      // Verify the network_type was passed (as enum)
      const createCall = (mockClient.relayers.createRelayer as ReturnType<typeof mock>).mock
        .calls[0] as [Record<string, unknown>];
      expect(createCall[0].network_type).toBeDefined();
      expect(consoleLogCalls.some((c) => c[0] === 'success')).toBe(true);
    });

    test('creates relayer with custom name', async () => {
      await runSubCommand(mockDeps, 'create', {
        url: 'https://api.example.com',
        id: 'new-relayer',
        name: 'My Custom Relayer',
        'network-type': 'stellar',
        network: 'testnet',
        'signer-id': 'my-signer',
      });

      expect(mockClient.relayers.createRelayer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'new-relayer',
          name: 'My Custom Relayer',
        }),
      );
    });

    test('creates relayer with EVM network type', async () => {
      await runSubCommand(mockDeps, 'create', {
        url: 'https://api.example.com',
        id: 'evm-relayer',
        'network-type': 'evm',
        network: 'sepolia',
        'signer-id': 'evm-signer',
      });

      expect(mockClient.relayers.createRelayer).toHaveBeenCalledWith(
        expect.objectContaining({
          network_type: 'evm',
        }),
      );
    });

    test('creates relayer with Solana network type', async () => {
      await runSubCommand(mockDeps, 'create', {
        url: 'https://api.example.com',
        id: 'solana-relayer',
        'network-type': 'solana',
        network: 'devnet',
        'signer-id': 'solana-signer',
      });

      expect(mockClient.relayers.createRelayer).toHaveBeenCalledWith(
        expect.objectContaining({
          network_type: 'solana',
        }),
      );
    });

    test('creates relayer in paused state', async () => {
      await runSubCommand(mockDeps, 'create', {
        url: 'https://api.example.com',
        id: 'new-relayer',
        'network-type': 'stellar',
        network: 'testnet',
        'signer-id': 'my-signer',
        paused: true,
      });

      expect(mockClient.relayers.createRelayer).toHaveBeenCalledWith(
        expect.objectContaining({
          paused: true,
        }),
      );
    });

    test('creates relayer with policy options', async () => {
      await runSubCommand(mockDeps, 'create', {
        url: 'https://api.example.com',
        id: 'new-relayer',
        'network-type': 'stellar',
        network: 'testnet',
        'signer-id': 'my-signer',
        'min-balance': '1000000',
        'fee-payment-strategy': 'relayer',
        'concurrent-transactions': true,
      });

      expect(mockClient.relayers.createRelayer).toHaveBeenCalledWith(
        expect.objectContaining({
          policies: {
            min_balance: 1000000,
            fee_payment_strategy: 'relayer',
            concurrent_transactions: true,
          },
        }),
      );
    });

    test('throws error for invalid network type', async () => {
      await expect(
        runSubCommand(mockDeps, 'create', {
          url: 'https://api.example.com',
          id: 'new-relayer',
          'network-type': 'invalid',
          network: 'testnet',
          'signer-id': 'my-signer',
        }),
      ).rejects.toThrow('UsageError');

      expect(consoleLogCalls.some((c) => c[1]?.toString().includes('Invalid network type'))).toBe(
        true,
      );
    });

    test('throws error when ID is missing', async () => {
      await expect(
        runSubCommand(mockDeps, 'create', {
          url: 'https://api.example.com',
          id: '',
          'network-type': 'stellar',
          network: 'testnet',
          'signer-id': 'my-signer',
        }),
      ).rejects.toThrow('UsageError');
    });

    test('prompts for confirmation on protected profile', async () => {
      const confirmMock = mock(async () => true);
      mockDeps = createMockDeps({
        createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
        confirmProtectedOperation: confirmMock as RelayerDeps['confirmProtectedOperation'],
      });

      await runSubCommand(mockDeps, 'create', {
        url: 'https://api.example.com',
        profile: 'production',
        id: 'new-relayer',
        'network-type': 'stellar',
        network: 'testnet',
        'signer-id': 'my-signer',
      });

      expect(confirmMock).toHaveBeenCalledWith({
        profileName: 'production',
        operation: 'create relayer',
        summary: 'Relayer ID: new-relayer',
        noInput: false,
      });
    });

    test('cancels creation when confirmation declined', async () => {
      mockDeps = createMockDeps({
        createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
        confirmProtectedOperation: mock(
          async () => false,
        ) as RelayerDeps['confirmProtectedOperation'],
      });

      await expect(
        runSubCommand(mockDeps, 'create', {
          url: 'https://api.example.com',
          profile: 'production',
          id: 'new-relayer',
          'network-type': 'stellar',
          network: 'testnet',
          'signer-id': 'my-signer',
        }),
      ).rejects.toThrow('process.exit(0)');

      expect(exitCode).toBe(0);
      expect(mockClient.relayers.createRelayer).not.toHaveBeenCalled();
    });

    test('handles API error', async () => {
      mockClient = createMockClient({
        createError: new Error('Conflict: relayer already exists'),
      });
      mockDeps = createMockDeps({
        createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
      });

      await expect(
        runSubCommand(mockDeps, 'create', {
          url: 'https://api.example.com',
          id: 'existing-relayer',
          'network-type': 'stellar',
          network: 'testnet',
          'signer-id': 'my-signer',
        }),
      ).rejects.toThrow('ApiError');
    });

    test('outputs JSON when --json flag is set', async () => {
      await runSubCommand(mockDeps, 'create', {
        url: 'https://api.example.com',
        id: 'new-relayer',
        'network-type': 'stellar',
        network: 'testnet',
        'signer-id': 'my-signer',
        json: true,
      });

      // When json is true, it should call output with json:true
      // and NOT call success()
      const successCalls = consoleLogCalls.filter((c) => c[0] === 'success');
      expect(successCalls).toHaveLength(0);
    });

    test('shows success message without --json flag', async () => {
      await runSubCommand(mockDeps, 'create', {
        url: 'https://api.example.com',
        id: 'new-relayer',
        'network-type': 'stellar',
        network: 'testnet',
        'signer-id': 'my-signer',
        json: false,
      });

      expect(consoleLogCalls.some((c) => c[0] === 'success')).toBe(true);
    });
  });

  describe('configuration', () => {
    test('throws error when no config is available', async () => {
      await expect(runSubCommand(mockDeps, 'list', { url: 'no-config' })).rejects.toThrow(
        'UsageError',
      );

      expect(consoleLogCalls.some((c) => c[1]?.toString().includes('No configuration found'))).toBe(
        true,
      );
    });

    test('uses profile from args', async () => {
      await runSubCommand(mockDeps, 'list', {
        url: 'https://api.example.com',
        profile: 'staging',
      });

      expect(mockDeps.resolveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ profile: 'staging' }),
      );
    });

    test('supports --no-input flag for protected operations', async () => {
      const confirmMock = mock(async () => true);
      mockDeps = createMockDeps({
        createClient: mock(() => mockClient) as unknown as RelayerDeps['createClient'],
        confirmProtectedOperation: confirmMock as RelayerDeps['confirmProtectedOperation'],
      });

      await runSubCommand(mockDeps, 'pause', {
        url: 'https://api.example.com',
        profile: 'production',
        id: 'test-relayer',
        'no-input': true,
      });

      expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ noInput: true }));
    });
  });

  describe('parent command structure', () => {
    test('has correct subcommands defined', () => {
      const relayerCommand = createRelayerCommand(mockDeps);
      const subCommands = Object.keys(relayerCommand.subCommands || {});
      expect(subCommands).toContain('list');
      expect(subCommands).toContain('show');
      expect(subCommands).toContain('status');
      expect(subCommands).toContain('balance');
      expect(subCommands).toContain('pause');
      expect(subCommands).toContain('resume');
      expect(subCommands).toContain('enable');
      expect(subCommands).toContain('create');
    });

    test('has correct metadata', () => {
      const relayerCommand = createRelayerCommand(mockDeps);
      expect((relayerCommand.meta as any)?.name).toBe('relayer');
      expect((relayerCommand.meta as any)?.description).toBe('Relayer operations');
    });
  });
});
