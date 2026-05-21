import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createProfileCommand, type ProfileDeps } from './profile.js';

// Mock data
const mockProfiles = [
  {
    name: 'default',
    isDefault: true,
    isProtected: false,
    profile: {
      url: 'https://channels.example.com',
      api_key: 'test-api-key',
      plugin_id: 'channels',
      admin_secret: 'admin-secret-123',
      network: 'testnet' as const,
      test_account: 'test-account',
      smoke_contract: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    },
  },
  {
    name: 'production',
    isDefault: false,
    isProtected: true,
    profile: {
      url: 'https://prod.channels.example.com',
      api_key: 'prod-api-key',
      plugin_id: 'prod-channels',
      network: 'mainnet' as const,
    },
  },
];

// Capture console output
let consoleOutput: string[] = [];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

// Mock process.exit
let exitCode: number | undefined;
const originalProcessExit = process.exit;

/**
 * Create mock deps for testing with optional overrides.
 */
function createMockDeps(overrides: Partial<ProfileDeps> = {}): ProfileDeps {
  return {
    getProfile: mock((name: string) => {
      const entry = mockProfiles.find((p) => p.name === name);
      return entry?.profile ?? null;
    }) as ProfileDeps['getProfile'],
    listProfiles: mock(() => mockProfiles) as ProfileDeps['listProfiles'],
    saveProfile: mock(() => {}) as ProfileDeps['saveProfile'],
    deleteProfile: mock((name: string) => {
      return mockProfiles.some((p) => p.name === name);
    }) as ProfileDeps['deleteProfile'],
    setDefaultProfile: mock((name: string) => {
      return mockProfiles.some((p) => p.name === name);
    }) as ProfileDeps['setDefaultProfile'],
    getConfigPaths: mock(() => ({
      user: '/home/user/.config/oz-channels/config.yaml',
      project: '/workspace/project/.oz-channels.yaml',
    })) as ProfileDeps['getConfigPaths'],
    output: mock((data: unknown, opts?: { json?: boolean }) => {
      if (opts?.json) {
        consoleOutput.push(JSON.stringify(data, null, 2));
      }
    }) as ProfileDeps['output'],
    success: mock((msg: string) => {
      consoleOutput.push(`Success: ${msg}`);
    }) as ProfileDeps['success'],
    formatTable: mock((headers: string[], rows: string[][]) => {
      const headerRow = headers.join('\t');
      const bodyRows = rows.map((r) => r.join('\t')).join('\n');
      return `${headerRow}\n${bodyRows}`;
    }) as ProfileDeps['formatTable'],
    exitWithUsageError: mock((msg: string) => {
      consoleOutput.push(`Error: ${msg}`);
      process.exit(2);
    }) as ProfileDeps['exitWithUsageError'],
    prompt: mock(async () => '') as ProfileDeps['prompt'],
    promptConfirm: mock(async () => false) as ProfileDeps['promptConfirm'],
    promptPassword: mock(async () => '') as ProfileDeps['promptPassword'],
    promptSelect: mock(async () => 'testnet') as ProfileDeps['promptSelect'],
    closePrompts: mock(() => {}) as ProfileDeps['closePrompts'],
    getStellarAccount: mock(() => null) as ProfileDeps['getStellarAccount'],
    generateStellarAccount: mock(() => {}) as ProfileDeps['generateStellarAccount'],
    fundViaFriendbot: mock(async () => false) as ProfileDeps['fundViaFriendbot'],
    ...overrides,
  };
}

describe('profile command', () => {
  beforeEach(() => {
    consoleOutput = [];
    exitCode = undefined;

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

  describe('list subcommand', () => {
    test('success with profiles', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const listCommand = (profileCommand.subCommands as any)?.list;
      expect(listCommand).toBeDefined();

      await listCommand!.run!({ args: { json: false, 'no-input': false }, rawArgs: [], cmd: listCommand! });

      expect(mockDeps.listProfiles).toHaveBeenCalledTimes(1);
      const output = consoleOutput.join('\n');
      expect(output).toContain('NAME');
      expect(output).toContain('URL');
      expect(output).toContain('default');
      expect(output).toContain('https://channels.example.com');
    });

    test('empty profiles list', async () => {
      const mockDeps = createMockDeps({
        listProfiles: mock(() => []) as ProfileDeps['listProfiles'],
      });
      const profileCommand = createProfileCommand(mockDeps);
      const listCommand = (profileCommand.subCommands as any)?.list;
      await listCommand!.run!({ args: { json: false, 'no-input': false }, rawArgs: [], cmd: listCommand! });

      expect(mockDeps.listProfiles).toHaveBeenCalledTimes(1);
      const output = consoleOutput.join('\n');
      expect(output).toContain('No profiles configured');
      expect(output).toContain('oz-channels profile init');
    });

    test('JSON output with extra fields', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const listCommand = (profileCommand.subCommands as any)?.list;
      await listCommand!.run!({ args: { json: true, 'no-input': false }, rawArgs: [], cmd: listCommand! });

      expect(mockDeps.listProfiles).toHaveBeenCalledTimes(1);
      const output = consoleOutput.join('\n');
      const parsed = JSON.parse(output);

      expect(parsed.profiles).toHaveLength(2);
      expect(parsed.profiles[0]).toMatchObject({
        name: 'default',
        url: 'https://channels.example.com',
        default: true,
        protected: false,
        plugin_id: 'channels',
        has_admin_secret: true,
        network: 'testnet',
        test_account: 'test-account',
        smoke_contract: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      });
      expect(parsed.profiles[1]).toMatchObject({
        name: 'production',
        url: 'https://prod.channels.example.com',
        default: false,
        protected: true,
        plugin_id: 'prod-channels',
        has_admin_secret: false,
        network: 'mainnet',
      });
    });

    test('empty profiles JSON output', async () => {
      const mockDeps = createMockDeps({
        listProfiles: mock(() => []) as ProfileDeps['listProfiles'],
      });
      const profileCommand = createProfileCommand(mockDeps);
      const listCommand = (profileCommand.subCommands as any)?.list;
      await listCommand!.run!({ args: { json: true, 'no-input': false }, rawArgs: [], cmd: listCommand! });

      const output = consoleOutput.join('\n');
      const parsed = JSON.parse(output);
      expect(parsed).toEqual({ profiles: [] });
    });

    test('table output includes PLUGIN ID and ADMIN columns', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const listCommand = (profileCommand.subCommands as any)?.list;
      await listCommand!.run!({ args: { json: false, 'no-input': false }, rawArgs: [], cmd: listCommand! });

      const output = consoleOutput.join('\n');
      expect(output).toContain('PLUGIN ID');
      expect(output).toContain('ADMIN');
    });

    test('shows default marker for default profile', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const listCommand = (profileCommand.subCommands as any)?.list;
      await listCommand!.run!({ args: { json: false, 'no-input': false }, rawArgs: [], cmd: listCommand! });

      const output = consoleOutput.join('\n');
      expect(output).toContain('(default)');
    });

    test('shows protected marker for protected profile', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const listCommand = (profileCommand.subCommands as any)?.list;
      await listCommand!.run!({ args: { json: false, 'no-input': false }, rawArgs: [], cmd: listCommand! });

      const output = consoleOutput.join('\n');
      expect(output).toContain('(protected)');
    });
  });

  describe('show subcommand', () => {
    test('success with profile name', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const showCommand = (profileCommand.subCommands as any)?.show;
      expect(showCommand).toBeDefined();

      await showCommand!.run!({
        args: { name: 'default', json: false, 'no-input': false },
        rawArgs: [],
        cmd: showCommand!,
      });

      expect(mockDeps.getProfile).toHaveBeenCalledWith('default');
      const output = consoleOutput.join('\n');
      expect(output).toContain('Profile:');
      expect(output).toContain('default');
      expect(output).toContain('URL:');
      expect(output).toContain('https://channels.example.com');
      expect(output).toContain('API Key:');
      expect(output).toContain('********');
    });

    test('success with default profile when no name specified', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const showCommand = (profileCommand.subCommands as any)?.show;

      await showCommand!.run!({
        args: { name: undefined, json: false, 'no-input': false },
        rawArgs: [],
        cmd: showCommand!,
      });

      expect(mockDeps.listProfiles).toHaveBeenCalled();
      expect(mockDeps.getProfile).toHaveBeenCalledWith('default');
      const output = consoleOutput.join('\n');
      expect(output).toContain('default');
    });

    test('shows admin secret status', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const showCommand = (profileCommand.subCommands as any)?.show;

      await showCommand!.run!({
        args: { name: 'default', json: false, 'no-input': false },
        rawArgs: [],
        cmd: showCommand!,
      });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Admin Secret:');
      expect(output).toContain('********');
    });

    test('shows admin secret not set for profile without it', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const showCommand = (profileCommand.subCommands as any)?.show;

      await showCommand!.run!({
        args: { name: 'production', json: false, 'no-input': false },
        rawArgs: [],
        cmd: showCommand!,
      });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Admin Secret:');
      expect(output).toContain('not set');
    });

    test('no profile found exits with error', async () => {
      const mockDeps = createMockDeps({
        getProfile: mock(() => null) as ProfileDeps['getProfile'],
      });
      const profileCommand = createProfileCommand(mockDeps);
      const showCommand = (profileCommand.subCommands as any)?.show;

      try {
        await showCommand!.run!({
          args: { name: 'nonexistent', json: false, 'no-input': false },
          rawArgs: [],
          cmd: showCommand!,
        });
      } catch (e) {
        // Expected to throw due to process.exit mock
      }

      expect(exitCode).toBe(2);
      const output = consoleOutput.join('\n');
      expect(output).toContain("Profile 'nonexistent' not found");
    });

    test('no default profile and no name specified exits with error', async () => {
      const mockDeps = createMockDeps({
        listProfiles: mock(() => [
          { ...mockProfiles[0], isDefault: false },
          { ...mockProfiles[1], isDefault: false },
        ]) as ProfileDeps['listProfiles'],
      });
      const profileCommand = createProfileCommand(mockDeps);
      const showCommand = (profileCommand.subCommands as any)?.show;

      try {
        await showCommand!.run!({
          args: { name: undefined, json: false, 'no-input': false },
          rawArgs: [],
          cmd: showCommand!,
        });
      } catch (e) {
        // Expected to throw due to process.exit mock
      }

      expect(exitCode).toBe(2);
      const output = consoleOutput.join('\n');
      expect(output).toContain('No profile specified and no default profile set');
    });

    test('JSON output includes all oz-channels fields', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const showCommand = (profileCommand.subCommands as any)?.show;

      await showCommand!.run!({
        args: { name: 'default', json: true, 'no-input': false },
        rawArgs: [],
        cmd: showCommand!,
      });

      const output = consoleOutput.join('\n');
      const parsed = JSON.parse(output);

      expect(parsed).toMatchObject({
        name: 'default',
        url: 'https://channels.example.com',
        api_key: '********',
        plugin_id: 'channels',
        admin_secret: '********',
        network: 'testnet',
        test_account: 'test-account',
        smoke_contract: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        default: true,
        protected: false,
      });
    });

    test('JSON output shows null for admin_secret when not set', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const showCommand = (profileCommand.subCommands as any)?.show;

      await showCommand!.run!({
        args: { name: 'production', json: true, 'no-input': false },
        rawArgs: [],
        cmd: showCommand!,
      });

      const output = consoleOutput.join('\n');
      const parsed = JSON.parse(output);

      expect(parsed.admin_secret).toBeNull();
    });

    test('shows protected status in text output', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const showCommand = (profileCommand.subCommands as any)?.show;

      await showCommand!.run!({
        args: { name: 'production', json: false, 'no-input': false },
        rawArgs: [],
        cmd: showCommand!,
      });

      const output = consoleOutput.join('\n');
      expect(output).toContain('protected');
    });

    test('shows network field', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const showCommand = (profileCommand.subCommands as any)?.show;

      await showCommand!.run!({
        args: { name: 'default', json: false, 'no-input': false },
        rawArgs: [],
        cmd: showCommand!,
      });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Network:');
      expect(output).toContain('testnet');
    });

    test('shows test account field', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const showCommand = (profileCommand.subCommands as any)?.show;

      await showCommand!.run!({
        args: { name: 'default', json: false, 'no-input': false },
        rawArgs: [],
        cmd: showCommand!,
      });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Test Account:');
      expect(output).toContain('test-account');
    });

    test('shows smoke contract field', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const showCommand = (profileCommand.subCommands as any)?.show;

      await showCommand!.run!({
        args: { name: 'default', json: false, 'no-input': false },
        rawArgs: [],
        cmd: showCommand!,
      });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Smoke Contract:');
      expect(output).toContain('CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC');
    });

    test('shows plugin ID field', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const showCommand = (profileCommand.subCommands as any)?.show;

      await showCommand!.run!({
        args: { name: 'default', json: false, 'no-input': false },
        rawArgs: [],
        cmd: showCommand!,
      });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Plugin ID:');
      expect(output).toContain('channels');
    });
  });

  describe('path subcommand', () => {
    test('success showing paths', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const pathCommand = (profileCommand.subCommands as any)?.path;
      expect(pathCommand).toBeDefined();

      await pathCommand!.run!({ args: { json: false, 'no-input': false }, rawArgs: [], cmd: pathCommand! });

      expect(mockDeps.getConfigPaths).toHaveBeenCalledTimes(1);
      const output = consoleOutput.join('\n');
      expect(output).toContain('User config:');
      expect(output).toContain('/home/user/.config/oz-channels/config.yaml');
      expect(output).toContain('Project config:');
      expect(output).toContain('/workspace/project/.oz-channels.yaml');
    });

    test('JSON output', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const pathCommand = (profileCommand.subCommands as any)?.path;

      await pathCommand!.run!({ args: { json: true, 'no-input': false }, rawArgs: [], cmd: pathCommand! });

      expect(mockDeps.getConfigPaths).toHaveBeenCalledTimes(1);
      const output = consoleOutput.join('\n');
      const parsed = JSON.parse(output);

      expect(parsed).toEqual({
        user: '/home/user/.config/oz-channels/config.yaml',
        project: '/workspace/project/.oz-channels.yaml',
      });
    });

    test('shows only user config when no project config', async () => {
      const mockDeps = createMockDeps({
        getConfigPaths: mock(() => ({
          user: '/home/user/.config/oz-channels/config.yaml',
          project: null,
        })) as ProfileDeps['getConfigPaths'],
      });
      const profileCommand = createProfileCommand(mockDeps);
      const pathCommand = (profileCommand.subCommands as any)?.path;
      await pathCommand!.run!({ args: { json: false, 'no-input': false }, rawArgs: [], cmd: pathCommand! });

      const output = consoleOutput.join('\n');
      expect(output).toContain('User config:');
      expect(output).toContain('/home/user/.config/oz-channels/config.yaml');
      expect(output).not.toContain('Project config:');
    });
  });

  describe('use subcommand', () => {
    test('success setting default', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const useCommand = (profileCommand.subCommands as any)?.use;
      expect(useCommand).toBeDefined();

      await useCommand!.run!({
        args: { name: 'production' },
        rawArgs: [],
        cmd: useCommand!,
      });

      expect(mockDeps.setDefaultProfile).toHaveBeenCalledWith('production');
      const output = consoleOutput.join('\n');
      expect(output).toContain("Default profile set to 'production'");
    });

    test('profile not found exits with error', async () => {
      const mockDeps = createMockDeps({
        setDefaultProfile: mock(() => false) as ProfileDeps['setDefaultProfile'],
      });
      const profileCommand = createProfileCommand(mockDeps);
      const useCommand = (profileCommand.subCommands as any)?.use;

      try {
        await useCommand!.run!({
          args: { name: 'nonexistent' },
          rawArgs: [],
          cmd: useCommand!,
        });
      } catch (e) {
        // Expected to throw due to process.exit mock
      }

      expect(exitCode).toBe(2);
      const output = consoleOutput.join('\n');
      expect(output).toContain("Profile 'nonexistent' not found");
    });

    test('no profile name provided exits with error', async () => {
      const mockDeps = createMockDeps();
      const profileCommand = createProfileCommand(mockDeps);
      const useCommand = (profileCommand.subCommands as any)?.use;

      try {
        await useCommand!.run!({
          args: { name: undefined },
          rawArgs: [],
          cmd: useCommand!,
        });
      } catch (e) {
        // Expected to throw due to process.exit mock
      }

      expect(exitCode).toBe(2);
      const output = consoleOutput.join('\n');
      expect(output).toContain('Profile name is required');
    });
  });

  describe('delete subcommand', () => {
    test('profile not found exits with error', async () => {
      const mockDeps = createMockDeps({
        deleteProfile: mock(() => false) as ProfileDeps['deleteProfile'],
      });
      const profileCommand = createProfileCommand(mockDeps);
      const deleteCommand = (profileCommand.subCommands as any)?.delete;

      try {
        await deleteCommand!.run!({
          args: { name: 'nonexistent', json: false, 'no-input': true },
          rawArgs: [],
          cmd: deleteCommand!,
        });
      } catch (e) {
        // Expected to throw due to process.exit mock
      }

      expect(exitCode).toBe(2);
      const output = consoleOutput.join('\n');
      expect(output).toContain("Profile 'nonexistent' not found");
    });
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

  test('profile command has correct metadata', () => {
    const mockDeps = createMockDeps();
    const profileCommand = createProfileCommand(mockDeps);
    expect((profileCommand.meta as any)?.name).toBe('profile');
    expect((profileCommand.meta as any)?.description).toBe('Manage connection profiles');
  });
});
