import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { createOpenAILLM, createAnthropicLLM, createGeminiLLM } from './client';
import type { RetryConfig } from './retry/types';

describe('Client with Retry Configuration', () => {
  let mockFetch: any;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    // Save original fetch
    originalFetch = global.fetch;
    // Mock global fetch
    mockFetch = mock();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    // Restore original fetch
    global.fetch = originalFetch;
    mock.restore();
  });

  it('should accept retry configuration in client options', () => {
    const retryConfig: RetryConfig = {
      maxRetries: 5,
      initialDelay: 2000,
      jitter: false,
    };

    const client = createOpenAILLM({
      apiKey: 'test-key',
      model: 'gpt-4',
      retry: retryConfig,
    });

    expect(client).toBeDefined();
  });

  it('should retry on 429 rate limit error', async () => {
    const retryConfig: RetryConfig = {
      maxRetries: 2,
      initialDelay: 10,
      jitter: false,
    };

    // First call returns 429, second call succeeds
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({ 'Retry-After': '0' }),
        json: async () => ({ error: { message: 'Rate limit exceeded' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        json: async () => ({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4',
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Hello!',
              },
              finish_reason: 'stop',
            },
          ],
        }),
      });

    const client = createOpenAILLM({
      apiKey: 'test-key',
      model: 'gpt-4',
      retry: retryConfig,
    });

    const response = await client.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(response.content).toBe('Hello!');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should respect onRetry callback', async () => {
    const onRetry = mock();
    const retryConfig: RetryConfig = {
      maxRetries: 1,
      initialDelay: 10,
      onRetry,
    };

    // First call fails with 500, second succeeds
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers(),
        json: async () => ({ error: { message: 'Internal server error' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        json: async () => ({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4',
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Success after retry',
              },
              finish_reason: 'stop',
            },
          ],
        }),
      });

    const client = createOpenAILLM({
      apiKey: 'test-key',
      model: 'gpt-4',
      retry: retryConfig,
    });

    const response = await client.chat({
      messages: [{ role: 'user', content: 'Test' }],
    });

    expect(response.content).toBe('Success after retry');
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number));
  });

  it('should not retry non-retryable errors', async () => {
    const retryConfig: RetryConfig = {
      maxRetries: 3,
      initialDelay: 10,
    };

    // Return 400 bad request
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers(),
      json: async () => ({ error: { message: 'Invalid request' } }),
    });

    const client = createOpenAILLM({
      apiKey: 'test-key',
      model: 'gpt-4',
      retry: retryConfig,
    });

    await expect(
      client.chat({
        messages: [{ role: 'user', content: 'Test' }],
      }),
    ).rejects.toThrow('Invalid request');

    // Should not retry on 400
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should work with all provider types', () => {
    const retryConfig: RetryConfig = {
      maxRetries: 3,
      initialDelay: 1000,
    };

    const openaiClient = createOpenAILLM({
      apiKey: 'test-key',
      model: 'gpt-4',
      retry: retryConfig,
    });

    const anthropicClient = createAnthropicLLM({
      apiKey: 'test-key',
      model: 'claude-3-opus-20240229',
      retry: retryConfig,
    });

    const geminiClient = createGeminiLLM({
      apiKey: 'test-key',
      model: 'gemini-1.5-pro',
      retry: retryConfig,
    });

    expect(openaiClient).toBeDefined();
    expect(anthropicClient).toBeDefined();
    expect(geminiClient).toBeDefined();
  });

  it('should use default retry config when not specified', async () => {
    // Mock successful response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      json: async () => ({
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello!',
            },
            finish_reason: 'stop',
          },
        ],
      }),
    });

    const client = createOpenAILLM({
      apiKey: 'test-key',
      model: 'gpt-4',
      // No retry config specified
    });

    const response = await client.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(response.content).toBe('Hello!');
  });
});
