import type { RetryConfig } from './types';
import { DEFAULT_RETRY_CONFIG } from './types';
import { isRetryableError, LLMError } from './errors';

/**
 * Calculate exponential backoff delay
 */
export function calculateBackoff(
  attempt: number,
  initialDelay: number,
  multiplier: number,
  maxDelay?: number,
): number {
  const delay = initialDelay * Math.pow(multiplier, attempt);
  return maxDelay ? Math.min(delay, maxDelay) : delay;
}

/**
 * Add jitter to a delay value
 * Returns a value between 50% and 100% of the original delay
 */
export function withJitter(delay: number): number {
  return delay * (0.5 + Math.random() * 0.5);
}

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(fn: () => Promise<T>, config?: RetryConfig): Promise<T> {
  const {
    maxRetries,
    initialDelay,
    maxDelay,
    backoffMultiplier,
    jitter,
    retryableErrors: customRetryableErrors,
    onRetry,
  } = { ...DEFAULT_RETRY_CONFIG, ...config };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry
      if (attempt === maxRetries || !isRetryableError(lastError, customRetryableErrors)) {
        throw lastError;
      }

      // Calculate delay
      let delay = calculateBackoff(attempt, initialDelay, backoffMultiplier, maxDelay);

      // Check for Retry-After header
      if (lastError instanceof LLMError && lastError.retryAfter) {
        delay = lastError.retryAfter * 1000; // Convert seconds to milliseconds
      } else if ('retryAfter' in lastError && typeof lastError.retryAfter === 'number') {
        delay = lastError.retryAfter * 1000;
      }

      // Apply jitter if enabled
      if (jitter) {
        delay = withJitter(delay);
      }

      // Call retry callback
      if (onRetry) {
        onRetry(attempt + 1, lastError, delay);
      }

      // Wait before retrying
      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Create a retryable version of a function
 */
export function withRetry<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  config?: RetryConfig,
): T {
  return (async (...args: Parameters<T>) => {
    return retry(() => fn(...args), config);
  }) as T;
}
