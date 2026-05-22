import type {
  ApiResponseSignerResponseData,
  LocalSignerRequestConfig,
} from '@openzeppelin/relayer-sdk';
import { SignerTypeRequest } from '@openzeppelin/relayer-sdk';
import { defineCommand } from 'citty';
import { type CommandDeps, defaultDeps } from '../deps.js';

/**
 * Dependencies needed by signer commands.
 */
export type SignerDeps = Pick<
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

function requireConfig(deps: SignerDeps, args: Record<string, unknown>) {
  const config = deps.resolveConfig(args as { profile?: string; url?: string; 'api-key'?: string });
  if (!config) {
    deps.exitWithUsageError(
      'No configuration found. Run `oz-relayer profile init` or set OZ_RELAYER_URL and OZ_RELAYER_API_KEY environment variables.',
    );
  }
  return config;
}

function createListCommand(deps: SignerDeps) {
  return defineCommand({
    meta: {
      name: 'list',
      description: 'List all signers',
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
        const response = await client.signers.listSigners(
          Number(args.page),
          Number(args['per-page']),
        );
        const signers: ApiResponseSignerResponseData[] = response.data.data || [];

        deps.output(signers, { json: Boolean(json) });
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createShowCommand(deps: SignerDeps) {
  return defineCommand({
    meta: {
      name: 'show',
      description: 'Show signer details',
    },
    args: {
      ...globalArgs,
      id: {
        type: 'positional',
        description: 'Signer ID',
        required: true,
      },
    },
    async run({ args }) {
      deps.setVerbose(Boolean(args.verbose));
      const json = args.json;
      const config = requireConfig(deps, args);
      const client = deps.createClient(config);

      if (!args.id) {
        deps.exitWithUsageError('Signer ID is required');
      }

      try {
        const response = await client.signers.getSigner(args.id);
        const signer = response.data.data;

        deps.output(signer, { json: Boolean(json) });
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createCreateCommand(deps: SignerDeps) {
  return defineCommand({
    meta: {
      name: 'create',
      description: 'Create a new signer',
    },
    args: {
      ...globalArgs,
      id: {
        type: 'positional',
        description: 'Signer ID',
        required: true,
      },
      type: {
        type: 'string',
        alias: 't',
        description: 'Signer type (currently only "plain" is supported)',
        default: 'plain',
      },
      key: {
        type: 'string',
        alias: 'k',
        description: 'Secret key (hex-encoded for plain, required unless --generate)',
      },
      generate: {
        type: 'boolean',
        alias: 'g',
        description: 'Generate a random keypair (Stellar only)',
        default: false,
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
          operation: 'create signer',
          summary: `Signer ID: ${args.id}`,
          noInput: Boolean(noInput),
        });
        if (!confirmed) {
          console.log('Operation cancelled');
          process.exit(0);
        }
      }

      const client = deps.createClient(config);

      if (!args.id) {
        deps.exitWithUsageError('Signer ID is required');
      }

      let secretKey = args.key;

      // Generate keypair if requested
      if (args.generate) {
        // Generate 32 random bytes as hex for the secret key
        const randomBytes = crypto.getRandomValues(new Uint8Array(32));
        secretKey = Array.from(randomBytes)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      }

      if (!secretKey && args.type === 'plain') {
        deps.exitWithUsageError(
          'Secret key is required for plain signers. Use --key or --generate',
        );
      }

      // Map type string to enum
      const typeMap: Record<string, SignerTypeRequest> = {
        plain: SignerTypeRequest.PLAIN,
        vault: SignerTypeRequest.VAULT,
        aws_kms: SignerTypeRequest.AWS_KMS,
        vault_transit: SignerTypeRequest.VAULT_TRANSIT,
        turnkey: SignerTypeRequest.TURNKEY,
        cdp: SignerTypeRequest.CDP,
        google_cloud_kms: SignerTypeRequest.GOOGLE_CLOUD_KMS,
      };

      const signerType = typeMap[args.type.toLowerCase()];
      if (!signerType) {
        deps.exitWithUsageError(
          `Invalid signer type: ${args.type}. Use: plain, vault, aws_kms, vault_transit, turnkey, cdp, google_cloud_kms`,
        );
      }

      try {
        // Currently only plain signers are fully supported via CLI
        // Other signer types require additional configuration not yet implemented
        if (signerType !== SignerTypeRequest.PLAIN) {
          deps.exitWithUsageError(
            `Signer type '${args.type}' is not yet fully supported via CLI. Only 'plain' signers can be created.`,
          );
        }

        if (!secretKey) {
          deps.exitWithUsageError(
            'Secret key is required for plain signers. Use --key or --generate',
          );
        }

        const signerConfig: LocalSignerRequestConfig = { key: secretKey };
        const response = await client.signers.createSigner({
          id: args.id,
          type: signerType,
          config: signerConfig,
        });
        const signer = response.data.data;

        if (json) {
          deps.output(signer, { json: true });
        } else {
          deps.success(`Signer '${args.id}' created`);
          deps.output(signer, { json: false });
        }
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

/**
 * Create the signer command with injected dependencies.
 */
export function createSignerCommand(deps: SignerDeps = defaultDeps) {
  return defineCommand({
    meta: {
      name: 'signer',
      description: 'Signer management',
    },
    subCommands: {
      create: createCreateCommand(deps),
      list: createListCommand(deps),
      show: createShowCommand(deps),
    },
  });
}

/**
 * Default signer command instance for production use.
 */
export const signerCommand = createSignerCommand();
