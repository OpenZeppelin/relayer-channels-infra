import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ResolvedConfig } from '../config/index.js';
import { type TxDeps, createTxCommand } from './tx.js';

// Store original functions
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalProcessExit = process.exit;

// Capture outputs
let consoleOutput: string[] = [];
let consoleErrors: string[] = [];
let exitCode: number | undefined;

// Mock config
function createMockConfig(options?: {
  isProtected?: boolean;
  profileName?: string;
  defaultRelayer?: string;
}): ResolvedConfig {
  return {
    url: 'https://api.example.com',
    apiKey: 'test-api-key',
    profileName: options?.profileName ?? 'test-profile',
    isProtected: options?.isProtected ?? false,
    defaultRelayer: options?.defaultRelayer ?? 'test-relayer',
    profile: {},
  } as ResolvedConfig;
}

interface MockClientOptions {
  sendError?: Error;
  getRelayerError?: Error;
  listRelayersError?: Error;
  getTransactionError?: Error;
  listTransactionsError?: Error;
  cancelTransactionError?: Error;
  deletePendingTransactionsError?: Error;
  txData?: Record<string, unknown>;
  relayerData?: Record<string, unknown>;
  transactionData?: Record<string, unknown>;
  transactionsListData?: Record<string, unknown>[];
}

// Mock client factory
function createMockClient(options: MockClientOptions = {}) {
  const relayerData = options.relayerData ?? {
    id: 'test-relayer',
    address: 'GBCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNOPQR',
    network_type: 'stellar',
    network: 'testnet',
  };

  const transactionData = options.transactionData ?? {
    transaction_id: 'tx-123',
    status: 'confirmed',
    hash: 'abc123def456',
  };

  const transactionsListData = options.transactionsListData ?? [
    { id: 'tx-1', status: 'confirmed' },
    { id: 'tx-2', status: 'pending' },
  ];

  return {
    relayers: {
      getRelayer: mock(async (id: string) => {
        if (options.getRelayerError) throw options.getRelayerError;
        return { data: { success: true, data: { ...relayerData, id } } };
      }),
      listRelayers: mock(async () => {
        if (options.listRelayersError) throw options.listRelayersError;
        return { data: { items: [{ id: 'test-relayer', network_type: 'stellar' }] } };
      }),
      sendTransaction: mock(async (_relayerId: string, _txRequest: unknown) => {
        if (options.sendError) throw options.sendError;
        return {
          data: {
            success: true,
            data: options.txData ?? { transaction_id: 'tx-123', status: 'pending' },
          },
        };
      }),
      getTransactionById: mock(async (_relayerId: string, _txId: string) => {
        if (options.getTransactionError) throw options.getTransactionError;
        return { data: { success: true, data: transactionData } };
      }),
      listTransactions: mock(async (_relayerId: string, _page?: number, _perPage?: number) => {
        if (options.listTransactionsError) throw options.listTransactionsError;
        return { data: { success: true, data: transactionsListData } };
      }),
      cancelTransaction: mock(async (_relayerId: string, _txId: string) => {
        if (options.cancelTransactionError) throw options.cancelTransactionError;
        return {};
      }),
      deletePendingTransactions: mock(async (_relayerId: string) => {
        if (options.deletePendingTransactionsError) throw options.deletePendingTransactionsError;
        return {};
      }),
    },
    health: {},
    signers: {},
    config: createMockConfig(),
  };
}

/**
 * Create mock deps for testing with optional overrides.
 */
function createMockDeps(
  clientOptions: MockClientOptions = {},
  configOptions?: {
    isProtected?: boolean;
    profileName?: string;
    defaultRelayer?: string;
    noDefaultRelayer?: boolean;
    returnNull?: boolean;
  },
  overrides: Partial<TxDeps> = {},
): TxDeps {
  const mockClient = createMockClient(clientOptions);

  return {
    resolveConfig: mock(() => {
      if (configOptions?.returnNull) {
        return null;
      }
      const config = createMockConfig(configOptions);
      if (configOptions?.noDefaultRelayer) {
        return { ...config, defaultRelayer: undefined };
      }
      return config;
    }) as TxDeps['resolveConfig'],
    createClient: mock(() => mockClient) as unknown as TxDeps['createClient'],
    output: mock((data: unknown, opts?: { json?: boolean }) => {
      if (opts?.json) {
        consoleOutput.push(JSON.stringify(data, null, 2));
      } else {
        consoleOutput.push(JSON.stringify(data));
      }
    }) as TxDeps['output'],
    success: mock((msg: string) => consoleOutput.push(msg)) as TxDeps['success'],
    setVerbose: mock(() => {}) as TxDeps['setVerbose'],
    handleApiError: mock((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      consoleErrors.push(msg);
      throw new Error(`ApiError: ${msg}`);
    }) as TxDeps['handleApiError'],
    exitWithUsageError: mock((msg: string) => {
      consoleErrors.push(msg);
      process.exit(2);
    }) as TxDeps['exitWithUsageError'],
    confirmProtectedOperation: mock(async () => true) as TxDeps['confirmProtectedOperation'],
    prompt: mock(async () => '') as TxDeps['prompt'],
    promptConfirm: mock(async () => true) as TxDeps['promptConfirm'],
    promptSelect: mock(async () => 'test-relayer') as TxDeps['promptSelect'],
    closePrompts: mock(() => {}) as TxDeps['closePrompts'],
    ...overrides,
  };
}

// Helper to run a subcommand
async function runSubCommand(
  deps: TxDeps,
  subCommandName: string,
  args: Record<string, unknown> = {},
): Promise<void> {
  const txCommand = createTxCommand(deps);
  const subCommands = txCommand.subCommands as Record<
    string,
    { run: (ctx: { args: Record<string, unknown> }) => Promise<void> }
  >;
  const subCommand = subCommands[subCommandName];
  if (!subCommand) {
    throw new Error(`Unknown subcommand: ${subCommandName}`);
  }
  await subCommand.run({ args });
}

// Setup mocks before tests
beforeEach(() => {
  consoleOutput = [];
  consoleErrors = [];
  exitCode = undefined;

  console.log = (...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '));
  };
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`process.exit(${code})`);
  }) as never;
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  process.exit = originalProcessExit;
});

describe('tx status command', () => {
  test('successfully gets transaction status', async () => {
    const mockDeps = createMockDeps();

    await runSubCommand(mockDeps, 'status', {
      id: 'tx-123',
      relayer: 'test-relayer',
      json: true,
      'no-input': true,
      verbose: false,
    });

    const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
    expect(mockClient.relayers.getTransactionById).toHaveBeenCalledWith('test-relayer', 'tx-123');
    expect(consoleOutput.some((line) => line.includes('confirmed'))).toBe(true);
  });

  test('uses default relayer from config', async () => {
    const mockDeps = createMockDeps();

    await runSubCommand(mockDeps, 'status', {
      id: 'tx-456',
      json: true,
      'no-input': true,
      verbose: false,
    });

    const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
    expect(mockClient.relayers.getTransactionById).toHaveBeenCalledWith('test-relayer', 'tx-456');
  });

  test('exits with error when no relayer ID provided and no default', async () => {
    const mockDeps = createMockDeps({}, { noDefaultRelayer: true });

    await expect(
      runSubCommand(mockDeps, 'status', {
        id: 'tx-123',
        json: false,
        'no-input': true,
        verbose: false,
      }),
    ).rejects.toThrow('process.exit(2)');

    expect(exitCode).toBe(2);
    expect(consoleErrors.some((line) => line.includes('Relayer ID is required'))).toBe(true);
  });

  test('exits with error when no config found', async () => {
    const mockDeps = createMockDeps({}, { returnNull: true });

    await expect(
      runSubCommand(mockDeps, 'status', {
        id: 'tx-123',
        relayer: 'test-relayer',
        json: false,
        'no-input': true,
        verbose: false,
      }),
    ).rejects.toThrow('process.exit(2)');

    expect(exitCode).toBe(2);
    expect(consoleErrors.some((line) => line.includes('No configuration found'))).toBe(true);
  });
});

describe('tx list command', () => {
  test('successfully lists transactions', async () => {
    const mockDeps = createMockDeps();

    await runSubCommand(mockDeps, 'list', {
      relayer: 'test-relayer',
      json: true,
      'no-input': true,
      verbose: false,
      page: '1',
      'per-page': '10',
    });

    const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
    expect(mockClient.relayers.listTransactions).toHaveBeenCalledWith('test-relayer', 1, 10);
    expect(consoleOutput.some((line) => line.includes('tx-1'))).toBe(true);
  });

  test('lists transactions with status filter (client-side)', async () => {
    const mockDeps = createMockDeps();

    await runSubCommand(mockDeps, 'list', {
      relayer: 'test-relayer',
      status: 'pending',
      json: true,
      'no-input': true,
      verbose: false,
      page: '1',
      'per-page': '20',
    });

    // SDK doesn't support server-side status filtering, so we call without status
    const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
    expect(mockClient.relayers.listTransactions).toHaveBeenCalledWith('test-relayer', 1, 20);
    // Client-side filtering should be applied (pending transactions only)
  });

  test('lists transactions with pagination', async () => {
    const mockDeps = createMockDeps();

    await runSubCommand(mockDeps, 'list', {
      relayer: 'test-relayer',
      json: true,
      'no-input': true,
      verbose: false,
      page: '3',
      'per-page': '25',
    });

    const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
    expect(mockClient.relayers.listTransactions).toHaveBeenCalledWith('test-relayer', 3, 25);
  });

  test('exits with error when no relayer ID provided', async () => {
    const mockDeps = createMockDeps({}, { noDefaultRelayer: true });

    await expect(
      runSubCommand(mockDeps, 'list', {
        json: false,
        'no-input': true,
        verbose: false,
        page: '1',
        'per-page': '10',
      }),
    ).rejects.toThrow('process.exit(2)');

    expect(exitCode).toBe(2);
  });
});

describe('tx show command', () => {
  test('successfully shows transaction details', async () => {
    const mockDeps = createMockDeps();

    await runSubCommand(mockDeps, 'show', {
      id: 'tx-789',
      relayer: 'test-relayer',
      json: true,
      'no-input': true,
      verbose: false,
    });

    const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
    expect(mockClient.relayers.getTransactionById).toHaveBeenCalledWith('test-relayer', 'tx-789');
    expect(consoleOutput.some((line) => line.includes('tx-123'))).toBe(true);
  });

  test('shows transaction details in non-JSON format', async () => {
    const mockDeps = createMockDeps();

    await runSubCommand(mockDeps, 'show', {
      id: 'tx-789',
      relayer: 'test-relayer',
      json: false,
      'no-input': true,
      verbose: false,
    });

    const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
    expect(mockClient.relayers.getTransactionById).toHaveBeenCalled();
  });

  test('exits with error when no relayer ID provided', async () => {
    const mockDeps = createMockDeps({}, { noDefaultRelayer: true });

    await expect(
      runSubCommand(mockDeps, 'show', {
        id: 'tx-789',
        json: false,
        'no-input': true,
        verbose: false,
      }),
    ).rejects.toThrow('process.exit(2)');

    expect(exitCode).toBe(2);
  });
});

describe('tx cancel command', () => {
  test('successfully cancels transaction', async () => {
    const mockDeps = createMockDeps();

    await runSubCommand(mockDeps, 'cancel', {
      id: 'tx-to-cancel',
      relayer: 'test-relayer',
      json: true,
      'no-input': true,
      verbose: false,
    });

    const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
    expect(mockClient.relayers.cancelTransaction).toHaveBeenCalledWith(
      'test-relayer',
      'tx-to-cancel',
    );
    expect(consoleOutput.some((line) => line.includes('cancelled'))).toBe(true);
  });

  test('cancels with non-JSON output', async () => {
    const mockDeps = createMockDeps();

    await runSubCommand(mockDeps, 'cancel', {
      id: 'tx-to-cancel',
      relayer: 'test-relayer',
      json: false,
      'no-input': true,
      verbose: false,
    });

    const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
    expect(mockClient.relayers.cancelTransaction).toHaveBeenCalled();
    expect(consoleOutput.some((line) => line.includes('cancelled'))).toBe(true);
  });

  test('requires confirmation on protected profile', async () => {
    const confirmMock = mock(async () => true);
    const mockDeps = createMockDeps(
      {},
      { isProtected: true, profileName: 'mainnet' },
      { confirmProtectedOperation: confirmMock as TxDeps['confirmProtectedOperation'] },
    );

    await runSubCommand(mockDeps, 'cancel', {
      id: 'tx-to-cancel',
      relayer: 'test-relayer',
      json: true,
      'no-input': false,
      verbose: false,
    });

    expect(confirmMock).toHaveBeenCalledWith({
      profileName: 'mainnet',
      operation: 'cancel transaction',
      summary: 'Transaction ID: tx-to-cancel',
      noInput: false,
    });
    const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
    expect(mockClient.relayers.cancelTransaction).toHaveBeenCalled();
  });

  test('aborts when protected profile confirmation denied', async () => {
    const mockDeps = createMockDeps(
      {},
      { isProtected: true, profileName: 'mainnet' },
      { confirmProtectedOperation: mock(async () => false) as TxDeps['confirmProtectedOperation'] },
    );

    await expect(
      runSubCommand(mockDeps, 'cancel', {
        id: 'tx-to-cancel',
        relayer: 'test-relayer',
        json: false,
        'no-input': false,
        verbose: false,
      }),
    ).rejects.toThrow('process.exit(0)');

    expect(exitCode).toBe(0);
    expect(consoleOutput.some((line) => line.includes('Operation cancelled'))).toBe(true);
    // createClient is never called since command exits early
    expect(mockDeps.createClient).not.toHaveBeenCalled();
  });

  test('prompts for confirmation when not protected and not no-input', async () => {
    const promptConfirmMock = mock(async () => true);
    const closePromptsMock = mock(() => {});
    const mockDeps = createMockDeps(
      {},
      {},
      {
        promptConfirm: promptConfirmMock as TxDeps['promptConfirm'],
        closePrompts: closePromptsMock as TxDeps['closePrompts'],
      },
    );

    await runSubCommand(mockDeps, 'cancel', {
      id: 'tx-to-cancel',
      relayer: 'test-relayer',
      json: false,
      'no-input': false,
      verbose: false,
    });

    expect(promptConfirmMock).toHaveBeenCalled();
    expect(closePromptsMock).toHaveBeenCalled();
    const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
    expect(mockClient.relayers.cancelTransaction).toHaveBeenCalled();
  });

  test('aborts when user declines confirmation', async () => {
    const promptConfirmMock = mock(async () => false);
    const closePromptsMock = mock(() => {});
    const mockDeps = createMockDeps(
      {},
      {},
      {
        promptConfirm: promptConfirmMock as TxDeps['promptConfirm'],
        closePrompts: closePromptsMock as TxDeps['closePrompts'],
      },
    );

    await runSubCommand(mockDeps, 'cancel', {
      id: 'tx-to-cancel',
      relayer: 'test-relayer',
      json: false,
      'no-input': false,
      verbose: false,
    });

    expect(promptConfirmMock).toHaveBeenCalled();
    expect(closePromptsMock).toHaveBeenCalled();
    expect(consoleOutput.some((line) => line.includes('Cancellation aborted'))).toBe(true);
    const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
    expect(mockClient.relayers.cancelTransaction).not.toHaveBeenCalled();
  });

  test('exits with error when no relayer ID provided', async () => {
    const mockDeps = createMockDeps({}, { noDefaultRelayer: true });

    await expect(
      runSubCommand(mockDeps, 'cancel', {
        id: 'tx-to-cancel',
        json: false,
        'no-input': true,
        verbose: false,
      }),
    ).rejects.toThrow('process.exit(2)');

    expect(exitCode).toBe(2);
  });
});

describe('tx cancel-all command', () => {
  test('successfully cancels all pending transactions', async () => {
    const mockDeps = createMockDeps();

    await runSubCommand(mockDeps, 'cancel-all', {
      relayer: 'test-relayer',
      json: true,
      'no-input': true,
      verbose: false,
    });

    const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
    expect(mockClient.relayers.deletePendingTransactions).toHaveBeenCalledWith('test-relayer');
    expect(consoleOutput.some((line) => line.includes('cancelled'))).toBe(true);
  });

  test('cancels all with non-JSON output', async () => {
    const mockDeps = createMockDeps();

    await runSubCommand(mockDeps, 'cancel-all', {
      relayer: 'test-relayer',
      json: false,
      'no-input': true,
      verbose: false,
    });

    const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
    expect(mockClient.relayers.deletePendingTransactions).toHaveBeenCalled();
    expect(consoleOutput.some((line) => line.includes('All pending transactions cancelled'))).toBe(
      true,
    );
  });

  test('requires confirmation on protected profile', async () => {
    const confirmMock = mock(async () => true);
    const mockDeps = createMockDeps(
      {},
      { isProtected: true, profileName: 'mainnet' },
      { confirmProtectedOperation: confirmMock as TxDeps['confirmProtectedOperation'] },
    );

    await runSubCommand(mockDeps, 'cancel-all', {
      relayer: 'test-relayer',
      json: true,
      'no-input': false,
      verbose: false,
    });

    expect(confirmMock).toHaveBeenCalledWith({
      profileName: 'mainnet',
      operation: 'cancel all pending transactions',
      noInput: false,
    });
    const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
    expect(mockClient.relayers.deletePendingTransactions).toHaveBeenCalled();
  });

  test('aborts when protected profile confirmation denied', async () => {
    const mockDeps = createMockDeps(
      {},
      { isProtected: true, profileName: 'mainnet' },
      { confirmProtectedOperation: mock(async () => false) as TxDeps['confirmProtectedOperation'] },
    );

    await expect(
      runSubCommand(mockDeps, 'cancel-all', {
        relayer: 'test-relayer',
        json: false,
        'no-input': false,
        verbose: false,
      }),
    ).rejects.toThrow('process.exit(0)');

    expect(exitCode).toBe(0);
    expect(consoleOutput.some((line) => line.includes('Operation cancelled'))).toBe(true);
    // createClient is never called since command exits early
    expect(mockDeps.createClient).not.toHaveBeenCalled();
  });

  test('prompts for confirmation when not protected and not no-input', async () => {
    const promptConfirmMock = mock(async () => true);
    const closePromptsMock = mock(() => {});
    const mockDeps = createMockDeps(
      {},
      {},
      {
        promptConfirm: promptConfirmMock as TxDeps['promptConfirm'],
        closePrompts: closePromptsMock as TxDeps['closePrompts'],
      },
    );

    await runSubCommand(mockDeps, 'cancel-all', {
      relayer: 'test-relayer',
      json: false,
      'no-input': false,
      verbose: false,
    });

    expect(promptConfirmMock).toHaveBeenCalled();
    expect(closePromptsMock).toHaveBeenCalled();
    const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
    expect(mockClient.relayers.deletePendingTransactions).toHaveBeenCalled();
  });

  test('aborts when user declines confirmation', async () => {
    const promptConfirmMock = mock(async () => false);
    const closePromptsMock = mock(() => {});
    const mockDeps = createMockDeps(
      {},
      {},
      {
        promptConfirm: promptConfirmMock as TxDeps['promptConfirm'],
        closePrompts: closePromptsMock as TxDeps['closePrompts'],
      },
    );

    await runSubCommand(mockDeps, 'cancel-all', {
      relayer: 'test-relayer',
      json: false,
      'no-input': false,
      verbose: false,
    });

    expect(promptConfirmMock).toHaveBeenCalled();
    expect(closePromptsMock).toHaveBeenCalled();
    expect(consoleOutput.some((line) => line.includes('Cancellation aborted'))).toBe(true);
    const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
    expect(mockClient.relayers.deletePendingTransactions).not.toHaveBeenCalled();
  });

  test('exits with error when no relayer ID provided', async () => {
    const mockDeps = createMockDeps({}, { noDefaultRelayer: true });

    await expect(
      runSubCommand(mockDeps, 'cancel-all', {
        json: false,
        'no-input': true,
        verbose: false,
      }),
    ).rejects.toThrow('process.exit(2)');

    expect(exitCode).toBe(2);
  });
});

describe('tx command structure', () => {
  test('has all expected subcommands', () => {
    const mockDeps = createMockDeps();
    const txCommand = createTxCommand(mockDeps);

    expect(txCommand.subCommands).toBeDefined();
    expect((txCommand.subCommands as any)?.send).toBeDefined();
    expect((txCommand.subCommands as any)?.status).toBeDefined();
    expect((txCommand.subCommands as any)?.list).toBeDefined();
    expect((txCommand.subCommands as any)?.show).toBeDefined();
    expect((txCommand.subCommands as any)?.cancel).toBeDefined();
    expect((txCommand.subCommands as any)?.['cancel-all']).toBeDefined();
  });

  test('has correct metadata', () => {
    const mockDeps = createMockDeps();
    const txCommand = createTxCommand(mockDeps);

    expect((txCommand.meta as any)?.name).toBe('tx');
    expect((txCommand.meta as any)?.description).toBe('Transaction operations');
  });
});
