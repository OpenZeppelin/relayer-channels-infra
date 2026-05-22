import type {
  ApiResponseBalanceResponseData,
  ApiResponseRelayerResponseData,
  ApiResponseRelayerStatusData,
  CreateRelayerPolicyRequest,
} from '@openzeppelin/relayer-sdk';
import { RelayerNetworkType } from '@openzeppelin/relayer-sdk';
import { defineCommand } from 'citty';
import { type CommandDeps, defaultDeps } from '../deps.js';

/**
 * Dependencies needed by relayer commands.
 */
export type RelayerDeps = Pick<
  CommandDeps,
  | 'resolveConfig'
  | 'createClient'
  | 'output'
  | 'success'
  | 'setVerbose'
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
    description: 'Override relayer URL',
  },
  'api-key': {
    type: 'string' as const,
    description: 'Override API key',
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
  verbose: {
    type: 'boolean' as const,
    alias: 'v',
    description: 'Verbose output (show full errors)',
    default: false,
  },
};

function requireConfig(deps: RelayerDeps, args: Record<string, unknown>) {
  const config = deps.resolveConfig(args as { profile?: string; url?: string; 'api-key'?: string });
  if (!config) {
    deps.exitWithUsageError(
      'No configuration found. Run `oz-relayer profile init` or set OZ_RELAYER_URL and OZ_RELAYER_API_KEY environment variables.',
    );
  }
  return config;
}

function createListCommand(deps: RelayerDeps) {
  return defineCommand({
    meta: {
      name: 'list',
      description: 'List all relayers',
    },
    args: {
      ...globalArgs,
      page: {
        type: 'string',
        description: 'Page number',
        default: '1',
      },
      'per-page': {
        type: 'string',
        description: 'Items per page',
        default: '10',
      },
    },
    async run({ args }) {
      deps.setVerbose(Boolean(args.verbose));
      const json = args.json;
      const config = requireConfig(deps, args);
      const client = deps.createClient(config);

      try {
        const response = await client.relayers.listRelayers(
          Number(args.page),
          Number(args['per-page']),
        );
        const relayers: ApiResponseRelayerResponseData[] = response.data.data || [];

        deps.output(relayers, { json: Boolean(json) });
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createStatusCommand(deps: RelayerDeps) {
  return defineCommand({
    meta: {
      name: 'status',
      description: 'Get relayer status',
    },
    args: {
      ...globalArgs,
      id: {
        type: 'positional',
        description: 'Relayer ID',
        required: true,
      },
    },
    async run({ args }) {
      deps.setVerbose(Boolean(args.verbose));
      const json = args.json;
      const config = requireConfig(deps, args);
      const client = deps.createClient(config);

      if (!args.id) {
        deps.exitWithUsageError('Relayer ID is required');
      }

      try {
        const response = await client.relayers.getRelayerStatus(args.id);
        const status: ApiResponseRelayerStatusData | undefined = response.data.data;

        deps.output(status, { json: Boolean(json) });
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createBalanceCommand(deps: RelayerDeps) {
  return defineCommand({
    meta: {
      name: 'balance',
      description: 'Get relayer balance',
    },
    args: {
      ...globalArgs,
      id: {
        type: 'positional',
        description: 'Relayer ID',
        required: true,
      },
    },
    async run({ args }) {
      deps.setVerbose(Boolean(args.verbose));
      const json = args.json;
      const config = requireConfig(deps, args);
      const client = deps.createClient(config);

      if (!args.id) {
        deps.exitWithUsageError('Relayer ID is required');
      }

      try {
        const response = await client.relayers.getRelayerBalance(args.id);
        const balance: ApiResponseBalanceResponseData | undefined = response.data.data;

        deps.output(balance, { json: Boolean(json) });
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createShowCommand(deps: RelayerDeps) {
  return defineCommand({
    meta: {
      name: 'show',
      description: 'Show relayer details',
    },
    args: {
      ...globalArgs,
      id: {
        type: 'positional',
        description: 'Relayer ID',
        required: true,
      },
    },
    async run({ args }) {
      deps.setVerbose(Boolean(args.verbose));
      const json = args.json;
      const config = requireConfig(deps, args);
      const client = deps.createClient(config);

      if (!args.id) {
        deps.exitWithUsageError('Relayer ID is required');
      }

      try {
        const response = await client.relayers.getRelayer(args.id);
        const relayer = response.data.data;

        deps.output(relayer, { json: Boolean(json) });
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createPauseCommand(deps: RelayerDeps) {
  return defineCommand({
    meta: {
      name: 'pause',
      description: 'Pause a relayer',
    },
    args: {
      ...globalArgs,
      id: {
        type: 'positional',
        description: 'Relayer ID',
        required: true,
      },
    },
    async run({ args }) {
      deps.setVerbose(Boolean(args.verbose));
      const json = args.json;
      const noInput = args['no-input'];
      const config = requireConfig(deps, args);

      if (config.isProtected) {
        const confirmed = await deps.confirmProtectedOperation({
          profileName: config.profileName,
          operation: 'pause relayer',
          summary: `Relayer ID: ${args.id}`,
          noInput: Boolean(noInput),
        });
        if (!confirmed) {
          console.log('Operation cancelled');
          process.exit(0);
        }
      }

      const client = deps.createClient(config);

      if (!args.id) {
        deps.exitWithUsageError('Relayer ID is required');
      }

      try {
        const response = await client.relayers.updateRelayer(args.id, { paused: true });
        const relayer = response.data.data;

        deps.output(relayer, { json: Boolean(json) });
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createResumeCommand(deps: RelayerDeps) {
  return defineCommand({
    meta: {
      name: 'resume',
      description: 'Resume a paused relayer',
    },
    args: {
      ...globalArgs,
      id: {
        type: 'positional',
        description: 'Relayer ID',
        required: true,
      },
    },
    async run({ args }) {
      deps.setVerbose(Boolean(args.verbose));
      const json = args.json;
      const noInput = args['no-input'];
      const config = requireConfig(deps, args);

      if (config.isProtected) {
        const confirmed = await deps.confirmProtectedOperation({
          profileName: config.profileName,
          operation: 'resume relayer',
          summary: `Relayer ID: ${args.id}`,
          noInput: Boolean(noInput),
        });
        if (!confirmed) {
          console.log('Operation cancelled');
          process.exit(0);
        }
      }

      const client = deps.createClient(config);

      if (!args.id) {
        deps.exitWithUsageError('Relayer ID is required');
      }

      try {
        const response = await client.relayers.updateRelayer(args.id, { paused: false });
        const relayer = response.data.data;

        deps.output(relayer, { json: Boolean(json) });
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createEnableCommand(deps: RelayerDeps) {
  return defineCommand({
    meta: {
      name: 'enable',
      description: 'Re-enable a system-disabled relayer',
    },
    args: {
      ...globalArgs,
      id: {
        type: 'positional',
        description: 'Relayer ID',
        required: true,
      },
    },
    async run({ args }) {
      deps.setVerbose(Boolean(args.verbose));
      const json = args.json;
      const noInput = args['no-input'];
      const config = requireConfig(deps, args);

      if (config.isProtected) {
        const confirmed = await deps.confirmProtectedOperation({
          profileName: config.profileName,
          operation: 're-enable relayer',
          summary: `Relayer ID: ${args.id}`,
          noInput: Boolean(noInput),
        });
        if (!confirmed) {
          console.log('Operation cancelled');
          process.exit(0);
        }
      }

      const client = deps.createClient(config);

      if (!args.id) {
        deps.exitWithUsageError('Relayer ID is required');
      }

      try {
        const response = await client.relayers.updateRelayer(args.id, { system_disabled: false });
        const relayer = response.data.data;

        deps.output(relayer, { json: Boolean(json) });
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createCreateCommand(deps: RelayerDeps) {
  return defineCommand({
    meta: {
      name: 'create',
      description: 'Create a new relayer',
    },
    args: {
      ...globalArgs,
      id: {
        type: 'positional',
        description: 'Relayer ID',
        required: true,
      },
      name: {
        type: 'string',
        alias: 'n',
        description: 'Relayer name (defaults to ID)',
      },
      'network-type': {
        type: 'string',
        alias: 't',
        description: 'Network type (evm, solana, stellar)',
        required: true,
      },
      network: {
        type: 'string',
        description: 'Network name (e.g., mainnet, testnet, sepolia)',
        required: true,
      },
      'signer-id': {
        type: 'string',
        alias: 's',
        description: 'Signer ID to use',
        required: true,
      },
      paused: {
        type: 'boolean',
        description: 'Create in paused state',
        default: false,
      },
      'min-balance': {
        type: 'string',
        description: 'Minimum balance policy (in smallest unit)',
      },
      'fee-payment-strategy': {
        type: 'string',
        description: 'Fee payment strategy (e.g., relayer)',
      },
      'concurrent-transactions': {
        type: 'boolean',
        description: 'Allow concurrent transactions',
      },
    },
    async run({ args }) {
      deps.setVerbose(Boolean(args.verbose));
      const json = args.json;
      const noInput = args['no-input'];
      const config = requireConfig(deps, args);

      if (config.isProtected) {
        const confirmed = await deps.confirmProtectedOperation({
          profileName: config.profileName,
          operation: 'create relayer',
          summary: `Relayer ID: ${args.id}`,
          noInput: Boolean(noInput),
        });
        if (!confirmed) {
          console.log('Operation cancelled');
          process.exit(0);
        }
      }

      const client = deps.createClient(config);

      if (!args.id) {
        deps.exitWithUsageError('Relayer ID is required');
      }

      // Map network type string to enum
      const networkTypeMap: Record<string, RelayerNetworkType> = {
        evm: RelayerNetworkType.EVM,
        solana: RelayerNetworkType.SOLANA,
        stellar: RelayerNetworkType.STELLAR,
      };

      const networkType = networkTypeMap[args['network-type'].toLowerCase()];
      if (!networkType) {
        deps.exitWithUsageError(
          `Invalid network type: ${args['network-type']}. Use: evm, solana, stellar`,
        );
      }

      // Build policies object if any policy args provided
      const policies: Partial<CreateRelayerPolicyRequest> = {};
      if (args['min-balance'] !== undefined) {
        (policies as Record<string, unknown>).min_balance = Number(args['min-balance']);
      }
      if (args['fee-payment-strategy'] !== undefined) {
        (policies as Record<string, unknown>).fee_payment_strategy = args['fee-payment-strategy'];
      }
      if (args['concurrent-transactions'] !== undefined) {
        (policies as Record<string, unknown>).concurrent_transactions =
          args['concurrent-transactions'];
      }

      try {
        const response = await client.relayers.createRelayer({
          id: args.id,
          name: args.name || args.id,
          network_type: networkType,
          network: args.network,
          signer_id: args['signer-id'],
          paused: args.paused,
          policies:
            Object.keys(policies).length > 0 ? (policies as CreateRelayerPolicyRequest) : undefined,
        });
        const relayer = response.data.data;

        if (json) {
          deps.output(relayer, { json: true });
        } else {
          deps.success(`Relayer '${args.id}' created`);
          deps.output(relayer, { json: false });
        }
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

/**
 * Create the relayer command with injected dependencies.
 */
export function createRelayerCommand(deps: RelayerDeps = defaultDeps) {
  return defineCommand({
    meta: {
      name: 'relayer',
      description: 'Relayer operations',
    },
    subCommands: {
      create: createCreateCommand(deps),
      list: createListCommand(deps),
      status: createStatusCommand(deps),
      balance: createBalanceCommand(deps),
      show: createShowCommand(deps),
      pause: createPauseCommand(deps),
      resume: createResumeCommand(deps),
      enable: createEnableCommand(deps),
    },
  });
}

/**
 * Default relayer command instance for production use.
 */
export const relayerCommand = createRelayerCommand();
