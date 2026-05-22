import { readFileSync } from 'node:fs';
import { defineCommand } from 'citty';
import pc from 'picocolors';
import { type CommandDeps, defaultDeps } from '../deps.js';

/**
 * Dependencies needed by submit commands.
 */
export type SubmitDeps = Pick<
  CommandDeps,
  | 'resolveConfig'
  | 'createClient'
  | 'output'
  | 'success'
  | 'handleApiError'
  | 'exitWithUsageError'
  | 'prompt'
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

function requireConfig(deps: SubmitDeps, args: Record<string, unknown>) {
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

function createXdrCommand(deps: SubmitDeps) {
  return defineCommand({
    meta: {
      name: 'xdr',
      description: 'Submit a signed XDR transaction',
    },
    args: {
      ...globalArgs,
      xdr: {
        type: 'positional',
        description: 'Transaction XDR (base64) or "-" for stdin',
        required: false,
      },
      file: {
        type: 'string',
        alias: 'f',
        description: 'Read XDR from file',
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
      const json = args.json;
      const config = requireConfig(deps, args);
      const client = deps.createClient(config);

      let xdr: string;

      if (args.file) {
        // Read from file
        try {
          xdr = readFileSync(args.file, 'utf-8').trim();
        } catch (err) {
          deps.exitWithUsageError(`Failed to read file: ${args.file}`);
        }
      } else if (args.xdr === '-') {
        // Read from stdin
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        xdr = Buffer.concat(chunks).toString('utf-8').trim();
      } else if (args.xdr) {
        // Direct argument
        xdr = args.xdr;
      } else {
        deps.exitWithUsageError('XDR is required. Provide as argument, --file, or "-" for stdin.');
      }

      // Validate XDR is base64
      if (!/^[A-Za-z0-9+/=]+$/.test(xdr)) {
        deps.exitWithUsageError('Invalid XDR: must be base64 encoded');
      }

      try {
        const response = await client.submitXdr({ xdr });

        if (args.wait && response.transactionId) {
          process.stdout.write('Waiting for confirmation... ');
          // Note: polling not implemented in SDK yet
          console.log('(polling not yet supported)');
        }

        if (json) {
          deps.output(
            {
              transactionId: response.transactionId,
              hash: response.hash,
              status: response.status,
            },
            { json: true },
          );
        } else {
          if (response.transactionId) {
            deps.success(`Transaction submitted: ${response.transactionId}`);
          }
          if (response.hash) {
            console.log(`${pc.bold('Hash:')} ${response.hash}`);
          }
          if (response.status) {
            console.log(`${pc.bold('Status:')} ${response.status}`);
          }
        }
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

function createFuncAuthCommand(deps: SubmitDeps) {
  return defineCommand({
    meta: {
      name: 'func-auth',
      description: 'Submit a Soroban transaction with function and authorization entries',
    },
    args: {
      ...globalArgs,
      func: {
        type: 'string',
        description: 'Soroban host function XDR (base64)',
      },
      auth: {
        type: 'string',
        description: 'Comma-separated authorization entry XDRs (base64)',
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
      const json = args.json;
      const noInput = args['no-input'];
      const config = requireConfig(deps, args);
      const client = deps.createClient(config);

      let func = args.func;
      let authEntries: string[] = [];

      // Interactive mode for missing func
      if (!func && !noInput) {
        console.log(pc.bold('\noz-channels submit func-auth\n'));
        func = await deps.prompt('Host function XDR (base64)');
        if (!func) {
          console.error('Function XDR is required');
          deps.closePrompts();
          process.exit(2);
        }

        const authInput = await deps.prompt('Authorization entries (comma-separated XDRs)', '');
        deps.closePrompts();

        if (authInput) {
          authEntries = authInput.split(',').map((s) => s.trim());
        }
      } else {
        if (!func) {
          deps.exitWithUsageError('--func is required');
        }

        if (args.auth) {
          authEntries = args.auth.split(',').map((s) => s.trim());
        }
      }

      // Validate base64
      if (!/^[A-Za-z0-9+/=]+$/.test(func)) {
        deps.exitWithUsageError('Invalid func XDR: must be base64 encoded');
      }

      for (const entry of authEntries) {
        if (!/^[A-Za-z0-9+/=]+$/.test(entry)) {
          deps.exitWithUsageError('Invalid auth entry: must be base64 encoded');
        }
      }

      try {
        const response = await client.submitFuncAuth({ func, auth: authEntries });

        if (args.wait && response.transactionId) {
          process.stdout.write('Waiting for confirmation... ');
          // Note: polling not implemented in SDK yet
          console.log('(polling not yet supported)');
        }

        if (json) {
          deps.output(
            {
              transactionId: response.transactionId,
              hash: response.hash,
              status: response.status,
            },
            { json: true },
          );
        } else {
          if (response.transactionId) {
            deps.success(`Transaction submitted: ${response.transactionId}`);
          }
          if (response.hash) {
            console.log(`${pc.bold('Hash:')} ${response.hash}`);
          }
          if (response.status) {
            console.log(`${pc.bold('Status:')} ${response.status}`);
          }
        }
      } catch (err) {
        deps.handleApiError(err);
      }
    },
  });
}

/**
 * Create the submit command with injected dependencies.
 */
export function createSubmitCommand(deps: SubmitDeps = defaultDeps) {
  return defineCommand({
    meta: {
      name: 'submit',
      description: 'Submit transactions to the channels service',
    },
    subCommands: {
      xdr: createXdrCommand(deps),
      'func-auth': createFuncAuthCommand(deps),
    },
  });
}

/**
 * Default submit command instance for production use.
 */
export const submitCommand = createSubmitCommand();
