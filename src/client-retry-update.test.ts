import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { createOpenAILLM, createAnthropicLLM, createGeminiLLM } from './client';
import { LLMError } from './retry/errors';

describe('Client Retry Config Update', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    mock.restore();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    mock.restore();
  });

  describe('OpenAI Client', () => {
    it('should update and get retry config', () => {
      const client = createOpenAILLM({
        apiKey: 'test-key',
        model: 'gpt-4',
        retry: { maxRetries: 3, initialDelay: 1000 },
      });

      // Check initial config
      expect(client.getRetryConfig()).toEqual({
        maxRetries: 3,
        initialDelay: 1000,
      });

      // Update config
      client.setRetryConfig({
        maxRetries: 5,
        initialDelay: 500,
        maxDelay: 10000,
      });

      // Verify updated config
      expect(client.getRetryConfig()).toEqual({
        maxRetries: 5,
        initialDelay: 500,
        maxDelay: 10000,
      });

      // Clear config
      client.setRetryConfig(undefined);
      expect(client.getRetryConfig()).toBeUndefined();
    });

    it('should use updated retry config for subsequent calls', async () => {
      let attemptCount = 0;

      const mockFetch = mock((_url: string) => {
        attemptCount++;
        if (attemptCount <= 2) {
          return Promise.resolve({
            ok: false,
            status: 500,
            headers: { get: () => null },
            json: () => Promise.resolve({ error: { message: 'Server error' } }),
          } as any);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              id: 'test-id',
              object: 'chat.completion',
              created: Date.now(),
              model: 'gpt-4',
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: 'Success after retries',
                  },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
              },
            }),
        });
      });

      // @ts-expect-error - Mock global fetch
      global.fetch = mockFetch;

      const client = createOpenAILLM({
        apiKey: 'test-key',
        model: 'gpt-4',
        // Start with no retry config
      });

      // First call should fail (no retries)
      attemptCount = 0;
      try {
        await client.chat({
          messages: [{ role: 'user', content: 'Test 1' }],
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError);
        expect(attemptCount).toBe(1); // No retries
      }

      // Update config to enable retries
      client.setRetryConfig({ maxRetries: 2, initialDelay: 10 });

      // Second call should succeed with retries
      attemptCount = 0;
      const response = await client.chat({
        messages: [{ role: 'user', content: 'Test 2' }],
      });

      expect(attemptCount).toBe(3); // Initial + 2 retries
      expect(response.content).toBe('Success after retries');
    });

    it('should allow per-call override of updated default', async () => {
      const mockFetch = mock((_url: string) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              id: 'test-id',
              object: 'chat.completion',
              created: Date.now(),
              model: 'gpt-4',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'Success' },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
              },
            }),
        });
      });

      // @ts-expect-error - Mock global fetch
      global.fetch = mockFetch;

      const client = createOpenAILLM({
        apiKey: 'test-key',
        model: 'gpt-4',
      });

      // Set a default retry config
      client.setRetryConfig({ maxRetries: 5, initialDelay: 1000 });

      // Call with override should use override, not updated default
      const response = await client.chat({
        messages: [{ role: 'user', content: 'Test' }],
        retry: { maxRetries: 1, initialDelay: 100 }, // Override
      });

      expect(response.content).toBe('Success');
      // Note: We can't easily verify which config was used without more complex mocking
    });
  });

  describe('Anthropic Client', () => {
    it('should update and get retry config', () => {
      const client = createAnthropicLLM({
        apiKey: 'test-key',
        model: 'claude-3-haiku-20240307',
      });

      // Initially undefined
      expect(client.getRetryConfig()).toBeUndefined();

      // Set config
      client.setRetryConfig({
        maxRetries: 4,
        initialDelay: 2000,
        jitter: false,
      });

      expect(client.getRetryConfig()).toEqual({
        maxRetries: 4,
        initialDelay: 2000,
        jitter: false,
      });
    });
  });

  describe('Gemini Client', () => {
    it('should update and get retry config', () => {
      const client = createGeminiLLM({
        apiKey: 'test-key',
        model: 'gemini-2.5-pro',
      });

      // Initially undefined
      expect(client.getRetryConfig()).toBeUndefined();

      // Set config
      client.setRetryConfig({
        maxRetries: 3,
        initialDelay: 1500,
        backoffMultiplier: 3,
      });

      expect(client.getRetryConfig()).toEqual({
        maxRetries: 3,
        initialDelay: 1500,
        backoffMultiplier: 3,
      });
    });
  });

  describe('Multiple clients', () => {
    it('should maintain independent retry configs', () => {
      const client1 = createOpenAILLM({
        apiKey: 'test-key-1',
        model: 'gpt-4',
        retry: { maxRetries: 2 },
      });

      const client2 = createOpenAILLM({
        apiKey: 'test-key-2',
        model: 'gpt-3.5-turbo',
        retry: { maxRetries: 5 },
      });

      // Check initial configs are independent
      expect(client1.getRetryConfig()).toEqual({ maxRetries: 2 });
      expect(client2.getRetryConfig()).toEqual({ maxRetries: 5 });

      // Update client1's config
      client1.setRetryConfig({ maxRetries: 10, initialDelay: 100 });

      // Verify client2 is unaffected
      expect(client1.getRetryConfig()).toEqual({
        maxRetries: 10,
        initialDelay: 100,
      });
      expect(client2.getRetryConfig()).toEqual({ maxRetries: 5 });

      // Update client2's config
      client2.setRetryConfig(undefined);

      // Verify configs remain independent
      expect(client1.getRetryConfig()).toEqual({
        maxRetries: 10,
        initialDelay: 100,
      });
      expect(client2.getRetryConfig()).toBeUndefined();
    });
  });
});
