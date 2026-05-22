/**
 * Dependency injection types and defaults for oz-channels commands.
 *
 * This module provides a centralized way to inject dependencies into commands,
 * making them testable without mock.module().
 */

import { createClient } from './api/client.js';
import type { ApiClient } from './api/client.js';
import { confirmProtectedOperation } from './cli-config/index.js';
import {
  deleteProfile,
  getConfigPaths,
  getProfile,
  listProfiles,
  resolveConfig,
  saveProfile,
  setDefaultProfile,
  updateProfile,
} from './config/index.js';
import type { ResolvedConfig } from './config/index.js';
import { exitWithUsageError, handleApiError } from './utils/errors.js';
import { dim, error, formatTable, info, output, success, warn } from './utils/output.js';
import { ProgressBar } from './utils/progress.js';
import {
  closePrompts,
  prompt,
  promptConfirm,
  promptPassword,
  promptSelect,
} from './utils/prompts.js';
import {
  type NetworkName,
  checkAccountFunded,
  fetchCompetitiveFee,
  fundViaFriendbot,
  generateStellarAccount,
  getStellarAccount,
  stellarAccountExists,
} from './utils/stellar.js';

/**
 * All available dependencies for commands.
 */
export interface CommandDeps {
  // Config
  resolveConfig: typeof resolveConfig;
  getProfile: typeof getProfile;
  listProfiles: typeof listProfiles;
  saveProfile: typeof saveProfile;
  updateProfile: typeof updateProfile;
  deleteProfile: typeof deleteProfile;
  setDefaultProfile: typeof setDefaultProfile;
  getConfigPaths: typeof getConfigPaths;

  // Client
  createClient: typeof createClient;

  // Output
  output: typeof output;
  success: typeof success;
  warn: typeof warn;
  error: typeof error;
  info: typeof info;
  dim: typeof dim;
  formatTable: typeof formatTable;

  // Errors
  handleApiError: typeof handleApiError;
  exitWithUsageError: typeof exitWithUsageError;

  // Prompts
  prompt: typeof prompt;
  promptConfirm: typeof promptConfirm;
  promptPassword: typeof promptPassword;
  promptSelect: typeof promptSelect;
  closePrompts: typeof closePrompts;

  // Protected ops
  confirmProtectedOperation: typeof confirmProtectedOperation;

  // Stellar utilities
  getStellarAccount: typeof getStellarAccount;
  stellarAccountExists: typeof stellarAccountExists;
  generateStellarAccount: typeof generateStellarAccount;
  checkAccountFunded: typeof checkAccountFunded;
  fundViaFriendbot: typeof fundViaFriendbot;
  fetchCompetitiveFee: typeof fetchCompetitiveFee;

  // Progress
  createProgressBar: (total: number) => ProgressBar;
}

/**
 * Immutable default dependencies for production use.
 */
export const defaultDeps: Readonly<CommandDeps> = Object.freeze({
  // Config
  resolveConfig,
  getProfile,
  listProfiles,
  saveProfile,
  updateProfile,
  deleteProfile,
  setDefaultProfile,
  getConfigPaths,

  // Client
  createClient,

  // Output
  output,
  success,
  warn,
  error,
  info,
  dim,
  formatTable,

  // Errors
  handleApiError,
  exitWithUsageError,

  // Prompts
  prompt,
  promptConfirm,
  promptPassword,
  promptSelect,
  closePrompts,

  // Protected ops
  confirmProtectedOperation,

  // Stellar utilities
  getStellarAccount,
  stellarAccountExists,
  generateStellarAccount,
  checkAccountFunded,
  fundViaFriendbot,
  fetchCompetitiveFee,

  // Progress
  createProgressBar: (total: number) => new ProgressBar(total),
});

/**
 * Create deps object with optional overrides.
 * Useful for testing - pass mock implementations for specific deps.
 *
 * @example
 * ```ts
 * const mockDeps = makeDeps({
 *   resolveConfig: mock(() => mockConfig),
 *   createClient: mock(() => mockClient),
 *   output: mock(() => {}),
 * });
 * const cmd = createHealthCommand(mockDeps);
 * ```
 */
export function makeDeps(overrides: Partial<CommandDeps> = {}): CommandDeps {
  return { ...defaultDeps, ...overrides };
}

// Re-export types for convenience
export type { ApiClient, ResolvedConfig, NetworkName };
export { ProgressBar };
