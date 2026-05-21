import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { createConfigManager } from './config.js';
import type { BaseProfile, ConfigFile } from './types.js';

// Test profile type that extends BaseProfile
interface TestProfile extends BaseProfile {
  url: string;
  api_key: string;
  protected?: boolean;
  extra?: string;
}

const TEST_DIR = '/tmp/cli-config-test-' + Date.now();
const CLI_NAME = 'test-cli';
const ENV_PREFIX = 'TEST_CLI';

function createTestManager() {
  return createConfigManager<TestProfile>({
    cliName: CLI_NAME,
    envPrefix: ENV_PREFIX,
    envMapping: {
      url: 'URL',
      api_key: 'API_KEY',
    },
    protectedNames: ['staging'],
  });
}

function writeUserConfig(config: ConfigFile<TestProfile>) {
  const configDir = join(TEST_DIR, CLI_NAME);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.yaml'), stringify(config), 'utf-8');
}

function writeProjectConfig(projectDir: string, config: ConfigFile<TestProfile>) {
  const configDir = join(projectDir, `.${CLI_NAME}`);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.yaml'), stringify(config), 'utf-8');
}

describe('createConfigManager', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.XDG_CONFIG_HOME = TEST_DIR;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.XDG_CONFIG_HOME;
    delete process.env[`${ENV_PREFIX}_URL`];
    delete process.env[`${ENV_PREFIX}_API_KEY`];
    delete process.env[`${ENV_PREFIX}_PROFILE`];
  });

  test('creates manager with expected methods', () => {
    const manager = createTestManager();

    expect(typeof manager.loadConfig).toBe('function');
    expect(typeof manager.resolveConfig).toBe('function');
    expect(typeof manager.getProfile).toBe('function');
    expect(typeof manager.listProfiles).toBe('function');
    expect(typeof manager.saveProfile).toBe('function');
    expect(typeof manager.updateProfile).toBe('function');
    expect(typeof manager.deleteProfile).toBe('function');
    expect(typeof manager.setDefaultProfile).toBe('function');
    expect(typeof manager.setAlias).toBe('function');
    expect(typeof manager.removeAlias).toBe('function');
    expect(typeof manager.listAliases).toBe('function');
    expect(typeof manager.getConfigPaths).toBe('function');
    expect(typeof manager.isProtected).toBe('function');
    expect(manager.cliName).toBe(CLI_NAME);
    expect(manager.envPrefix).toBe(ENV_PREFIX);
  });

  test('creates config directory when saving profile', () => {
    const manager = createTestManager();
    const configDir = join(TEST_DIR, CLI_NAME);

    expect(existsSync(configDir)).toBe(false);

    manager.saveProfile('test', { url: 'https://test.com', api_key: 'key123' });

    expect(existsSync(configDir)).toBe(true);
  });
});

describe('resolveConfig', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.XDG_CONFIG_HOME = TEST_DIR;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.XDG_CONFIG_HOME;
    delete process.env[`${ENV_PREFIX}_URL`];
    delete process.env[`${ENV_PREFIX}_API_KEY`];
    delete process.env[`${ENV_PREFIX}_PROFILE`];
  });

  test('resolves config from profile', () => {
    writeUserConfig({
      default: 'dev',
      profiles: {
        dev: { url: 'https://dev.example.com', api_key: 'dev-key' },
      },
    });

    const manager = createTestManager();
    const config = manager.resolveConfig({});

    expect(config).not.toBeNull();
    expect(config!.url).toBe('https://dev.example.com');
    expect(config!.apiKey).toBe('dev-key');
    expect(config!.profileName).toBe('dev');
  });

  test('resolves config from environment variables', () => {
    process.env[`${ENV_PREFIX}_URL`] = 'https://env.example.com';
    process.env[`${ENV_PREFIX}_API_KEY`] = 'env-key';

    const manager = createTestManager();
    const config = manager.resolveConfig({});

    expect(config).not.toBeNull();
    expect(config!.url).toBe('https://env.example.com');
    expect(config!.apiKey).toBe('env-key');
  });

  test('resolves config from CLI args', () => {
    const manager = createTestManager();
    const config = manager.resolveConfig({
      url: 'https://cli.example.com',
      'api-key': 'cli-key',
    });

    expect(config).not.toBeNull();
    expect(config!.url).toBe('https://cli.example.com');
    expect(config!.apiKey).toBe('cli-key');
  });

  test('precedence: CLI args override env vars override profile', () => {
    writeUserConfig({
      default: 'dev',
      profiles: {
        dev: { url: 'https://profile.example.com', api_key: 'profile-key' },
      },
    });
    process.env[`${ENV_PREFIX}_URL`] = 'https://env.example.com';
    process.env[`${ENV_PREFIX}_API_KEY`] = 'env-key';

    const manager = createTestManager();

    // CLI overrides everything
    const config1 = manager.resolveConfig({
      url: 'https://cli.example.com',
      'api-key': 'cli-key',
    });
    expect(config1!.url).toBe('https://cli.example.com');
    expect(config1!.apiKey).toBe('cli-key');

    // Env overrides profile
    const config2 = manager.resolveConfig({});
    expect(config2!.url).toBe('https://env.example.com');
    expect(config2!.apiKey).toBe('env-key');
  });

  test('returns null when URL or API key is missing', () => {
    const manager = createTestManager();

    // No config at all
    const config1 = manager.resolveConfig({});
    expect(config1).toBeNull();

    // Only URL
    const config2 = manager.resolveConfig({ url: 'https://example.com' });
    expect(config2).toBeNull();

    // Only API key
    const config3 = manager.resolveConfig({ 'api-key': 'key123' });
    expect(config3).toBeNull();
  });

  test('uses profile specified by CLI arg', () => {
    writeUserConfig({
      default: 'dev',
      profiles: {
        dev: { url: 'https://dev.example.com', api_key: 'dev-key' },
        prod: { url: 'https://prod.example.com', api_key: 'prod-key' },
      },
    });

    const manager = createTestManager();
    const config = manager.resolveConfig({ profile: 'prod' });

    expect(config!.profileName).toBe('prod');
    expect(config!.url).toBe('https://prod.example.com');
  });

  test('uses profile specified by environment variable', () => {
    writeUserConfig({
      default: 'dev',
      profiles: {
        dev: { url: 'https://dev.example.com', api_key: 'dev-key' },
        prod: { url: 'https://prod.example.com', api_key: 'prod-key' },
      },
    });
    process.env[`${ENV_PREFIX}_PROFILE`] = 'prod';

    const manager = createTestManager();
    const config = manager.resolveConfig({});

    expect(config!.profileName).toBe('prod');
    expect(config!.url).toBe('https://prod.example.com');
  });

  test('falls back to default profile named "default"', () => {
    writeUserConfig({
      profiles: {
        default: { url: 'https://default.example.com', api_key: 'default-key' },
      },
    });

    const manager = createTestManager();
    const config = manager.resolveConfig({});

    expect(config!.profileName).toBe('default');
  });

  test('resolves alias to actual profile name', () => {
    writeUserConfig({
      profiles: {
        development: { url: 'https://dev.example.com', api_key: 'dev-key' },
      },
      aliases: {
        dev: 'development',
      },
    });

    const manager = createTestManager();
    const config = manager.resolveConfig({ profile: 'dev' });

    expect(config!.profileName).toBe('development');
    expect(config!.url).toBe('https://dev.example.com');
  });
});

describe('getProfile', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.XDG_CONFIG_HOME = TEST_DIR;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.XDG_CONFIG_HOME;
  });

  test('returns existing profile', () => {
    writeUserConfig({
      profiles: {
        dev: { url: 'https://dev.example.com', api_key: 'dev-key', extra: 'data' },
      },
    });

    const manager = createTestManager();
    const profile = manager.getProfile('dev');

    expect(profile).not.toBeNull();
    expect(profile!.url).toBe('https://dev.example.com');
    expect(profile!.api_key).toBe('dev-key');
    expect(profile!.extra).toBe('data');
  });

  test('returns null for non-existent profile', () => {
    writeUserConfig({
      profiles: {
        dev: { url: 'https://dev.example.com', api_key: 'dev-key' },
      },
    });

    const manager = createTestManager();
    const profile = manager.getProfile('prod');

    expect(profile).toBeNull();
  });

  test('resolves alias when getting profile', () => {
    writeUserConfig({
      profiles: {
        development: { url: 'https://dev.example.com', api_key: 'dev-key' },
      },
      aliases: {
        dev: 'development',
      },
    });

    const manager = createTestManager();
    const profile = manager.getProfile('dev');

    expect(profile).not.toBeNull();
    expect(profile!.url).toBe('https://dev.example.com');
  });
});

describe('listProfiles', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.XDG_CONFIG_HOME = TEST_DIR;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.XDG_CONFIG_HOME;
  });

  test('returns empty array when no profiles', () => {
    const manager = createTestManager();
    const profiles = manager.listProfiles();

    expect(profiles).toEqual([]);
  });

  test('returns all profiles with metadata', () => {
    writeUserConfig({
      default: 'dev',
      profiles: {
        dev: { url: 'https://dev.example.com', api_key: 'dev-key' },
        prod: { url: 'https://prod.example.com', api_key: 'prod-key' },
      },
    });

    const manager = createTestManager();
    const profiles = manager.listProfiles();

    expect(profiles).toHaveLength(2);

    const devProfile = profiles.find((p) => p.name === 'dev');
    expect(devProfile).toBeDefined();
    expect(devProfile!.isDefault).toBe(true);
    expect(devProfile!.isProtected).toBe(false);

    const prodProfile = profiles.find((p) => p.name === 'prod');
    expect(prodProfile).toBeDefined();
    expect(prodProfile!.isDefault).toBe(false);
    expect(prodProfile!.isProtected).toBe(true); // 'prod' is auto-protected
  });
});

describe('saveProfile', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.XDG_CONFIG_HOME = TEST_DIR;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.XDG_CONFIG_HOME;
  });

  test('saves new profile', () => {
    const manager = createTestManager();

    manager.saveProfile('dev', { url: 'https://dev.example.com', api_key: 'dev-key' });

    const profile = manager.getProfile('dev');
    expect(profile).not.toBeNull();
    expect(profile!.url).toBe('https://dev.example.com');
  });

  test('saves profile and sets as default', () => {
    const manager = createTestManager();

    manager.saveProfile('dev', { url: 'https://dev.example.com', api_key: 'dev-key' }, true);

    const profiles = manager.listProfiles();
    const devProfile = profiles.find((p) => p.name === 'dev');
    expect(devProfile!.isDefault).toBe(true);
  });

  test('overwrites existing profile', () => {
    const manager = createTestManager();

    manager.saveProfile('dev', { url: 'https://old.example.com', api_key: 'old-key' });
    manager.saveProfile('dev', { url: 'https://new.example.com', api_key: 'new-key' });

    const profile = manager.getProfile('dev');
    expect(profile!.url).toBe('https://new.example.com');
  });
});

describe('updateProfile', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.XDG_CONFIG_HOME = TEST_DIR;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.XDG_CONFIG_HOME;
  });

  test('updates profile with partial changes', () => {
    const manager = createTestManager();

    manager.saveProfile('dev', {
      url: 'https://dev.example.com',
      api_key: 'old-key',
      extra: 'original',
    });

    const result = manager.updateProfile('dev', { api_key: 'new-key' });

    expect(result).toBe(true);
    const profile = manager.getProfile('dev');
    expect(profile!.url).toBe('https://dev.example.com'); // unchanged
    expect(profile!.api_key).toBe('new-key'); // updated
    expect(profile!.extra).toBe('original'); // unchanged
  });

  test('returns false for non-existent profile', () => {
    const manager = createTestManager();

    const result = manager.updateProfile('nonexistent', { api_key: 'new-key' });

    expect(result).toBe(false);
  });
});

describe('deleteProfile', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.XDG_CONFIG_HOME = TEST_DIR;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.XDG_CONFIG_HOME;
  });

  test('deletes existing profile', () => {
    const manager = createTestManager();
    manager.saveProfile('dev', { url: 'https://dev.example.com', api_key: 'dev-key' });

    const result = manager.deleteProfile('dev');

    expect(result).toBe(true);
    expect(manager.getProfile('dev')).toBeNull();
  });

  test('returns false for non-existent profile', () => {
    const manager = createTestManager();

    const result = manager.deleteProfile('nonexistent');

    expect(result).toBe(false);
  });

  test('clears default when deleting default profile', () => {
    const manager = createTestManager();
    manager.saveProfile('dev', { url: 'https://dev.example.com', api_key: 'dev-key' }, true);

    manager.deleteProfile('dev');

    const config = manager.loadConfig();
    expect(config.default).toBeUndefined();
  });

  test('removes aliases pointing to deleted profile', () => {
    const manager = createTestManager();
    manager.saveProfile('development', { url: 'https://dev.example.com', api_key: 'dev-key' });
    manager.setAlias('dev', 'development');

    manager.deleteProfile('development');

    const aliases = manager.listAliases();
    expect(aliases.dev).toBeUndefined();
  });
});

describe('setDefaultProfile', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.XDG_CONFIG_HOME = TEST_DIR;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.XDG_CONFIG_HOME;
  });

  test('sets existing profile as default', () => {
    const manager = createTestManager();
    manager.saveProfile('dev', { url: 'https://dev.example.com', api_key: 'dev-key' });
    manager.saveProfile('prod', { url: 'https://prod.example.com', api_key: 'prod-key' });

    const result = manager.setDefaultProfile('prod');

    expect(result).toBe(true);
    const profiles = manager.listProfiles();
    expect(profiles.find((p) => p.name === 'prod')!.isDefault).toBe(true);
    expect(profiles.find((p) => p.name === 'dev')!.isDefault).toBe(false);
  });

  test('returns false for non-existent profile', () => {
    const manager = createTestManager();

    const result = manager.setDefaultProfile('nonexistent');

    expect(result).toBe(false);
  });
});

describe('aliases', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.XDG_CONFIG_HOME = TEST_DIR;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.XDG_CONFIG_HOME;
  });

  test('setAlias creates alias for existing profile', () => {
    const manager = createTestManager();
    manager.saveProfile('development', { url: 'https://dev.example.com', api_key: 'dev-key' });

    const result = manager.setAlias('dev', 'development');

    expect(result).toBe(true);
    const aliases = manager.listAliases();
    expect(aliases.dev).toBe('development');
  });

  test('setAlias returns false for non-existent profile', () => {
    const manager = createTestManager();

    const result = manager.setAlias('dev', 'nonexistent');

    expect(result).toBe(false);
  });

  test('removeAlias removes existing alias', () => {
    const manager = createTestManager();
    manager.saveProfile('development', { url: 'https://dev.example.com', api_key: 'dev-key' });
    manager.setAlias('dev', 'development');

    const result = manager.removeAlias('dev');

    expect(result).toBe(true);
    const aliases = manager.listAliases();
    expect(aliases.dev).toBeUndefined();
  });

  test('removeAlias returns false for non-existent alias', () => {
    const manager = createTestManager();

    const result = manager.removeAlias('nonexistent');

    expect(result).toBe(false);
  });

  test('listAliases returns all aliases', () => {
    const manager = createTestManager();
    manager.saveProfile('development', { url: 'https://dev.example.com', api_key: 'dev-key' });
    manager.saveProfile('production', { url: 'https://prod.example.com', api_key: 'prod-key' });
    manager.setAlias('dev', 'development');
    manager.setAlias('prd', 'production');

    const aliases = manager.listAliases();

    expect(aliases).toEqual({
      dev: 'development',
      prd: 'production',
    });
  });

  test('listAliases returns empty object when no aliases', () => {
    const manager = createTestManager();

    const aliases = manager.listAliases();

    expect(aliases).toEqual({});
  });
});

describe('isProtected', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.XDG_CONFIG_HOME = TEST_DIR;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.XDG_CONFIG_HOME;
  });

  test('returns true for auto-protected names (prod, production, mainnet, etc.)', () => {
    const manager = createTestManager();
    manager.saveProfile('prod', { url: 'https://prod.example.com', api_key: 'key' });
    manager.saveProfile('production', { url: 'https://production.example.com', api_key: 'key' });
    manager.saveProfile('mainnet', { url: 'https://mainnet.example.com', api_key: 'key' });
    manager.saveProfile('stellar-mainnet', { url: 'https://mainnet.example.com', api_key: 'key' });

    expect(manager.isProtected('prod')).toBe(true);
    expect(manager.isProtected('production')).toBe(true);
    expect(manager.isProtected('mainnet')).toBe(true);
    expect(manager.isProtected('stellar-mainnet')).toBe(true);
  });

  test('returns true for custom protected names', () => {
    const manager = createTestManager(); // includes 'staging' as protected
    manager.saveProfile('staging', { url: 'https://staging.example.com', api_key: 'key' });

    expect(manager.isProtected('staging')).toBe(true);
  });

  test('returns false for non-protected names', () => {
    const manager = createTestManager();
    manager.saveProfile('dev', { url: 'https://dev.example.com', api_key: 'key' });
    manager.saveProfile('test', { url: 'https://test.example.com', api_key: 'key' });

    expect(manager.isProtected('dev')).toBe(false);
    expect(manager.isProtected('test')).toBe(false);
  });

  test('explicit protected flag overrides name detection', () => {
    const manager = createTestManager();
    // Profile named 'prod' but explicitly marked as not protected
    manager.saveProfile('prod', {
      url: 'https://prod.example.com',
      api_key: 'key',
      protected: false,
    });
    // Profile named 'dev' but explicitly marked as protected
    manager.saveProfile('dev', { url: 'https://dev.example.com', api_key: 'key', protected: true });

    expect(manager.isProtected('prod')).toBe(false);
    expect(manager.isProtected('dev')).toBe(true);
  });

  test('works with ResolvedConfig object', () => {
    const manager = createTestManager();

    const protectedConfig = {
      url: 'https://prod.example.com',
      apiKey: 'key',
      profileName: 'prod',
      profile: { url: 'https://prod.example.com', api_key: 'key' },
      isProtected: true,
    };

    const unprotectedConfig = {
      url: 'https://dev.example.com',
      apiKey: 'key',
      profileName: 'dev',
      profile: { url: 'https://dev.example.com', api_key: 'key' },
      isProtected: false,
    };

    expect(manager.isProtected(protectedConfig)).toBe(true);
    expect(manager.isProtected(unprotectedConfig)).toBe(false);
  });

  test('returns false for non-existent profile by name', () => {
    const manager = createTestManager();

    // Non-existent profile - falls back to name-based detection
    expect(manager.isProtected('nonexistent')).toBe(false);
    expect(manager.isProtected('nonexistent-prod')).toBe(true); // contains 'prod'
  });
});

describe('getConfigPaths', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.XDG_CONFIG_HOME = TEST_DIR;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.XDG_CONFIG_HOME;
  });

  test('returns user config path', () => {
    const manager = createTestManager();
    const paths = manager.getConfigPaths();

    expect(paths.user).toBe(join(TEST_DIR, CLI_NAME, 'config.yaml'));
  });

  test('returns null for project path when no project config exists', () => {
    const manager = createTestManager();
    const paths = manager.getConfigPaths();

    expect(paths.project).toBeNull();
  });
});

describe('loadConfig with project config', () => {
  const originalCwd = process.cwd();
  const projectDir = join(TEST_DIR, 'project');

  beforeEach(() => {
    mkdirSync(projectDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = TEST_DIR;
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.XDG_CONFIG_HOME;
  });

  test('merges user and project configs with project taking precedence', () => {
    writeUserConfig({
      default: 'user-default',
      profiles: {
        shared: { url: 'https://user.example.com', api_key: 'user-key' },
        'user-only': { url: 'https://user-only.example.com', api_key: 'key' },
      },
      aliases: {
        s: 'shared',
        u: 'user-only',
      },
    });

    writeProjectConfig(projectDir, {
      default: 'project-default',
      profiles: {
        shared: { url: 'https://project.example.com', api_key: 'project-key' },
        'project-only': { url: 'https://project-only.example.com', api_key: 'key' },
      },
      aliases: {
        s: 'project-only', // overrides user alias
        p: 'project-only',
      },
    });

    const manager = createTestManager();
    const config = manager.loadConfig();

    // Project default takes precedence
    expect(config.default).toBe('project-default');

    // Project profile overrides user profile
    expect(config.profiles.shared.url).toBe('https://project.example.com');

    // User-only profile still exists
    expect(config.profiles['user-only']).toBeDefined();

    // Project-only profile exists
    expect(config.profiles['project-only']).toBeDefined();

    // Aliases are merged with project taking precedence
    expect(config.aliases!.s).toBe('project-only');
    expect(config.aliases!.u).toBe('user-only');
    expect(config.aliases!.p).toBe('project-only');
  });
});
