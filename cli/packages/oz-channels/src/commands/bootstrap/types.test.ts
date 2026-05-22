import { describe, expect, test } from 'bun:test';
import type {
  AccountAudit,
  BootstrapOptions,
  BootstrapSummary,
  CreateResult,
  FundResult,
  PreflightResult,
} from './types.js';

describe('bootstrap types', () => {
  test('AccountAudit has required fields', () => {
    const audit: AccountAudit = {
      slot: 'channel-0001',
      signerId: 'channel-0001-signer',
      signerExists: true,
      relayerExists: true,
      onChainFunded: true,
    };

    expect(audit.slot).toBe('channel-0001');
    expect(audit.signerId).toBe('channel-0001-signer');
  });

  test('AccountAudit with optional fields', () => {
    const audit: AccountAudit = {
      slot: 'channel-0001',
      signerId: 'channel-0001-signer',
      signerExists: true,
      relayerExists: true,
      onChainFunded: true,
      relayerAddress: 'GABCDEF...',
      balance: '100.0000000',
      error: undefined,
    };

    expect(audit.relayerAddress).toBe('GABCDEF...');
    expect(audit.balance).toBe('100.0000000');
  });

  test('PreflightResult structure', () => {
    const result: PreflightResult = {
      accounts: [],
      existing: { signers: 5, relayers: 5, funded: 3 },
      missing: { signers: 2, relayers: 2, unfunded: 2 },
      highestExisting: 5,
      gapDetected: false,
      existingConfigIds: ['channel-0001', 'channel-0002'],
    };

    expect(result.existing.signers).toBe(5);
    expect(result.missing.unfunded).toBe(2);
    expect(result.existingConfigIds).toHaveLength(2);
  });

  test('PreflightResult with gap', () => {
    const result: PreflightResult = {
      accounts: [],
      existing: { signers: 3, relayers: 3, funded: 3 },
      missing: { signers: 0, relayers: 0, unfunded: 0 },
      highestExisting: 3,
      gapDetected: true,
      gapRange: [4, 9],
      existingConfigIds: [],
    };

    expect(result.gapDetected).toBe(true);
    expect(result.gapRange).toEqual([4, 9]);
  });

  test('BootstrapOptions structure', () => {
    const options: BootstrapOptions = {
      from: 1,
      to: 10,
      fundingRelayer: 'channels-fund',
      startingBalance: 2,
      prefix: 'channel-',
      padding: 4,
      concurrency: 10,
      delayMs: 100,
      audit: false,
      dryRun: false,
      verbose: false,
      json: false,
      allowGaps: false,
      network: 'testnet',
      noInput: false,
    };

    expect(options.from).toBe(1);
    expect(options.to).toBe(10);
    expect(options.network).toBe('testnet');
  });

  test('CreateResult structure', () => {
    const result: CreateResult = {
      slot: 'channel-0001',
      signerId: 'channel-0001-signer',
      signerCreated: true,
      relayerCreated: true,
      relayerAddress: 'GABCDEF...',
    };

    expect(result.signerCreated).toBe(true);
    expect(result.relayerAddress).toBeDefined();
  });

  test('CreateResult with error', () => {
    const result: CreateResult = {
      slot: 'channel-0001',
      signerId: 'channel-0001-signer',
      signerCreated: false,
      relayerCreated: false,
      error: 'Failed to create signer',
    };

    expect(result.error).toBe('Failed to create signer');
  });

  test('FundResult structure', () => {
    const result: FundResult = {
      slot: 'channel-0001',
      address: 'GABCDEF...',
      funded: true,
    };

    expect(result.funded).toBe(true);
  });

  test('FundResult already funded', () => {
    const result: FundResult = {
      slot: 'channel-0001',
      address: 'GABCDEF...',
      funded: true,
      alreadyFunded: true,
    };

    expect(result.alreadyFunded).toBe(true);
  });

  test('FundResult with error', () => {
    const result: FundResult = {
      slot: 'channel-0001',
      address: 'GABCDEF...',
      funded: false,
      error: 'Insufficient balance',
    };

    expect(result.funded).toBe(false);
    expect(result.error).toBe('Insufficient balance');
  });

  test('BootstrapSummary structure', () => {
    const summary: BootstrapSummary = {
      signersCreated: 5,
      relayersCreated: 5,
      accountsFunded: 5,
      alreadyExisted: 3,
      totalConfigured: 8,
      errors: [],
    };

    expect(summary.signersCreated).toBe(5);
    expect(summary.totalConfigured).toBe(8);
    expect(summary.errors).toHaveLength(0);
  });

  test('BootstrapSummary with errors', () => {
    const summary: BootstrapSummary = {
      signersCreated: 3,
      relayersCreated: 3,
      accountsFunded: 2,
      alreadyExisted: 0,
      totalConfigured: 3,
      errors: ['channel-0004: Rate limited', 'channel-0005: Network error'],
    };

    expect(summary.errors).toHaveLength(2);
    expect(summary.errors[0]).toContain('Rate limited');
  });
});
