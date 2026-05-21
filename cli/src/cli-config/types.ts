/**
 * Base profile interface that all CLI-specific profiles must extend.
 */
export interface BaseProfile {
  url: string;
  api_key: string;
  protected?: boolean;
}

/**
 * Configuration file structure with profiles and optional aliases.
 */
export interface ConfigFile<P extends BaseProfile> {
  default?: string;
  profiles: Record<string, P>;
  aliases?: Record<string, string>;
}

/**
 * Options for creating a config manager.
 */
export interface ConfigOptions<P extends BaseProfile> {
  /** CLI name used for directory name (e.g., 'oz-relayer' -> ~/.config/oz-relayer) */
  cliName: string;
  /** Environment variable prefix (e.g., 'OZ_RELAYER' -> OZ_RELAYER_URL) */
  envPrefix: string;
  /** Maps profile fields to environment variable suffixes */
  envMapping: Partial<Record<keyof P, string>>;
  /** Additional profile names to auto-protect (case-insensitive) */
  protectedNames?: string[];
}

/**
 * Resolved configuration with all values resolved from CLI args, env vars, and profile.
 */
export interface ResolvedConfig<P extends BaseProfile> {
  url: string;
  apiKey: string;
  profileName: string;
  profile: P | undefined;
  isProtected: boolean;
}

/**
 * Profile listing entry.
 */
export interface ProfileEntry<P extends BaseProfile> {
  name: string;
  isDefault: boolean;
  isProtected: boolean;
  profile: P;
}

/**
 * Config paths.
 */
export interface ConfigPaths {
  user: string;
  project: string | null;
}
