import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { isProfileProtected } from './protection.js';
import type {
  BaseProfile,
  ConfigFile,
  ConfigOptions,
  ConfigPaths,
  ProfileEntry,
  ResolvedConfig,
} from './types.js';

const CONFIG_FILE_NAME = 'config.yaml';

/**
 * Create a config manager for a CLI with the given options.
 */
export function createConfigManager<P extends BaseProfile>(options: ConfigOptions<P>) {
  const { cliName, envPrefix, envMapping, protectedNames = [] } = options;

  const CONFIG_DIR_NAME = cliName;
  const PROJECT_CONFIG_DIR = `.${cliName}`;

  function getUserConfigDir(): string {
    const xdgConfig = process.env.XDG_CONFIG_HOME;
    if (xdgConfig) {
      return join(xdgConfig, CONFIG_DIR_NAME);
    }
    return join(homedir(), '.config', CONFIG_DIR_NAME);
  }

  function getUserConfigPath(): string {
    return join(getUserConfigDir(), CONFIG_FILE_NAME);
  }

  function getProjectConfigPath(): string | null {
    let dir = process.cwd();
    const root = dirname(dir);

    while (dir !== root) {
      const configPath = join(dir, PROJECT_CONFIG_DIR, CONFIG_FILE_NAME);
      if (existsSync(configPath)) {
        return configPath;
      }
      dir = dirname(dir);
    }

    return null;
  }

  function loadConfigFile(path: string): ConfigFile<P> | null {
    if (!existsSync(path)) {
      return null;
    }
    try {
      const content = readFileSync(path, 'utf-8');
      return parse(content) as ConfigFile<P>;
    } catch {
      return null;
    }
  }

  function saveConfigFile(path: string, config: ConfigFile<P>): void {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(path, stringify(config), 'utf-8');
  }

  /**
   * Load and merge user and project config files.
   */
  function loadConfig(): ConfigFile<P> {
    const userConfig = loadConfigFile(getUserConfigPath());
    const projectConfig = loadConfigFile(getProjectConfigPath() || '');

    // Merge configs: project overrides user
    const merged: ConfigFile<P> = {
      default: projectConfig?.default || userConfig?.default,
      profiles: {
        ...userConfig?.profiles,
        ...projectConfig?.profiles,
      },
      aliases: {
        ...userConfig?.aliases,
        ...projectConfig?.aliases,
      },
    };

    return merged;
  }

  /**
   * Resolve a profile name, following aliases.
   */
  function resolveProfileName(config: ConfigFile<P>, name: string): string {
    const alias = config.aliases?.[name];
    if (alias && config.profiles?.[alias]) {
      return alias;
    }
    return name;
  }

  /**
   * Resolve configuration from CLI args, environment variables, and config files.
   */
  function resolveConfig(args: {
    profile?: string;
    url?: string;
    'api-key'?: string;
    [key: string]: unknown;
  }): ResolvedConfig<P> | null {
    // Check environment variables for base fields
    const envUrl = process.env[`${envPrefix}_URL`];
    const envApiKey = process.env[`${envPrefix}_API_KEY`];
    const envProfile = process.env[`${envPrefix}_PROFILE`];

    // Load config file
    const config = loadConfig();

    // Determine profile name (CLI > env > config default > 'default')
    const rawProfileName = args.profile || envProfile || config.default || 'default';
    const profileName = resolveProfileName(config, rawProfileName);

    // Get profile from config
    const profile = config.profiles?.[profileName];

    // Resolve URL: CLI > env > profile
    const url = args.url || envUrl || profile?.url;

    // Resolve API key: CLI > env > profile
    const apiKey = args['api-key'] || envApiKey || profile?.api_key;

    if (!url || !apiKey) {
      return null;
    }

    // Check if profile is protected
    const isProtected = isProfileProtected(profileName, profile, protectedNames);

    return {
      url,
      apiKey,
      profileName,
      profile,
      isProtected,
    };
  }

  /**
   * Get a specific profile by name.
   */
  function getProfile(name: string): P | null {
    const config = loadConfig();
    const resolvedName = resolveProfileName(config, name);
    return config.profiles?.[resolvedName] || null;
  }

  /**
   * List all profiles.
   */
  function listProfiles(): ProfileEntry<P>[] {
    const config = loadConfig();
    const defaultProfile = config.default;

    return Object.entries(config.profiles || {}).map(([name, profile]) => ({
      name,
      isDefault: name === defaultProfile,
      isProtected: isProfileProtected(name, profile, protectedNames),
      profile,
    }));
  }

  /**
   * Save a profile to the user config file.
   */
  function saveProfile(name: string, profile: P, setAsDefault = false): void {
    const configPath = getUserConfigPath();
    const config = loadConfigFile(configPath) || { profiles: {} as Record<string, P> };

    config.profiles = config.profiles || ({} as Record<string, P>);
    config.profiles[name] = profile;

    if (setAsDefault) {
      config.default = name;
    }

    saveConfigFile(configPath, config);
  }

  /**
   * Update an existing profile with partial changes.
   */
  function updateProfile(name: string, updates: Partial<P>): boolean {
    const configPath = getUserConfigPath();
    const config = loadConfigFile(configPath);

    if (!config || !config.profiles?.[name]) {
      return false;
    }

    config.profiles[name] = {
      ...config.profiles[name],
      ...updates,
    };

    saveConfigFile(configPath, config);
    return true;
  }

  /**
   * Delete a profile from the user config file.
   */
  function deleteProfile(name: string): boolean {
    const configPath = getUserConfigPath();
    const config = loadConfigFile(configPath);

    if (!config || !config.profiles?.[name]) {
      return false;
    }

    delete config.profiles[name];

    if (config.default === name) {
      config.default = undefined;
    }

    // Also remove any aliases pointing to this profile
    if (config.aliases) {
      for (const [alias, target] of Object.entries(config.aliases)) {
        if (target === name) {
          delete config.aliases[alias];
        }
      }
    }

    saveConfigFile(configPath, config);
    return true;
  }

  /**
   * Set the default profile.
   */
  function setDefaultProfile(name: string): boolean {
    const configPath = getUserConfigPath();
    const config = loadConfigFile(configPath);

    if (!config || !config.profiles?.[name]) {
      return false;
    }

    config.default = name;
    saveConfigFile(configPath, config);
    return true;
  }

  /**
   * Set an alias for a profile.
   */
  function setAlias(alias: string, profileName: string): boolean {
    const configPath = getUserConfigPath();
    const config = loadConfigFile(configPath) || { profiles: {} as Record<string, P> };

    // Verify the target profile exists
    if (!config.profiles?.[profileName]) {
      return false;
    }

    config.aliases = config.aliases || {};
    config.aliases[alias] = profileName;
    saveConfigFile(configPath, config);
    return true;
  }

  /**
   * Remove an alias.
   */
  function removeAlias(alias: string): boolean {
    const configPath = getUserConfigPath();
    const config = loadConfigFile(configPath);

    if (!config?.aliases?.[alias]) {
      return false;
    }

    delete config.aliases[alias];
    saveConfigFile(configPath, config);
    return true;
  }

  /**
   * List all aliases.
   */
  function listAliases(): Record<string, string> {
    const config = loadConfig();
    return config.aliases || {};
  }

  /**
   * Get config file paths.
   */
  function getConfigPaths(): ConfigPaths {
    return {
      user: getUserConfigPath(),
      project: getProjectConfigPath(),
    };
  }

  /**
   * Check if a profile is protected.
   */
  function isProtected(profileNameOrConfig: string | ResolvedConfig<P>): boolean {
    if (typeof profileNameOrConfig === 'string') {
      const profile = getProfile(profileNameOrConfig);
      return isProfileProtected(profileNameOrConfig, profile ?? undefined, protectedNames);
    }
    return profileNameOrConfig.isProtected;
  }

  return {
    loadConfig,
    resolveConfig,
    getProfile,
    listProfiles,
    saveProfile,
    updateProfile,
    deleteProfile,
    setDefaultProfile,
    setAlias,
    removeAlias,
    listAliases,
    getConfigPaths,
    isProtected,
    envPrefix,
    cliName,
  };
}

export type ConfigManager<P extends BaseProfile> = ReturnType<typeof createConfigManager<P>>;
