import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createSubmitCommand, type SubmitDeps } from './submit.js';

// Store original functions
const originalExit = process.exit;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalStdoutWrite = process.stdout.write;

let exitCode: number | null = null;
let consoleOutput: string[] = [];
let consoleErrors: string[] = [];
let stdoutOutput: string[] = [];

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
  submitXdrError?: Error;
  submitXdrData?: { transactionId?: string; hash?: string; status?: string };
  submitFuncAuthError?: Error;
  submitFuncAuthData?: { transactionId?: string; hash?: string; status?: string };
}) {
  const defaultXdrData = {
    transactionId: 'tx-123',
    hash: 'abc123def456',
    status: 'submitted',
  };

  const defaultFuncAuthData = {
    transactionId: 'tx-456',
    hash: 'def789ghi012',
    status: 'submitted',
  };

  return {
    submitXdr: mock(async (payload: { xdr: string }) => {
      if (options?.submitXdrError) throw options.submitXdrError;
      return options?.submitXdrData ?? defaultXdrData;
    }),
    submitFuncAuth: mock(async (payload: { func: string; auth: string[] }) => {
      if (options?.submitFuncAuthError) throw options.submitFuncAuthError;
      return options?.submitFuncAuthData ?? defaultFuncAuthData;
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
  overrides?: Partial<SubmitDeps> & { promptResults?: string[] },
): SubmitDeps & { _promptResults: string[]; _promptCalls: Array<{ message: string; defaultValue?: string }> } {
  const mockConfig = configOptions === null ? null : createMockConfig(configOptions);
  const mockClient = createMockClient(clientOptions);
  const promptResults = overrides?.promptResults ?? [];
  const promptCalls: Array<{ message: string; defaultValue?: string }> = [];

  return {
    resolveConfig: mock(() => mockConfig) as unknown as SubmitDeps['resolveConfig'],
    createClient: mock(() => mockClient) as unknown as SubmitDeps['createClient'],
    output: mock((data: unknown, opts?: { json?: boolean }) => {
      if (opts?.json) {
        consoleOutput.push(JSON.stringify(data, null, 2));
      }
    }) as SubmitDeps['output'],
    success: mock((msg: string) => {
      consoleOutput.push(`Success: ${msg}`);
    }) as SubmitDeps['success'],
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
    }) as SubmitDeps['handleApiError'],
    exitWithUsageError: mock((msg: string) => {
      consoleErrors.push(`Error: ${msg}`);
      process.exit(2);
    }) as SubmitDeps['exitWithUsageError'],
    prompt: mock(async (message: string, defaultValue?: string) => {
      promptCalls.push({ message, defaultValue });
      return promptResults.shift() ?? '';
    }) as SubmitDeps['prompt'],
    closePrompts: mock(() => {}) as SubmitDeps['closePrompts'],
    ...overrides,
    _promptResults: promptResults,
    _promptCalls: promptCalls,
  };
}

describe('submit command', () => {
  beforeEach(() => {
    exitCode = null;
    consoleOutput = [];
    consoleErrors = [];
    stdoutOutput = [];

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

    // Mock stdout.write
    process.stdout.write = mock((chunk: string | Uint8Array) => {
      stdoutOutput.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.exit = originalExit;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.stdout.write = originalStdoutWrite;
  });

  describe('command metadata', () => {
    test('has correct name and description', () => {
      const mockDeps = createMockDeps();
      const submitCommand = createSubmitCommand(mockDeps);

      expect((submitCommand.meta as any)?.name).toBe('submit');
      expect((submitCommand.meta as any)?.description).toBe('Submit transactions to the channels service');
    });

    test('has xdr and func-auth subcommands', () => {
      const mockDeps = createMockDeps();
      const submitCommand = createSubmitCommand(mockDeps);

      expect(submitCommand.subCommands).toBeDefined();
      expect((submitCommand.subCommands as any)?.xdr).toBeDefined();
      expect((submitCommand.subCommands as any)?.['func-auth']).toBeDefined();
    });
  });

  describe('xdr subcommand', () => {
    describe('success cases', () => {
      test('submits valid XDR and outputs text format', async () => {
        const mockDeps = createMockDeps();
        const submitCommand = createSubmitCommand(mockDeps);
        const xdrCommand = (submitCommand.subCommands as any)?.xdr;

        // Valid base64 XDR
        const validXdr = 'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQQ==';

        await xdrCommand!.run!({
          args: { xdr: validXdr, json: false, wait: false },
        } as never);

        const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
        expect(mockClient.submitXdr).toHaveBeenCalledWith({ xdr: validXdr });
        expect(consoleOutput.some((line) => line.includes('Transaction submitted: tx-123'))).toBe(true);
        expect(consoleOutput.some((line) => line.includes('Hash:'))).toBe(true);
        expect(consoleOutput.some((line) => line.includes('Status:'))).toBe(true);
      });

      test('submits valid XDR and outputs JSON format', async () => {
        const mockDeps = createMockDeps();
        const submitCommand = createSubmitCommand(mockDeps);
        const xdrCommand = (submitCommand.subCommands as any)?.xdr;

        const validXdr = 'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQQ==';

        await xdrCommand!.run!({
          args: { xdr: validXdr, json: true, wait: false },
        } as never);

        const parsed = findJsonOutput() as { transactionId: string; hash: string; status: string };
        expect(parsed.transactionId).toBe('tx-123');
        expect(parsed.hash).toBe('abc123def456');
        expect(parsed.status).toBe('submitted');

        // Should NOT output text success message in JSON mode
        expect(consoleOutput.filter((line) => line.startsWith('Success:')).length).toBe(0);
      });

      test('submits XDR without response fields gracefully', async () => {
        const mockDeps = createMockDeps(undefined, { submitXdrData: {} });
        const submitCommand = createSubmitCommand(mockDeps);
        const xdrCommand = (submitCommand.subCommands as any)?.xdr;

        const validXdr = 'QUFBQQ==';

        // Should not throw
        await xdrCommand!.run!({
          args: { xdr: validXdr, json: false, wait: false },
        } as never);

        // Should not call success when no transactionId
        expect(consoleOutput.filter((line) => line.startsWith('Success:')).length).toBe(0);
      });

      test('handles --wait flag', async () => {
        const mockDeps = createMockDeps();
        const submitCommand = createSubmitCommand(mockDeps);
        const xdrCommand = (submitCommand.subCommands as any)?.xdr;

        const validXdr = 'QUFBQQ==';

        await xdrCommand!.run!({
          args: { xdr: validXdr, json: false, wait: true, timeout: '120' },
        } as never);

        // Should show waiting message
        expect(stdoutOutput.some((line) => line.includes('Waiting for confirmation'))).toBe(true);
        expect(consoleOutput.some((line) => line.includes('polling not yet supported'))).toBe(true);
      });
    });

    describe('invalid XDR cases', () => {
      test('exits with error for non-base64 XDR', async () => {
        const mockDeps = createMockDeps();
        const submitCommand = createSubmitCommand(mockDeps);
        const xdrCommand = (submitCommand.subCommands as any)?.xdr;

        const invalidXdr = 'not-valid-base64!@#$%';

        await expect(
          xdrCommand!.run!({
            args: { xdr: invalidXdr, json: false, wait: false },
          } as never),
        ).rejects.toThrow('process.exit(2)');

        expect(exitCode).toBe(2);
        expect(consoleErrors.some((line) => line.includes('Invalid XDR: must be base64 encoded'))).toBe(true);

        const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
        expect(mockClient.submitXdr).not.toHaveBeenCalled();
      });

      test('exits with error for XDR with spaces', async () => {
        const mockDeps = createMockDeps();
        const submitCommand = createSubmitCommand(mockDeps);
        const xdrCommand = (submitCommand.subCommands as any)?.xdr;

        const invalidXdr = 'QUFBQQ== QUFBQQ==';

        await expect(
          xdrCommand!.run!({
            args: { xdr: invalidXdr, json: false, wait: false },
          } as never),
        ).rejects.toThrow('process.exit(2)');

        expect(exitCode).toBe(2);
        expect(consoleErrors.some((line) => line.includes('Invalid XDR: must be base64 encoded'))).toBe(true);
      });
    });

    describe('missing XDR cases', () => {
      test('exits with error when XDR is not provided', async () => {
        const mockDeps = createMockDeps();
        const submitCommand = createSubmitCommand(mockDeps);
        const xdrCommand = (submitCommand.subCommands as any)?.xdr;

        await expect(
          xdrCommand!.run!({
            args: { json: false, wait: false },
          } as never),
        ).rejects.toThrow('process.exit(2)');

        expect(exitCode).toBe(2);
        expect(
          consoleErrors.some((line) =>
            line.includes('XDR is required. Provide as argument, --file, or "-" for stdin.'),
          ),
        ).toBe(true);
      });
    });

    describe('no config found', () => {
      test('calls exitWithUsageError when config is null', async () => {
        const mockDeps = createMockDeps(null);
        const submitCommand = createSubmitCommand(mockDeps);
        const xdrCommand = (submitCommand.subCommands as any)?.xdr;

        await expect(
          xdrCommand!.run!({
            args: { xdr: 'QUFBQQ==', json: false, wait: false },
          } as never),
        ).rejects.toThrow('process.exit(2)');

        expect(exitCode).toBe(2);
        expect(consoleErrors.some((line) => line.includes('No configuration found'))).toBe(true);
      });
    });

    describe('API error handling', () => {
      test('calls handleApiError on submit failure', async () => {
        const error = new Error('Network error');
        const mockDeps = createMockDeps(undefined, { submitXdrError: error });
        const submitCommand = createSubmitCommand(mockDeps);
        const xdrCommand = (submitCommand.subCommands as any)?.xdr;

        await expect(
          xdrCommand!.run!({
            args: { xdr: 'QUFBQQ==', json: false, wait: false },
          } as never),
        ).rejects.toThrow('process.exit');

        expect(consoleErrors.some((line) => line.includes('Network error'))).toBe(true);
      });
    });
  });

  describe('func-auth subcommand', () => {
    describe('success cases', () => {
      test('submits with func and auth entries and outputs text format', async () => {
        const mockDeps = createMockDeps();
        const submitCommand = createSubmitCommand(mockDeps);
        const funcAuthCommand = (submitCommand.subCommands as any)?.['func-auth'];

        const func = 'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQQ==';
        const auth = 'QkJCQkJCQkI=,Q0NDQ0NDQ0M=';

        await funcAuthCommand!.run!({
          args: { func, auth, json: false, wait: false, 'no-input': true },
        } as never);

        const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
        expect(mockClient.submitFuncAuth).toHaveBeenCalledWith({
          func,
          auth: ['QkJCQkJCQkI=', 'Q0NDQ0NDQ0M='],
        });
        expect(consoleOutput.some((line) => line.includes('Transaction submitted: tx-456'))).toBe(true);
        expect(consoleOutput.some((line) => line.includes('Hash:'))).toBe(true);
        expect(consoleOutput.some((line) => line.includes('Status:'))).toBe(true);
      });

      test('submits with func only (no auth entries)', async () => {
        const mockDeps = createMockDeps();
        const submitCommand = createSubmitCommand(mockDeps);
        const funcAuthCommand = (submitCommand.subCommands as any)?.['func-auth'];

        const func = 'QUFBQQ==';

        await funcAuthCommand!.run!({
          args: { func, json: false, wait: false, 'no-input': true },
        } as never);

        const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
        expect(mockClient.submitFuncAuth).toHaveBeenCalledWith({
          func,
          auth: [],
        });
      });

      test('submits and outputs JSON format', async () => {
        const mockDeps = createMockDeps();
        const submitCommand = createSubmitCommand(mockDeps);
        const funcAuthCommand = (submitCommand.subCommands as any)?.['func-auth'];

        const func = 'QUFBQQ==';
        const auth = 'QkJCQg==';

        await funcAuthCommand!.run!({
          args: { func, auth, json: true, wait: false, 'no-input': true },
        } as never);

        const parsed = findJsonOutput() as { transactionId: string; hash: string; status: string };
        expect(parsed.transactionId).toBe('tx-456');
        expect(parsed.hash).toBe('def789ghi012');
        expect(parsed.status).toBe('submitted');

        // Should NOT output text success in JSON mode
        expect(consoleOutput.filter((line) => line.startsWith('Success:')).length).toBe(0);
      });

      test('handles --wait flag', async () => {
        const mockDeps = createMockDeps();
        const submitCommand = createSubmitCommand(mockDeps);
        const funcAuthCommand = (submitCommand.subCommands as any)?.['func-auth'];

        const func = 'QUFBQQ==';

        await funcAuthCommand!.run!({
          args: { func, json: false, wait: true, timeout: '120', 'no-input': true },
        } as never);

        expect(stdoutOutput.some((line) => line.includes('Waiting for confirmation'))).toBe(true);
        expect(consoleOutput.some((line) => line.includes('polling not yet supported'))).toBe(true);
      });
    });

    describe('interactive mode', () => {
      test('prompts for func when not provided and not in no-input mode', async () => {
        const mockDeps = createMockDeps(undefined, undefined, {
          promptResults: ['QUFBQQ==', 'QkJCQg=='],
        });
        const submitCommand = createSubmitCommand(mockDeps);
        const funcAuthCommand = (submitCommand.subCommands as any)?.['func-auth'];

        await funcAuthCommand!.run!({
          args: { json: false, wait: false, 'no-input': false },
        } as never);

        expect(mockDeps._promptCalls).toHaveLength(2);
        expect(mockDeps._promptCalls[0].message).toBe('Host function XDR (base64)');
        expect(mockDeps._promptCalls[1].message).toBe('Authorization entries (comma-separated XDRs)');
        expect(mockDeps._promptCalls[1].defaultValue).toBe('');
        expect(mockDeps.closePrompts).toHaveBeenCalled();

        const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
        expect(mockClient.submitFuncAuth).toHaveBeenCalledWith({
          func: 'QUFBQQ==',
          auth: ['QkJCQg=='],
        });
      });

      test('exits when func prompt returns empty in interactive mode', async () => {
        const mockDeps = createMockDeps(undefined, undefined, {
          promptResults: [''],
        });
        const submitCommand = createSubmitCommand(mockDeps);
        const funcAuthCommand = (submitCommand.subCommands as any)?.['func-auth'];

        await expect(
          funcAuthCommand!.run!({
            args: { json: false, wait: false, 'no-input': false },
          } as never),
        ).rejects.toThrow('process.exit(2)');

        expect(exitCode).toBe(2);
        expect(consoleErrors.some((line) => line.includes('Function XDR is required'))).toBe(true);
        expect(mockDeps.closePrompts).toHaveBeenCalled();
      });

      test('handles empty auth in interactive mode', async () => {
        const mockDeps = createMockDeps(undefined, undefined, {
          promptResults: ['QUFBQQ==', ''],
        });
        const submitCommand = createSubmitCommand(mockDeps);
        const funcAuthCommand = (submitCommand.subCommands as any)?.['func-auth'];

        await funcAuthCommand!.run!({
          args: { json: false, wait: false, 'no-input': false },
        } as never);

        const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
        expect(mockClient.submitFuncAuth).toHaveBeenCalledWith({
          func: 'QUFBQQ==',
          auth: [],
        });
      });
    });

    describe('missing func in no-input mode', () => {
      test('exits with error when func is not provided in no-input mode', async () => {
        const mockDeps = createMockDeps();
        const submitCommand = createSubmitCommand(mockDeps);
        const funcAuthCommand = (submitCommand.subCommands as any)?.['func-auth'];

        await expect(
          funcAuthCommand!.run!({
            args: { json: false, wait: false, 'no-input': true },
          } as never),
        ).rejects.toThrow('process.exit(2)');

        expect(exitCode).toBe(2);
        expect(consoleErrors.some((line) => line.includes('--func is required'))).toBe(true);

        const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
        expect(mockClient.submitFuncAuth).not.toHaveBeenCalled();
      });
    });

    describe('invalid base64 cases', () => {
      test('exits with error for invalid func XDR', async () => {
        const mockDeps = createMockDeps();
        const submitCommand = createSubmitCommand(mockDeps);
        const funcAuthCommand = (submitCommand.subCommands as any)?.['func-auth'];

        const invalidFunc = 'not-valid-base64!@#';

        await expect(
          funcAuthCommand!.run!({
            args: { func: invalidFunc, json: false, wait: false, 'no-input': true },
          } as never),
        ).rejects.toThrow('process.exit(2)');

        expect(exitCode).toBe(2);
        expect(consoleErrors.some((line) => line.includes('Invalid func XDR: must be base64 encoded'))).toBe(true);

        const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
        expect(mockClient.submitFuncAuth).not.toHaveBeenCalled();
      });

      test('exits with error for invalid auth entry', async () => {
        const mockDeps = createMockDeps();
        const submitCommand = createSubmitCommand(mockDeps);
        const funcAuthCommand = (submitCommand.subCommands as any)?.['func-auth'];

        const func = 'QUFBQQ==';
        const invalidAuth = 'QUFBQQ==,invalid!@#';

        await expect(
          funcAuthCommand!.run!({
            args: { func, auth: invalidAuth, json: false, wait: false, 'no-input': true },
          } as never),
        ).rejects.toThrow('process.exit(2)');

        expect(exitCode).toBe(2);
        expect(consoleErrors.some((line) => line.includes('Invalid auth entry: must be base64 encoded'))).toBe(true);

        const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
        expect(mockClient.submitFuncAuth).not.toHaveBeenCalled();
      });

      test('exits with error when first auth entry is invalid', async () => {
        const mockDeps = createMockDeps();
        const submitCommand = createSubmitCommand(mockDeps);
        const funcAuthCommand = (submitCommand.subCommands as any)?.['func-auth'];

        const func = 'QUFBQQ==';
        const invalidAuth = 'invalid!,QUFBQQ==';

        await expect(
          funcAuthCommand!.run!({
            args: { func, auth: invalidAuth, json: false, wait: false, 'no-input': true },
          } as never),
        ).rejects.toThrow('process.exit(2)');

        expect(exitCode).toBe(2);
        expect(consoleErrors.some((line) => line.includes('Invalid auth entry: must be base64 encoded'))).toBe(true);
      });
    });

    describe('no config found', () => {
      test('calls exitWithUsageError when config is null', async () => {
        const mockDeps = createMockDeps(null);
        const submitCommand = createSubmitCommand(mockDeps);
        const funcAuthCommand = (submitCommand.subCommands as any)?.['func-auth'];

        await expect(
          funcAuthCommand!.run!({
            args: { func: 'QUFBQQ==', json: false, wait: false, 'no-input': true },
          } as never),
        ).rejects.toThrow('process.exit(2)');

        expect(exitCode).toBe(2);
        expect(consoleErrors.some((line) => line.includes('No configuration found'))).toBe(true);
      });
    });

    describe('API error handling', () => {
      test('calls handleApiError on submit failure', async () => {
        const error = new Error('Server error');
        const mockDeps = createMockDeps(undefined, { submitFuncAuthError: error });
        const submitCommand = createSubmitCommand(mockDeps);
        const funcAuthCommand = (submitCommand.subCommands as any)?.['func-auth'];

        await expect(
          funcAuthCommand!.run!({
            args: { func: 'QUFBQQ==', json: false, wait: false, 'no-input': true },
          } as never),
        ).rejects.toThrow('process.exit');

        expect(consoleErrors.some((line) => line.includes('Server error'))).toBe(true);
      });
    });
  });
});
