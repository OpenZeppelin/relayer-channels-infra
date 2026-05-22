import { describe, expect, test } from 'bun:test';
import { isProfileProtected, isProtectedName } from './protection.js';

describe('isProtectedName', () => {
  test('returns true for default protected names', () => {
    expect(isProtectedName('prod')).toBe(true);
    expect(isProtectedName('production')).toBe(true);
    expect(isProtectedName('main')).toBe(true);
    expect(isProtectedName('mainnet')).toBe(true);
    expect(isProtectedName('live')).toBe(true);
  });

  test('is case-insensitive', () => {
    expect(isProtectedName('PROD')).toBe(true);
    expect(isProtectedName('Production')).toBe(true);
    expect(isProtectedName('MAINNET')).toBe(true);
    expect(isProtectedName('Live')).toBe(true);
  });

  test('matches partial names (substring matching)', () => {
    expect(isProtectedName('stellar-mainnet')).toBe(true);
    expect(isProtectedName('prod-us-east')).toBe(true);
    expect(isProtectedName('my-production-profile')).toBe(true);
    expect(isProtectedName('live-api')).toBe(true);
  });

  test('returns false for non-protected names', () => {
    expect(isProtectedName('default')).toBe(false);
    expect(isProtectedName('testnet')).toBe(false);
    expect(isProtectedName('staging')).toBe(false);
    expect(isProtectedName('dev')).toBe(false);
    expect(isProtectedName('local')).toBe(false);
  });

  test('respects additional protected names', () => {
    expect(isProtectedName('staging', ['staging'])).toBe(true);
    expect(isProtectedName('STAGING', ['staging'])).toBe(true);
    expect(isProtectedName('pre-staging-env', ['staging'])).toBe(true);
    expect(isProtectedName('dev')).toBe(false);
    expect(isProtectedName('dev', ['dev', 'qa'])).toBe(true);
    expect(isProtectedName('qa', ['dev', 'qa'])).toBe(true);
  });

  test('handles empty additional names', () => {
    expect(isProtectedName('prod', [])).toBe(true);
    expect(isProtectedName('dev', [])).toBe(false);
  });
});

describe('isProfileProtected', () => {
  test('returns explicit protection flag when set to true', () => {
    expect(isProfileProtected('default', { url: '', api_key: '', protected: true })).toBe(true);
    expect(isProfileProtected('dev', { url: '', api_key: '', protected: true })).toBe(true);
  });

  test('returns explicit protection flag when set to false', () => {
    expect(isProfileProtected('prod', { url: '', api_key: '', protected: false })).toBe(false);
    expect(isProfileProtected('mainnet', { url: '', api_key: '', protected: false })).toBe(false);
  });

  test('falls back to name-based detection when no explicit flag', () => {
    expect(isProfileProtected('prod', { url: '', api_key: '' })).toBe(true);
    expect(isProfileProtected('dev', { url: '', api_key: '' })).toBe(false);
    expect(isProfileProtected('mainnet', { url: '', api_key: '' })).toBe(true);
    expect(isProfileProtected('testnet', { url: '', api_key: '' })).toBe(false);
  });

  test('falls back to name-based detection when profile is undefined', () => {
    expect(isProfileProtected('prod', undefined)).toBe(true);
    expect(isProfileProtected('dev', undefined)).toBe(false);
    expect(isProfileProtected('production', undefined)).toBe(true);
  });

  test('respects additional protected names', () => {
    expect(isProfileProtected('staging', undefined, ['staging'])).toBe(true);
    expect(isProfileProtected('staging', { url: '', api_key: '' }, ['staging'])).toBe(true);
    expect(isProfileProtected('qa', { url: '', api_key: '' }, ['qa'])).toBe(true);
  });

  test('explicit flag takes precedence over additional names', () => {
    expect(
      isProfileProtected('staging', { url: '', api_key: '', protected: false }, ['staging']),
    ).toBe(false);
  });
});
