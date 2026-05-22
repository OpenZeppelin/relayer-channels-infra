import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { type FeeDeps, createFeeCommand } from './fee.js';

// Store original functions
const originalExit = process.exit;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

let exitCode: number | null = null;
let consoleOutput: string[] = [];
let consoleErrors: string[] = [];

function createMockConfig(options?: {
  adminSecret?: string | null;
  isProtected?: boolean;
  profileName?: string;
}) {
  return {
    url: 'https://channels.example.com',
    apiKey: 'test-api-key',
    pluginId: 'test-plugin',
    adminSecret: options?.adminSecret === undefined ? 'test-admin-secret' : options.adminSecret,
    isProtected: options?.isProtected ?? false,
    profileName: options?.profileName ?? 'default',
  };
}

function createMockClient(options?: {
  usageError?: Error;
  usageData?: {
    consumed: number;
    limit: number | null;
    remaining: number | null;
    periodStartAt: string | null;
    periodEndsAt: string | null;
  };
  limitError?: Error;
  limitData?: { limit: number | null };
  setLimitError?: Error;
  setLimitData?: { ok: boolean; limit: number };
  deleteLimitError?: Error;
  deleteLimitData?: { ok: boolean };
}) {
  const defaultUsageData = {
    consumed: 50000,
    limit: 100000,
    remaining: 50000,
    periodStartAt: '2024-01-01T00:00:00Z',
    periodEndsAt: '2024-02-01T00:00:00Z',
  };

  return {
    getFeeUsage: mock(async (_apiKey: string) => {
      if (options?.usageError) throw options.usageError;
      return options?.usageData ?? defaultUsageData;
    }),
    getFeeLimit: mock(async (_apiKey: string) => {
      if (options?.limitError) throw options.limitError;
      return options?.limitData ?? { limit: 100000 };
    }),
    setFeeLimit: mock(async (_apiKey: string, limit: number) => {
      if (options?.setLimitError) throw options.setLimitError;
      return options?.setLimitData ?? { ok: true, limit };
    }),
    deleteFeeLimit: mock(async (_apiKey: string) => {
      if (options?.deleteLimitError) throw options.deleteLimitError;
      return options?.deleteLimitData ?? { ok: true };
    }),
  };
}

/**
 * Helper to find and parse JSON output from console output.
 */
function findJsonOutput(): unknown {
  const jsonLine = consoleOutput.find((line) => {
    try {
      JSON.parse(line);
      return true;
    } catch {
      return false;
    }
  });
  if (!jsonLine) {
    throw new Error('No JSON output found in console output');
  }
  return JSON.parse(jsonLine);
}

/**
 * Create mock deps for testing with optional overrides.
 */
function createMockDeps(
  configOptions?: Parameters<typeof createMockConfig>[0] | null,
  clientOptions?: Parameters<typeof createMockClient>[0],
  overrides?: Partial<FeeDeps>,
): FeeDeps {
  const mockConfig = configOptions === null ? null : createMockConfig(configOptions);
  const mockClient = createMockClient(clientOptions);

  return {
    resolveConfig: mock(() => mockConfig) as unknown as FeeDeps['resolveConfig'],
    createClient: mock(() => mockClient) as unknown as FeeDeps['createClient'],
    output: mock((data: unknown, opts?: { json?: boolean }) => {
      if (opts?.json) {
        consoleOutput.push(JSON.stringify(data, null, 2));
      }
    }) as FeeDeps['output'],
    success: mock((msg: string) => {
      consoleOutput.push(`Success: ${msg}`);
    }) as FeeDeps['success'],
    handleApiError: mock((err: unknown) => {
      const error = err as Error & { response?: { status?: number } };
      const status = error.response?.status;

      let code = 1; // GeneralError
      if (status === 401 || status === 403) {
        code = 3; // AuthenticationFailure
      } else if (status === 404) {
        code = 4; // ResourceNotFound
      }

      consoleErrors.push(`Error: ${error.message}`);
      process.exit(code);
    }) as FeeDeps['handleApiError'],
    exitWithUsageError: mock((msg: string) => {
      consoleErrors.push(`Error: ${msg}`);
      process.exit(2);
    }) as FeeDeps['exitWithUsageError'],
    confirmProtectedOperation: mock(async () => true) as FeeDeps['confirmProtectedOperation'],
    ...overrides,
  };
}

describe('fee command', () => {
  beforeEach(() => {
    exitCode = null;
    consoleOutput = [];
    consoleErrors = [];

    // Mock process.exit
    process.exit = mock((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    // Mock console.log
    console.log = mock((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });

    // Mock console.error
    console.error = mock((...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    process.exit = originalExit;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe('usage subcommand', () => {
    test('displays usage data successfully', async () => {
      const mockDeps = createMockDeps();
      const feeCommand = createFeeCommand(mockDeps);
      const usageCmd = (feeCommand.subCommands as any)?.usage;

      await usageCmd?.run?.({
        args: {
          'target-api-key': 'target-key-12345678',
          json: false,
        },
        rawArgs: [],
        cmd: usageCmd!,
      });

      const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
      expect(mockClient.getFeeUsage).toHaveBeenCalledWith('target-key-12345678');
      expect(consoleOutput.some((line) => line.includes('target-k'))).toBe(true);
      expect(consoleOutput.some((line) => line.includes('Consumed'))).toBe(true);
      expect(consoleOutput.some((line) => line.includes('Limit'))).toBe(true);
    });

    test('outputs JSON format when --json flag is set', async () => {
      const usageData = {
        consumed: 75000,
        limit: 200000,
        remaining: 125000,
        periodStartAt: '2024-01-15T00:00:00Z',
        periodEndsAt: '2024-02-15T00:00:00Z',
      };
      const mockDeps = createMockDeps(undefined, { usageData });
      const feeCommand = createFeeCommand(mockDeps);
      const usageCmd = (feeCommand.subCommands as any)?.usage;

      await usageCmd?.run?.({
        args: {
          'target-api-key': 'target-key-abc',
          json: true,
        },
        rawArgs: [],
        cmd: usageCmd!,
      });

      const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
      expect(mockClient.getFeeUsage).toHaveBeenCalledWith('target-key-abc');

      const parsed = findJsonOutput() as typeof usageData;
      expect(parsed.consumed).toBe(75000);
      expect(parsed.limit).toBe(200000);
      expect(parsed.remaining).toBe(125000);
    });

    test('requires admin secret', async () => {
      const mockDeps = createMockDeps({ adminSecret: null });
      const feeCommand = createFeeCommand(mockDeps);
      const usageCmd = (feeCommand.subCommands as any)?.usage;

      await expect(
        usageCmd?.run?.({
          args: {
            'target-api-key': 'target-key-abc',
            json: false,
          },
          rawArgs: [],
          cmd: usageCmd!,
        }),
      ).rejects.toThrow('process.exit(2)');

      expect(exitCode).toBe(2);
      expect(consoleErrors.some((line) => line.includes('Admin secret is required'))).toBe(true);
    });

    test('exits with error when no config found', async () => {
      const mockDeps = createMockDeps(null);
      const feeCommand = createFeeCommand(mockDeps);
      const usageCmd = (feeCommand.subCommands as any)?.usage;

      await expect(
        usageCmd?.run?.({
          args: {
            'target-api-key': 'target-key-abc',
            json: false,
          },
          rawArgs: [],
          cmd: usageCmd!,
        }),
      ).rejects.toThrow('process.exit(2)');

      expect(exitCode).toBe(2);
      expect(consoleErrors.some((line) => line.includes('No configuration found'))).toBe(true);
    });

    test('handles API errors', async () => {
      const mockDeps = createMockDeps(undefined, {
        usageError: new Error('API unavailable'),
      });
      const feeCommand = createFeeCommand(mockDeps);
      const usageCmd = (feeCommand.subCommands as any)?.usage;

      await expect(
        usageCmd?.run?.({
          args: {
            'target-api-key': 'target-key-abc',
            json: false,
          },
          rawArgs: [],
          cmd: usageCmd!,
        }),
      ).rejects.toThrow('process.exit');

      expect(exitCode).toBeDefined();
    });
  });

  describe('limit subcommand', () => {
    test('displays limit data successfully', async () => {
      const mockDeps = createMockDeps(undefined, { limitData: { limit: 500000 } });
      const feeCommand = createFeeCommand(mockDeps);
      const limitCmd = (feeCommand.subCommands as any)?.limit;

      await limitCmd?.run?.({
        args: {
          'target-api-key': 'target-key-xyz',
          json: false,
        },
        rawArgs: [],
        cmd: limitCmd!,
      });

      const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
      expect(mockClient.getFeeLimit).toHaveBeenCalledWith('target-key-xyz');
      expect(consoleOutput.some((line) => line.includes('target-k'))).toBe(true);
      expect(consoleOutput.some((line) => line.includes('Limit'))).toBe(true);
    });

    test('displays unlimited when limit is null', async () => {
      const mockDeps = createMockDeps(undefined, { limitData: { limit: null } });
      const feeCommand = createFeeCommand(mockDeps);
      const limitCmd = (feeCommand.subCommands as any)?.limit;

      await limitCmd?.run?.({
        args: {
          'target-api-key': 'target-key-xyz',
          json: false,
        },
        rawArgs: [],
        cmd: limitCmd!,
      });

      const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
      expect(mockClient.getFeeLimit).toHaveBeenCalledWith('target-key-xyz');
      expect(consoleOutput.some((line) => line.includes('unlimited'))).toBe(true);
    });

    test('outputs JSON format when --json flag is set', async () => {
      const mockDeps = createMockDeps(undefined, { limitData: { limit: 300000 } });
      const feeCommand = createFeeCommand(mockDeps);
      const limitCmd = (feeCommand.subCommands as any)?.limit;

      await limitCmd?.run?.({
        args: {
          'target-api-key': 'target-key-xyz',
          json: true,
        },
        rawArgs: [],
        cmd: limitCmd!,
      });

      const parsed = findJsonOutput() as { limit: number };
      expect(parsed.limit).toBe(300000);
    });

    test('outputs null limit in JSON for unlimited', async () => {
      const mockDeps = createMockDeps(undefined, { limitData: { limit: null } });
      const feeCommand = createFeeCommand(mockDeps);
      const limitCmd = (feeCommand.subCommands as any)?.limit;

      await limitCmd?.run?.({
        args: {
          'target-api-key': 'target-key-xyz',
          json: true,
        },
        rawArgs: [],
        cmd: limitCmd!,
      });

      const parsed = findJsonOutput() as { limit: null };
      expect(parsed.limit).toBeNull();
    });

    test('requires admin secret', async () => {
      const mockDeps = createMockDeps({ adminSecret: null });
      const feeCommand = createFeeCommand(mockDeps);
      const limitCmd = (feeCommand.subCommands as any)?.limit;

      await expect(
        limitCmd?.run?.({
          args: {
            'target-api-key': 'target-key-abc',
            json: false,
          },
          rawArgs: [],
          cmd: limitCmd!,
        }),
      ).rejects.toThrow('process.exit(2)');

      expect(exitCode).toBe(2);
      expect(consoleErrors.some((line) => line.includes('Admin secret is required'))).toBe(true);
    });
  });

  describe('set-limit subcommand', () => {
    test('sets limit successfully', async () => {
      const mockDeps = createMockDeps();
      const feeCommand = createFeeCommand(mockDeps);
      const setLimitCmd = (feeCommand.subCommands as any)?.['set-limit'];

      await setLimitCmd?.run?.({
        args: {
          'target-api-key': 'target-key-abc',
          limit: '250000',
          json: false,
          'no-input': true,
        },
        rawArgs: [],
        cmd: setLimitCmd!,
      });

      const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
      expect(mockClient.setFeeLimit).toHaveBeenCalledWith('target-key-abc', 250000);
      expect(consoleOutput.some((line) => line.includes('Fee limit set'))).toBe(true);
    });

    test('outputs JSON format when --json flag is set', async () => {
      const mockDeps = createMockDeps(undefined, { setLimitData: { ok: true, limit: 150000 } });
      const feeCommand = createFeeCommand(mockDeps);
      const setLimitCmd = (feeCommand.subCommands as any)?.['set-limit'];

      await setLimitCmd?.run?.({
        args: {
          'target-api-key': 'target-key-abc',
          limit: '150000',
          json: true,
          'no-input': true,
        },
        rawArgs: [],
        cmd: setLimitCmd!,
      });

      const parsed = findJsonOutput() as { ok: boolean; limit: number };
      expect(parsed.ok).toBe(true);
      expect(parsed.limit).toBe(150000);
    });

    test('rejects negative limit', async () => {
      const mockDeps = createMockDeps();
      const feeCommand = createFeeCommand(mockDeps);
      const setLimitCmd = (feeCommand.subCommands as any)?.['set-limit'];

      await expect(
        setLimitCmd?.run?.({
          args: {
            'target-api-key': 'target-key-abc',
            limit: '-100',
            json: false,
            'no-input': true,
          },
          rawArgs: [],
          cmd: setLimitCmd!,
        }),
      ).rejects.toThrow('process.exit(2)');

      expect(exitCode).toBe(2);
      expect(consoleErrors.some((line) => line.includes('non-negative'))).toBe(true);
    });

    test('rejects invalid limit value', async () => {
      const mockDeps = createMockDeps();
      const feeCommand = createFeeCommand(mockDeps);
      const setLimitCmd = (feeCommand.subCommands as any)?.['set-limit'];

      await expect(
        setLimitCmd?.run?.({
          args: {
            'target-api-key': 'target-key-abc',
            limit: 'not-a-number',
            json: false,
            'no-input': true,
          },
          rawArgs: [],
          cmd: setLimitCmd!,
        }),
      ).rejects.toThrow('process.exit(2)');

      expect(exitCode).toBe(2);
    });

    test('allows zero limit (blocks all transactions)', async () => {
      const mockDeps = createMockDeps(undefined, { setLimitData: { ok: true, limit: 0 } });
      const feeCommand = createFeeCommand(mockDeps);
      const setLimitCmd = (feeCommand.subCommands as any)?.['set-limit'];

      await setLimitCmd?.run?.({
        args: {
          'target-api-key': 'target-key-abc',
          limit: '0',
          json: false,
          'no-input': true,
        },
        rawArgs: [],
        cmd: setLimitCmd!,
      });

      const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
      expect(mockClient.setFeeLimit).toHaveBeenCalledWith('target-key-abc', 0);
    });

    test('prompts for confirmation on protected profile', async () => {
      const mockConfirmProtected = mock(async () => true);
      const mockDeps = createMockDeps({ isProtected: true, profileName: 'mainnet' }, undefined, {
        confirmProtectedOperation: mockConfirmProtected as FeeDeps['confirmProtectedOperation'],
      });
      const feeCommand = createFeeCommand(mockDeps);
      const setLimitCmd = (feeCommand.subCommands as any)?.['set-limit'];

      await setLimitCmd?.run?.({
        args: {
          'target-api-key': 'target-key-abc',
          limit: '100000',
          json: false,
          'no-input': false,
        },
        rawArgs: [],
        cmd: setLimitCmd!,
      });

      expect(mockConfirmProtected).toHaveBeenCalled();
      const callArgs = (mockConfirmProtected.mock.calls[0] as any)?.[0] as {
        profileName: string;
        operation: string;
        summary: string;
        noInput: boolean;
      };
      expect(callArgs.profileName).toBe('mainnet');
      expect(callArgs.operation).toBe('set fee limit');
      expect(callArgs.summary).toContain('target-k');
      expect(callArgs.noInput).toBe(false);

      const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
      expect(mockClient.setFeeLimit).toHaveBeenCalled();
    });

    test('cancels operation when confirmation denied on protected profile', async () => {
      const mockDeps = createMockDeps({ isProtected: true, profileName: 'mainnet' }, undefined, {
        confirmProtectedOperation: mock(async () => false) as FeeDeps['confirmProtectedOperation'],
      });
      const feeCommand = createFeeCommand(mockDeps);
      const setLimitCmd = (feeCommand.subCommands as any)?.['set-limit'];

      await expect(
        setLimitCmd?.run?.({
          args: {
            'target-api-key': 'target-key-abc',
            limit: '100000',
            json: false,
            'no-input': false,
          },
          rawArgs: [],
          cmd: setLimitCmd!,
        }),
      ).rejects.toThrow('process.exit(0)');

      expect(exitCode).toBe(0);
      expect(consoleOutput.some((line) => line.includes('cancelled'))).toBe(true);
      // createClient is never called when confirmation is denied (process.exit happens first)
      expect(mockDeps.createClient).not.toHaveBeenCalled();
    });

    test('requires admin secret', async () => {
      const mockDeps = createMockDeps({ adminSecret: null });
      const feeCommand = createFeeCommand(mockDeps);
      const setLimitCmd = (feeCommand.subCommands as any)?.['set-limit'];

      await expect(
        setLimitCmd?.run?.({
          args: {
            'target-api-key': 'target-key-abc',
            limit: '100000',
            json: false,
            'no-input': true,
          },
          rawArgs: [],
          cmd: setLimitCmd!,
        }),
      ).rejects.toThrow('process.exit(2)');

      expect(exitCode).toBe(2);
      expect(consoleErrors.some((line) => line.includes('Admin secret is required'))).toBe(true);
    });

    test('handles API errors', async () => {
      const mockDeps = createMockDeps(undefined, {
        setLimitError: new Error('API error'),
      });
      const feeCommand = createFeeCommand(mockDeps);
      const setLimitCmd = (feeCommand.subCommands as any)?.['set-limit'];

      await expect(
        setLimitCmd?.run?.({
          args: {
            'target-api-key': 'target-key-abc',
            limit: '100000',
            json: false,
            'no-input': true,
          },
          rawArgs: [],
          cmd: setLimitCmd!,
        }),
      ).rejects.toThrow('process.exit');

      expect(exitCode).toBeDefined();
    });
  });

  describe('delete-limit subcommand', () => {
    test('deletes limit successfully', async () => {
      const mockDeps = createMockDeps();
      const feeCommand = createFeeCommand(mockDeps);
      const deleteLimitCmd = (feeCommand.subCommands as any)?.['delete-limit'];

      await deleteLimitCmd?.run?.({
        args: {
          'target-api-key': 'target-key-abc',
          json: false,
          'no-input': true,
        },
        rawArgs: [],
        cmd: deleteLimitCmd!,
      });

      const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
      expect(mockClient.deleteFeeLimit).toHaveBeenCalledWith('target-key-abc');
      expect(consoleOutput.some((line) => line.includes('removed'))).toBe(true);
    });

    test('outputs JSON format when --json flag is set', async () => {
      const mockDeps = createMockDeps(undefined, { deleteLimitData: { ok: true } });
      const feeCommand = createFeeCommand(mockDeps);
      const deleteLimitCmd = (feeCommand.subCommands as any)?.['delete-limit'];

      await deleteLimitCmd?.run?.({
        args: {
          'target-api-key': 'target-key-abc',
          json: true,
          'no-input': true,
        },
        rawArgs: [],
        cmd: deleteLimitCmd!,
      });

      const parsed = findJsonOutput() as { ok: boolean };
      expect(parsed.ok).toBe(true);
    });

    test('prompts for confirmation on protected profile', async () => {
      const mockConfirmProtected = mock(async () => true);
      const mockDeps = createMockDeps({ isProtected: true, profileName: 'mainnet' }, undefined, {
        confirmProtectedOperation: mockConfirmProtected as FeeDeps['confirmProtectedOperation'],
      });
      const feeCommand = createFeeCommand(mockDeps);
      const deleteLimitCmd = (feeCommand.subCommands as any)?.['delete-limit'];

      await deleteLimitCmd?.run?.({
        args: {
          'target-api-key': 'target-key-def',
          json: false,
          'no-input': false,
        },
        rawArgs: [],
        cmd: deleteLimitCmd!,
      });

      expect(mockConfirmProtected).toHaveBeenCalled();
      const callArgs = (mockConfirmProtected.mock.calls[0] as any)?.[0] as {
        profileName: string;
        operation: string;
        summary: string;
        noInput: boolean;
      };
      expect(callArgs.profileName).toBe('mainnet');
      expect(callArgs.operation).toBe('delete fee limit');
      expect(callArgs.summary).toContain('target-k');
      expect(callArgs.noInput).toBe(false);

      const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
      expect(mockClient.deleteFeeLimit).toHaveBeenCalled();
    });

    test('cancels operation when confirmation denied on protected profile', async () => {
      const mockDeps = createMockDeps({ isProtected: true, profileName: 'mainnet' }, undefined, {
        confirmProtectedOperation: mock(async () => false) as FeeDeps['confirmProtectedOperation'],
      });
      const feeCommand = createFeeCommand(mockDeps);
      const deleteLimitCmd = (feeCommand.subCommands as any)?.['delete-limit'];

      await expect(
        deleteLimitCmd?.run?.({
          args: {
            'target-api-key': 'target-key-def',
            json: false,
            'no-input': false,
          },
          rawArgs: [],
          cmd: deleteLimitCmd!,
        }),
      ).rejects.toThrow('process.exit(0)');

      expect(exitCode).toBe(0);
      expect(consoleOutput.some((line) => line.includes('cancelled'))).toBe(true);
      // createClient is never called when confirmation is denied (process.exit happens first)
      expect(mockDeps.createClient).not.toHaveBeenCalled();
    });

    test('requires admin secret', async () => {
      const mockDeps = createMockDeps({ adminSecret: null });
      const feeCommand = createFeeCommand(mockDeps);
      const deleteLimitCmd = (feeCommand.subCommands as any)?.['delete-limit'];

      await expect(
        deleteLimitCmd?.run?.({
          args: {
            'target-api-key': 'target-key-abc',
            json: false,
            'no-input': true,
          },
          rawArgs: [],
          cmd: deleteLimitCmd!,
        }),
      ).rejects.toThrow('process.exit(2)');

      expect(exitCode).toBe(2);
      expect(consoleErrors.some((line) => line.includes('Admin secret is required'))).toBe(true);
    });

    test('handles API errors', async () => {
      const mockDeps = createMockDeps(undefined, {
        deleteLimitError: new Error('Server error'),
      });
      const feeCommand = createFeeCommand(mockDeps);
      const deleteLimitCmd = (feeCommand.subCommands as any)?.['delete-limit'];

      await expect(
        deleteLimitCmd?.run?.({
          args: {
            'target-api-key': 'target-key-abc',
            json: false,
            'no-input': true,
          },
          rawArgs: [],
          cmd: deleteLimitCmd!,
        }),
      ).rejects.toThrow('process.exit');

      expect(exitCode).toBeDefined();
    });
  });

  describe('command structure', () => {
    test('has all expected subcommands', () => {
      const mockDeps = createMockDeps();
      const feeCommand = createFeeCommand(mockDeps);

      expect(feeCommand.subCommands).toBeDefined();
      expect((feeCommand.subCommands as any)?.usage).toBeDefined();
      expect((feeCommand.subCommands as any)?.limit).toBeDefined();
      expect((feeCommand.subCommands as any)?.['set-limit']).toBeDefined();
      expect((feeCommand.subCommands as any)?.['delete-limit']).toBeDefined();
    });

    test('has correct metadata', () => {
      const mockDeps = createMockDeps();
      const feeCommand = createFeeCommand(mockDeps);

      expect((feeCommand.meta as any)?.name).toBe('fee');
      expect((feeCommand.meta as any)?.description).toContain('fee');
    });
  });
});
