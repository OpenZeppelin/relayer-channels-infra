// Types
export type {
  BaseProfile,
  ConfigFile,
  ConfigOptions,
  ConfigPaths,
  ProfileEntry,
  ResolvedConfig,
} from './types.js';

// Config manager factory
export { createConfigManager } from './config.js';
export type { ConfigManager } from './config.js';

// Protection utilities
export {
  confirmProtectedOperation,
  isProfileProtected,
  isProtectedName,
} from './protection.js';
export type { ProtectionConfirmOptions } from './protection.js';

// Prompts
export {
  closePrompts,
  prompt,
  promptConfirm,
  promptPassword,
  promptSelect,
} from './prompts.js';

// Output utilities
export {
  dim,
  error,
  formatJson,
  formatTable,
  info,
  output,
  success,
  warn,
} from './output.js';
export type { OutputOptions } from './output.js';
