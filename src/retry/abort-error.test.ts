import { describe, test, expect } from 'bun:test';
import { AbortError, isRetryableError } from './errors';

describe('AbortError', () => {
  test('should create an AbortError with message', () => {
    const error = new AbortError('Request aborted');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AbortError);
    expect(error.message).toBe('Request aborted');
    expect(error.name).toBe('AbortError');
  });

  test('should create an AbortError with reason', () => {
    const reason = new Error('User cancelled');
    const error = new AbortError('Request aborted', reason);
    expect(error.message).toBe('Request aborted');
    expect(error.reason).toBe(reason);
  });

  test('should NOT be retryable', () => {
    const error = new AbortError('Request aborted');
    expect(error.isRetryable).toBe(false);
  });

  test('should be recognized as non-retryable by isRetryableError', () => {
    const error = new AbortError('Request aborted');
    expect(isRetryableError(error)).toBe(false);
  });

  test('should have isRetryable=false even if reason is retryable', () => {
    const retryableReason = new Error('Network error');
    (retryableReason as Error & { isRetryable?: boolean }).isRetryable = true;

    const error = new AbortError('Request aborted', retryableReason);
    expect(error.isRetryable).toBe(false);
    expect(isRetryableError(error)).toBe(false);
  });
});
