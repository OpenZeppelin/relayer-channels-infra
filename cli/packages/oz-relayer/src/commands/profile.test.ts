import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { runCommand } from 'citty';
import { type ProfileDeps, createProfileCommand } from './profile.js';

// Mock data
const mockProfiles = [
  {
    name: 'default',
    profile: {
      url: 'https://api.example.com',
      api_key: 'secret-key',
      default_relayer: 'relayer-1',
    },
    isDefault: true,
    isProtected: false,
  },
  {
    name: 'production',
    profile: {
      url: 'https://prod.example.com',
      api_key: 'prod-key',
    },
    isDefault: false,
    isProtected: true,
  },
];

const mockConfigPaths = {
  user: '/home/user/.config/oz-relayer/config.yaml',
  project: '/project/.oz-relayer.yaml',
};

// Store original functions
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalProcessExit = process.exit;

// Capture outputs
let consoleOutput: string[] = [];
let exitCode: number | null = null;

/**
 * Create mock deps for testing with optional overrides.
 */
function createMockDeps(overrides: Partial<ProfileDeps> = {}): ProfileDeps {
  return {
    getProfile: mock((name: string) => {
      const found = mockProfiles.find((p) => p.name === name);
      return found?.profile || null;
    }) as ProfileDeps['getProfile'],
    listProfiles: mock(() => mockProfiles) as ProfileDeps['listProfiles'],
    saveProfile: mock(() => {}) as ProfileDeps['saveProfile'],
    deleteProfile: mock((name: string) => {
      return mockProfiles.some((p) => p.name === name);
    }) as ProfileDeps['deleteProfile'],
    setDefaultProfile: mock((name: string) => {
      return mockProfiles.some((p) => p.name === name);
    }) as ProfileDeps['setDefaultProfile'],
    getConfigPaths: mock(() => mockConfigPaths) as unknown as ProfileDeps['getConfigPaths'],
    output: mock((data: unknown, options?: { json?: boolean }) => {
      if (options?.json) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(data);
      }
    }) as ProfileDeps['output'],
    success: mock((msg: string) => console.log(msg)) as ProfileDeps['success'],
    formatTable: mock((headers: string[], rows: string[][]) => {
      const headerLine = headers.join('\t');
      const rowLines = rows.map((row) => row.join('\t'));
      return [headerLine, ...rowLines].join('\n');
    }) as ProfileDeps['formatTable'],
    exitWithUsageError: mock((msg: string) => {
      console.error(`Error: ${msg}`);
      process.exit(2);
    }) as ProfileDeps['exitWithUsageError'],
    prompt: mock(async () => '') as ProfileDeps['prompt'],
    promptConfirm: mock(async () => false) as ProfileDeps['promptConfirm'],
    promptPassword: mock(async () => '') as ProfileDeps['promptPassword'],
    closePrompts: mock(() => {}) as ProfileDeps['closePrompts'],
    ...overrides,
  };
}

beforeEach(() => {
  consoleOutput = [];
  exitCode = null;

  console.log = mock((...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(' '));
  });
  console.error = mock((...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(' '));
  });
  process.exit = mock((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`process.exit(${code})`);
  }) as never;
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  process.exit = originalProcessExit;
});

describe('profile list', () => {
  test('lists profiles successfully', async () => {
    const mockDeps = createMockDeps();
    const profileCommand = createProfileCommand(mockDeps);

    await runCommand(profileCommand, { rawArgs: ['list'] });

    expect(mockDeps.listProfiles).toHaveBeenCalledTimes(1);
    // Check that output contains profile information
    const output = consoleOutput.join('\n');
    expect(output).toContain('default');
    expect(output).toContain('production');
    expect(output).toContain('https://api.example.com');
    expect(output).toContain('https://prod.example.com');
  });

  test('shows message when no profiles configured', async () => {
    const mockDeps = createMockDeps({
      listProfiles: mock(() => []) as ProfileDeps['listProfiles'],
    });
    const profileCommand = createProfileCommand(mockDeps);

    await runCommand(profileCommand, { rawArgs: ['list'] });

    expect(mockDeps.listProfiles).toHaveBeenCalledTimes(1);
    const output = consoleOutput.join('\n');
    expect(output).toContain('No profiles configured');
    expect(output).toContain('oz-relayer profile init');
  });

  test('outputs JSON format when --json flag is used', async () => {
    const mockDeps = createMockDeps();
    const profileCommand = createProfileCommand(mockDeps);

    await runCommand(profileCommand, { rawArgs: ['list', '--json'] });

    expect(mockDeps.listProfiles).toHaveBeenCalledTimes(1);
    const output = consoleOutput.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.profiles).toBeArray();
    expect(parsed.profiles).toHaveLength(2);
    expect(parsed.profiles[0].name).toBe('default');
    expect(parsed.profiles[0].url).toBe('https://api.example.com');
    expect(parsed.profiles[0].default).toBe(true);
    expect(parsed.profiles[0].protected).toBe(false);
    expect(parsed.profiles[1].name).toBe('production');
    expect(parsed.profiles[1].protected).toBe(true);
  });

  test('outputs empty profiles array as JSON when no profiles', async () => {
    const mockDeps = createMockDeps({
      listProfiles: mock(() => []) as ProfileDeps['listProfiles'],
    });
    const profileCommand = createProfileCommand(mockDeps);

    await runCommand(profileCommand, { rawArgs: ['list', '--json'] });

    const output = consoleOutput.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.profiles).toEqual([]);
  });
});

describe('profile show', () => {
  test('shows profile details by name', async () => {
    const mockDeps = createMockDeps();
    const profileCommand = createProfileCommand(mockDeps);

    await runCommand(profileCommand, { rawArgs: ['show', 'default'] });

    expect(mockDeps.getProfile).toHaveBeenCalledWith('default');
    const output = consoleOutput.join('\n');
    expect(output).toContain('Profile:');
    expect(output).toContain('default');
    expect(output).toContain('URL:');
    expect(output).toContain('https://api.example.com');
    expect(output).toContain('API Key:');
    expect(output).toContain('********');
    expect(output).toContain('Default Relayer:');
    expect(output).toContain('relayer-1');
  });

  test('shows default profile when no name specified', async () => {
    const mockDeps = createMockDeps();
    const profileCommand = createProfileCommand(mockDeps);

    await runCommand(profileCommand, { rawArgs: ['show'] });

    expect(mockDeps.listProfiles).toHaveBeenCalledTimes(1);
    expect(mockDeps.getProfile).toHaveBeenCalledWith('default');
    const output = consoleOutput.join('\n');
    expect(output).toContain('default');
  });

  test('exits with error when profile not found', async () => {
    const mockDeps = createMockDeps({
      getProfile: mock(() => null) as ProfileDeps['getProfile'],
    });
    const profileCommand = createProfileCommand(mockDeps);

    try {
      await runCommand(profileCommand, { rawArgs: ['show', 'nonexistent'] });
    } catch {
      // Expected to throw due to process.exit mock
    }

    expect(exitCode).toBe(2);
  });

  test('exits with error when no profile specified and no default', async () => {
    const mockDeps = createMockDeps({
      listProfiles: mock(() => [
        { ...mockProfiles[0], isDefault: false },
        { ...mockProfiles[1], isDefault: false },
      ]) as ProfileDeps['listProfiles'],
    });
    const profileCommand = createProfileCommand(mockDeps);

    try {
      await runCommand(profileCommand, { rawArgs: ['show'] });
    } catch {
      // Expected to throw due to process.exit mock
    }

    expect(exitCode).toBe(2);
  });

  test('outputs JSON format when --json flag is used', async () => {
    const mockDeps = createMockDeps();
    const profileCommand = createProfileCommand(mockDeps);

    await runCommand(profileCommand, { rawArgs: ['show', 'default', '--json'] });

    const output = consoleOutput.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.name).toBe('default');
    expect(parsed.url).toBe('https://api.example.com');
    expect(parsed.api_key).toBe('********');
    expect(parsed.default).toBe(true);
    expect(parsed.protected).toBe(false);
    expect(parsed.default_relayer).toBe('relayer-1');
  });

  test('shows protected profile with JSON output', async () => {
    const mockDeps = createMockDeps();
    const profileCommand = createProfileCommand(mockDeps);

    await runCommand(profileCommand, { rawArgs: ['show', 'production', '--json'] });

    const output = consoleOutput.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.name).toBe('production');
    expect(parsed.protected).toBe(true);
  });
});

describe('profile path', () => {
  test('shows config file paths', async () => {
    const mockDeps = createMockDeps();
    const profileCommand = createProfileCommand(mockDeps);

    await runCommand(profileCommand, { rawArgs: ['path'] });

    expect(mockDeps.getConfigPaths).toHaveBeenCalledTimes(1);
    const output = consoleOutput.join('\n');
    expect(output).toContain('User config:');
    expect(output).toContain('/home/user/.config/oz-relayer/config.yaml');
    expect(output).toContain('Project config:');
    expect(output).toContain('/project/.oz-relayer.yaml');
  });

  test('shows only user config when no project config', async () => {
    const mockDeps = createMockDeps({
      getConfigPaths: mock(() => ({
        user: '/home/user/.config/oz-relayer/config.yaml',
        project: undefined,
      })) as unknown as ProfileDeps['getConfigPaths'],
    });
    const profileCommand = createProfileCommand(mockDeps);

    await runCommand(profileCommand, { rawArgs: ['path'] });

    const output = consoleOutput.join('\n');
    expect(output).toContain('User config:');
    expect(output).toContain('/home/user/.config/oz-relayer/config.yaml');
    expect(output).not.toContain('Project config:');
  });

  test('outputs JSON format when --json flag is used', async () => {
    const mockDeps = createMockDeps();
    const profileCommand = createProfileCommand(mockDeps);

    await runCommand(profileCommand, { rawArgs: ['path', '--json'] });

    const output = consoleOutput.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.user).toBe('/home/user/.config/oz-relayer/config.yaml');
    expect(parsed.project).toBe('/project/.oz-relayer.yaml');
  });

  test('outputs JSON with null project when no project config', async () => {
    const mockDeps = createMockDeps({
      getConfigPaths: mock(() => ({
        user: '/home/user/.config/oz-relayer/config.yaml',
        project: undefined,
      })) as unknown as ProfileDeps['getConfigPaths'],
    });
    const profileCommand = createProfileCommand(mockDeps);

    await runCommand(profileCommand, { rawArgs: ['path', '--json'] });

    const output = consoleOutput.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.user).toBe('/home/user/.config/oz-relayer/config.yaml');
    expect(parsed.project).toBeUndefined();
  });
});

describe('profile use', () => {
  test('sets default profile successfully', async () => {
    const mockDeps = createMockDeps();
    const profileCommand = createProfileCommand(mockDeps);

    await runCommand(profileCommand, { rawArgs: ['use', 'production'] });

    expect(mockDeps.setDefaultProfile).toHaveBeenCalledWith('production');
    const output = consoleOutput.join('\n');
    expect(output).toContain("Default profile set to 'production'");
  });

  test('exits with error when profile not found', async () => {
    const mockDeps = createMockDeps({
      setDefaultProfile: mock(() => false) as ProfileDeps['setDefaultProfile'],
    });
    const profileCommand = createProfileCommand(mockDeps);

    try {
      await runCommand(profileCommand, { rawArgs: ['use', 'nonexistent'] });
    } catch {
      // Expected to throw due to process.exit mock
    }

    expect(mockDeps.setDefaultProfile).toHaveBeenCalledWith('nonexistent');
    expect(exitCode).toBe(2);
  });

  test('sets existing profile as default', async () => {
    const mockDeps = createMockDeps();
    const profileCommand = createProfileCommand(mockDeps);

    await runCommand(profileCommand, { rawArgs: ['use', 'default'] });

    expect(mockDeps.setDefaultProfile).toHaveBeenCalledWith('default');
    const output = consoleOutput.join('\n');
    expect(output).toContain("Default profile set to 'default'");
  });
});

describe('profile command structure', () => {
  test('has all expected subcommands', () => {
    const mockDeps = createMockDeps();
    const profileCommand = createProfileCommand(mockDeps);

    expect(profileCommand.subCommands).toBeDefined();
    expect((profileCommand.subCommands as any)?.init).toBeDefined();
    expect((profileCommand.subCommands as any)?.list).toBeDefined();
    expect((profileCommand.subCommands as any)?.show).toBeDefined();
    expect((profileCommand.subCommands as any)?.use).toBeDefined();
    expect((profileCommand.subCommands as any)?.delete).toBeDefined();
    expect((profileCommand.subCommands as any)?.path).toBeDefined();
  });

  test('has correct meta information', () => {
    const mockDeps = createMockDeps();
    const profileCommand = createProfileCommand(mockDeps);

    expect((profileCommand.meta as any)?.name).toBe('profile');
    expect((profileCommand.meta as any)?.description).toBe('Manage connection profiles');
  });
});
