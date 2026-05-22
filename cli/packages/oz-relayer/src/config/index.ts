import {
  type BaseProfile,
  type ResolvedConfig as BaseResolvedConfig,
  type ConfigManager,
  createConfigManager,
} from '@internal/cli-config';

/**
 * oz-relayer specific profile extending the base profile.
 */
export interface RelayerProfile extends BaseProfile {
  default_relayer?: string;
}

/**
 * Resolved config with oz-relayer specific fields.
 */
export interface ResolvedConfig extends BaseResolvedConfig<RelayerProfile> {
  defaultRelayer?: string;
}

const configManager = createConfigManager<RelayerProfile>({
  cliName: 'oz-relayer',
  envPrefix: 'OZ_RELAYER',
  envMapping: {
    default_relayer: 'DEFAULT_RELAYER',
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
}): ResolvedConfig | null {
  const resolved = configManager.resolveConfig(args);
  if (!resolved) {
    return null;
  }

  // Check for default relayer from env
  const envDefaultRelayer = process.env.OZ_RELAYER_DEFAULT_RELAYER;

  return {
    ...resolved,
    defaultRelayer: envDefaultRelayer || resolved.profile?.default_relayer,
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
 * Delete a profile.
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
export type { RelayerProfile as Profile };
