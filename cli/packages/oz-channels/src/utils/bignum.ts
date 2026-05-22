/**
 * Utilities for handling large numbers that exceed JavaScript's safe integer range.
 * Stellar sequence numbers and large stroop values can exceed Number.MAX_SAFE_INTEGER.
 */

/**
 * Safely parse a potentially large number, returning a BigInt.
 * Handles string, number, and bigint inputs.
 */
export function parseBigInt(value: string | number | bigint | undefined | null): bigint | null {
  if (value === undefined || value === null) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * Format a large number for display with locale-aware separators.
 * Keeps the full precision unlike Number.toLocaleString().
 */
export function formatBigInt(value: bigint | string | number | undefined | null): string {
  if (value === undefined || value === null) {
    return '0';
  }

  const str = String(value);

  // Handle negative numbers
  const isNegative = str.startsWith('-');
  const absStr = isNegative ? str.slice(1) : str;

  // Add thousand separators
  const formatted = absStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Convert stroops to XLM string with full precision.
 * 1 XLM = 10,000,000 stroops
 */
export function stroopsToXlm(stroops: bigint | string | number | undefined | null): string {
  const value = parseBigInt(stroops);
  if (value === null) {
    return '0';
  }

  const STROOPS_PER_XLM = 10_000_000n;
  const whole = value / STROOPS_PER_XLM;
  const remainder = value % STROOPS_PER_XLM;

  // Pad remainder to 7 digits and trim trailing zeros
  const decimal = remainder.toString().padStart(7, '0').replace(/0+$/, '');

  if (decimal) {
    return `${whole}.${decimal}`;
  }
  return whole.toString();
}

/**
 * Format stroops for display: "1,000,000 stroops (0.1 XLM)"
 */
export function formatStroops(
  stroops: bigint | string | number | undefined | null,
  unlimitedLabel = 'unlimited',
): string {
  if (stroops === undefined || stroops === null) {
    return unlimitedLabel;
  }

  const value = parseBigInt(stroops);
  if (value === null) {
    return unlimitedLabel;
  }

  return `${formatBigInt(value)} stroops (${stroopsToXlm(value)} XLM)`;
}

/**
 * Check if a value is safe to use as a JavaScript number.
 */
export function isSafeInteger(value: bigint | string | number): boolean {
  const big = typeof value === 'bigint' ? value : parseBigInt(value);
  if (big === null) return false;
  return big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER);
}
