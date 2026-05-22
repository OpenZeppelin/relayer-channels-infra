import { describe, expect, mock, test } from 'bun:test';
import { parallelMap, parallelMapSettled } from './concurrency.js';

describe('parallelMap', () => {
  test('returns empty array for empty input', async () => {
    const fn = mock(async (x: number) => x * 2);
    const result = await parallelMap([], fn, 5);
    expect(result).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  test('processes items and returns results in order', async () => {
    const fn = async (x: number) => x * 2;
    const result = await parallelMap([1, 2, 3, 4, 5], fn, 3);
    expect(result).toEqual([2, 4, 6, 8, 10]);
  });

  test('respects concurrency limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const fn = async (x: number) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return x * 2;
    };

    await parallelMap([1, 2, 3, 4, 5, 6, 7, 8], fn, 3);
    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  test('calls progress callback', async () => {
    const fn = async (x: number) => x * 2;
    const progressCalls: Array<[number, number]> = [];

    await parallelMap([1, 2, 3], fn, 2, (completed, total) => {
      progressCalls.push([completed, total]);
    });

    expect(progressCalls).toContainEqual([1, 3]);
    expect(progressCalls).toContainEqual([2, 3]);
    expect(progressCalls).toContainEqual([3, 3]);
  });

  test('throws on error', async () => {
    const fn = async (x: number) => {
      if (x === 3) throw new Error('test error');
      return x * 2;
    };

    await expect(parallelMap([1, 2, 3, 4, 5], fn, 2)).rejects.toThrow('test error');
  });

  test('handles single item', async () => {
    const fn = async (x: number) => x * 2;
    const result = await parallelMap([42], fn, 5);
    expect(result).toEqual([84]);
  });

  test('handles concurrency greater than item count', async () => {
    const fn = async (x: number) => x * 2;
    const result = await parallelMap([1, 2], fn, 10);
    expect(result).toEqual([2, 4]);
  });
});

describe('parallelMapSettled', () => {
  test('returns empty array for empty input', async () => {
    const fn = mock(async (x: number) => x * 2);
    const result = await parallelMapSettled([], fn, 5);
    expect(result).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  test('collects all results including errors', async () => {
    const fn = async (x: number) => {
      if (x === 3) throw new Error('test error');
      return x * 2;
    };

    const result = await parallelMapSettled([1, 2, 3, 4, 5], fn, 2);

    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ success: true, value: 2 });
    expect(result[1]).toEqual({ success: true, value: 4 });
    expect(result[2]).toEqual({ success: false, error: expect.any(Error) });
    expect((result[2] as { success: false; error: Error }).error.message).toBe('test error');
    expect(result[3]).toEqual({ success: true, value: 8 });
    expect(result[4]).toEqual({ success: true, value: 10 });
  });

  test('respects concurrency limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const fn = async (x: number) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return x * 2;
    };

    await parallelMapSettled([1, 2, 3, 4, 5, 6, 7, 8], fn, 3);
    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  test('calls progress callback for both success and error', async () => {
    const fn = async (x: number) => {
      if (x === 2) throw new Error('test error');
      return x * 2;
    };
    const progressCalls: Array<[number, number]> = [];

    await parallelMapSettled([1, 2, 3], fn, 2, (completed, total) => {
      progressCalls.push([completed, total]);
    });

    expect(progressCalls).toContainEqual([1, 3]);
    expect(progressCalls).toContainEqual([2, 3]);
    expect(progressCalls).toContainEqual([3, 3]);
  });

  test('converts non-Error throws to Error objects', async () => {
    const fn = async (x: number) => {
      if (x === 2) throw 'string error';
      return x * 2;
    };

    const result = await parallelMapSettled([1, 2, 3], fn, 2);

    expect(result[1]).toEqual({ success: false, error: expect.any(Error) });
    expect((result[1] as { success: false; error: Error }).error.message).toBe('string error');
  });
});
