/**
 * Execute an async function over an array with limited concurrency.
 *
 * Uses a worker pool pattern where `concurrency` workers process items
 * from a shared queue. Results are returned in the same order as input.
 *
 * @param items Array of items to process
 * @param fn Async function to apply to each item
 * @param concurrency Maximum number of concurrent operations
 * @param onProgress Optional callback fired after each item completes
 * @returns Array of results in the same order as input items
 */
export async function parallelMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
  onProgress?: (completed: number, total: number) => void,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let completedCount = 0;
  const total = items.length;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];

      results[index] = await fn(item);

      completedCount++;
      if (onProgress) {
        onProgress(completedCount, total);
      }
    }
  }

  // Start workers up to concurrency limit or item count (whichever is smaller)
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, () => worker());

  await Promise.all(workers);
  return results;
}

/**
 * Execute an async function over an array with limited concurrency,
 * collecting all results including errors.
 *
 * Unlike parallelMap, this function doesn't throw on individual errors.
 * Instead, it returns a result object for each item indicating success or failure.
 *
 * @param items Array of items to process
 * @param fn Async function to apply to each item
 * @param concurrency Maximum number of concurrent operations
 * @param onProgress Optional callback fired after each item completes
 * @returns Array of result objects in the same order as input items
 */
export async function parallelMapSettled<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
  onProgress?: (completed: number, total: number) => void,
): Promise<Array<{ success: true; value: R } | { success: false; error: Error }>> {
  if (items.length === 0) {
    return [];
  }

  type Result = { success: true; value: R } | { success: false; error: Error };
  const results: Result[] = new Array(items.length);
  let nextIndex = 0;
  let completedCount = 0;
  const total = items.length;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];

      try {
        const value = await fn(item);
        results[index] = { success: true, value };
      } catch (err) {
        results[index] = {
          success: false,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }

      completedCount++;
      if (onProgress) {
        onProgress(completedCount, total);
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, () => worker());

  await Promise.all(workers);
  return results;
}
