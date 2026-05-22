import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { type HealthDeps, createHealthCommand } from './health.js';

// Store original process.exit
const originalExit = process.exit;
const originalConsoleLog = console.log;

// Capture state
let consoleOutput: string[] = [];
let exitCode: number | undefined;

// Custom error to identify process.exit calls
class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
    this.name = 'ProcessExitError';
  }
}

/**
 * Create mock deps for testing with optional overrides.
 */
function createMockDeps(overrides: Partial<HealthDeps> = {}): HealthDeps {
  return {
    resolveConfig: mock(() => null),
    createClient: mock(() => ({}) as ReturnType<HealthDeps['createClient']>),
    exitWithUsageError: mock((msg: string) => {
      throw new ProcessExitError(2);
    }) as HealthDeps['exitWithUsageError'],
    handleApiError: mock((err: unknown) => {
      throw new ProcessExitError(1);
    }) as HealthDeps['handleApiError'],
    output: mock(() => {}),
    ...overrides,
  };
}

function createMockConfig(overrides?: {
  url?: string;
  apiKey?: string;
  profileName?: string;
  pluginId?: string | null;
  isProtected?: boolean;
}) {
  const defaults = {
    url: 'https://api.channels.example.com',
    apiKey: 'test-api-key',
    profileName: 'test-profile',
    pluginId: 'plugin-123' as string | undefined,
    isProtected: false,
  };

  // Handle explicit null/undefined for pluginId
  if (overrides && 'pluginId' in overrides) {
    defaults.pluginId = overrides.pluginId ?? undefined;
  }

  return {
    url: overrides?.url ?? defaults.url,
    apiKey: overrides?.apiKey ?? defaults.apiKey,
    profileName: overrides?.profileName ?? defaults.profileName,
    pluginId: defaults.pluginId,
    isProtected: overrides?.isProtected ?? defaults.isProtected,
  };
}

describe('health command', () => {
  beforeEach(() => {
    consoleOutput = [];
    exitCode = undefined;

    // Mock process.exit
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new ProcessExitError(code ?? 0);
    }) as never;

    // Capture console.log
    console.log = ((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    }) as typeof console.log;
  });

  afterEach(() => {
    process.exit = originalExit;
    console.log = originalConsoleLog;
  });

  describe('success case - healthy service', () => {
    test('outputs text format when healthy', async () => {
      const config = createMockConfig();
      const healthCheckFn = mock(async () => ({ healthy: true }));
      const mockClient = { healthCheck: healthCheckFn };

      const mockDeps = createMockDeps({
        resolveConfig: mock(() => config) as unknown as HealthDeps['resolveConfig'],
        createClient: mock(() => mockClient) as unknown as HealthDeps['createClient'],
      });

      const healthCommand = createHealthCommand(mockDeps);
      await healthCommand.run?.({ args: { json: false } } as never);

      expect(healthCheckFn).toHaveBeenCalled();

      // Should output text to console
      expect(consoleOutput.length).toBeGreaterThan(0);
      expect(consoleOutput.some((line) => line.includes('Service:'))).toBe(true);
      expect(consoleOutput.some((line) => line.includes('Profile:'))).toBe(true);
      expect(consoleOutput.some((line) => line.includes('Plugin ID:'))).toBe(true);
      expect(consoleOutput.some((line) => line.includes('Health:'))).toBe(true);

      // Should NOT call output (JSON output function)
      expect(mockDeps.output).not.toHaveBeenCalled();
    });

    test('outputs JSON format when healthy with --json flag', async () => {
      const config = createMockConfig();
      const healthCheckFn = mock(async () => ({ healthy: true }));
      const mockClient = { healthCheck: healthCheckFn };

      const mockDeps = createMockDeps({
        resolveConfig: mock(() => config) as unknown as HealthDeps['resolveConfig'],
        createClient: mock(() => mockClient) as unknown as HealthDeps['createClient'],
      });

      const healthCommand = createHealthCommand(mockDeps);
      await healthCommand.run?.({ args: { json: true } } as never);

      expect(mockDeps.output).toHaveBeenCalledWith(
        {
          healthy: true,
          url: config.url,
          profile: config.profileName,
          pluginId: config.pluginId,
        },
        { json: true },
      );

      // Should NOT log to console in JSON mode
      expect(consoleOutput.length).toBe(0);
    });

    test('outputs text without plugin ID when not configured', async () => {
      const config = createMockConfig({ pluginId: undefined });
      const healthCheckFn = mock(async () => ({ healthy: true }));
      const mockClient = { healthCheck: healthCheckFn };

      const mockDeps = createMockDeps({
        resolveConfig: mock(() => config) as unknown as HealthDeps['resolveConfig'],
        createClient: mock(() => mockClient) as unknown as HealthDeps['createClient'],
      });

      const healthCommand = createHealthCommand(mockDeps);
      await healthCommand.run?.({ args: { json: false } } as never);

      // Should NOT include Plugin ID line when not configured
      expect(consoleOutput.some((line) => line.includes('Plugin ID:'))).toBe(false);
    });
  });

  describe('unhealthy service', () => {
    test('exits with code 1 when service is unhealthy (text mode)', async () => {
      const config = createMockConfig();
      const healthCheckFn = mock(async () => ({ healthy: false }));
      const mockClient = { healthCheck: healthCheckFn };

      const mockDeps = createMockDeps({
        resolveConfig: mock(() => config) as unknown as HealthDeps['resolveConfig'],
        createClient: mock(() => mockClient) as unknown as HealthDeps['createClient'],
      });

      const healthCommand = createHealthCommand(mockDeps);

      await expect(healthCommand.run?.({ args: { json: false } } as never)).rejects.toThrow(
        ProcessExitError,
      );

      expect(exitCode).toBe(1);
      expect(consoleOutput.some((line) => line.includes('Health:'))).toBe(true);
    });

    test('exits with code 1 when service is unhealthy (JSON mode)', async () => {
      const config = createMockConfig();
      const healthCheckFn = mock(async () => ({ healthy: false }));
      const mockClient = { healthCheck: healthCheckFn };

      const mockDeps = createMockDeps({
        resolveConfig: mock(() => config) as unknown as HealthDeps['resolveConfig'],
        createClient: mock(() => mockClient) as unknown as HealthDeps['createClient'],
      });

      const healthCommand = createHealthCommand(mockDeps);

      await expect(healthCommand.run?.({ args: { json: true } } as never)).rejects.toThrow(
        ProcessExitError,
      );

      expect(exitCode).toBe(1);

      expect(mockDeps.output).toHaveBeenCalledWith(
        {
          healthy: false,
          url: config.url,
          profile: config.profileName,
          pluginId: config.pluginId,
        },
        { json: true },
      );
    });
  });

  describe('no config found', () => {
    test('calls exitWithUsageError when config is null', async () => {
      const mockDeps = createMockDeps({
        resolveConfig: mock(() => null) as unknown as HealthDeps['resolveConfig'],
      });

      const healthCommand = createHealthCommand(mockDeps);

      await expect(healthCommand.run?.({ args: { json: false } } as never)).rejects.toThrow(
        ProcessExitError,
      );

      expect(mockDeps.exitWithUsageError).toHaveBeenCalledWith(
        'No configuration found. Run `oz-channels profile init` or set OZ_CHANNELS_URL and OZ_CHANNELS_API_KEY environment variables.',
      );
    });
  });

  describe('API error handling', () => {
    test('calls handleApiError on health check failure (text mode)', async () => {
      const config = createMockConfig();
      const error = new Error('Network error');
      const healthCheckFn = mock(async () => {
        throw error;
      });
      const mockClient = { healthCheck: healthCheckFn };

      const mockDeps = createMockDeps({
        resolveConfig: mock(() => config) as unknown as HealthDeps['resolveConfig'],
        createClient: mock(() => mockClient) as unknown as HealthDeps['createClient'],
      });

      const healthCommand = createHealthCommand(mockDeps);

      await expect(healthCommand.run?.({ args: { json: false } } as never)).rejects.toThrow(
        ProcessExitError,
      );

      expect(mockDeps.handleApiError).toHaveBeenCalledWith(error);
    });

    test('outputs JSON error and exits with code 1 on health check failure (JSON mode)', async () => {
      const config = createMockConfig();
      const error = new Error('Network error');
      const healthCheckFn = mock(async () => {
        throw error;
      });
      const mockClient = { healthCheck: healthCheckFn };

      const mockDeps = createMockDeps({
        resolveConfig: mock(() => config) as unknown as HealthDeps['resolveConfig'],
        createClient: mock(() => mockClient) as unknown as HealthDeps['createClient'],
      });

      const healthCommand = createHealthCommand(mockDeps);

      await expect(healthCommand.run?.({ args: { json: true } } as never)).rejects.toThrow(
        ProcessExitError,
      );

      expect(exitCode).toBe(1);
      expect(mockDeps.output).toHaveBeenCalledWith(
        {
          healthy: false,
          url: config.url,
          profile: config.profileName,
          pluginId: config.pluginId,
        },
        { json: true },
      );

      // Should NOT call handleApiError in JSON mode
      expect(mockDeps.handleApiError).not.toHaveBeenCalled();
    });
  });

  describe('command metadata', () => {
    test('has correct name and description', () => {
      const mockDeps = createMockDeps();
      const healthCommand = createHealthCommand(mockDeps);

      expect((healthCommand.meta as any)?.name).toBe('health');
      expect((healthCommand.meta as any)?.description).toBe('Check channels service health');
    });

    test('has json argument with default false', () => {
      const mockDeps = createMockDeps();
      const healthCommand = createHealthCommand(mockDeps);

      expect((healthCommand.args as any)?.json).toBeDefined();
      expect((healthCommand.args as any)?.json?.type).toBe('boolean');
      expect((healthCommand.args as any)?.json?.default).toBe(false);
    });

    test('has profile argument', () => {
      const mockDeps = createMockDeps();
      const healthCommand = createHealthCommand(mockDeps);

      expect((healthCommand.args as any)?.profile).toBeDefined();
      expect((healthCommand.args as any)?.profile?.type).toBe('string');
      expect((healthCommand.args as any)?.profile?.alias).toBe('p');
    });
  });
});
