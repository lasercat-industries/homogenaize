import type { RetryConfig } from './types';
import { DEFAULT_RETRY_CONFIG } from './types';
import { isRetryableError, LLMError } from './errors';
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
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(fn: () => Promise<T>, config?: RetryConfig): Promise<T> {
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

  logger.debug('Starting retry operation', { maxRetries, initialDelay, backoffMultiplier });

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
        logger.debug('Using Retry-After header', { retryAfter: lastError.retryAfter, delay });
      } else if ('retryAfter' in lastError && typeof lastError.retryAfter === 'number') {
        delay = lastError.retryAfter * 1000;
        logger.debug('Using retryAfter property', { retryAfter: lastError.retryAfter, delay });
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
export function withRetry<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  config?: RetryConfig,
): T {
  return (async (...args: Parameters<T>) => {
    return retry(() => fn(...args), config);
  }) as T;
}
