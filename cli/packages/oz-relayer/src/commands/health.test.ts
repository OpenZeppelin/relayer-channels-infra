import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { type HealthDeps, createHealthCommand } from './health.js';

// Store original process.exit
const originalExit = process.exit;

/**
 * Create mock deps for testing with optional overrides.
 */
function createMockDeps(overrides: Partial<HealthDeps> = {}): HealthDeps {
  return {
    resolveConfig: mock(() => null),
    createClient: mock(() => ({}) as unknown as ReturnType<HealthDeps['createClient']>),
    setVerbose: mock(() => {}),
    exitWithUsageError: mock((msg: string) => {
      throw new Error(`exitWithUsageError: ${msg}`);
    }) as HealthDeps['exitWithUsageError'],
    handleApiError: mock((err: unknown) => {
      throw new Error(`handleApiError: ${err}`);
    }) as HealthDeps['handleApiError'],
    output: mock(() => {}),
    ...overrides,
  };
}

describe('health command', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let exitCode: number | undefined;
  let mockDeps: HealthDeps;

  beforeEach(() => {
    // Spy on console.log
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});

    // Mock process.exit to capture exit code
    exitCode = undefined;
    process.exit = mock((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit(${code})`);
    }) as never;

    // Create fresh mock deps for each test
    mockDeps = createMockDeps();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.exit = originalExit;
  });

  describe('success cases', () => {
    test('outputs text format when healthy', async () => {
      const mockConfig = {
        url: 'https://api.example.com',
        apiKey: 'test-key',
        profileName: 'test-profile',
        isProtected: false,
      };

      const mockHealthFn = mock(() => Promise.resolve({ status: 'ok' }));
      const mockClient = {
        health: { health: mockHealthFn },
      };

      mockDeps = createMockDeps({
        resolveConfig: mock(() => mockConfig as ReturnType<HealthDeps['resolveConfig']>),
        createClient: mock(() => mockClient as unknown as ReturnType<HealthDeps['createClient']>),
      });

      const healthCommand = createHealthCommand(mockDeps);
      await healthCommand.run?.({ args: { json: false, verbose: false } } as any);

      expect(mockDeps.resolveConfig).toHaveBeenCalledTimes(1);
      expect(mockDeps.createClient).toHaveBeenCalledWith(mockConfig);
      expect(mockHealthFn).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledTimes(3);
      // Verify console output contains service URL and profile
      const calls = consoleSpy.mock.calls;
      expect(calls[0][0]).toContain('https://api.example.com');
      expect(calls[1][0]).toContain('test-profile');
      expect(calls[2][0]).toContain('Healthy');
    });

    test('outputs JSON format when healthy with --json flag', async () => {
      const mockConfig = {
        url: 'https://api.example.com',
        apiKey: 'test-key',
        profileName: 'test-profile',
        isProtected: false,
      };

      const mockHealthFn = mock(() => Promise.resolve({ status: 'ok' }));
      const mockClient = {
        health: { health: mockHealthFn },
      };

      mockDeps = createMockDeps({
        resolveConfig: mock(() => mockConfig as ReturnType<HealthDeps['resolveConfig']>),
        createClient: mock(() => mockClient as unknown as ReturnType<HealthDeps['createClient']>),
      });

      const healthCommand = createHealthCommand(mockDeps);
      await healthCommand.run?.({ args: { json: true, verbose: false } } as any);

      expect(mockDeps.output).toHaveBeenCalledWith(
        {
          healthy: true,
          url: 'https://api.example.com',
          profile: 'test-profile',
        },
        { json: true },
      );
    });

    test('sets verbose mode from args', async () => {
      const mockConfig = {
        url: 'https://api.example.com',
        apiKey: 'test-key',
        profileName: 'test-profile',
        isProtected: false,
      };

      const mockHealthFn = mock(() => Promise.resolve({ status: 'ok' }));
      const mockClient = {
        health: { health: mockHealthFn },
      };

      mockDeps = createMockDeps({
        resolveConfig: mock(() => mockConfig as ReturnType<HealthDeps['resolveConfig']>),
        createClient: mock(() => mockClient as unknown as ReturnType<HealthDeps['createClient']>),
      });

      const healthCommand = createHealthCommand(mockDeps);
      await healthCommand.run?.({ args: { json: false, verbose: true } } as any);

      expect(mockDeps.setVerbose).toHaveBeenCalledWith(true);
    });
  });

  describe('no config found', () => {
    test('exits with usage error when no config is found', async () => {
      mockDeps = createMockDeps({
        resolveConfig: mock(() => null),
      });

      const healthCommand = createHealthCommand(mockDeps);

      await expect(
        healthCommand.run?.({ args: { json: false, verbose: false } } as any),
      ).rejects.toThrow('exitWithUsageError');

      expect(mockDeps.exitWithUsageError).toHaveBeenCalledWith(
        'No configuration found. Run `oz-relayer profile init` or set OZ_RELAYER_URL and OZ_RELAYER_API_KEY environment variables.',
      );
      expect(mockDeps.createClient).not.toHaveBeenCalled();
    });
  });

  describe('API error handling', () => {
    test('calls handleApiError on health check failure (text mode)', async () => {
      const mockConfig = {
        url: 'https://api.example.com',
        apiKey: 'test-key',
        profileName: 'test-profile',
        isProtected: false,
      };

      const apiError = new Error('Network error');
      const mockHealthFn = mock(() => Promise.reject(apiError));
      const mockClient = {
        health: { health: mockHealthFn },
      };

      mockDeps = createMockDeps({
        resolveConfig: mock(() => mockConfig as ReturnType<HealthDeps['resolveConfig']>),
        createClient: mock(() => mockClient as unknown as ReturnType<HealthDeps['createClient']>),
      });

      const healthCommand = createHealthCommand(mockDeps);

      await expect(
        healthCommand.run?.({ args: { json: false, verbose: false } } as any),
      ).rejects.toThrow('handleApiError');

      expect(mockDeps.handleApiError).toHaveBeenCalledWith(apiError);
    });

    test('outputs JSON with healthy=false and exits on health check failure (JSON mode)', async () => {
      const mockConfig = {
        url: 'https://api.example.com',
        apiKey: 'test-key',
        profileName: 'test-profile',
        isProtected: false,
      };

      const apiError = new Error('Service unavailable');
      const mockHealthFn = mock(() => Promise.reject(apiError));
      const mockClient = {
        health: { health: mockHealthFn },
      };

      mockDeps = createMockDeps({
        resolveConfig: mock(() => mockConfig as ReturnType<HealthDeps['resolveConfig']>),
        createClient: mock(() => mockClient as unknown as ReturnType<HealthDeps['createClient']>),
      });

      const healthCommand = createHealthCommand(mockDeps);

      await expect(
        healthCommand.run?.({ args: { json: true, verbose: false } } as any),
      ).rejects.toThrow('process.exit(1)');

      expect(mockDeps.output).toHaveBeenCalledWith(
        {
          healthy: false,
          url: 'https://api.example.com',
          profile: 'test-profile',
        },
        { json: true },
      );
      expect(exitCode).toBe(1);
      // handleApiError should NOT be called in JSON mode
      expect(mockDeps.handleApiError).not.toHaveBeenCalled();
    });
  });

  describe('command metadata', () => {
    test('has correct name and description', () => {
      const healthCommand = createHealthCommand(mockDeps);
      expect((healthCommand.meta as any)?.name).toBe('health');
      expect((healthCommand.meta as any)?.description).toBe('Check relayer service health');
    });

    test('defines expected arguments', () => {
      const healthCommand = createHealthCommand(mockDeps);
      const args = healthCommand.args;
      expect(args).toBeDefined();
      expect((args as any)?.profile).toBeDefined();
      expect((args as any)?.url).toBeDefined();
      expect((args as any)?.['api-key']).toBeDefined();
      expect((args as any)?.json).toBeDefined();
      expect((args as any)?.['no-input']).toBeDefined();
      expect((args as any)?.verbose).toBeDefined();
    });
  });
});
