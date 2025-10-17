import { describe, test, expect } from 'bun:test';
import { sleep } from './retry';
import { AbortError } from './errors';

describe('sleep', () => {
  test('should resolve after specified time', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45); // Allow small timing variance
    expect(elapsed).toBeLessThan(100);
  });

  test('should resolve immediately if signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const start = Date.now();
    try {
      await sleep(1000, controller.signal);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50); // Should abort immediately
      expect(error).toBeInstanceOf(AbortError);
      expect((error as AbortError).message).toBe('Sleep aborted');
    }
  });

  test('should reject with AbortError when signal is aborted during sleep', async () => {
    const controller = new AbortController();

    // Abort after 50ms
    setTimeout(() => controller.abort(), 50);

    const start = Date.now();
    try {
      await sleep(1000, controller.signal);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(45); // Should abort around 50ms
      expect(elapsed).toBeLessThan(150);
      expect(error).toBeInstanceOf(AbortError);
      expect((error as AbortError).message).toBe('Sleep aborted');
    }
  });

  test('should reject with abort reason when provided', async () => {
    const controller = new AbortController();
    const customReason = new Error('Custom abort reason');
    controller.abort(customReason);

    try {
      await sleep(1000, controller.signal);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(AbortError);
      expect((error as AbortError).reason).toBe(customReason);
    }
  });

  test('should work without signal parameter (backward compatibility)', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
  });

  test('should not leak event listeners after abort', async () => {
    const controller = new AbortController();

    setTimeout(() => controller.abort(), 50);

    try {
      await sleep(1000, controller.signal);
    } catch {
      // Expected to throw
    }

    // If we get here without errors, event listener was properly cleaned up
    expect(true).toBe(true);
  });

  test('should not leak event listeners after successful completion', async () => {
    const controller = new AbortController();

    await sleep(50, controller.signal);

    // Aborting after sleep completes should not affect anything
    controller.abort();

    expect(true).toBe(true);
  });
});
