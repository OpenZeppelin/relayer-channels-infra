import pc from 'picocolors';
import { closePrompts, promptConfirm } from './prompts.js';
import type { BaseProfile } from './types.js';

/**
 * Default profile names that are auto-protected (case-insensitive).
 */
const DEFAULT_PROTECTED_NAMES = ['prod', 'production', 'main', 'mainnet', 'live'];

/**
 * Check if a profile name matches protected naming conventions.
 * Matches if the profile name includes any protected string (e.g., "stellar-mainnet" matches "mainnet").
 */
export function isProtectedName(
  profileName: string,
  additionalProtectedNames: string[] = [],
): boolean {
  const lowerName = profileName.toLowerCase();
  const allProtectedNames = [...DEFAULT_PROTECTED_NAMES, ...additionalProtectedNames];
  return allProtectedNames.some((name) => lowerName.includes(name.toLowerCase()));
}

/**
 * Check if a profile is protected (either by explicit flag or name convention).
 */
export function isProfileProtected<P extends BaseProfile>(
  profileName: string,
  profile: P | undefined,
  additionalProtectedNames: string[] = [],
): boolean {
  // Explicit protection flag takes precedence
  if (profile?.protected !== undefined) {
    return profile.protected;
  }
  // Fall back to name-based detection
  return isProtectedName(profileName, additionalProtectedNames);
}

/**
 * Options for protection confirmation.
 */
export interface ProtectionConfirmOptions {
  /** The profile name */
  profileName: string;
  /** Description of the operation being performed */
  operation: string;
  /** Additional summary details to display */
  summary?: string;
  /** Whether to skip confirmation (--no-input mode) */
  noInput?: boolean;
}

/**
 * Confirm a write operation on a protected profile.
 * Returns true if operation should proceed, false if cancelled.
 */
export async function confirmProtectedOperation(
  options: ProtectionConfirmOptions,
): Promise<boolean> {
  const { profileName, operation, summary, noInput } = options;

  // In non-interactive mode, skip confirmation (for CI/automation)
  if (noInput) {
    return true;
  }

  console.log();
  console.log(pc.yellow(`Warning: '${profileName}' is a protected profile.`));
  console.log(`Operation: ${operation}`);
  if (summary) {
    console.log(`Summary: ${summary}`);
  }
  console.log();

  const confirmed = await promptConfirm('Are you sure you want to proceed?', false);
  closePrompts();

  return confirmed;
}
