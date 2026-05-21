import { AxiosError } from 'axios';

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 10) */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff (default: 500) */
  baseDelayMs?: number;
  /** HTTP status codes to retry on (default: [429, 500, 502, 503]) */
  retryOn?: number[];
  /** Callback fired before each retry */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

const DEFAULT_RETRY_ON = [429, 500, 502, 503];

function getHttpStatus(err: unknown): number | undefined {
  if (err instanceof AxiosError) {
    return err.response?.status;
  }
  if (err && typeof err === 'object' && 'response' in err) {
    const response = (err as { response?: { status?: number } }).response;
    return response?.status;
  }
  return undefined;
}

function getRetryAfterMs(err: unknown): number | undefined {
  if (err instanceof AxiosError) {
    const retryAfter = err.response?.headers?.['retry-after'];
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (!Number.isNaN(seconds)) {
        return seconds * 1000;
      }
    }
  }
  return undefined;
}

function isTimeoutError(err: unknown): boolean {
  if (err instanceof AxiosError) {
    return err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT';
  }
  if (err instanceof Error) {
    return err.message.includes('timeout') || err.message.includes('ETIMEDOUT');
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateDelay(attempt: number, baseDelayMs: number): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelayMs * 2 ** attempt;
  // Add jitter: ±25% randomness
  const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
  return Math.round(exponentialDelay + jitter);
}

/**
 * Execute a function with retry logic and exponential backoff.
 *
 * Features:
 * - Exponential backoff with jitter
 * - Respects Retry-After header for 429 responses
 * - Quick retry (100-300ms) for timeouts
 * - Configurable retry status codes
 */
export async function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const maxRetries = options?.maxRetries ?? 10;
  const baseDelayMs = options?.baseDelayMs ?? 500;
  const retryOn = options?.retryOn ?? DEFAULT_RETRY_ON;
  const onRetry = options?.onRetry;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt >= maxRetries) {
        throw lastError;
      }

      const status = getHttpStatus(err);
      const isRetryableStatus = status !== undefined && retryOn.includes(status);
      const isTimeout = isTimeoutError(err);

      if (!isRetryableStatus && !isTimeout) {
        throw lastError;
      }

      let delayMs: number;

      if (status === 429) {
        // Use Retry-After header if present, otherwise use exponential backoff
        delayMs = getRetryAfterMs(err) ?? calculateDelay(attempt, baseDelayMs);
      } else if (isTimeout) {
        // Quick retry for timeouts: 100-300ms
        delayMs = 100 + Math.random() * 200;
      } else {
        // Server errors: exponential backoff
        delayMs = calculateDelay(attempt, baseDelayMs);
      }

      if (onRetry) {
        onRetry(attempt + 1, lastError, delayMs);
      }

      await sleep(delayMs);
    }
  }

  throw lastError ?? new Error('Max retries exceeded');
}
