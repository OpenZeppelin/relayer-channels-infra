import { defineCommand } from 'citty';
import pc from 'picocolors';
import { type CommandDeps, defaultDeps } from '../deps.js';
import { formatStroops, parseBigInt } from '../utils/bignum.js';

/**
 * Dependencies needed by fee commands.
 */
export type FeeDeps = Pick<
  CommandDeps,
  | 'resolveConfig'
  | 'createClient'
  | 'output'
  | 'success'
  | 'handleApiError'
  | 'exitWithUsageError'
  | 'confirmProtectedOperation'
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

function requireConfig(deps: FeeDeps, args: Record<string, unknown>) {
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

function requireAdminSecret(deps: FeeDeps, config: ReturnType<typeof requireConfig>) {
  if (!config.adminSecret) {
    deps.exitWithUsageError(
      'Admin secret is required for this operation. Set it in your profile or use --admin-secret.',
    );
  }
}

function formatStroopsDisplay(stroops: number | string | bigint | undefined | null): string {
  if (stroops === undefined || stroops === null) {
    return pc.dim('unlimited');
  }
  return formatStroops(stroops, pc.dim('unlimited'));
}

function createUsageCommand(deps: FeeDeps) {
  return defineCommand({
    meta: {
      name: 'usage',
      description: 'Get fee consumption for an API key',
    },
    args: {
      ...globalArgs,
      'target-api-key': {
        type: 'positional',
        description: 'API key to query fee usage for',
        required: true,
      },
    },
    async run({ args }) {
      const json = args.json;
      const config = requireConfig(deps, args);
      requireAdminSecret(deps, config);
      const client = deps.createClient(config);

      const targetApiKey = args['target-api-key'];
      if (!targetApiKey) {
        deps.exitWithUsageError('API key is required');
      }

      try {
        const response = await client.getFeeUsage(targetApiKey);

        if (json) {
          deps.output(
            {
              consumed: response.consumed,
              limit: response.limit,
              remaining: response.remaining,
              periodStartAt: response.periodStartAt,
              periodEndsAt: response.periodEndsAt,
            },
            { json: true },
          );
        } else {
          console.log(`${pc.bold('API Key:')} ${targetApiKey.slice(0, 8)}...`);
          console.log(`${pc.bold('Consumed:')} ${formatStroopsDisplay(response.consumed)}`);
          console.log(`${pc.bold('Limit:')} ${formatStroopsDisplay(response.limit)}`);
          if (response.remaining !== undefined) {
            console.log(`${pc.bold('Remaining:')} ${formatStroopsDisplay(response.remaining)}`);
          }
          if (response.periodStartAt) {
            console.log(`${pc.bold('Period Start:')} ${response.periodStartAt}`);
          }
          if (response.periodEndsAt) {
            console.log(`${pc.bold('Period Ends:')} ${response.periodEndsAt}`);
          }
        }
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createLimitCommand(deps: FeeDeps) {
  return defineCommand({
    meta: {
      name: 'limit',
      description: 'Get fee limit for an API key',
    },
    args: {
      ...globalArgs,
      'target-api-key': {
        type: 'positional',
        description: 'API key to query fee limit for',
        required: true,
      },
    },
    async run({ args }) {
      const json = args.json;
      const config = requireConfig(deps, args);
      requireAdminSecret(deps, config);
      const client = deps.createClient(config);

      const targetApiKey = args['target-api-key'];
      if (!targetApiKey) {
        deps.exitWithUsageError('API key is required');
      }

      try {
        const response = await client.getFeeLimit(targetApiKey);

        if (json) {
          deps.output({ limit: response.limit }, { json: true });
        } else {
          console.log(`${pc.bold('API Key:')} ${targetApiKey.slice(0, 8)}...`);
          console.log(`${pc.bold('Limit:')} ${formatStroopsDisplay(response.limit)}`);
        }
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createSetLimitCommand(deps: FeeDeps) {
  return defineCommand({
    meta: {
      name: 'set-limit',
      description: 'Set fee limit for an API key',
    },
    args: {
      ...globalArgs,
      'target-api-key': {
        type: 'positional',
        description: 'API key to set fee limit for',
        required: true,
      },
      limit: {
        type: 'positional',
        description: 'Fee limit in stroops (0 blocks all transactions)',
        required: true,
      },
    },
    async run({ args }) {
      const json = args.json;
      const noInput = args['no-input'];
      const config = requireConfig(deps, args);
      requireAdminSecret(deps, config);

      const targetApiKey = args['target-api-key'];
      if (!targetApiKey) {
        deps.exitWithUsageError('API key is required');
      }

      const limitBig = parseBigInt(args.limit);
      if (limitBig === null || limitBig < 0n) {
        deps.exitWithUsageError('Limit must be a non-negative number (stroops)');
      }
      // SDK expects number, but we validate it fits safely
      if (limitBig > BigInt(Number.MAX_SAFE_INTEGER)) {
        deps.exitWithUsageError(
          `Limit ${args.limit} exceeds safe integer range. Max: ${Number.MAX_SAFE_INTEGER}`,
        );
      }
      const limit = Number(limitBig);

      // Check for protected profile before write operation
      if (config.isProtected) {
        const confirmed = await deps.confirmProtectedOperation({
          profileName: config.profileName,
          operation: 'set fee limit',
          summary: `API Key: ${targetApiKey.slice(0, 8)}..., Limit: ${formatStroops(limit, 'unlimited')}`,
          noInput: Boolean(noInput),
        });
        if (!confirmed) {
          console.log('Operation cancelled');
          process.exit(0);
        }
      }

      const client = deps.createClient(config);

      try {
        const response = await client.setFeeLimit(targetApiKey, limit);

        if (json) {
          deps.output({ ok: response.ok, limit: response.limit }, { json: true });
        } else {
          if (response.ok) {
            deps.success(`Fee limit set to ${formatStroopsDisplay(response.limit)}`);
          }
        }
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createDeleteLimitCommand(deps: FeeDeps) {
  return defineCommand({
    meta: {
      name: 'delete-limit',
      description: 'Remove custom fee limit for an API key',
    },
    args: {
      ...globalArgs,
      'target-api-key': {
        type: 'positional',
        description: 'API key to remove fee limit for',
        required: true,
      },
    },
    async run({ args }) {
      const json = args.json;
      const noInput = args['no-input'];
      const config = requireConfig(deps, args);
      requireAdminSecret(deps, config);

      const targetApiKey = args['target-api-key'];
      if (!targetApiKey) {
        deps.exitWithUsageError('API key is required');
      }

      // Check for protected profile before write operation
      if (config.isProtected) {
        const confirmed = await deps.confirmProtectedOperation({
          profileName: config.profileName,
          operation: 'delete fee limit',
          summary: `API Key: ${targetApiKey.slice(0, 8)}...`,
          noInput: Boolean(noInput),
        });
        if (!confirmed) {
          console.log('Operation cancelled');
          process.exit(0);
        }
      }

      const client = deps.createClient(config);

      try {
        const response = await client.deleteFeeLimit(targetApiKey);

        if (json) {
          deps.output({ ok: response.ok }, { json: true });
        } else {
          if (response.ok) {
            deps.success('Custom fee limit removed');
          }
        }
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

/**
 * Create the fee command with injected dependencies.
 */
export function createFeeCommand(deps: FeeDeps = defaultDeps) {
  return defineCommand({
    meta: {
      name: 'fee',
      description: 'Manage fee limits and usage',
    },
    subCommands: {
      usage: createUsageCommand(deps),
      limit: createLimitCommand(deps),
      'set-limit': createSetLimitCommand(deps),
      'delete-limit': createDeleteLimitCommand(deps),
    },
  });
}

/**
 * Default fee command instance for production use.
 */
export const feeCommand = createFeeCommand();
