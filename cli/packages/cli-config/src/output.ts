import pc from 'picocolors';

export interface OutputOptions {
  json?: boolean;
}

/**
 * Strip ANSI escape codes from a string to get visible length.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence stripping requires control characters
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

/**
 * Pad a string to a target visible width, accounting for ANSI codes.
 */
function padEndVisible(str: string, targetWidth: number): string {
  const visibleLength = stripAnsi(str).length;
  const padding = Math.max(0, targetWidth - visibleLength);
  return str + ' '.repeat(padding);
}

export function formatTable(headers: string[], rows: string[][]): string {
  // Calculate column widths based on visible length (strip ANSI codes)
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => stripAnsi(r[i] || '').length)),
  );

  const headerRow = headers.map((h, i) => h.padEnd(colWidths[i])).join('  ');
  const separator = '';
  const dataRows = rows.map((row) =>
    row.map((cell, i) => padEndVisible(cell || '', colWidths[i])).join('  '),
  );

  return [pc.bold(headerRow), separator, ...dataRows].filter(Boolean).join('\n');
}

export function formatJson(data: unknown): string {
  // Custom replacer to handle BigInt values (convert to string to preserve precision)
  return JSON.stringify(
    data,
    (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
    2,
  );
}

export function output(data: unknown, options: OutputOptions = {}): void {
  if (options.json) {
    console.log(formatJson(data));
  } else if (typeof data === 'string') {
    console.log(data);
  } else {
    // Pretty print object with colors
    printObject(data as Record<string, unknown>);
  }
}

function printObject(obj: Record<string, unknown>, indent = 0): void {
  const pad = '  '.repeat(indent);
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;

    const label = pc.bold(`${pad}${formatKey(key)}:`);

    if (typeof value === 'object' && !Array.isArray(value)) {
      console.log(label);
      printObject(value as Record<string, unknown>, indent + 1);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        console.log(`${label} []`);
      } else if (typeof value[0] === 'object') {
        console.log(`${label} (${value.length} items)`);
        value.forEach((item, i) => {
          console.log(`${pad}  [${i}]`);
          printObject(item as Record<string, unknown>, indent + 2);
        });
      } else {
        console.log(`${label} ${value.join(', ')}`);
      }
    } else {
      console.log(`${label} ${formatValue(key, value)}`);
    }
  }
}

function formatKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

function formatValue(key: string, value: unknown): string {
  // Status coloring
  if (key.includes('status')) {
    const strValue = String(value).toLowerCase();
    if (strValue === 'confirmed' || strValue === 'success' || strValue === 'active') {
      return pc.green(String(value));
    }
    if (strValue === 'failed' || strValue === 'error') {
      return pc.red(String(value));
    }
    if (strValue === 'pending' || strValue === 'submitted') {
      return pc.yellow(String(value));
    }
  }
  // Boolean flags
  if (key === 'paused' || key === 'system_disabled') {
    return value ? pc.yellow(String(value)) : pc.green(String(value));
  }
  // Limit display
  if (key === 'limit' && value === null) {
    return pc.dim('unlimited');
  }
  // Format bigint with locale separators
  if (typeof value === 'bigint') {
    return value.toLocaleString();
  }
  return String(value);
}

export function success(message: string): void {
  console.log(pc.green(`✓ ${message}`));
}

export function error(message: string, details?: Record<string, unknown>, verbose = false): void {
  console.error(pc.red(`✗ ${message}`));
  if (details) {
    if (details.status) {
      console.error(pc.dim(`  HTTP ${details.status}`));
    }
    if (details.code) {
      console.error(pc.dim(`  Code: ${details.code}`));
    }
    if (details.requestId) {
      console.error(pc.dim(`  Request ID: ${details.requestId}`));
    }
    if (details.message && details.message !== message) {
      console.error(pc.dim(`  ${details.message}`));
    }

    // Verbose output
    if (verbose) {
      if (details.method || details.url) {
        console.error(pc.dim(`  Request: ${details.method || '?'} ${details.url || '?'}`));
      }
      if (details.responseBody !== undefined && details.responseBody !== null) {
        const body =
          typeof details.responseBody === 'string'
            ? details.responseBody
            : JSON.stringify(details.responseBody, null, 2);
        if (body && body !== '{}' && body !== '') {
          console.error(pc.dim('  Response body:'));
          console.error(pc.dim(`    ${body.replace(/\n/g, '\n    ')}`));
        }
      }
      if (details.stack) {
        console.error(pc.dim('  Stack trace:'));
        console.error(pc.dim(`    ${String(details.stack).replace(/\n/g, '\n    ')}`));
      }
    }
  }
}

export function warn(message: string): void {
  console.warn(pc.yellow(`⚠ ${message}`));
}

export function info(message: string): void {
  console.log(pc.blue(`ℹ ${message}`));
}

export function dim(message: string): void {
  console.log(pc.dim(message));
}
