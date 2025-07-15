import { describe, it, expect } from 'vitest';
import { LLMError, ProviderError, NetworkError, RateLimitError, isRetryableError } from './errors';

describe('Error Types', () => {
  describe('LLMError', () => {
    it('should create error with status code', () => {
      const error = new LLMError('Test error', 500);
      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(500);
      expect(error.name).toBe('LLMError');
    });

    it('should include provider and model info when provided', () => {
      const error = new LLMError('Test error', 400, 'openai', 'gpt-4');
      expect(error.provider).toBe('openai');
      expect(error.model).toBe('gpt-4');
    });

    it('should preserve original error', () => {
      const originalError = new Error('Original');
      const error = new LLMError('Wrapped error', 500);
      error.originalError = originalError;
      expect(error.originalError).toBe(originalError);
    });
  });

  describe('ProviderError', () => {
    it('should create provider-specific error', () => {
      const error = new ProviderError('API failed', 'anthropic', 'claude-3');
      expect(error.message).toBe('API failed');
      expect(error.provider).toBe('anthropic');
      expect(error.model).toBe('claude-3');
      expect(error.name).toBe('ProviderError');
    });

    it('should include attempt number and context', () => {
      const error = new ProviderError('Failed after retries', 'openai', 'gpt-4', 3);
      error.context = { endpoint: '/chat/completions' };
      expect(error.attempt).toBe(3);
      expect(error.context).toEqual({ endpoint: '/chat/completions' });
    });
  });

  describe('NetworkError', () => {
    it('should create network error', () => {
      const error = new NetworkError('Connection timeout');
      expect(error.message).toBe('Connection timeout');
      expect(error.name).toBe('NetworkError');
      expect(error.isRetryable).toBe(true);
    });

    it('should handle different network error types', () => {
      const resetError = new NetworkError('ECONNRESET');
      expect(resetError.message).toBe('ECONNRESET');

      const dnsError = new NetworkError('ENOTFOUND');
      expect(dnsError.message).toBe('ENOTFOUND');
    });
  });

  describe('RateLimitError', () => {
    it('should create rate limit error with retry after', () => {
      const error = new RateLimitError('Rate limit exceeded', 10);
      expect(error.message).toBe('Rate limit exceeded');
      expect(error.retryAfter).toBe(10);
      expect(error.statusCode).toBe(429);
      expect(error.name).toBe('RateLimitError');
    });

    it('should be retryable', () => {
      const error = new RateLimitError('Too many requests', 5);
      expect(error.isRetryable).toBe(true);
    });
  });

  describe('Error Classification', () => {
    it('should classify errors correctly', () => {
      // Retryable errors
      expect(isRetryableError(new LLMError('Server error', 500))).toBe(true);
      expect(isRetryableError(new LLMError('Bad gateway', 502))).toBe(true);
      expect(isRetryableError(new LLMError('Service unavailable', 503))).toBe(true);
      expect(isRetryableError(new LLMError('Gateway timeout', 504))).toBe(true);
      expect(isRetryableError(new RateLimitError('Rate limited', 5))).toBe(true);
      expect(isRetryableError(new NetworkError('ETIMEDOUT'))).toBe(true);

      // Non-retryable errors
      expect(isRetryableError(new LLMError('Bad request', 400))).toBe(false);
      expect(isRetryableError(new LLMError('Unauthorized', 401))).toBe(false);
      expect(isRetryableError(new LLMError('Forbidden', 403))).toBe(false);
      expect(isRetryableError(new LLMError('Not found', 404))).toBe(false);
      expect(isRetryableError(new Error('Random error'))).toBe(false);
    });

    it('should check isRetryable property first', () => {
      const customError = new Error('Custom') as any;
      customError.isRetryable = true;
      expect(isRetryableError(customError)).toBe(true);

      customError.isRetryable = false;
      expect(isRetryableError(customError)).toBe(false);
    });

    it('should use custom classifier', () => {
      const classifier = (error: Error) => error.message.includes('retry');

      expect(isRetryableError(new Error('please retry'), classifier)).toBe(true);
      expect(isRetryableError(new Error('do not'), classifier)).toBe(false);
    });

    it('should handle provider-specific error formats', () => {
      // OpenAI format
      const openAIError = new Error('Rate limit reached') as any;
      openAIError.status = 429;
      expect(isRetryableError(openAIError)).toBe(true);

      // Anthropic format
      const anthropicError = new Error('Overloaded') as any;
      anthropicError.status = 529;
      expect(isRetryableError(anthropicError)).toBe(true);

      // Gemini format
      const geminiError = new Error('RESOURCE_EXHAUSTED') as any;
      expect(isRetryableError(geminiError)).toBe(true);
    });
  });
});
