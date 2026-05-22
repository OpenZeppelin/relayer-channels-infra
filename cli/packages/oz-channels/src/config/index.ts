import {
  type BaseProfile,
  type ResolvedConfig as BaseResolvedConfig,
  createConfigManager,
} from '@internal/cli-config';

/**
 * oz-channels specific profile extending the base profile.
 */
export interface ChannelsProfile extends BaseProfile {
  plugin_id?: string;
  admin_secret?: string;
  network?: 'testnet' | 'mainnet' | 'futurenet';
  test_account?: string;
  smoke_contract?: string;
}

/**
 * Resolved config with oz-channels specific fields.
 */
export interface ResolvedConfig extends BaseResolvedConfig<ChannelsProfile> {
  pluginId?: string;
  adminSecret?: string;
  network?: 'testnet' | 'mainnet' | 'futurenet';
  testAccount?: string;
  smokeContract?: string;
}

const configManager = createConfigManager<ChannelsProfile>({
  cliName: 'oz-channels',
  envPrefix: 'OZ_CHANNELS',
  envMapping: {
    plugin_id: 'PLUGIN_ID',
    admin_secret: 'ADMIN_SECRET',
  },
});

/**
 * Load merged config file.
 */
export const loadConfig = configManager.loadConfig;

/**
 * Resolve config from CLI args, env vars, and config files.
 * Returns null if required fields (url, api_key) are not found.
 */
export function resolveConfig(args: {
  profile?: string;
  url?: string;
  'api-key'?: string;
  'plugin-id'?: string;
  'admin-secret'?: string;
}): ResolvedConfig | null {
  const resolved = configManager.resolveConfig(args);
  if (!resolved) {
    return null;
  }

  // Check for additional fields from env
  const envPluginId = process.env.OZ_CHANNELS_PLUGIN_ID;
  const envAdminSecret = process.env.OZ_CHANNELS_ADMIN_SECRET;

  return {
    ...resolved,
    pluginId: args['plugin-id'] || envPluginId || resolved.profile?.plugin_id,
    adminSecret: args['admin-secret'] || envAdminSecret || resolved.profile?.admin_secret,
    network: resolved.profile?.network,
    testAccount: resolved.profile?.test_account,
    smokeContract: resolved.profile?.smoke_contract,
  };
}

/**
 * Get a profile by name.
 */
export const getProfile = configManager.getProfile;

/**
 * List all profiles.
 */
export const listProfiles = configManager.listProfiles;

/**
 * Save a profile to the user config file.
 */
export const saveProfile = configManager.saveProfile;

/**
 * Update an existing profile.
 */
export const updateProfile = configManager.updateProfile;

/**
 * Delete a profile from the user config file.
 */
export const deleteProfile = configManager.deleteProfile;

/**
 * Set the default profile.
 */
export const setDefaultProfile = configManager.setDefaultProfile;

/**
 * Set an alias for a profile.
 */
export const setAlias = configManager.setAlias;

/**
 * Remove an alias.
 */
export const removeAlias = configManager.removeAlias;

/**
 * List all aliases.
 */
export const listAliases = configManager.listAliases;

/**
 * Get config file paths.
 */
export const getConfigPaths = configManager.getConfigPaths;

/**
 * Check if a profile is protected.
 */
export const isProtected = configManager.isProtected;

// Re-export types for convenience
export type { ChannelsProfile as Profile };
