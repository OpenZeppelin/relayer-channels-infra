import type {
  ApiResponseRelayerResponseData,
  ApiResponseTransactionResponseData,
} from '@openzeppelin/relayer-sdk';
import { defineCommand } from 'citty';
import pc from 'picocolors';
import { type CommandDeps, defaultDeps } from '../deps.js';

/**
 * Dependencies needed by tx commands.
 */
export type TxDeps = Pick<
  CommandDeps,
  | 'resolveConfig'
  | 'createClient'
  | 'output'
  | 'success'
  | 'setVerbose'
  | 'handleApiError'
  | 'exitWithUsageError'
  | 'confirmProtectedOperation'
  | 'prompt'
  | 'promptConfirm'
  | 'promptSelect'
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

function requireConfig(deps: TxDeps, args: Record<string, unknown>) {
  const config = deps.resolveConfig(args as { profile?: string; url?: string; 'api-key'?: string });
  if (!config) {
    deps.exitWithUsageError(
      'No configuration found. Run `oz-relayer profile init` or set OZ_RELAYER_URL and OZ_RELAYER_API_KEY environment variables.',
    );
  }
  return config;
}

function getNetworkType(
  relayer: ApiResponseRelayerResponseData,
): 'evm' | 'solana' | 'stellar' | 'unknown' {
  const networkType = String(relayer.network_type || '').toLowerCase();
  if (networkType.includes('evm') || networkType.includes('ethereum')) return 'evm';
  if (networkType.includes('solana')) return 'solana';
  if (networkType.includes('stellar')) return 'stellar';
  return 'unknown';
}

function createSendCommand(deps: TxDeps) {
  return defineCommand({
    meta: {
      name: 'send',
      description: 'Send a transaction',
    },
    args: {
      ...globalArgs,
      relayer: {
        type: 'string',
        alias: 'r',
        description: 'Relayer ID',
      },
      to: {
        type: 'string',
        description: 'Destination address',
      },
      'to-relayer': {
        type: 'string',
        description: 'Destination relayer ID (resolves to relayer address)',
      },
      value: {
        type: 'string',
        description: 'Value to send (in native units)',
      },
      data: {
        type: 'string',
        description: 'Transaction data (hex, EVM only)',
      },
      'gas-limit': {
        type: 'string',
        description: 'Gas limit (EVM only)',
      },
      wait: {
        type: 'boolean',
        description: 'Wait for confirmation',
        default: false,
      },
      timeout: {
        type: 'string',
        description: 'Timeout in seconds for --wait',
        default: '120',
      },
    },
    async run({ args }) {
      deps.setVerbose(Boolean(args.verbose));
      const json = args.json;
      const noInput = args['no-input'];
      const config = requireConfig(deps, args);

      // Check for protected profile before write operation
      if (config.isProtected) {
        const confirmed = await deps.confirmProtectedOperation({
          profileName: config.profileName,
          operation: 'send transaction',
          noInput: Boolean(noInput),
        });
        if (!confirmed) {
          console.log('Operation cancelled');
          process.exit(0);
        }
      }

      const client = deps.createClient(config);

      let relayerId = args.relayer || config.defaultRelayer;
      let to = args.to;
      const toRelayer = args['to-relayer'];
      let value = args.value;

      // Resolve --to-relayer to an address
      if (toRelayer) {
        if (to) {
          deps.exitWithUsageError('Cannot specify both --to and --to-relayer');
        }
        try {
          const relayerResponse = await client.relayers.getRelayer(toRelayer);
          const relayerData = relayerResponse.data.data as
            | ApiResponseRelayerResponseData
            | undefined;
          const resolvedAddress = relayerData?.address;
          if (!resolvedAddress) {
            deps.exitWithUsageError(`Could not resolve address for relayer ${toRelayer}`);
          }
          to = resolvedAddress;
        } catch (err) {
          deps.handleApiError(err);
        }
      }
      let data = args.data;
      const gasLimit = args['gas-limit'];

      // If no relayer specified and interactive mode, show wizard
      if (!relayerId && !noInput) {
        const response = await client.relayers.listRelayers();
        const relayers: ApiResponseRelayerResponseData[] = response.data.data || [];

        if (relayers.length === 0) {
          deps.exitWithUsageError('No relayers available');
        }

        const choices = relayers.map((r) => ({
          value: r.id,
          name: `${r.id} (${r.network_type || r.network || 'unknown'})`,
        }));

        relayerId = await deps.promptSelect('Select relayer:', choices);
      }

      if (!relayerId) {
        deps.exitWithUsageError(
          'Relayer ID is required. Use -r/--relayer or set a default relayer in your profile.',
        );
      }

      // Fetch relayer to determine network type and network
      let networkType: 'evm' | 'solana' | 'stellar' | 'unknown' = 'unknown';
      let network: string | undefined;
      try {
        const relayerResponse = await client.relayers.getRelayer(relayerId);
        const relayerData = relayerResponse.data.data as ApiResponseRelayerResponseData | undefined;
        if (relayerData) {
          networkType = getNetworkType(relayerData);
          network = relayerData.network;
        }
      } catch {
        // Continue without network info
      }

      // Interactive mode for missing fields
      if (!noInput && (!to || !value)) {
        console.log(pc.bold('\noz-relayer tx send\n'));

        if (!to) {
          to = await deps.prompt('To address');
          if (!to) {
            console.error('Address is required');
            deps.closePrompts();
            process.exit(2);
          }
          if (networkType === 'evm' && !to.startsWith('0x')) {
            console.error('EVM address should start with 0x');
            deps.closePrompts();
            process.exit(2);
          }
        }

        if (!value) {
          const unitLabel =
            networkType === 'evm'
              ? 'ETH'
              : networkType === 'solana'
                ? 'SOL'
                : networkType === 'stellar'
                  ? 'XLM'
                  : '';
          value = await deps.prompt(`Value${unitLabel ? ` (${unitLabel})` : ''}`);
          if (!value || Number.isNaN(Number(value))) {
            console.error('Value must be a number');
            deps.closePrompts();
            process.exit(2);
          }
        }

        // EVM-specific fields
        if (networkType === 'evm' && !data) {
          const dataInput = await deps.prompt('Data (hex, optional)');
          if (dataInput) {
            data = dataInput;
          }
        }

        // Confirmation
        const shortTo = to.length > 20 ? `${to.slice(0, 10)}...${to.slice(-8)}` : to;
        const unitLabel =
          networkType === 'evm'
            ? 'ETH'
            : networkType === 'solana'
              ? 'SOL'
              : networkType === 'stellar'
                ? 'XLM'
                : '';
        const confirmed = await deps.promptConfirm(`Send ${value} ${unitLabel} to ${shortTo}?`);
        deps.closePrompts();

        if (!confirmed) {
          console.log('Transaction cancelled');
          process.exit(0);
        }
      }

      if (!to || !value) {
        deps.exitWithUsageError('--to and --value are required in non-interactive mode');
      }

      try {
        let txRequest: Record<string, unknown>;

        if (networkType === 'stellar') {
          // Stellar uses operations array for payments
          txRequest = {
            network,
            operations: [
              {
                type: 'payment',
                destination: to,
                amount: Number(value),
                asset: { type: 'native' },
              },
            ],
          };
        } else if (networkType === 'solana') {
          // Solana requires instructions - simple transfers need system program transfer instruction
          deps.exitWithUsageError(
            'Simple value transfers not yet supported for Solana. Use transaction XDR instead.',
          );
        } else {
          // EVM format
          txRequest = {
            to,
            value: Number(value),
          };
          if (data) {
            txRequest.data = data;
          }
          if (gasLimit) {
            txRequest.gas_limit = Number(gasLimit);
          }
        }

        const response = await client.relayers.sendTransaction(relayerId, txRequest);
        const tx = response.data.data as ApiResponseTransactionResponseData | undefined;

        if (!tx) {
          deps.exitWithUsageError('Failed to submit transaction: no response data');
        }

        if (args.wait) {
          process.stdout.write('Waiting for confirmation... ');

          const timeoutMs = Number(args.timeout) * 1000;
          const startTime = Date.now();
          let finalStatus: ApiResponseTransactionResponseData = tx;

          while (Date.now() - startTime < timeoutMs) {
            await new Promise((resolve) => setTimeout(resolve, 2000));

            try {
              const statusResponse = await client.relayers.getTransactionById(relayerId, tx.id);
              const statusData = statusResponse.data.data as
                | ApiResponseTransactionResponseData
                | undefined;
              if (statusData) {
                finalStatus = statusData;
              }

              const status = String(finalStatus.status || '').toLowerCase();
              if (
                status === 'confirmed' ||
                status === 'mined' ||
                status === 'failed' ||
                status === 'error'
              ) {
                break;
              }
            } catch {
              // Continue polling
            }
          }

          console.log('Done');
          deps.output(finalStatus, { json: Boolean(json) });
        } else {
          if (json) {
            deps.output(tx, { json: true });
          } else {
            deps.success(`Transaction submitted: ${tx.id}`);
            if ('hash' in tx && tx.hash) {
              console.log(`${pc.bold('Hash:')} ${tx.hash}`);
            }
          }
        }
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createStatusCommand(deps: TxDeps) {
  return defineCommand({
    meta: {
      name: 'status',
      description: 'Get transaction status',
    },
    args: {
      ...globalArgs,
      id: {
        type: 'positional',
        description: 'Transaction ID',
        required: true,
      },
      relayer: {
        type: 'string',
        alias: 'r',
        description: 'Relayer ID',
      },
    },
    async run({ args }) {
      deps.setVerbose(Boolean(args.verbose));
      const json = args.json;
      const config = requireConfig(deps, args);
      const client = deps.createClient(config);

      const relayerId = args.relayer || config.defaultRelayer;
      if (!relayerId) {
        deps.exitWithUsageError(
          'Relayer ID is required. Use -r/--relayer or set a default relayer.',
        );
      }

      if (!args.id) {
        deps.exitWithUsageError('Transaction ID is required');
      }

      try {
        const response = await client.relayers.getTransactionById(relayerId, args.id);
        const transaction = response.data.data;

        deps.output(transaction, { json: Boolean(json) });
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createListCommand(deps: TxDeps) {
  return defineCommand({
    meta: {
      name: 'list',
      description: 'List transactions',
    },
    args: {
      ...globalArgs,
      relayer: {
        type: 'string',
        alias: 'r',
        description: 'Filter by relayer',
      },
      status: {
        type: 'string',
        description: 'Filter by status (pending/sent/confirmed/failed)',
      },
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

      const relayerId = args.relayer || config.defaultRelayer;
      if (!relayerId) {
        deps.exitWithUsageError(
          'Relayer ID is required. Use -r/--relayer or set a default relayer.',
        );
      }

      try {
        const response = await client.relayers.listTransactions(
          relayerId,
          Number(args.page),
          Number(args['per-page']),
        );
        let transactions: ApiResponseTransactionResponseData[] = response.data.data || [];

        // Client-side status filtering (SDK doesn't support server-side filtering)
        if (args.status) {
          const statusFilter = args.status.toLowerCase();
          transactions = transactions.filter(
            (tx) => String(tx.status || '').toLowerCase() === statusFilter,
          );
        }

        deps.output(transactions, { json: Boolean(json) });
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createShowCommand(deps: TxDeps) {
  return defineCommand({
    meta: {
      name: 'show',
      description: 'Show full transaction details',
    },
    args: {
      ...globalArgs,
      id: {
        type: 'positional',
        description: 'Transaction ID',
        required: true,
      },
      relayer: {
        type: 'string',
        alias: 'r',
        description: 'Relayer ID',
      },
    },
    async run({ args }) {
      deps.setVerbose(Boolean(args.verbose));
      const json = args.json;
      const config = requireConfig(deps, args);
      const client = deps.createClient(config);

      const relayerId = args.relayer || config.defaultRelayer;
      if (!relayerId) {
        deps.exitWithUsageError(
          'Relayer ID is required. Use -r/--relayer or set a default relayer.',
        );
      }

      if (!args.id) {
        deps.exitWithUsageError('Transaction ID is required');
      }

      try {
        const response = await client.relayers.getTransactionById(relayerId, args.id);
        const transaction = response.data.data;

        deps.output(transaction, { json: Boolean(json) });
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createCancelCommand(deps: TxDeps) {
  return defineCommand({
    meta: {
      name: 'cancel',
      description: 'Cancel a pending transaction',
    },
    args: {
      ...globalArgs,
      id: {
        type: 'positional',
        description: 'Transaction ID',
        required: true,
      },
      relayer: {
        type: 'string',
        alias: 'r',
        description: 'Relayer ID',
      },
    },
    async run({ args }) {
      deps.setVerbose(Boolean(args.verbose));
      const json = args.json;
      const noInput = args['no-input'];
      const config = requireConfig(deps, args);

      // Check for protected profile before write operation
      if (config.isProtected) {
        const confirmed = await deps.confirmProtectedOperation({
          profileName: config.profileName,
          operation: 'cancel transaction',
          summary: `Transaction ID: ${args.id}`,
          noInput: Boolean(noInput),
        });
        if (!confirmed) {
          console.log('Operation cancelled');
          process.exit(0);
        }
      }

      const client = deps.createClient(config);

      const relayerId = args.relayer || config.defaultRelayer;
      if (!relayerId) {
        deps.exitWithUsageError(
          'Relayer ID is required. Use -r/--relayer or set a default relayer.',
        );
      }

      if (!args.id) {
        deps.exitWithUsageError('Transaction ID is required');
      }

      if (!noInput && !config.isProtected) {
        const confirmed = await deps.promptConfirm(`Cancel transaction ${args.id}?`);
        deps.closePrompts();
        if (!confirmed) {
          console.log('Cancellation aborted');
          return;
        }
      }

      try {
        await client.relayers.cancelTransaction(relayerId, args.id);

        if (json) {
          deps.output({ id: args.id, cancelled: true }, { json: true });
        } else {
          deps.success(`Transaction ${args.id} cancelled`);
        }
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createCancelAllCommand(deps: TxDeps) {
  return defineCommand({
    meta: {
      name: 'cancel-all',
      description: 'Cancel all pending transactions',
    },
    args: {
      ...globalArgs,
      relayer: {
        type: 'string',
        alias: 'r',
        description: 'Relayer ID',
      },
    },
    async run({ args }) {
      deps.setVerbose(Boolean(args.verbose));
      const json = args.json;
      const noInput = args['no-input'];
      const config = requireConfig(deps, args);

      // Check for protected profile before write operation
      if (config.isProtected) {
        const confirmed = await deps.confirmProtectedOperation({
          profileName: config.profileName,
          operation: 'cancel all pending transactions',
          noInput: Boolean(noInput),
        });
        if (!confirmed) {
          console.log('Operation cancelled');
          process.exit(0);
        }
      }

      const client = deps.createClient(config);

      const relayerId = args.relayer || config.defaultRelayer;
      if (!relayerId) {
        deps.exitWithUsageError(
          'Relayer ID is required. Use -r/--relayer or set a default relayer.',
        );
      }

      if (!noInput && !config.isProtected) {
        const confirmed = await deps.promptConfirm(
          `Cancel all pending transactions for relayer ${relayerId}?`,
        );
        deps.closePrompts();
        if (!confirmed) {
          console.log('Cancellation aborted');
          return;
        }
      }

      try {
        await client.relayers.deletePendingTransactions(relayerId);

        if (json) {
          deps.output({ relayer: relayerId, cancelled: true }, { json: true });
        } else {
          deps.success(`All pending transactions cancelled for relayer ${relayerId}`);
        }
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

/**
 * Create the tx command with injected dependencies.
 */
export function createTxCommand(deps: TxDeps = defaultDeps) {
  return defineCommand({
    meta: {
      name: 'tx',
      description: 'Transaction operations',
    },
    subCommands: {
      send: createSendCommand(deps),
      status: createStatusCommand(deps),
      list: createListCommand(deps),
      show: createShowCommand(deps),
      cancel: createCancelCommand(deps),
      'cancel-all': createCancelAllCommand(deps),
    },
  });
}

/**
 * Default tx command instance for production use.
 */
export const txCommand = createTxCommand();
