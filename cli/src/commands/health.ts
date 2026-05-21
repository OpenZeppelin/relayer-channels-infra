import { defineCommand } from 'citty';
import pc from 'picocolors';
import { type CommandDeps, defaultDeps } from '../deps.js';

/**
 * Dependencies needed by the health command.
 */
export type HealthDeps = Pick<
  CommandDeps,
  'resolveConfig' | 'createClient' | 'output' | 'handleApiError' | 'exitWithUsageError'
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

/**
 * Create the health command with injected dependencies.
 */
export function createHealthCommand(deps: HealthDeps = defaultDeps) {
  return defineCommand({
    meta: {
      name: 'health',
      description: 'Check channels service health',
    },
    args: {
      ...globalArgs,
    },
    async run({ args }) {
      const json = args.json;

      const config = deps.resolveConfig(args);
      if (!config) {
        deps.exitWithUsageError(
          'No configuration found. Run `oz-channels profile init` or set OZ_CHANNELS_URL and OZ_CHANNELS_API_KEY environment variables.',
        );
      }

      const client = deps.createClient(config);

      try {
        const result = await client.healthCheck();

        if (json) {
          deps.output(
            {
              healthy: result.healthy,
              url: config.url,
              profile: config.profileName,
              pluginId: config.pluginId,
            },
            { json: true },
          );
        } else {
          console.log(`${pc.bold('Service:')} ${config.url}`);
          console.log(`${pc.bold('Profile:')} ${config.profileName}`);
          if (config.pluginId) {
            console.log(`${pc.bold('Plugin ID:')} ${config.pluginId}`);
          }
          console.log(
            `${pc.bold('Health:')} ${result.healthy ? pc.green('✓ Healthy') : pc.red('✗ Unhealthy')}`,
          );
        }

        if (!result.healthy) {
          process.exit(1);
        }
      } catch (err) {
        if (json) {
          deps.output(
            {
              healthy: false,
              url: config.url,
              profile: config.profileName,
              pluginId: config.pluginId,
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
