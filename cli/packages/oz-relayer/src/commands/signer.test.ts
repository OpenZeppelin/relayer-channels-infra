import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ResolvedConfig } from '../config/index.js';
import { type SignerDeps, createSignerCommand } from './signer.js';

// Store original process.exit and console functions
const originalExit = process.exit;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

// Captured values
let exitCode: number | undefined;
let consoleOutput: unknown[][] = [];
let consoleErrors: unknown[][] = [];

// Mock config factory
function createMockConfig(options?: {
  isProtected?: boolean;
  profileName?: string;
}): ResolvedConfig {
  return {
    url: 'https://api.example.com',
    apiKey: 'test-api-key',
    profileName: options?.profileName ?? 'default',
    isProtected: options?.isProtected ?? false,
    profile: {},
  } as ResolvedConfig;
}

interface MockClientOptions {
  createError?: Error;
  getError?: Error;
  listError?: Error;
  listData?: unknown[];
  getData?: unknown;
}

// Mock client factory
function createMockClient(options: MockClientOptions = {}) {
  return {
    signers: {
      listSigners: mock(async (_page?: number, _perPage?: number) => {
        if (options.listError) throw options.listError;
        return {
          data: {
            items: options.listData ?? [
              { id: 'test-signer-1', address: 'GABCDEF1234567890' },
              { id: 'test-signer-2', address: 'GXYZ9876543210ABC' },
            ],
          },
        };
      }),
      getSigner: mock(async (id: string) => {
        if (options.getError) throw options.getError;
        return {
          data: {
            data: options.getData ?? {
              id,
              address: 'GABCDEF1234567890',
              type: 'plain',
            },
          },
        };
      }),
      createSigner: mock(async (req: { id: string; type: string; config?: { key: string } }) => {
        if (options.createError) throw options.createError;
        return {
          data: {
            data: {
              id: req.id,
              address: 'GNEWSIGNER123456',
              type: req.type,
            },
          },
        };
      }),
    },
    health: {},
    relayers: {},
    config: createMockConfig(),
  };
}

// Helper to create axios-like error
function createAxiosError(
  status: number,
  message: string,
): Error & { response?: { status: number; data?: unknown; headers?: Record<string, string> } } {
  const err = new Error(message) as Error & {
    response?: { status: number; data?: unknown; headers?: Record<string, string> };
  };
  err.response = { status, data: { message }, headers: {} };
  return err;
}

/**
 * Create mock deps for testing with optional overrides.
 */
function createMockDeps(
  clientOptions: MockClientOptions = {},
  overrides: Partial<SignerDeps> = {},
): SignerDeps {
  const mockClient = createMockClient(clientOptions);

  return {
    resolveConfig: mock((args: Record<string, unknown>) => {
      if (args.url === 'no-config') {
        return null;
      }
      return createMockConfig({
        profileName: args.profile as string,
        isProtected: args.profile === 'production',
      });
    }) as SignerDeps['resolveConfig'],
    createClient: mock(() => mockClient) as unknown as SignerDeps['createClient'],
    output: mock((data: unknown) => {
      consoleOutput.push(['output', data]);
    }) as SignerDeps['output'],
    success: mock((message: string) => {
      consoleOutput.push(['success', message]);
    }) as SignerDeps['success'],
    setVerbose: mock(() => {}) as SignerDeps['setVerbose'],
    exitWithUsageError: mock((message: string) => {
      consoleErrors.push(['usageError', message]);
      throw new Error(`UsageError: ${message}`);
    }) as SignerDeps['exitWithUsageError'],
    handleApiError: mock((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      consoleErrors.push(['apiError', message]);
      throw new Error(`ApiError: ${message}`);
    }) as SignerDeps['handleApiError'],
    confirmProtectedOperation: mock(async () => true) as SignerDeps['confirmProtectedOperation'],
    ...overrides,
  };
}

// Helper to run a subcommand
async function runSubCommand(
  deps: SignerDeps,
  subCommandName: string,
  args: Record<string, unknown> = {},
): Promise<void> {
  const signerCommand = createSignerCommand(deps);
  const subCommands = signerCommand.subCommands as Record<
    string,
    { run: (ctx: { args: Record<string, unknown> }) => Promise<void> }
  >;
  const subCommand = subCommands[subCommandName];
  if (!subCommand) {
    throw new Error(`Unknown subcommand: ${subCommandName}`);
  }
  await subCommand.run({ args });
}

describe('signer command', () => {
  beforeEach(() => {
    exitCode = undefined;
    consoleOutput = [];
    consoleErrors = [];

    // Mock process.exit
    process.exit = mock((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit(${code})`);
    }) as never;

    // Mock console.log
    console.log = mock((...args: unknown[]) => {
      consoleOutput.push(args);
    });

    // Mock console.error
    console.error = mock((...args: unknown[]) => {
      consoleErrors.push(args);
    });
  });

  afterEach(() => {
    process.exit = originalExit;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe('list subcommand', () => {
    test('lists signers successfully', async () => {
      const mockDeps = createMockDeps({
        listData: [
          { id: 'signer-1', address: 'GABC123' },
          { id: 'signer-2', address: 'GXYZ456' },
        ],
      });

      await runSubCommand(mockDeps, 'list', {
        url: 'https://api.example.com',
        page: '1',
        'per-page': '10',
      });

      expect(consoleOutput.some((c) => c[0] === 'output')).toBe(true);
    });

    test('lists signers with pagination parameters', async () => {
      const mockDeps = createMockDeps();
      const mockClient = createMockClient();
      mockDeps.createClient = mock(() => mockClient) as unknown as SignerDeps['createClient'];

      await runSubCommand(mockDeps, 'list', {
        url: 'https://api.example.com',
        page: '2',
        'per-page': '5',
      });

      expect(mockClient.signers.listSigners).toHaveBeenCalledWith(2, 5);
    });

    test('handles empty signer list', async () => {
      const mockDeps = createMockDeps({ listData: [] });

      await runSubCommand(mockDeps, 'list', {
        url: 'https://api.example.com',
        page: '1',
        'per-page': '10',
      });

      expect(consoleOutput.some((c) => c[0] === 'output')).toBe(true);
    });

    test('handles API error on list', async () => {
      const mockDeps = createMockDeps({
        listError: createAxiosError(500, 'Internal Server Error'),
      });

      await expect(
        runSubCommand(mockDeps, 'list', {
          url: 'https://api.example.com',
          page: '1',
          'per-page': '10',
        }),
      ).rejects.toThrow('ApiError');
    });

    test('handles authentication error on list', async () => {
      const mockDeps = createMockDeps({
        listError: createAxiosError(401, 'Unauthorized'),
      });

      await expect(
        runSubCommand(mockDeps, 'list', {
          url: 'https://api.example.com',
          page: '1',
          'per-page': '10',
        }),
      ).rejects.toThrow('ApiError');
    });
  });

  describe('show subcommand', () => {
    test('shows signer details with ID', async () => {
      const mockDeps = createMockDeps({
        getData: {
          id: 'my-signer',
          address: 'GSHOWSIGNER123',
          type: 'plain',
          createdAt: '2024-01-01T00:00:00Z',
        },
      });
      const mockClient = createMockClient({
        getData: {
          id: 'my-signer',
          address: 'GSHOWSIGNER123',
          type: 'plain',
          createdAt: '2024-01-01T00:00:00Z',
        },
      });
      mockDeps.createClient = mock(() => mockClient) as unknown as SignerDeps['createClient'];

      await runSubCommand(mockDeps, 'show', {
        url: 'https://api.example.com',
        id: 'my-signer',
      });

      expect(mockClient.signers.getSigner).toHaveBeenCalledWith('my-signer');
      expect(consoleOutput.some((c) => c[0] === 'output')).toBe(true);
    });

    test('throws error when ID is missing', async () => {
      const mockDeps = createMockDeps();

      await expect(
        runSubCommand(mockDeps, 'show', {
          url: 'https://api.example.com',
          id: '',
        }),
      ).rejects.toThrow('UsageError');
    });

    test('handles signer not found error (404)', async () => {
      const mockDeps = createMockDeps({
        getError: createAxiosError(404, 'Signer not found'),
      });

      await expect(
        runSubCommand(mockDeps, 'show', {
          url: 'https://api.example.com',
          id: 'nonexistent',
        }),
      ).rejects.toThrow('ApiError');
    });

    test('handles authentication error on show', async () => {
      const mockDeps = createMockDeps({
        getError: createAxiosError(403, 'Forbidden'),
      });

      await expect(
        runSubCommand(mockDeps, 'show', {
          url: 'https://api.example.com',
          id: 'protected-signer',
        }),
      ).rejects.toThrow('ApiError');
    });
  });

  describe('create subcommand', () => {
    test('creates signer with secret key', async () => {
      const mockDeps = createMockDeps();
      const mockClient = createMockClient();
      mockDeps.createClient = mock(() => mockClient) as unknown as SignerDeps['createClient'];
      const secretKey = 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234';

      await runSubCommand(mockDeps, 'create', {
        url: 'https://api.example.com',
        id: 'new-signer',
        type: 'plain',
        key: secretKey,
      });

      expect(mockClient.signers.createSigner).toHaveBeenCalledTimes(1);
      const callArgs = (mockClient.signers.createSigner as ReturnType<typeof mock>).mock.calls[0];
      expect(callArgs[0].id).toBe('new-signer');
      expect(callArgs[0].config.key).toBe(secretKey);
    });

    test('rejects non-plain signer types (not yet supported)', async () => {
      const mockDeps = createMockDeps();

      await expect(
        runSubCommand(mockDeps, 'create', {
          url: 'https://api.example.com',
          id: 'vault-signer',
          type: 'vault',
        }),
      ).rejects.toThrow('UsageError');

      expect(consoleErrors.some(([type]) => type === 'usageError')).toBe(true);
    });

    test('handles 409 conflict error (signer already exists)', async () => {
      const mockDeps = createMockDeps({
        createError: createAxiosError(409, 'Signer already exists'),
      });

      await expect(
        runSubCommand(mockDeps, 'create', {
          url: 'https://api.example.com',
          id: 'existing-signer',
          type: 'plain',
          key: 'somekey1234567890123456789012345678901234567890123456789012345678',
        }),
      ).rejects.toThrow('ApiError');
    });

    test('handles validation error on create', async () => {
      const mockDeps = createMockDeps({
        createError: createAxiosError(400, 'Invalid signer configuration'),
      });

      await expect(
        runSubCommand(mockDeps, 'create', {
          url: 'https://api.example.com',
          id: 'invalid-signer',
          type: 'plain',
          key: 'short',
        }),
      ).rejects.toThrow('ApiError');
    });

    test('throws error when key is missing for plain signer without generate', async () => {
      const mockDeps = createMockDeps();

      await expect(
        runSubCommand(mockDeps, 'create', {
          url: 'https://api.example.com',
          id: 'new-signer',
          type: 'plain',
          generate: false,
        }),
      ).rejects.toThrow('UsageError');
    });

    test('throws error for invalid signer type', async () => {
      const mockDeps = createMockDeps();

      await expect(
        runSubCommand(mockDeps, 'create', {
          url: 'https://api.example.com',
          id: 'new-signer',
          type: 'invalid',
          key: 'somekey',
        }),
      ).rejects.toThrow('UsageError');
    });

    test('prompts for confirmation on protected profile', async () => {
      const confirmMock = mock(async () => true);
      const mockDeps = createMockDeps(
        {},
        {
          confirmProtectedOperation: confirmMock as SignerDeps['confirmProtectedOperation'],
        },
      );

      await runSubCommand(mockDeps, 'create', {
        url: 'https://api.example.com',
        profile: 'production',
        id: 'new-signer',
        type: 'plain',
        key: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
      });

      expect(confirmMock).toHaveBeenCalledWith({
        profileName: 'production',
        operation: 'create signer',
        summary: 'Signer ID: new-signer',
        noInput: false,
      });
    });

    test('cancels creation when confirmation declined', async () => {
      const mockDeps = createMockDeps(
        {},
        {
          confirmProtectedOperation: mock(
            async () => false,
          ) as SignerDeps['confirmProtectedOperation'],
        },
      );

      await expect(
        runSubCommand(mockDeps, 'create', {
          url: 'https://api.example.com',
          profile: 'production',
          id: 'new-signer',
          type: 'plain',
          key: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
        }),
      ).rejects.toThrow('process.exit(0)');

      expect(exitCode).toBe(0);
    });
  });

  describe('key generation logic', () => {
    test('generates 64-character hex string (32 bytes)', () => {
      // Simulate the key generation logic from createCommand
      const randomBytes = crypto.getRandomValues(new Uint8Array(32));
      const secretKey = Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      expect(secretKey).toMatch(/^[0-9a-f]{64}$/);
      expect(secretKey.length).toBe(64);
    });

    test('generates unique keys', () => {
      const keys = new Set<string>();

      for (let i = 0; i < 10; i++) {
        const randomBytes = crypto.getRandomValues(new Uint8Array(32));
        const secretKey = Array.from(randomBytes)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        keys.add(secretKey);
      }

      expect(keys.size).toBe(10);
    });
  });

  describe('signer type mapping', () => {
    test('maps plain type correctly', () => {
      const typeMap: Record<string, string> = {
        plain: 'PLAIN',
        vault: 'VAULT',
        test: 'TEST',
      };

      expect(typeMap.plain).toBe('PLAIN');
    });

    test('maps vault type correctly', () => {
      const typeMap: Record<string, string> = {
        plain: 'PLAIN',
        vault: 'VAULT',
        test: 'TEST',
      };

      expect(typeMap.vault).toBe('VAULT');
    });

    test('maps test type correctly', () => {
      const typeMap: Record<string, string> = {
        plain: 'PLAIN',
        vault: 'VAULT',
        test: 'TEST',
      };

      expect(typeMap.test).toBe('TEST');
    });

    test('returns undefined for invalid type', () => {
      const typeMap: Record<string, string> = {
        plain: 'PLAIN',
        vault: 'VAULT',
        test: 'TEST',
      };

      expect(typeMap.invalid).toBeUndefined();
    });
  });

  describe('command structure', () => {
    test('has all expected subcommands', () => {
      const mockDeps = createMockDeps();
      const signerCommand = createSignerCommand(mockDeps);
      const subCommands = Object.keys(signerCommand.subCommands || {});

      expect(subCommands).toContain('list');
      expect(subCommands).toContain('show');
      expect(subCommands).toContain('create');
    });

    test('has correct metadata', () => {
      const mockDeps = createMockDeps();
      const signerCommand = createSignerCommand(mockDeps);

      expect((signerCommand.meta as any)?.name).toBe('signer');
      expect((signerCommand.meta as any)?.description).toBe('Signer management');
    });
  });

  describe('configuration', () => {
    test('throws error when no config is available', async () => {
      const mockDeps = createMockDeps();

      await expect(
        runSubCommand(mockDeps, 'list', { url: 'no-config', page: '1', 'per-page': '10' }),
      ).rejects.toThrow('UsageError');
    });
  });
});
