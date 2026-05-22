import { defineCommand } from 'citty';
import pc from 'picocolors';
import { isProtectedName } from '../cli-config/index.js';
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
  | 'promptSelect'
  | 'closePrompts'
  | 'getStellarAccount'
  | 'generateStellarAccount'
  | 'fundViaFriendbot'
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

      console.log(pc.bold('\noz-channels profile init\n'));

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

      const url = await deps.prompt('Channels service URL');
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

      const pluginId = await deps.prompt('Plugin ID (optional, default: channels)', 'channels');
      const adminSecret = await deps.promptPassword(
        'Admin Secret (optional, for management operations)',
      );

      // Network selection
      const network = await deps.promptSelect<'testnet' | 'mainnet'>('Which network?', [
        { value: 'testnet', name: 'Stellar Testnet' },
        { value: 'mainnet', name: 'Stellar Mainnet' },
      ]);

      // Test account setup
      let testAccount = await deps.prompt('Test account name (stellar CLI)', 'test-account');
      if (testAccount) {
        const account = deps.getStellarAccount(testAccount);
        if (!account) {
          const generate = await deps.promptConfirm(
            `Account '${testAccount}' not found. Generate it?`,
            true,
          );
          if (generate) {
            try {
              deps.generateStellarAccount(testAccount, network);
              console.log(pc.green(`Account '${testAccount}' generated`));

              if (network === 'testnet') {
                const fund = await deps.promptConfirm('Fund account via friendbot?', true);
                if (fund) {
                  const newAccount = deps.getStellarAccount(testAccount);
                  if (newAccount) {
                    console.log('Funding via friendbot...');
                    const funded = await deps.fundViaFriendbot(newAccount.publicKey);
                    if (funded) {
                      console.log(pc.green('Account funded successfully'));
                    } else {
                      console.log(
                        pc.yellow('Failed to fund via friendbot (may already be funded)'),
                      );
                    }
                  }
                }
              }
            } catch (err) {
              console.log(
                pc.yellow(
                  `Failed to generate account: ${err instanceof Error ? err.message : String(err)}`,
                ),
              );
              testAccount = '';
            }
          } else {
            testAccount = '';
          }
        } else {
          console.log(
            pc.green(`Account '${testAccount}' found: ${account.publicKey.slice(0, 8)}...`),
          );
        }
      }

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
          plugin_id: pluginId || undefined,
          admin_secret: adminSecret || undefined,
          network,
          test_account: testAccount || undefined,
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
          console.log('No profiles configured. Run `oz-channels profile init` to create one.');
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
              plugin_id: p.profile.plugin_id,
              has_admin_secret: Boolean(p.profile.admin_secret),
              network: p.profile.network,
              test_account: p.profile.test_account,
              smoke_contract: p.profile.smoke_contract,
            })),
          },
          { json: true },
        );
      } else {
        const rows = profiles.map((p) => {
          let name = p.name;
          if (p.isDefault) name += ` ${pc.green('(default)')}`;
          if (p.isProtected) name += ` ${pc.yellow('(protected)')}`;
          return [
            name,
            p.profile.url,
            p.profile.plugin_id || '-',
            p.profile.admin_secret ? pc.green('yes') : pc.dim('no'),
          ];
        });
        console.log(deps.formatTable(['NAME', 'URL', 'PLUGIN ID', 'ADMIN'], rows));
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
            plugin_id: profile.plugin_id,
            admin_secret: profile.admin_secret ? '********' : null,
            network: profile.network,
            test_account: profile.test_account,
            smoke_contract: profile.smoke_contract,
            default: isDefault,
            protected: isProtected,
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
        if (profile.plugin_id) {
          console.log(`${pc.bold('Plugin ID:')} ${profile.plugin_id}`);
        }
        console.log(
          `${pc.bold('Admin Secret:')} ${profile.admin_secret ? '********' : pc.dim('not set')}`,
        );
        console.log(`${pc.bold('Network:')} ${profile.network || pc.dim('not set')}`);
        console.log(`${pc.bold('Test Account:')} ${profile.test_account || pc.dim('not set')}`);
        console.log(`${pc.bold('Smoke Contract:')} ${profile.smoke_contract || pc.dim('not set')}`);
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
