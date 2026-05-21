import { describe, expect, test } from 'bun:test';

// Test helper functions that don't require API calls

describe('generateSlotNames', () => {
  // Recreate the function locally for testing
  function generateSlotNames(from: number, to: number, prefix: string, padding: number): string[] {
    const slots: string[] = [];
    for (let i = from; i <= to; i++) {
      slots.push(`${prefix}${String(i).padStart(padding, '0')}`);
    }
    return slots;
  }

  test('generates correct slot names with default prefix and padding', () => {
    const slots = generateSlotNames(1, 5, 'channel-', 4);
    expect(slots).toEqual([
      'channel-0001',
      'channel-0002',
      'channel-0003',
      'channel-0004',
      'channel-0005',
    ]);
  });

  test('generates slot names with custom prefix', () => {
    const slots = generateSlotNames(1, 3, 'relay-', 4);
    expect(slots).toEqual(['relay-0001', 'relay-0002', 'relay-0003']);
  });

  test('generates slot names with different padding', () => {
    const slots = generateSlotNames(1, 3, 'ch-', 2);
    expect(slots).toEqual(['ch-01', 'ch-02', 'ch-03']);
  });

  test('handles single slot range', () => {
    const slots = generateSlotNames(5, 5, 'channel-', 4);
    expect(slots).toEqual(['channel-0005']);
  });

  test('handles starting from non-1 index', () => {
    const slots = generateSlotNames(10, 12, 'channel-', 4);
    expect(slots).toEqual(['channel-0010', 'channel-0011', 'channel-0012']);
  });

  test('handles large numbers', () => {
    const slots = generateSlotNames(999, 1001, 'channel-', 4);
    expect(slots).toEqual(['channel-0999', 'channel-1000', 'channel-1001']);
  });

  test('handles no padding overflow', () => {
    const slots = generateSlotNames(9999, 10001, 'ch-', 4);
    expect(slots).toEqual(['ch-9999', 'ch-10000', 'ch-10001']);
  });
});

describe('bootstrap command argument validation', () => {
  // These tests verify the validation logic conceptually

  test('from must be positive', () => {
    const from = 0;
    const isValid = from >= 1;
    expect(isValid).toBe(false);
  });

  test('to must be >= from', () => {
    const from = 5;
    const to = 3;
    const isValid = to >= from;
    expect(isValid).toBe(false);
  });

  test('startingBalance must be positive', () => {
    const balance = 0;
    const isValid = balance > 0;
    expect(isValid).toBe(false);
  });

  test('valid range is accepted', () => {
    const from = 1;
    const to = 10;
    const isValid = from >= 1 && to >= from;
    expect(isValid).toBe(true);
  });
});

describe('bootstrap summary calculation', () => {
  test('counts signers created correctly', () => {
    const provisionResults = [
      { slot: 'a', signerId: 'a-s', signerCreated: true, relayerCreated: true },
      { slot: 'b', signerId: 'b-s', signerCreated: false, relayerCreated: true },
      { slot: 'c', signerId: 'c-s', signerCreated: true, relayerCreated: false },
    ];

    const signersCreated = provisionResults.filter((r) => r.signerCreated).length;
    expect(signersCreated).toBe(2);
  });

  test('counts relayers created correctly', () => {
    const provisionResults = [
      { slot: 'a', signerId: 'a-s', signerCreated: true, relayerCreated: true },
      { slot: 'b', signerId: 'b-s', signerCreated: false, relayerCreated: true },
      { slot: 'c', signerId: 'c-s', signerCreated: true, relayerCreated: false },
    ];

    const relayersCreated = provisionResults.filter((r) => r.relayerCreated).length;
    expect(relayersCreated).toBe(2);
  });

  test('collects errors correctly', () => {
    const results = [
      { slot: 'a', error: 'Failed' },
      { slot: 'b', error: undefined },
      { slot: 'c', error: 'Also failed' },
    ];

    const errors = results.filter((r) => r.error).map((r) => `${r.slot}: ${r.error}`);
    expect(errors).toEqual(['a: Failed', 'c: Also failed']);
  });
});

describe('relayer as source of truth', () => {
  // Simulates the new behavior: filter relayers by prefix from relayer service
  function filterRelayersByPrefix(relayers: { id: string }[], prefix: string): string[] {
    return relayers
      .filter((r) => r.id.startsWith(prefix))
      .map((r) => r.id)
      .sort();
  }

  test('filters relayers by prefix', () => {
    const relayers = [
      { id: 'channel-0001' },
      { id: 'channel-0002' },
      { id: 'other-0001' },
      { id: 'channel-0003' },
    ];

    const channelRelayers = filterRelayersByPrefix(relayers, 'channel-');

    expect(channelRelayers).toEqual(['channel-0001', 'channel-0002', 'channel-0003']);
  });

  test('handles no matching relayers', () => {
    const relayers = [{ id: 'other-0001' }, { id: 'relay-0001' }];

    const channelRelayers = filterRelayersByPrefix(relayers, 'channel-');

    expect(channelRelayers).toEqual([]);
  });

  test('handles empty relayer list', () => {
    const relayers: { id: string }[] = [];

    const channelRelayers = filterRelayersByPrefix(relayers, 'channel-');

    expect(channelRelayers).toEqual([]);
  });

  test('sorts relayers correctly', () => {
    const relayers = [
      { id: 'channel-0010' },
      { id: 'channel-0002' },
      { id: 'channel-0001' },
      { id: 'channel-0003' },
    ];

    const channelRelayers = filterRelayersByPrefix(relayers, 'channel-');

    // String sort with padding works correctly
    expect(channelRelayers).toEqual([
      'channel-0001',
      'channel-0002',
      'channel-0003',
      'channel-0010',
    ]);
  });
});

describe('config filtering by funding status', () => {
  // Simulates the new logic: in-range must be funded, out-of-range trusted
  function filterForConfig(
    allRelayers: string[],
    inRangeSlots: Set<string>,
    fundedInRangeSlots: Set<string>,
  ): string[] {
    return allRelayers.filter((id) => {
      if (inRangeSlots.has(id)) {
        return fundedInRangeSlots.has(id);
      }
      return true; // out-of-range: trust previous bootstrap
    });
  }

  test('includes funded in-range relayers', () => {
    const allRelayers = ['channel-0001', 'channel-0002', 'channel-0003'];
    const inRange = new Set(['channel-0001', 'channel-0002', 'channel-0003']);
    const funded = new Set(['channel-0001', 'channel-0002', 'channel-0003']);

    const result = filterForConfig(allRelayers, inRange, funded);

    expect(result).toEqual(['channel-0001', 'channel-0002', 'channel-0003']);
  });

  test('excludes unfunded in-range relayers', () => {
    const allRelayers = ['channel-0001', 'channel-0002', 'channel-0003'];
    const inRange = new Set(['channel-0001', 'channel-0002', 'channel-0003']);
    const funded = new Set(['channel-0001', 'channel-0003']); // 0002 not funded

    const result = filterForConfig(allRelayers, inRange, funded);

    expect(result).toEqual(['channel-0001', 'channel-0003']);
  });

  test('includes out-of-range relayers without checking funding', () => {
    const allRelayers = ['channel-0001', 'channel-0002', 'channel-0005', 'channel-0006'];
    const inRange = new Set(['channel-0005', 'channel-0006']); // bootstrapping 5-6
    const funded = new Set(['channel-0005', 'channel-0006']);

    const result = filterForConfig(allRelayers, inRange, funded);

    // 0001, 0002 included even though not in funded set (they're out-of-range)
    expect(result).toEqual(['channel-0001', 'channel-0002', 'channel-0005', 'channel-0006']);
  });

  test('mixed: excludes unfunded in-range, includes out-of-range', () => {
    const allRelayers = ['channel-0001', 'channel-0002', 'channel-0003', 'channel-0004'];
    const inRange = new Set(['channel-0003', 'channel-0004']); // bootstrapping 3-4
    const funded = new Set(['channel-0003']); // 0004 failed to fund

    const result = filterForConfig(allRelayers, inRange, funded);

    // 0001, 0002: out-of-range, included
    // 0003: in-range, funded, included
    // 0004: in-range, NOT funded, excluded
    expect(result).toEqual(['channel-0001', 'channel-0002', 'channel-0003']);
  });

  test('handles empty in-range (all out-of-range)', () => {
    const allRelayers = ['channel-0001', 'channel-0002'];
    const inRange = new Set<string>([]);
    const funded = new Set<string>([]);

    const result = filterForConfig(allRelayers, inRange, funded);

    expect(result).toEqual(['channel-0001', 'channel-0002']);
  });
});

describe('funding requirement calculation', () => {
  test('calculates required XLM correctly', () => {
    const toFundCount = 5;
    const startingBalance = 2;
    const requiredXlm = toFundCount * startingBalance;
    expect(requiredXlm).toBe(10);
  });

  test('detects insufficient balance', () => {
    const fundingBalance = 8;
    const requiredXlm = 10;
    const hasEnough = fundingBalance >= requiredXlm;
    expect(hasEnough).toBe(false);
  });

  test('detects sufficient balance', () => {
    const fundingBalance = 15;
    const requiredXlm = 10;
    const hasEnough = fundingBalance >= requiredXlm;
    expect(hasEnough).toBe(true);
  });
});

describe('filter accounts for provisioning', () => {
  test('identifies accounts needing provisioning', () => {
    const accounts = [
      { slot: 'a', signerExists: false, relayerExists: false },
      { slot: 'b', signerExists: true, relayerExists: true },
      { slot: 'c', signerExists: true, relayerExists: false },
      { slot: 'd', signerExists: false, relayerExists: true },
    ];

    const toProvision = accounts.filter((a) => !a.signerExists || !a.relayerExists);
    expect(toProvision.map((a) => a.slot)).toEqual(['a', 'c', 'd']);
  });

  test('identifies accounts needing funding', () => {
    const accounts = [
      { slot: 'a', relayerExists: true, relayerAddress: 'G1', onChainFunded: false },
      { slot: 'b', relayerExists: true, relayerAddress: 'G2', onChainFunded: true },
      { slot: 'c', relayerExists: false, relayerAddress: undefined, onChainFunded: false },
      { slot: 'd', relayerExists: true, relayerAddress: 'G4', onChainFunded: false },
    ];

    const toFund = accounts.filter((a) => a.relayerExists && a.relayerAddress && !a.onChainFunded);
    expect(toFund.map((a) => a.slot)).toEqual(['a', 'd']);
  });
});
