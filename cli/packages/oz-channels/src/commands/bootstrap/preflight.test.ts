import { describe, expect, test } from 'bun:test';
import { type GapDetectionResult, detectGaps } from './preflight.js';
import type { PreflightResult } from './types.js';

describe('detectGaps', () => {
  const createPreflight = (
    slots: Array<{ slot: string; signerExists: boolean; relayerExists: boolean }>,
    existingConfigIds: string[] = [],
  ): PreflightResult => ({
    accounts: slots.map((s) => ({
      slot: s.slot,
      signerId: `${s.slot}-signer`,
      signerExists: s.signerExists,
      relayerExists: s.relayerExists,
      onChainFunded: false,
    })),
    existing: {
      signers: slots.filter((s) => s.signerExists).length,
      relayers: slots.filter((s) => s.relayerExists).length,
      funded: 0,
    },
    missing: {
      signers: slots.filter((s) => !s.signerExists).length,
      relayers: slots.filter((s) => !s.relayerExists).length,
      unfunded: 0,
    },
    highestExisting: 0,
    gapDetected: false,
    existingConfigIds,
  });

  test('no gap when starting fresh', () => {
    const preflight = createPreflight([
      { slot: 'channel-0001', signerExists: false, relayerExists: false },
      { slot: 'channel-0002', signerExists: false, relayerExists: false },
    ]);

    const result = detectGaps(1, preflight, 'channel-');

    expect(result.hasGap).toBe(false);
    expect(result.highestExisting).toBe(0);
  });

  test('no gap when continuous from 1', () => {
    const preflight = createPreflight([
      { slot: 'channel-0001', signerExists: true, relayerExists: true },
      { slot: 'channel-0002', signerExists: true, relayerExists: true },
      { slot: 'channel-0003', signerExists: false, relayerExists: false },
    ]);

    const result = detectGaps(1, preflight, 'channel-');

    expect(result.hasGap).toBe(false);
    expect(result.highestExisting).toBe(2);
  });

  test('detects gap when starting beyond existing slots', () => {
    const preflight = createPreflight(
      [
        { slot: 'channel-0010', signerExists: false, relayerExists: false },
        { slot: 'channel-0011', signerExists: false, relayerExists: false },
      ],
      ['channel-0001', 'channel-0002', 'channel-0003'],
    );

    const result = detectGaps(10, preflight, 'channel-');

    expect(result.hasGap).toBe(true);
    expect(result.gapStart).toBe(4);
    expect(result.gapEnd).toBe(9);
    expect(result.highestExisting).toBe(3);
  });

  test('detects gap in existing config', () => {
    const preflight = createPreflight(
      [],
      ['channel-0001', 'channel-0002', 'channel-0005'], // Gap at 3-4
    );

    const result = detectGaps(1, preflight, 'channel-');

    expect(result.hasGap).toBe(true);
    expect(result.gapStart).toBe(3);
    expect(result.gapEnd).toBe(4);
  });

  test('no gap when continuing from highest existing', () => {
    const preflight = createPreflight(
      [
        { slot: 'channel-0004', signerExists: false, relayerExists: false },
        { slot: 'channel-0005', signerExists: false, relayerExists: false },
      ],
      ['channel-0001', 'channel-0002', 'channel-0003'],
    );

    const result = detectGaps(4, preflight, 'channel-');

    expect(result.hasGap).toBe(false);
    expect(result.highestExisting).toBe(3);
  });

  test('considers both preflight accounts and existing config', () => {
    const preflight = createPreflight(
      [
        { slot: 'channel-0003', signerExists: true, relayerExists: true },
        { slot: 'channel-0004', signerExists: false, relayerExists: false },
      ],
      ['channel-0001', 'channel-0002'],
    );

    const result = detectGaps(3, preflight, 'channel-');

    expect(result.hasGap).toBe(false);
    expect(result.highestExisting).toBe(3);
  });

  test('handles different prefix', () => {
    const preflight = createPreflight([
      { slot: 'relay-001', signerExists: true, relayerExists: true },
      { slot: 'relay-002', signerExists: true, relayerExists: true },
    ]);

    const result = detectGaps(1, preflight, 'relay-');

    expect(result.hasGap).toBe(false);
    expect(result.highestExisting).toBe(2);
  });

  test('handles only relayer existing (signer missing)', () => {
    const preflight = createPreflight([
      { slot: 'channel-0001', signerExists: false, relayerExists: true },
      { slot: 'channel-0002', signerExists: false, relayerExists: false },
    ]);

    const result = detectGaps(1, preflight, 'channel-');

    expect(result.hasGap).toBe(false);
    expect(result.highestExisting).toBe(1);
  });

  test('handles only signer existing (relayer missing)', () => {
    const preflight = createPreflight([
      { slot: 'channel-0001', signerExists: true, relayerExists: false },
      { slot: 'channel-0002', signerExists: false, relayerExists: false },
    ]);

    const result = detectGaps(1, preflight, 'channel-');

    expect(result.hasGap).toBe(false);
    expect(result.highestExisting).toBe(1);
  });

  test('detects single-slot gap', () => {
    const preflight = createPreflight(
      [],
      ['channel-0001', 'channel-0003'], // Gap at 2
    );

    const result = detectGaps(1, preflight, 'channel-');

    expect(result.hasGap).toBe(true);
    expect(result.gapStart).toBe(2);
    expect(result.gapEnd).toBe(2);
  });

  test('ignores slots with wrong prefix', () => {
    const preflight = createPreflight(
      [{ slot: 'other-0001', signerExists: true, relayerExists: true }],
      [],
    );

    const result = detectGaps(1, preflight, 'channel-');

    expect(result.hasGap).toBe(false);
    expect(result.highestExisting).toBe(0);
  });
});
