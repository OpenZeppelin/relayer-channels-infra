import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { type ChannelsDeps, createChannelsCommand } from './channels.js';

// Store original functions
const originalExit = process.exit;
const originalConsoleLog = console.log;

let exitCode: number | null = null;
let consoleOutput: string[] = [];

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
  listData?: string[];
  setError?: Error;
  setResponse?: { ok: boolean; appliedRelayerIds: string[] };
}) {
  return {
    listChannelAccounts: mock(async () => ({
      relayerIds: options?.listData ?? ['relayer-1', 'relayer-2'],
    })),
    setChannelAccounts: mock(async (ids: string[]) => {
      if (options?.setError) throw options.setError;
      return options?.setResponse ?? { ok: true, appliedRelayerIds: ids };
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
  configOptions?: Parameters<typeof createMockConfig>[0],
  clientOptions?: Parameters<typeof createMockClient>[0],
  overrides?: Partial<ChannelsDeps>,
): ChannelsDeps {
  const mockConfig = configOptions === null ? null : createMockConfig(configOptions);
  const mockClient = createMockClient(clientOptions);

  return {
    resolveConfig: mock(() => mockConfig) as unknown as ChannelsDeps['resolveConfig'],
    createClient: mock(() => mockClient) as unknown as ChannelsDeps['createClient'],
    output: mock((data: unknown, opts?: { json?: boolean }) => {
      if (opts?.json) {
        consoleOutput.push(JSON.stringify(data, null, 2));
      }
    }) as ChannelsDeps['output'],
    success: mock((msg: string) => {
      consoleOutput.push(`Success: ${msg}`);
    }) as ChannelsDeps['success'],
    handleApiError: mock((err: unknown) => {
      const error = err as Error & { response?: { status?: number } };
      const status = error.response?.status;

      let code = 1; // GeneralError
      if (status === 401 || status === 403) {
        code = 3; // AuthenticationFailure
      } else if (status === 404) {
        code = 4; // ResourceNotFound
      }

      consoleOutput.push(`Error: ${error.message}`);
      process.exit(code);
    }) as ChannelsDeps['handleApiError'],
    exitWithUsageError: mock((msg: string) => {
      consoleOutput.push(`Error: ${msg}`);
      process.exit(2);
    }) as ChannelsDeps['exitWithUsageError'],
    confirmProtectedOperation: mock(async () => true) as ChannelsDeps['confirmProtectedOperation'],
    promptConfirm: mock(async () => true) as ChannelsDeps['promptConfirm'],
    closePrompts: mock(() => {}) as ChannelsDeps['closePrompts'],
    ...overrides,
  };
}

describe('channels command', () => {
  beforeEach(() => {
    exitCode = null;
    consoleOutput = [];

    // Mock process.exit
    process.exit = mock((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    // Mock console.log
    console.log = mock((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    process.exit = originalExit;
    console.log = originalConsoleLog;
  });

  describe('list subcommand', () => {
    test('lists channels successfully', async () => {
      const mockDeps = createMockDeps(undefined, {
        listData: ['relayer-1', 'relayer-2', 'relayer-3'],
      });
      const channelsCommand = createChannelsCommand(mockDeps);
      const listCommand = (channelsCommand.subCommands as any)?.list;

      await listCommand?.run?.({ args: { json: false }, rawArgs: [], cmd: listCommand } as never);

      const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
      expect(mockClient.listChannelAccounts).toHaveBeenCalledTimes(1);
      expect(consoleOutput.some((line) => line.includes('Channel Accounts (3)'))).toBe(true);
      expect(consoleOutput.some((line) => line.includes('relayer-1'))).toBe(true);
      expect(consoleOutput.some((line) => line.includes('relayer-2'))).toBe(true);
      expect(consoleOutput.some((line) => line.includes('relayer-3'))).toBe(true);
    });

    test('handles empty channel list', async () => {
      const mockDeps = createMockDeps(undefined, { listData: [] });
      const channelsCommand = createChannelsCommand(mockDeps);
      const listCommand = (channelsCommand.subCommands as any)?.list;

      await listCommand?.run?.({ args: { json: false }, rawArgs: [], cmd: listCommand } as never);

      const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
      expect(mockClient.listChannelAccounts).toHaveBeenCalledTimes(1);
      expect(consoleOutput.some((line) => line.includes('No channel accounts configured'))).toBe(
        true,
      );
    });

    test('outputs JSON when --json flag is provided', async () => {
      const mockDeps = createMockDeps(undefined, { listData: ['relayer-1', 'relayer-2'] });
      const channelsCommand = createChannelsCommand(mockDeps);
      const listCommand = (channelsCommand.subCommands as any)?.list;

      await listCommand?.run?.({ args: { json: true }, rawArgs: [], cmd: listCommand } as never);

      const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
      expect(mockClient.listChannelAccounts).toHaveBeenCalledTimes(1);
      const parsed = findJsonOutput() as { relayerIds: string[] };
      expect(parsed.relayerIds).toEqual(['relayer-1', 'relayer-2']);
    });

    test('requires admin secret', async () => {
      const mockDeps = createMockDeps({ adminSecret: null });
      const channelsCommand = createChannelsCommand(mockDeps);
      const listCommand = (channelsCommand.subCommands as any)?.list;

      await expect(
        listCommand?.run?.({ args: { json: false }, rawArgs: [], cmd: listCommand } as never),
      ).rejects.toThrow('process.exit');

      expect(exitCode).toBe(2); // InvalidUsage
      expect(consoleOutput.some((line) => line.includes('Admin secret is required'))).toBe(true);
    });

    test('requires configuration', async () => {
      const mockDeps = createMockDeps(null as unknown as undefined);
      // Override to return null config
      mockDeps.resolveConfig = mock(() => null) as ChannelsDeps['resolveConfig'];
      const channelsCommand = createChannelsCommand(mockDeps);
      const listCommand = (channelsCommand.subCommands as any)?.list;

      await expect(
        listCommand?.run?.({ args: { json: false }, rawArgs: [], cmd: listCommand } as never),
      ).rejects.toThrow('process.exit');

      expect(exitCode).toBe(2); // InvalidUsage
      expect(consoleOutput.some((line) => line.includes('No configuration found'))).toBe(true);
    });
  });

  describe('set subcommand', () => {
    test('sets channels successfully', async () => {
      const newIds = ['new-relayer-1', 'new-relayer-2'];
      const mockDeps = createMockDeps();
      const channelsCommand = createChannelsCommand(mockDeps);
      const setCommand = (channelsCommand.subCommands as any)?.set;

      await setCommand?.run?.({
        args: { json: false, 'no-input': true, ids: newIds[0], _: [newIds[1]] },
        rawArgs: [],
        cmd: setCommand,
      } as never);

      const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
      expect(mockClient.setChannelAccounts).toHaveBeenCalledWith(newIds);
      expect(consoleOutput.some((line) => line.includes('Set 2 channel account(s)'))).toBe(true);
    });

    test('prompts for confirmation on protected profile', async () => {
      const mockConfirmProtected = mock(async () => true);
      const mockDeps = createMockDeps({ isProtected: true, profileName: 'production' }, undefined, {
        confirmProtectedOperation:
          mockConfirmProtected as ChannelsDeps['confirmProtectedOperation'],
      });
      const channelsCommand = createChannelsCommand(mockDeps);
      const setCommand = (channelsCommand.subCommands as any)?.set;

      await setCommand?.run?.({
        args: { json: false, 'no-input': false, ids: 'relayer-1', _: [] },
        rawArgs: [],
        cmd: setCommand,
      } as never);

      expect(mockConfirmProtected).toHaveBeenCalledWith({
        profileName: 'production',
        operation: 'set channel accounts',
        summary: '1 relayer ID(s)',
        noInput: false,
      });
    });

    test('cancels when protected profile confirmation is declined', async () => {
      const mockDeps = createMockDeps({ isProtected: true }, undefined, {
        confirmProtectedOperation: mock(
          async () => false,
        ) as ChannelsDeps['confirmProtectedOperation'],
      });
      const channelsCommand = createChannelsCommand(mockDeps);
      const setCommand = (channelsCommand.subCommands as any)?.set;

      await expect(
        setCommand?.run?.({
          args: { json: false, 'no-input': false, ids: 'relayer-1', _: [] },
          rawArgs: [],
          cmd: setCommand,
        } as never),
      ).rejects.toThrow('process.exit');

      expect(exitCode).toBe(0);
      expect(consoleOutput.some((line) => line.includes('Operation cancelled'))).toBe(true);
    });

    test('prompts for confirmation on non-protected profile when interactive', async () => {
      const mockPromptConfirm = mock(async () => true);
      const mockClosePrompts = mock(() => {});
      const mockDeps = createMockDeps({ isProtected: false }, undefined, {
        promptConfirm: mockPromptConfirm as ChannelsDeps['promptConfirm'],
        closePrompts: mockClosePrompts as ChannelsDeps['closePrompts'],
      });
      const channelsCommand = createChannelsCommand(mockDeps);
      const setCommand = (channelsCommand.subCommands as any)?.set;

      await setCommand?.run?.({
        args: { json: false, 'no-input': false, ids: 'relayer-1', _: ['relayer-2'] },
        rawArgs: [],
        cmd: setCommand,
      } as never);

      expect(mockPromptConfirm).toHaveBeenCalledWith(
        'Replace all channel accounts with these 2 relayer(s)?',
      );
      expect(mockClosePrompts).toHaveBeenCalled();
    });

    test('cancels when interactive confirmation is declined', async () => {
      const mockDeps = createMockDeps({ isProtected: false }, undefined, {
        promptConfirm: mock(async () => false) as ChannelsDeps['promptConfirm'],
      });
      const channelsCommand = createChannelsCommand(mockDeps);
      const setCommand = (channelsCommand.subCommands as any)?.set;

      await setCommand?.run?.({
        args: { json: false, 'no-input': false, ids: 'relayer-1', _: [] },
        rawArgs: [],
        cmd: setCommand,
      } as never);

      expect(consoleOutput.some((line) => line.includes('Operation cancelled'))).toBe(true);
    });

    test('skips confirmation with --no-input flag', async () => {
      const mockPromptConfirm = mock(async () => true);
      const mockDeps = createMockDeps({ isProtected: false }, undefined, {
        promptConfirm: mockPromptConfirm as ChannelsDeps['promptConfirm'],
      });
      const channelsCommand = createChannelsCommand(mockDeps);
      const setCommand = (channelsCommand.subCommands as any)?.set;

      await setCommand?.run?.({
        args: { json: false, 'no-input': true, ids: 'relayer-1', _: [] },
        rawArgs: [],
        cmd: setCommand,
      } as never);

      expect(mockPromptConfirm).not.toHaveBeenCalled();
    });

    test('outputs JSON on success when --json flag is provided', async () => {
      const mockDeps = createMockDeps(undefined, {
        setResponse: { ok: true, appliedRelayerIds: ['relayer-1'] },
      });
      const channelsCommand = createChannelsCommand(mockDeps);
      const setCommand = (channelsCommand.subCommands as any)?.set;

      await setCommand?.run?.({
        args: { json: true, 'no-input': true, ids: 'relayer-1', _: [] },
        rawArgs: [],
        cmd: setCommand,
      } as never);

      const parsed = findJsonOutput() as { ok: boolean; appliedRelayerIds: string[] };
      expect(parsed.ok).toBe(true);
      expect(parsed.appliedRelayerIds).toEqual(['relayer-1']);
    });
  });

  describe('add subcommand', () => {
    test('adds new relayer ID successfully', async () => {
      const mockDeps = createMockDeps(undefined, { listData: ['existing-1', 'existing-2'] });
      const channelsCommand = createChannelsCommand(mockDeps);
      const addCommand = (channelsCommand.subCommands as any)?.add;

      await addCommand?.run?.({
        args: { json: false, 'no-input': true, id: 'new-relayer' },
        rawArgs: [],
        cmd: addCommand,
      } as never);

      const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
      expect(mockClient.listChannelAccounts).toHaveBeenCalledTimes(1);
      expect(mockClient.setChannelAccounts).toHaveBeenCalledWith([
        'existing-1',
        'existing-2',
        'new-relayer',
      ]);
      expect(consoleOutput.some((line) => line.includes("Added 'new-relayer'"))).toBe(true);
    });

    test('reports when ID already exists', async () => {
      const mockDeps = createMockDeps(undefined, { listData: ['existing-1', 'new-relayer'] });
      const channelsCommand = createChannelsCommand(mockDeps);
      const addCommand = (channelsCommand.subCommands as any)?.add;

      await addCommand?.run?.({
        args: { json: false, 'no-input': true, id: 'new-relayer' },
        rawArgs: [],
        cmd: addCommand,
      } as never);

      const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
      expect(mockClient.listChannelAccounts).toHaveBeenCalledTimes(1);
      expect(mockClient.setChannelAccounts).not.toHaveBeenCalled();
      expect(
        consoleOutput.some((line) => line.includes("'new-relayer' is already in the channel")),
      ).toBe(true);
    });

    test('outputs JSON when ID already exists with --json flag', async () => {
      const mockDeps = createMockDeps(undefined, { listData: ['existing-relayer'] });
      const channelsCommand = createChannelsCommand(mockDeps);
      const addCommand = (channelsCommand.subCommands as any)?.add;

      await addCommand?.run?.({
        args: { json: true, 'no-input': true, id: 'existing-relayer' },
        rawArgs: [],
        cmd: addCommand,
      } as never);

      const parsed = findJsonOutput() as { ok: boolean; message: string };
      expect(parsed.ok).toBe(true);
      expect(parsed.message).toBe('Already exists');
    });

    test('prompts for confirmation on protected profile', async () => {
      const mockConfirmProtected = mock(async () => true);
      const mockDeps = createMockDeps(
        { isProtected: true, profileName: 'prod' },
        { listData: [] },
        {
          confirmProtectedOperation:
            mockConfirmProtected as ChannelsDeps['confirmProtectedOperation'],
        },
      );
      const channelsCommand = createChannelsCommand(mockDeps);
      const addCommand = (channelsCommand.subCommands as any)?.add;

      await addCommand?.run?.({
        args: { json: false, 'no-input': false, id: 'new-relayer' },
        rawArgs: [],
        cmd: addCommand,
      } as never);

      expect(mockConfirmProtected).toHaveBeenCalledWith({
        profileName: 'prod',
        operation: 'add channel account',
        summary: 'Relayer ID: new-relayer',
        noInput: false,
      });
    });

    test('cancels when protected profile confirmation is declined', async () => {
      const mockDeps = createMockDeps({ isProtected: true }, undefined, {
        confirmProtectedOperation: mock(
          async () => false,
        ) as ChannelsDeps['confirmProtectedOperation'],
      });
      const channelsCommand = createChannelsCommand(mockDeps);
      const addCommand = (channelsCommand.subCommands as any)?.add;

      await expect(
        addCommand?.run?.({
          args: { json: false, 'no-input': false, id: 'new-relayer' },
          rawArgs: [],
          cmd: addCommand,
        } as never),
      ).rejects.toThrow('process.exit');

      expect(exitCode).toBe(0);
      expect(consoleOutput.some((line) => line.includes('Operation cancelled'))).toBe(true);
    });

    test('prompts for confirmation on non-protected profile when interactive', async () => {
      const mockPromptConfirm = mock(async () => true);
      const mockClosePrompts = mock(() => {});
      const mockDeps = createMockDeps(
        { isProtected: false },
        { listData: [] },
        {
          promptConfirm: mockPromptConfirm as ChannelsDeps['promptConfirm'],
          closePrompts: mockClosePrompts as ChannelsDeps['closePrompts'],
        },
      );
      const channelsCommand = createChannelsCommand(mockDeps);
      const addCommand = (channelsCommand.subCommands as any)?.add;

      await addCommand?.run?.({
        args: { json: false, 'no-input': false, id: 'new-relayer' },
        rawArgs: [],
        cmd: addCommand,
      } as never);

      expect(mockPromptConfirm).toHaveBeenCalledWith("Add 'new-relayer' to channel accounts?");
      expect(mockClosePrompts).toHaveBeenCalled();
    });
  });

  describe('remove subcommand', () => {
    test('removes existing relayer ID successfully', async () => {
      const mockDeps = createMockDeps(undefined, {
        listData: ['relayer-1', 'relayer-2', 'relayer-3'],
      });
      const channelsCommand = createChannelsCommand(mockDeps);
      const removeCommand = (channelsCommand.subCommands as any)?.remove;

      await removeCommand?.run?.({
        args: { json: false, 'no-input': true, id: 'relayer-2' },
        rawArgs: [],
        cmd: removeCommand,
      } as never);

      const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
      expect(mockClient.listChannelAccounts).toHaveBeenCalledTimes(1);
      expect(mockClient.setChannelAccounts).toHaveBeenCalledWith(['relayer-1', 'relayer-3']);
      expect(consoleOutput.some((line) => line.includes("Removed 'relayer-2'"))).toBe(true);
    });

    test('reports when ID not found', async () => {
      const mockDeps = createMockDeps(undefined, { listData: ['relayer-1', 'relayer-2'] });
      const channelsCommand = createChannelsCommand(mockDeps);
      const removeCommand = (channelsCommand.subCommands as any)?.remove;

      await removeCommand?.run?.({
        args: { json: false, 'no-input': true, id: 'non-existent' },
        rawArgs: [],
        cmd: removeCommand,
      } as never);

      const mockClient = (mockDeps.createClient as ReturnType<typeof mock>).mock.results[0]?.value;
      expect(mockClient.listChannelAccounts).toHaveBeenCalledTimes(1);
      expect(mockClient.setChannelAccounts).not.toHaveBeenCalled();
      expect(
        consoleOutput.some((line) => line.includes("'non-existent' is not in the channel")),
      ).toBe(true);
    });

    test('outputs JSON when ID not found with --json flag', async () => {
      const mockDeps = createMockDeps(undefined, { listData: ['relayer-1'] });
      const channelsCommand = createChannelsCommand(mockDeps);
      const removeCommand = (channelsCommand.subCommands as any)?.remove;

      await removeCommand?.run?.({
        args: { json: true, 'no-input': true, id: 'non-existent' },
        rawArgs: [],
        cmd: removeCommand,
      } as never);

      const parsed = findJsonOutput() as { ok: boolean; message: string };
      expect(parsed.ok).toBe(true);
      expect(parsed.message).toBe('Not found');
    });

    test('prompts for confirmation on protected profile', async () => {
      const mockConfirmProtected = mock(async () => true);
      const mockDeps = createMockDeps(
        { isProtected: true, profileName: 'staging' },
        { listData: ['relayer-1'] },
        {
          confirmProtectedOperation:
            mockConfirmProtected as ChannelsDeps['confirmProtectedOperation'],
        },
      );
      const channelsCommand = createChannelsCommand(mockDeps);
      const removeCommand = (channelsCommand.subCommands as any)?.remove;

      await removeCommand?.run?.({
        args: { json: false, 'no-input': false, id: 'relayer-1' },
        rawArgs: [],
        cmd: removeCommand,
      } as never);

      expect(mockConfirmProtected).toHaveBeenCalledWith({
        profileName: 'staging',
        operation: 'remove channel account',
        summary: 'Relayer ID: relayer-1',
        noInput: false,
      });
    });

    test('cancels when protected profile confirmation is declined', async () => {
      const mockDeps = createMockDeps({ isProtected: true }, undefined, {
        confirmProtectedOperation: mock(
          async () => false,
        ) as ChannelsDeps['confirmProtectedOperation'],
      });
      const channelsCommand = createChannelsCommand(mockDeps);
      const removeCommand = (channelsCommand.subCommands as any)?.remove;

      await expect(
        removeCommand?.run?.({
          args: { json: false, 'no-input': false, id: 'relayer-1' },
          rawArgs: [],
          cmd: removeCommand,
        } as never),
      ).rejects.toThrow('process.exit');

      expect(exitCode).toBe(0);
      expect(consoleOutput.some((line) => line.includes('Operation cancelled'))).toBe(true);
    });

    test('prompts for confirmation on non-protected profile when interactive', async () => {
      const mockPromptConfirm = mock(async () => true);
      const mockClosePrompts = mock(() => {});
      const mockDeps = createMockDeps(
        { isProtected: false },
        { listData: ['relayer-1'] },
        {
          promptConfirm: mockPromptConfirm as ChannelsDeps['promptConfirm'],
          closePrompts: mockClosePrompts as ChannelsDeps['closePrompts'],
        },
      );
      const channelsCommand = createChannelsCommand(mockDeps);
      const removeCommand = (channelsCommand.subCommands as any)?.remove;

      await removeCommand?.run?.({
        args: { json: false, 'no-input': false, id: 'relayer-1' },
        rawArgs: [],
        cmd: removeCommand,
      } as never);

      expect(mockPromptConfirm).toHaveBeenCalledWith("Remove 'relayer-1' from channel accounts?");
      expect(mockClosePrompts).toHaveBeenCalled();
    });

    test('cancels when interactive confirmation is declined', async () => {
      const mockDeps = createMockDeps(
        { isProtected: false },
        { listData: ['relayer-1'] },
        { promptConfirm: mock(async () => false) as ChannelsDeps['promptConfirm'] },
      );
      const channelsCommand = createChannelsCommand(mockDeps);
      const removeCommand = (channelsCommand.subCommands as any)?.remove;

      await removeCommand?.run?.({
        args: { json: false, 'no-input': false, id: 'relayer-1' },
        rawArgs: [],
        cmd: removeCommand,
      } as never);

      expect(consoleOutput.some((line) => line.includes('Operation cancelled'))).toBe(true);
    });

    test('outputs JSON on success when --json flag is provided', async () => {
      const mockDeps = createMockDeps(undefined, { listData: ['relayer-1', 'relayer-2'] });
      const channelsCommand = createChannelsCommand(mockDeps);
      const removeCommand = (channelsCommand.subCommands as any)?.remove;

      await removeCommand?.run?.({
        args: { json: true, 'no-input': true, id: 'relayer-1' },
        rawArgs: [],
        cmd: removeCommand,
      } as never);

      const parsed = findJsonOutput() as { ok: boolean; appliedRelayerIds: string[] };
      expect(parsed.ok).toBe(true);
      expect(parsed.appliedRelayerIds).toEqual(['relayer-2']);
    });
  });

  describe('error handling', () => {
    test('handles API error on list', async () => {
      const apiError = new Error('Network error') as Error & { response?: { status: number } };
      apiError.response = { status: 500 };

      const mockClient = {
        listChannelAccounts: mock(() => Promise.reject(apiError)),
        setChannelAccounts: mock(() => Promise.resolve({ ok: true, appliedRelayerIds: [] })),
      };

      const mockDeps = createMockDeps();
      mockDeps.createClient = mock(() => mockClient) as unknown as ChannelsDeps['createClient'];

      const channelsCommand = createChannelsCommand(mockDeps);
      const listCommand = (channelsCommand.subCommands as any)?.list;

      await expect(
        listCommand?.run?.({ args: { json: false }, rawArgs: [], cmd: listCommand } as never),
      ).rejects.toThrow('process.exit');

      expect(exitCode).toBe(1); // GeneralError
    });

    test('handles API error on set', async () => {
      const apiError = new Error('Server error') as Error & { response?: { status: number } };
      apiError.response = { status: 500 };

      const mockDeps = createMockDeps(undefined, { setError: apiError });
      const channelsCommand = createChannelsCommand(mockDeps);
      const setCommand = (channelsCommand.subCommands as any)?.set;

      await expect(
        setCommand?.run?.({
          args: { json: false, 'no-input': true, ids: 'relayer-1', _: [] },
          rawArgs: [],
          cmd: setCommand,
        } as never),
      ).rejects.toThrow('process.exit');

      expect(exitCode).toBe(1); // GeneralError
    });

    test('handles 401 authentication error', async () => {
      const authError = new Error('Unauthorized') as Error & { response?: { status: number } };
      authError.response = { status: 401 };

      const mockClient = {
        listChannelAccounts: mock(() => Promise.reject(authError)),
        setChannelAccounts: mock(() => Promise.resolve({ ok: true, appliedRelayerIds: [] })),
      };

      const mockDeps = createMockDeps();
      mockDeps.createClient = mock(() => mockClient) as unknown as ChannelsDeps['createClient'];

      const channelsCommand = createChannelsCommand(mockDeps);
      const listCommand = (channelsCommand.subCommands as any)?.list;

      await expect(
        listCommand?.run?.({ args: { json: false }, rawArgs: [], cmd: listCommand } as never),
      ).rejects.toThrow('process.exit');

      expect(exitCode).toBe(3); // AuthenticationFailure
    });

    test('handles 404 not found error', async () => {
      const notFoundError = new Error('Not found') as Error & { response?: { status: number } };
      notFoundError.response = { status: 404 };

      const mockClient = {
        listChannelAccounts: mock(() => Promise.reject(notFoundError)),
        setChannelAccounts: mock(() => Promise.resolve({ ok: true, appliedRelayerIds: [] })),
      };

      const mockDeps = createMockDeps();
      mockDeps.createClient = mock(() => mockClient) as unknown as ChannelsDeps['createClient'];

      const channelsCommand = createChannelsCommand(mockDeps);
      const listCommand = (channelsCommand.subCommands as any)?.list;

      await expect(
        listCommand?.run?.({ args: { json: false }, rawArgs: [], cmd: listCommand } as never),
      ).rejects.toThrow('process.exit');

      expect(exitCode).toBe(4); // ResourceNotFound
    });
  });
});
