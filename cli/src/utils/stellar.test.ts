import { describe, expect, test } from 'bun:test';
import { NETWORKS, type NetworkName } from './stellar.js';

describe('NETWORKS', () => {
  test('has testnet config', () => {
    expect(NETWORKS.testnet).toEqual({
      horizonUrl: 'https://horizon-testnet.stellar.org',
      passphrase: 'Test SDF Network ; September 2015',
      friendbotUrl: 'https://friendbot.stellar.org',
    });
  });

  test('has mainnet config', () => {
    expect(NETWORKS.mainnet).toEqual({
      horizonUrl: 'https://horizon.stellar.org',
      passphrase: 'Public Global Stellar Network ; September 2015',
    });
  });

  test('has futurenet config', () => {
    expect(NETWORKS.futurenet).toEqual({
      horizonUrl: 'https://horizon-futurenet.stellar.org',
      passphrase: 'Test SDF Future Network ; October 2022',
      friendbotUrl: 'https://friendbot-futurenet.stellar.org',
    });
  });

  test('mainnet has no friendbot', () => {
    expect(NETWORKS.mainnet.friendbotUrl).toBeUndefined();
  });

  test('all networks have horizonUrl and passphrase', () => {
    const networks: NetworkName[] = ['testnet', 'mainnet', 'futurenet'];
    for (const network of networks) {
      expect(NETWORKS[network].horizonUrl).toBeTruthy();
      expect(NETWORKS[network].passphrase).toBeTruthy();
    }
  });
});

describe('fetchCompetitiveFee', () => {
  // Note: These tests would require mocking fetch or using a test server
  // For now we just test the MIN_FEE fallback behavior

  test('returns minimum fee on network error', async () => {
    // Import dynamically to allow mocking
    const { fetchCompetitiveFee } = await import('./stellar.js');

    // Create a mock that throws
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error('Network error'))) as unknown as typeof fetch;

    try {
      const fee = await fetchCompetitiveFee('testnet');
      expect(fee).toBe(100000); // MIN_FEE
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
