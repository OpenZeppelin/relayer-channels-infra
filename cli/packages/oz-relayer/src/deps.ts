/**
 * Dependency injection types and defaults for oz-relayer commands.
 *
 * This module provides a centralized way to inject dependencies into commands,
 * making them testable without mock.module().
 */

import { confirmProtectedOperation } from '@internal/cli-config';
import { createClient } from './api/client.js';
import type { ApiClient } from './api/client.js';
import {
  deleteProfile,
  getConfigPaths,
  getProfile,
  listProfiles,
  resolveConfig,
  saveProfile,
  setDefaultProfile,
} from './config/index.js';
import type { ResolvedConfig } from './config/index.js';
import { exitWithUsageError, handleApiError, setVerbose } from './utils/errors.js';
import { error, formatTable, info, output, success, warn } from './utils/output.js';
import {
  closePrompts,
  prompt,
  promptConfirm,
  promptPassword,
  promptSelect,
} from './utils/prompts.js';

/**
 * All available dependencies for commands.
 */
export interface CommandDeps {
  // Config
  resolveConfig: typeof resolveConfig;
  getProfile: typeof getProfile;
  listProfiles: typeof listProfiles;
  saveProfile: typeof saveProfile;
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
  formatTable: typeof formatTable;

  // Errors
  setVerbose: typeof setVerbose;
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
  formatTable,

  // Errors
  setVerbose,
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
export type { ApiClient, ResolvedConfig };
