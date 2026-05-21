import { defineCommand } from 'citty';
import pc from 'picocolors';
import { type CommandDeps, defaultDeps } from '../deps.js';

/**
 * Dependencies needed by channels commands.
 */
export type ChannelsDeps = Pick<
  CommandDeps,
  | 'resolveConfig'
  | 'createClient'
  | 'output'
  | 'success'
  | 'handleApiError'
  | 'exitWithUsageError'
  | 'confirmProtectedOperation'
  | 'promptConfirm'
  | 'closePrompts'
>;

// Global args that need to be defined on each subcommand (citty doesn't inherit from parent)
const globalArgs = {
  profile: {
    type: 'string' as const,
    alias: 'p',
    description: 'Profile to use',
  },
  url: {
    type: 'string' as const,
    description: 'Override channels URL',
  },
  'api-key': {
    type: 'string' as const,
    description: 'Override API key',
  },
  'plugin-id': {
    type: 'string' as const,
    description: 'Override plugin ID',
  },
  'admin-secret': {
    type: 'string' as const,
    description: 'Override admin secret',
  },
  json: {
    type: 'boolean' as const,
    description: 'Output as JSON',
    default: false,
  },
  'no-input': {
    type: 'boolean' as const,
    description: 'Disable interactive prompts',
    default: false,
  },
};

function requireConfig(deps: ChannelsDeps, args: Record<string, unknown>) {
  const config = deps.resolveConfig(
    args as {
      profile?: string;
      url?: string;
      'api-key'?: string;
      'plugin-id'?: string;
      'admin-secret'?: string;
    },
  );
  if (!config) {
    deps.exitWithUsageError(
      'No configuration found. Run `oz-channels profile init` or set OZ_CHANNELS_URL and OZ_CHANNELS_API_KEY environment variables.',
    );
  }
  return config;
}

function requireAdminSecret(deps: ChannelsDeps, config: ReturnType<typeof requireConfig>) {
  if (!config.adminSecret) {
    deps.exitWithUsageError(
      'Admin secret is required for this operation. Set it in your profile or use --admin-secret.',
    );
  }
}

function createListCommand(deps: ChannelsDeps) {
  return defineCommand({
    meta: {
      name: 'list',
      description: 'List configured channel account relayer IDs',
    },
    args: {
      ...globalArgs,
    },
    async run({ args }) {
      const json = args.json;
      const config = requireConfig(deps, args);
      requireAdminSecret(deps, config);
      const client = deps.createClient(config);

      try {
        const response = await client.listChannelAccounts();

        if (json) {
          deps.output({ relayerIds: response.relayerIds }, { json: true });
        } else {
          if (response.relayerIds.length === 0) {
            console.log('No channel accounts configured.');
          } else {
            console.log(pc.bold(`Channel Accounts (${response.relayerIds.length}):\n`));
            for (const id of response.relayerIds) {
              console.log(`  ${id}`);
            }
          }
        }
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createSetCommand(deps: ChannelsDeps) {
  return defineCommand({
    meta: {
      name: 'set',
      description: 'Replace all channel account relayer IDs',
    },
    args: {
      ...globalArgs,
      ids: {
        type: 'positional',
        description: 'Relayer IDs (space-separated)',
        required: true,
      },
    },
    async run({ args }) {
      const json = args.json;
      const noInput = args['no-input'];
      const config = requireConfig(deps, args);
      requireAdminSecret(deps, config);

      // Collect all positional arguments as IDs
      const relayerIds = args._.filter((id): id is string => typeof id === 'string' && id.length > 0);
      if (args.ids) {
        relayerIds.unshift(args.ids);
      }

      if (relayerIds.length === 0) {
        deps.exitWithUsageError('At least one relayer ID is required');
      }

      // Check for protected profile before write operation
      if (config.isProtected) {
        const confirmed = await deps.confirmProtectedOperation({
          profileName: config.profileName,
          operation: 'set channel accounts',
          summary: `${relayerIds.length} relayer ID(s)`,
          noInput: Boolean(noInput),
        });
        if (!confirmed) {
          console.log('Operation cancelled');
          process.exit(0);
        }
      } else if (!noInput) {
        console.log(pc.bold('\nChannel accounts to set:\n'));
        for (const id of relayerIds) {
          console.log(`  ${id}`);
        }
        console.log();

        const confirmed = await deps.promptConfirm(
          `Replace all channel accounts with these ${relayerIds.length} relayer(s)?`,
        );
        deps.closePrompts();
        if (!confirmed) {
          console.log('Operation cancelled');
          return;
        }
      }

      const client = deps.createClient(config);

      try {
        const response = await client.setChannelAccounts(relayerIds);

        if (json) {
          deps.output(
            {
              ok: response.ok,
              appliedRelayerIds: response.appliedRelayerIds,
            },
            { json: true },
          );
        } else {
          if (response.ok) {
            deps.success(`Set ${response.appliedRelayerIds.length} channel account(s)`);
          } else {
            console.log(pc.yellow('Operation completed with warnings'));
          }
        }
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createAddCommand(deps: ChannelsDeps) {
  return defineCommand({
    meta: {
      name: 'add',
      description: 'Add a relayer ID to the channel account pool',
    },
    args: {
      ...globalArgs,
      id: {
        type: 'positional',
        description: 'Relayer ID to add',
        required: true,
      },
    },
    async run({ args }) {
      const json = args.json;
      const noInput = args['no-input'];
      const config = requireConfig(deps, args);
      requireAdminSecret(deps, config);

      if (!args.id) {
        deps.exitWithUsageError('Relayer ID is required');
      }

      // Check for protected profile before write operation
      if (config.isProtected) {
        const confirmed = await deps.confirmProtectedOperation({
          profileName: config.profileName,
          operation: 'add channel account',
          summary: `Relayer ID: ${args.id}`,
          noInput: Boolean(noInput),
        });
        if (!confirmed) {
          console.log('Operation cancelled');
          process.exit(0);
        }
      } else if (!noInput) {
        const confirmed = await deps.promptConfirm(`Add '${args.id}' to channel accounts?`);
        deps.closePrompts();
        if (!confirmed) {
          console.log('Operation cancelled');
          return;
        }
      }

      const client = deps.createClient(config);

      try {
        // Get current list
        const current = await client.listChannelAccounts();

        if (current.relayerIds.includes(args.id)) {
          if (json) {
            deps.output({ ok: true, message: 'Already exists' }, { json: true });
          } else {
            console.log(`Relayer '${args.id}' is already in the channel accounts pool`);
          }
          return;
        }

        // Add to list
        const newList = [...current.relayerIds, args.id];
        const response = await client.setChannelAccounts(newList);

        if (json) {
          deps.output(
            {
              ok: response.ok,
              appliedRelayerIds: response.appliedRelayerIds,
            },
            { json: true },
          );
        } else {
          if (response.ok) {
            deps.success(`Added '${args.id}' to channel accounts`);
          } else {
            console.log(pc.yellow('Operation completed with warnings'));
          }
        }
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createRemoveCommand(deps: ChannelsDeps) {
  return defineCommand({
    meta: {
      name: 'remove',
      description: 'Remove a relayer ID from the channel account pool',
    },
    args: {
      ...globalArgs,
      id: {
        type: 'positional',
        description: 'Relayer ID to remove',
        required: true,
      },
    },
    async run({ args }) {
      const json = args.json;
      const noInput = args['no-input'];
      const config = requireConfig(deps, args);
      requireAdminSecret(deps, config);

      if (!args.id) {
        deps.exitWithUsageError('Relayer ID is required');
      }

      // Check for protected profile before write operation
      if (config.isProtected) {
        const confirmed = await deps.confirmProtectedOperation({
          profileName: config.profileName,
          operation: 'remove channel account',
          summary: `Relayer ID: ${args.id}`,
          noInput: Boolean(noInput),
        });
        if (!confirmed) {
          console.log('Operation cancelled');
          process.exit(0);
        }
      } else if (!noInput) {
        const confirmed = await deps.promptConfirm(`Remove '${args.id}' from channel accounts?`);
        deps.closePrompts();
        if (!confirmed) {
          console.log('Operation cancelled');
          return;
        }
      }

      const client = deps.createClient(config);

      try {
        // Get current list
        const current = await client.listChannelAccounts();

        if (!current.relayerIds.includes(args.id)) {
          if (json) {
            deps.output({ ok: true, message: 'Not found' }, { json: true });
          } else {
            console.log(`Relayer '${args.id}' is not in the channel accounts pool`);
          }
          return;
        }

        // Remove from list
        const newList = current.relayerIds.filter((id) => id !== args.id);
        const response = await client.setChannelAccounts(newList);

        if (json) {
          deps.output(
            {
              ok: response.ok,
              appliedRelayerIds: response.appliedRelayerIds,
            },
            { json: true },
          );
        } else {
          if (response.ok) {
            deps.success(`Removed '${args.id}' from channel accounts`);
          } else {
            console.log(pc.yellow('Operation completed with warnings'));
          }
        }
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

/**
 * Create the channels command with injected dependencies.
 */
export function createChannelsCommand(deps: ChannelsDeps = defaultDeps) {
  return defineCommand({
    meta: {
      name: 'channels',
      description: 'Manage channel accounts',
    },
    subCommands: {
      list: createListCommand(deps),
      set: createSetCommand(deps),
      add: createAddCommand(deps),
      remove: createRemoveCommand(deps),
    },
  });
}

/**
 * Default channels command instance for production use.
 */
export const channelsCommand = createChannelsCommand();
