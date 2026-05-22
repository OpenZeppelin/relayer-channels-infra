import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock console.log to capture output
let consoleOutput: string[];
let originalConsoleLog: typeof console.log;

// Mock the output module to capture JSON output
mock.module('../utils/output.js', () => ({
  output: (data: unknown, options?: { json?: boolean }) => {
    if (options?.json) {
      consoleOutput.push(JSON.stringify(data));
    } else {
      consoleOutput.push(String(data));
    }
  },
  success: (message: string) => consoleOutput.push(message),
  error: (message: string) => consoleOutput.push(message),
}));

beforeEach(() => {
  consoleOutput = [];
  originalConsoleLog = console.log;
  console.log = mock((...args: unknown[]) => {
    consoleOutput.push(args.map((a) => String(a)).join(' '));
  });
});

afterEach(() => {
  console.log = originalConsoleLog;
});

describe('smoke list command', () => {
  const expectedTests = [
    { id: 'xdr-payment', description: 'Signed XDR self-payment' },
    {
      id: 'xdr-unsigned-soroban',
      description: 'Unsigned Soroban XDR with signed auth (smart wallet flow)',
    },
    { id: 'func-auth-no-auth', description: 'func+auth: no_auth_bump(42)' },
    { id: 'func-auth-address-auth', description: 'func+auth: write_with_address_auth(777)' },
  ];

  test('text output shows all test IDs and descriptions', async () => {
    // Import dynamically to get fresh module state
    const { smokeCommand } = await import('./smoke.js');
    const listCommand = (smokeCommand.subCommands as any)?.list;

    if (!listCommand) {
      throw new Error('list subcommand not found');
    }

    // Run the list command with json: false
    await listCommand.run?.({ args: { json: false }, cmd: listCommand, rawArgs: [] });

    const output = consoleOutput.join('\n');

    // Verify header
    expect(output).toContain('Available smoke tests:');

    // Verify each test ID and description appears
    for (const test of expectedTests) {
      expect(output).toContain(test.id);
      expect(output).toContain(test.description);
    }
  });

  test('JSON output has correct structure', async () => {
    const { smokeCommand } = await import('./smoke.js');
    const listCommand = (smokeCommand.subCommands as any)?.list;

    if (!listCommand) {
      throw new Error('list subcommand not found');
    }

    // Run the list command with json: true
    await listCommand.run?.({ args: { json: true }, cmd: listCommand, rawArgs: [] });

    // Find the JSON output line (should be the formatted JSON)
    const jsonOutput = consoleOutput.find((line) => line.startsWith('{'));
    if (!jsonOutput) {
      throw new Error('JSON output not found in console output');
    }

    const parsed = JSON.parse(jsonOutput);

    // Verify structure
    expect(parsed).toHaveProperty('tests');
    expect(Array.isArray(parsed.tests)).toBe(true);
    expect(parsed.tests).toHaveLength(4);

    // Verify each test has id and description
    for (const test of parsed.tests) {
      expect(test).toHaveProperty('id');
      expect(test).toHaveProperty('description');
      expect(typeof test.id).toBe('string');
      expect(typeof test.description).toBe('string');
    }

    // Verify the exact test entries
    expect(parsed.tests).toEqual(expectedTests);
  });

  test('JSON output contains all expected test IDs', async () => {
    const { smokeCommand } = await import('./smoke.js');
    const listCommand = (smokeCommand.subCommands as any)?.list;

    if (!listCommand) {
      throw new Error('list subcommand not found');
    }

    await listCommand.run?.({ args: { json: true }, cmd: listCommand, rawArgs: [] });

    const jsonOutput = consoleOutput.find((line) => line.startsWith('{'));
    if (!jsonOutput) {
      throw new Error('JSON output not found in console output');
    }
    const parsed = JSON.parse(jsonOutput);

    const testIds = parsed.tests.map((t: { id: string }) => t.id);

    expect(testIds).toContain('xdr-payment');
    expect(testIds).toContain('xdr-unsigned-soroban');
    expect(testIds).toContain('func-auth-no-auth');
    expect(testIds).toContain('func-auth-address-auth');
  });

  test('text output formats test IDs with padding', async () => {
    const { smokeCommand } = await import('./smoke.js');
    const listCommand = (smokeCommand.subCommands as any)?.list;

    if (!listCommand) {
      throw new Error('list subcommand not found');
    }

    await listCommand.run?.({ args: { json: false }, cmd: listCommand, rawArgs: [] });

    const output = consoleOutput.join('\n');

    // The implementation pads test IDs to 24 characters
    // Check that descriptions appear after the padded ID
    expect(output).toMatch(/xdr-payment\s+Signed XDR self-payment/);
    expect(output).toMatch(/func-auth-no-auth\s+func\+auth: no_auth_bump\(42\)/);
  });
});
