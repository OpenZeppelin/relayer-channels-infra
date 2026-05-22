import { isProtectedName } from '@internal/cli-config';
import { defineCommand } from 'citty';
import pc from 'picocolors';
import { type CommandDeps, defaultDeps } from '../deps.js';

/**
 * Dependencies needed by profile commands.
 */
export type ProfileDeps = Pick<
  CommandDeps,
  | 'getProfile'
  | 'listProfiles'
  | 'saveProfile'
  | 'deleteProfile'
  | 'setDefaultProfile'
  | 'getConfigPaths'
  | 'output'
  | 'success'
  | 'formatTable'
  | 'exitWithUsageError'
  | 'prompt'
  | 'promptConfirm'
  | 'promptPassword'
  | 'closePrompts'
>;

// Global args that need to be defined on each subcommand (citty doesn't inherit from parent)
const globalArgs = {
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

function createInitCommand(deps: ProfileDeps) {
  return defineCommand({
    meta: {
      name: 'init',
      description: 'Create a new profile interactively',
    },
    args: {
      ...globalArgs,
      name: {
        type: 'positional',
        description: 'Profile name',
        required: false,
      },
    },
    async run({ args }) {
      const noInput = args['no-input'];

      if (noInput) {
        deps.exitWithUsageError('Cannot run profile init in non-interactive mode');
      }

      console.log(pc.bold('\noz-relayer profile init\n'));

      let profileName = args.name;
      if (!profileName) {
        profileName = await deps.prompt('Profile name', 'default');
        if (!profileName.match(/^[a-zA-Z0-9_-]+$/)) {
          console.error('Profile name must be alphanumeric with dashes/underscores only');
          deps.closePrompts();
          process.exit(2);
        }
      }

      const existingProfile = deps.getProfile(profileName);
      if (existingProfile) {
        const overwrite = await deps.promptConfirm(
          `Profile '${profileName}' already exists. Overwrite?`,
        );
        if (!overwrite) {
          console.log('Profile creation cancelled');
          deps.closePrompts();
          process.exit(0);
        }
      }

      const url = await deps.prompt('Relayer URL');
      try {
        new URL(url);
      } catch {
        console.error('Please enter a valid URL');
        deps.closePrompts();
        process.exit(2);
      }

      const apiKey = await deps.promptPassword('API Key');
      if (!apiKey) {
        console.error('API key is required');
        deps.closePrompts();
        process.exit(2);
      }

      const testConnection = await deps.promptConfirm('Test connection?', true);

      if (testConnection) {
        process.stdout.write('Testing connection... ');

        try {
          // Use direct fetch instead of SDK (SDK health endpoint has wrong path)
          const healthUrl = `${url.replace(/\/$/, '')}/api/v1/health`;
          const response = await fetch(healthUrl, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
          }
          console.log(pc.green('OK'));
        } catch (err) {
          console.log(pc.red('Failed'));

          if (err instanceof Error) {
            console.log(`  Error: ${err.message}`);
          }

          const saveAnyway = await deps.promptConfirm('Save profile despite connection failure?');
          if (!saveAnyway) {
            console.log('Profile creation cancelled');
            deps.closePrompts();
            process.exit(0);
          }
        }
      }

      const defaultRelayer = await deps.prompt('Default relayer ID (optional)');

      // Ask about protection if name isn't auto-protected
      let isProtected = isProtectedName(profileName);
      if (!isProtected) {
        isProtected = await deps.promptConfirm(
          'Mark this profile as protected (require confirmation for write operations)?',
        );
      } else {
        console.log(pc.dim(`Profile '${profileName}' will be auto-protected based on its name.`));
      }

      const profiles = deps.listProfiles();
      let setAsDefault = profiles.length === 0;

      if (!setAsDefault) {
        setAsDefault = await deps.promptConfirm('Set as default profile?');
      }

      deps.saveProfile(
        profileName,
        {
          url,
          api_key: apiKey,
          default_relayer: defaultRelayer || undefined,
          protected: isProtected || undefined,
        },
        setAsDefault,
      );

      deps.closePrompts();
      deps.success(`Profile '${profileName}' created successfully`);
    },
  });
}

function createListCommand(deps: ProfileDeps) {
  return defineCommand({
    meta: {
      name: 'list',
      description: 'List all profiles',
    },
    args: {
      ...globalArgs,
    },
    async run({ args }) {
      const json = args.json;

      const profiles = deps.listProfiles();

      if (profiles.length === 0) {
        if (json) {
          deps.output({ profiles: [] }, { json: true });
        } else {
          console.log('No profiles configured. Run `oz-relayer profile init` to create one.');
        }
        return;
      }

      if (json) {
        deps.output(
          {
            profiles: profiles.map((p) => ({
              name: p.name,
              url: p.profile.url,
              default: p.isDefault,
              protected: p.isProtected,
              default_relayer: p.profile.default_relayer,
            })),
          },
          { json: true },
        );
      } else {
        const rows = profiles.map((p) => {
          let name = p.name;
          if (p.isDefault) name += ` ${pc.green('(default)')}`;
          if (p.isProtected) name += ` ${pc.yellow('(protected)')}`;
          return [name, p.profile.url, p.profile.default_relayer || '-'];
        });
        console.log(deps.formatTable(['NAME', 'URL', 'DEFAULT RELAYER'], rows));
      }
    },
  });
}

function createShowCommand(deps: ProfileDeps) {
  return defineCommand({
    meta: {
      name: 'show',
      description: 'Show profile details',
    },
    args: {
      ...globalArgs,
      name: {
        type: 'positional',
        description: 'Profile name (uses default if not specified)',
        required: false,
      },
    },
    async run({ args }) {
      const json = args.json;

      const profiles = deps.listProfiles();
      const defaultProfile = profiles.find((p) => p.isDefault);

      const profileName = args.name || defaultProfile?.name;

      if (!profileName) {
        deps.exitWithUsageError('No profile specified and no default profile set');
      }

      const profile = deps.getProfile(profileName);
      if (!profile) {
        deps.exitWithUsageError(`Profile '${profileName}' not found`);
      }

      const profileEntry = profiles.find((p) => p.name === profileName);
      const isDefault = profileEntry?.isDefault || false;
      const isProtected = profileEntry?.isProtected || false;

      if (json) {
        deps.output(
          {
            name: profileName,
            url: profile.url,
            api_key: '********',
            default: isDefault,
            protected: isProtected,
            default_relayer: profile.default_relayer,
          },
          { json: true },
        );
      } else {
        let statusSuffix = '';
        if (isDefault) statusSuffix += pc.green(' (default)');
        if (isProtected) statusSuffix += pc.yellow(' (protected)');
        console.log(`${pc.bold('Profile:')} ${profileName}${statusSuffix}`);
        console.log(`${pc.bold('URL:')} ${profile.url}`);
        console.log(`${pc.bold('API Key:')} ********`);
        if (profile.default_relayer) {
          console.log(`${pc.bold('Default Relayer:')} ${profile.default_relayer}`);
        }
      }
    },
  });
}

function createUseCommand(deps: ProfileDeps) {
  return defineCommand({
    meta: {
      name: 'use',
      description: 'Set the default profile',
    },
    args: {
      name: {
        type: 'positional',
        description: 'Profile name to set as default',
        required: true,
      },
    },
    async run({ args }) {
      if (!args.name) {
        deps.exitWithUsageError('Profile name is required');
      }

      if (!deps.setDefaultProfile(args.name)) {
        deps.exitWithUsageError(`Profile '${args.name}' not found`);
      }

      deps.success(`Default profile set to '${args.name}'`);
    },
  });
}

function createDeleteCommand(deps: ProfileDeps) {
  return defineCommand({
    meta: {
      name: 'delete',
      description: 'Delete a profile',
    },
    args: {
      ...globalArgs,
      name: {
        type: 'positional',
        description: 'Profile name to delete',
        required: true,
      },
    },
    async run({ args }) {
      const noInput = args['no-input'];

      if (!args.name) {
        deps.exitWithUsageError('Profile name is required');
      }

      if (!noInput) {
        const confirmed = await deps.promptConfirm(`Delete profile '${args.name}'?`);
        deps.closePrompts();
        if (!confirmed) {
          console.log('Deletion cancelled');
          return;
        }
      }

      if (!deps.deleteProfile(args.name)) {
        deps.exitWithUsageError(`Profile '${args.name}' not found`);
      }

      deps.success(`Profile '${args.name}' deleted`);
    },
  });
}

function createPathCommand(deps: ProfileDeps) {
  return defineCommand({
    meta: {
      name: 'path',
      description: 'Show config file paths',
    },
    args: {
      ...globalArgs,
    },
    async run({ args }) {
      const json = args.json;

      const paths = deps.getConfigPaths();

      if (json) {
        deps.output(paths, { json: true });
      } else {
        console.log(`${pc.bold('User config:')} ${paths.user}`);
        if (paths.project) {
          console.log(`${pc.bold('Project config:')} ${paths.project}`);
        }
      }
    },
  });
}

/**
 * Create the profile command with injected dependencies.
 */
export function createProfileCommand(deps: ProfileDeps = defaultDeps) {
  return defineCommand({
    meta: {
      name: 'profile',
      description: 'Manage connection profiles',
    },
    subCommands: {
      init: createInitCommand(deps),
      list: createListCommand(deps),
      show: createShowCommand(deps),
      use: createUseCommand(deps),
      delete: createDeleteCommand(deps),
      path: createPathCommand(deps),
    },
  });
}

/**
 * Default profile command instance for production use.
 */
export const profileCommand = createProfileCommand();
