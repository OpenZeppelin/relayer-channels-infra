import { defineCommand } from 'citty';
import pc from 'picocolors';
import { type CommandDeps, defaultDeps } from '../deps.js';

/**
 * Dependencies needed by the health command.
 */
export type HealthDeps = Pick<
  CommandDeps,
  | 'resolveConfig'
  | 'createClient'
  | 'output'
  | 'setVerbose'
  | 'handleApiError'
  | 'exitWithUsageError'
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

/**
 * Create the health command with injected dependencies.
 */
export function createHealthCommand(deps: HealthDeps = defaultDeps) {
  return defineCommand({
    meta: {
      name: 'health',
      description: 'Check relayer service health',
    },
    args: {
      ...globalArgs,
    },
    async run({ args }) {
      deps.setVerbose(Boolean(args.verbose));
      const json = args.json;

      const config = deps.resolveConfig(args);
      if (!config) {
        deps.exitWithUsageError(
          'No configuration found. Run `oz-relayer profile init` or set OZ_RELAYER_URL and OZ_RELAYER_API_KEY environment variables.',
        );
      }

      const client = deps.createClient(config);

      try {
        await client.health.health();

        if (json) {
          deps.output(
            {
              healthy: true,
              url: config.url,
              profile: config.profileName,
            },
            { json: true },
          );
        } else {
          console.log(`${pc.bold('Service:')} ${config.url}`);
          console.log(`${pc.bold('Profile:')} ${config.profileName}`);
          console.log(`${pc.bold('Health:')} ${pc.green('✓ Healthy')}`);
        }
      } catch (err) {
        if (json) {
          deps.output(
            {
              healthy: false,
              url: config.url,
              profile: config.profileName,
            },
            { json: true },
          );
          process.exit(1);
        }
        deps.handleApiError(err);
      }
    },
  });
}

/**
 * Default health command instance for production use.
 */
export const healthCommand = createHealthCommand();
