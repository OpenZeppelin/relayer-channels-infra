import { describe, expect, mock, test } from 'bun:test';
import { withRetry } from './retry.js';

describe('withRetry', () => {
  test('succeeds on first attempt', async () => {
    const fn = mock(() => Promise.resolve('success'));
    const result = await withRetry(fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on retryable status codes', async () => {
    let attempt = 0;
    const fn = mock(() => {
      attempt++;
      if (attempt < 3) {
        const error = new Error('Server Error') as Error & { response?: { status: number } };
        error.response = { status: 500 };
        return Promise.reject(error);
      }
      return Promise.resolve('success');
    });

    const result = await withRetry(fn, { maxRetries: 5, baseDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('does not retry on non-retryable status codes', async () => {
    const fn = mock(() => {
      const error = new Error('Not Found') as Error & { response?: { status: number } };
      error.response = { status: 404 };
      return Promise.reject(error);
    });

    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 10 })).rejects.toThrow('Not Found');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('respects custom retryOn status codes', async () => {
    let attempt = 0;
    const fn = mock(() => {
      attempt++;
      if (attempt < 2) {
        const error = new Error('Not Found') as Error & { response?: { status: number } };
        error.response = { status: 404 };
        return Promise.reject(error);
      }
      return Promise.resolve('success');
    });

    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 10,
      retryOn: [404],
    });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('retries on timeout errors', async () => {
    let attempt = 0;
    const fn = mock(() => {
      attempt++;
      if (attempt < 2) {
        const error = new Error('timeout');
        return Promise.reject(error);
      }
      return Promise.resolve('success');
    });

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('throws after max retries exceeded', async () => {
    const fn = mock(() => {
      const error = new Error('Server Error') as Error & { response?: { status: number } };
      error.response = { status: 500 };
      return Promise.reject(error);
    });

    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 10 })).rejects.toThrow('Server Error');
    expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  test('calls onRetry callback', async () => {
    let attempt = 0;
    const fn = mock(() => {
      attempt++;
      if (attempt < 3) {
        const error = new Error('Server Error') as Error & { response?: { status: number } };
        error.response = { status: 500 };
        return Promise.reject(error);
      }
      return Promise.resolve('success');
    });

    const onRetry = mock(() => {});
    await withRetry(fn, { maxRetries: 5, baseDelayMs: 10, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  test('retries on 429 rate limit', async () => {
    let attempt = 0;
    const fn = mock(() => {
      attempt++;
      if (attempt < 2) {
        const error = new Error('Rate Limited') as Error & { response?: { status: number } };
        error.response = { status: 429 };
        return Promise.reject(error);
      }
      return Promise.resolve('success');
    });

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('retries on 502 bad gateway', async () => {
    let attempt = 0;
    const fn = mock(() => {
      attempt++;
      if (attempt < 2) {
        const error = new Error('Bad Gateway') as Error & { response?: { status: number } };
        error.response = { status: 502 };
        return Promise.reject(error);
      }
      return Promise.resolve('success');
    });

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('retries on 503 service unavailable', async () => {
    let attempt = 0;
    const fn = mock(() => {
      attempt++;
      if (attempt < 2) {
        const error = new Error('Service Unavailable') as Error & { response?: { status: number } };
        error.response = { status: 503 };
        return Promise.reject(error);
      }
      return Promise.resolve('success');
    });

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
