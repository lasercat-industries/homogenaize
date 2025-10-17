import type { RetryConfig } from './types';
import { DEFAULT_RETRY_CONFIG } from './types';
import { isRetryableError, LLMError, AbortError } from './errors';
import { getLogger } from '../utils/logger';

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
 * Can be cancelled via AbortSignal
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if already aborted
    if (signal?.aborted) {
      reject(new AbortError('Sleep aborted', signal.reason));
      return;
    }

    const timeout = setTimeout(resolve, ms);

    // Set up abort handler
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new AbortError('Sleep aborted', signal?.reason));
    };

    // Use { once: true } to automatically remove listener after first call
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Retry a function with exponential backoff
 * Supports cancellation via AbortSignal
 */
export async function retry<T>(
  fn: () => Promise<T>,
  config?: RetryConfig,
  signal?: AbortSignal,
): Promise<T> {
  const logger = getLogger('retry');
  const {
    maxRetries,
    initialDelay,
    maxDelay,
    backoffMultiplier,
    jitter,
    retryableErrors: customRetryableErrors,
    onRetry,
  } = { ...DEFAULT_RETRY_CONFIG, ...config };

  logger.debug('Starting retry operation', {
    maxRetries,
    initialDelay,
    backoffMultiplier,
  });

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check if aborted before attempting
    if (signal?.aborted) {
      logger.info('Retry loop aborted before attempt', { attempt });
      throw new AbortError('Retry aborted', signal.reason);
    }

    try {
      if (attempt > 0) {
        logger.info(`Retry attempt ${attempt} of ${maxRetries}`);
      }
      const result = await fn();
      if (attempt > 0) {
        logger.info('Retry successful', { attempt });
      }
      return result;
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry
      const isRetryable = isRetryableError(lastError, customRetryableErrors);
      const isLastAttempt = attempt === maxRetries;

      logger.debug('Error occurred', {
        attempt,
        isRetryable,
        isLastAttempt,
        errorMessage: lastError.message,
        errorType: lastError.constructor.name,
      });

      if (isLastAttempt || !isRetryable) {
        if (isLastAttempt) {
          logger.error('Max retries exceeded', {
            maxRetries,
            finalError: lastError.message,
          });
        } else {
          logger.warn('Non-retryable error encountered', {
            errorMessage: lastError.message,
            errorType: lastError.constructor.name,
          });
        }
        throw lastError;
      }

      // Calculate delay
      let delay = calculateBackoff(attempt, initialDelay, backoffMultiplier, maxDelay);
      const originalDelay = delay;

      // Check for Retry-After header
      if (lastError instanceof LLMError && lastError.retryAfter) {
        delay = lastError.retryAfter * 1000; // Convert seconds to milliseconds
        logger.debug('Using Retry-After header', {
          retryAfter: lastError.retryAfter,
          delay,
        });
      } else if ('retryAfter' in lastError && typeof lastError.retryAfter === 'number') {
        delay = lastError.retryAfter * 1000;
        logger.debug('Using retryAfter property', {
          retryAfter: lastError.retryAfter,
          delay,
        });
      }

      // Apply jitter if enabled
      if (jitter) {
        const jitteredDelay = withJitter(delay);
        logger.verbose('Applied jitter to delay', {
          originalDelay,
          beforeJitter: delay,
          afterJitter: jitteredDelay,
        });
        delay = jitteredDelay;
      }

      logger.info('Retrying after delay', {
        attempt: attempt + 1,
        delayMs: Math.round(delay),
        error: lastError.message,
      });

      // Call retry callback
      if (onRetry) {
        onRetry(attempt + 1, lastError, delay);
      }

      // Wait before retrying (will throw AbortError if signal is triggered)
      await sleep(delay, signal);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Create a retryable version of a function
 */
export function withRetry<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  config?: RetryConfig,
  signal?: AbortSignal,
): T {
  return (async (...args: Parameters<T>) => {
    return retry(() => fn(...args), config, signal);
  }) as T;
}
