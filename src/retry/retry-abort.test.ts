import { describe, test, expect } from 'bun:test';
import { retry } from './retry';
import { AbortError, LLMError } from './errors';

describe('retry with AbortSignal', () => {
  test('should abort before first attempt if signal already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const fn = async () => {
      return 'success';
    };

    try {
      await retry(fn, { maxRetries: 3 }, controller.signal);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(AbortError);
      expect((error as AbortError).message).toBe('Retry aborted');
    }
  });

  test('should abort during sleep between retries', async () => {
    const controller = new AbortController();
    let attemptCount = 0;

    const fn = async () => {
      attemptCount++;
      throw new LLMError('Temporary error', 500);
    };

    // Abort after 100ms
    setTimeout(() => controller.abort(), 100);

    const start = Date.now();
    try {
      await retry(fn, { maxRetries: 5, initialDelay: 1000 }, controller.signal);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      const elapsed = Date.now() - start;
      expect(error).toBeInstanceOf(AbortError);
      expect((error as AbortError).message).toBe('Sleep aborted');
      expect(attemptCount).toBe(1); // Should only attempt once before abort
      expect(elapsed).toBeLessThan(500); // Should abort during sleep, not wait full duration
    }
  });

  test('should abort immediately if signal aborted before retry attempt', async () => {
    const controller = new AbortController();
    let attemptCount = 0;

    const fn = async () => {
      attemptCount++;
      // Abort before next retry
      if (attemptCount === 1) {
        controller.abort();
      }
      throw new LLMError('Temporary error', 500);
    };

    try {
      await retry(fn, { maxRetries: 5, initialDelay: 1000 }, controller.signal);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      // Could be either AbortError from loop check or Sleep aborted
      expect(error).toBeInstanceOf(AbortError);
      expect(attemptCount).toBeLessThanOrEqual(2);
    }
  });

  test('should complete successfully if not aborted', async () => {
    const controller = new AbortController();
    let attemptCount = 0;

    const fn = async () => {
      attemptCount++;
      if (attemptCount < 3) {
        throw new LLMError('Temporary error', 500);
      }
      return 'success';
    };

    const result = await retry(fn, { maxRetries: 5, initialDelay: 10 }, controller.signal);

    expect(result).toBe('success');
    expect(attemptCount).toBe(3);
  });

  test('should not retry AbortError', async () => {
    const controller = new AbortController();
    let attemptCount = 0;

    const fn = async () => {
      attemptCount++;
      throw new AbortError('Aborted by user');
    };

    try {
      await retry(fn, { maxRetries: 5 }, controller.signal);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(AbortError);
      expect((error as AbortError).message).toBe('Aborted by user');
      expect(attemptCount).toBe(1); // Should not retry
    }
  });

  test('should work without signal parameter (backward compatibility)', async () => {
    let attemptCount = 0;

    const fn = async () => {
      attemptCount++;
      if (attemptCount < 2) {
        throw new LLMError('Temporary error', 500);
      }
      return 'success';
    };

    const result = await retry(fn, { maxRetries: 3, initialDelay: 10 });

    expect(result).toBe('success');
    expect(attemptCount).toBe(2);
  });

  test('should pass custom abort reason', async () => {
    const controller = new AbortController();
    const customReason = new Error('User cancelled');

    const fn = async () => {
      throw new LLMError('Temporary error', 500);
    };

    // Abort after a short delay with custom reason
    setTimeout(() => controller.abort(customReason), 100);

    try {
      await retry(fn, { maxRetries: 5, initialDelay: 1000 }, controller.signal);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(AbortError);
      expect((error as AbortError).reason).toBe(customReason);
    }
  });

  test('should abort on first attempt if signal aborted immediately', async () => {
    const controller = new AbortController();
    let attemptCount = 0;

    const fn = async () => {
      attemptCount++;
      return 'success';
    };

    controller.abort();

    try {
      await retry(fn, { maxRetries: 3 }, controller.signal);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(AbortError);
      expect(attemptCount).toBe(0); // Should not even attempt
    }
  });
});
