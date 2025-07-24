import { describe, expect, it, mock } from 'bun:test';
import { calculateBackoff, withJitter, retry } from './retry';
import type { RetryConfig } from './types';
import { LLMError, isRetryableError } from './errors';

describe('Retry Infrastructure', () => {
  describe('calculateBackoff', () => {
    it('should calculate exponential backoff correctly', () => {
      expect(calculateBackoff(0, 1000, 2)).toBe(1000);
      expect(calculateBackoff(1, 1000, 2)).toBe(2000);
      expect(calculateBackoff(2, 1000, 2)).toBe(4000);
      expect(calculateBackoff(3, 1000, 2)).toBe(8000);
    });

    it('should respect maxDelay limit', () => {
      expect(calculateBackoff(10, 1000, 2, 5000)).toBe(5000);
      expect(calculateBackoff(5, 1000, 2, 10000)).toBe(10000);
    });

    it('should handle different multipliers', () => {
      expect(calculateBackoff(2, 1000, 3)).toBe(9000);
      expect(calculateBackoff(2, 1000, 1.5)).toBe(2250);
    });
  });

  describe('withJitter', () => {
    it('should add jitter within expected range', () => {
      const baseDelay = 1000;
      for (let i = 0; i < 100; i++) {
        const jittered = withJitter(baseDelay);
        expect(jittered).toBeGreaterThanOrEqual(500);
        expect(jittered).toBeLessThanOrEqual(1000);
      }
    });

    it('should return different values on multiple calls', () => {
      const baseDelay = 1000;
      const values = new Set();
      for (let i = 0; i < 20; i++) {
        values.add(withJitter(baseDelay));
      }
      // Should have at least some different values
      expect(values.size).toBeGreaterThan(1);
    });
  });

  describe('isRetryableError', () => {
    it('should classify rate limit errors as retryable', () => {
      const error = new LLMError('Rate limit exceeded', 429);
      expect(isRetryableError(error)).toBe(true);
    });

    it('should classify server errors as retryable', () => {
      expect(isRetryableError(new LLMError('Server error', 500))).toBe(true);
      expect(isRetryableError(new LLMError('Bad gateway', 502))).toBe(true);
      expect(isRetryableError(new LLMError('Service unavailable', 503))).toBe(true);
    });

    it('should classify network errors as retryable', () => {
      const error = new Error('ECONNRESET');
      expect(isRetryableError(error)).toBe(true);

      const timeoutError = new Error('ETIMEDOUT');
      expect(isRetryableError(timeoutError)).toBe(true);
    });

    it('should classify client errors as non-retryable', () => {
      expect(isRetryableError(new LLMError('Bad request', 400))).toBe(false);
      expect(isRetryableError(new LLMError('Unauthorized', 401))).toBe(false);
      expect(isRetryableError(new LLMError('Forbidden', 403))).toBe(false);
      expect(isRetryableError(new LLMError('Not found', 404))).toBe(false);
    });

    it('should use custom classifier when provided', () => {
      const customClassifier = (error: Error) => error.message.includes('please');
      expect(isRetryableError(new Error('please retry'), customClassifier)).toBe(true);
      expect(isRetryableError(new Error('do not'), customClassifier)).toBe(false);
    });
  });

  describe('retry', () => {
    it('should return result on first success', async () => {
      const mockFn = mock().mockResolvedValue('success');

      const result = await retry(mockFn);

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      let callCount = 0;
      const mockFn = mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new LLMError('Server error', 500));
        }
        if (callCount === 2) {
          return Promise.reject(new LLMError('Server error', 502));
        }
        return Promise.resolve('success');
      });

      const onRetry = mock();
      const config: RetryConfig = {
        maxRetries: 3,
        initialDelay: 10, // Short delay for tests
        onRetry,
      };

      const result = await retry(mockFn, config);

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(3);
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number));
      expect(onRetry).toHaveBeenCalledWith(2, expect.any(Error), expect.any(Number));
    });

    it('should fail after max retries', async () => {
      const error = new LLMError('Server error', 500);
      const mockFn = mock().mockRejectedValue(error);

      const config: RetryConfig = {
        maxRetries: 2,
        initialDelay: 10,
      };

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(retry(mockFn, config)).rejects.toThrow('Server error');
      expect(mockFn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should not retry non-retryable errors', async () => {
      const error = new LLMError('Bad request', 400);
      const mockFn = mock().mockRejectedValue(error);

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(retry(mockFn)).rejects.toThrow('Bad request');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should respect Retry-After header', async () => {
      const error = new LLMError('Rate limited', 429);
      error.retryAfter = 0.1; // 0.1 seconds for testing
      const mockFn = mock().mockRejectedValueOnce(error).mockResolvedValue('success');

      const startTime = Date.now();
      const result = await retry(mockFn, { initialDelay: 1000 });
      const elapsed = Date.now() - startTime;

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(2);
      // Should have waited ~100ms instead of 1000ms
      expect(elapsed).toBeGreaterThanOrEqual(50);
      expect(elapsed).toBeLessThan(200);
    });

    it('should apply jitter when enabled', async () => {
      const error = new LLMError('Server error', 500);
      const mockFn = mock().mockRejectedValueOnce(error).mockResolvedValue('success');

      const onRetry = mock();
      const config: RetryConfig = {
        initialDelay: 100,
        jitter: true,
        onRetry,
      };

      await retry(mockFn, config);

      // Check that delay was jittered (between 50-100ms)
      const [, , actualDelay] = onRetry.mock.calls?.[0] ?? [];
      expect(actualDelay).toBeGreaterThanOrEqual(50);
      expect(actualDelay).toBeLessThanOrEqual(100);
    });

    it('should preserve context in retried function', async () => {
      const context = { value: 42 };
      const fn = mock(async function (this: any) {
        if (this.value !== 42) throw new Error('Context lost');
        return 'success';
      });

      const result = await retry(fn.bind(context));
      expect(result).toBe('success');
    });

    it('should pass arguments to retried function', async () => {
      const fn = mock(async (a: number, b: string) => `${a}-${b}`);

      const result = await retry(() => fn(123, 'test'));
      expect(result).toBe('123-test');
      expect(fn).toHaveBeenCalledWith(123, 'test');
    });

    it('should handle async errors in retry', async () => {
      const mockFn = mock()
        .mockRejectedValueOnce(new LLMError('Temporary failure', 503))
        .mockResolvedValue('recovered');

      const config: RetryConfig = {
        maxRetries: 1,
        initialDelay: 10,
      };

      const result = await retry(mockFn, config);
      expect(result).toBe('recovered');
      expect(mockFn).toHaveBeenCalledTimes(2);
    });
  });
});
