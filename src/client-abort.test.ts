import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createLLM } from './client';
import { AbortError } from './retry/errors';

describe('Client AbortSignal support', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Reset mock before each test
    // eslint-disable-next-line no-undef
    const mockFetch = async (_input: string | URL | Request, init?: RequestInit) => {
      // Check if already aborted
      if (init?.signal?.aborted) {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      }

      // Simulate a slow request with proper abort handling
      return new Promise<Response>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          resolve(
            new Response(
              JSON.stringify({
                id: 'test-id',
                object: 'chat.completion',
                created: Date.now(),
                model: 'gpt-4o-mini',
                choices: [
                  {
                    index: 0,
                    message: {
                      role: 'assistant',
                      content: 'Test response',
                    },
                    finish_reason: 'stop',
                  },
                ],
                usage: {
                  prompt_tokens: 10,
                  completion_tokens: 20,
                  total_tokens: 30,
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }, 1000);

        // Handle abort signal
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }
      });
    };

    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    // Restore original fetch after each test to avoid polluting other tests
    global.fetch = originalFetch;
  });
  test('should abort a chat request when signal is aborted', async () => {
    const client = createLLM({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
    });

    const controller = new AbortController();

    // Abort after 100ms
    setTimeout(() => controller.abort(), 100);

    const start = Date.now();
    try {
      await client.chat({
        messages: [{ role: 'user', content: 'Hello' }],
        signal: controller.signal,
      });
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(500); // Should abort before 1000ms delay completes
      // fetch throws Error with name 'AbortError' on abort
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).name).toBe('AbortError');
    }
  });

  test('should abort during retry loop', async () => {
    // Create a fetch that fails with retryable error
    // eslint-disable-next-line no-undef
    const retryableFetch = async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      }

      return new Response(JSON.stringify({ error: { message: 'Server error' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    global.fetch = retryableFetch as unknown as typeof fetch;

    const client = createLLM({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      retry: {
        maxRetries: 5,
        initialDelay: 1000,
      },
    });

    const controller = new AbortController();

    // Abort after 150ms (during first retry sleep)
    setTimeout(() => controller.abort(), 150);

    const start = Date.now();
    try {
      await client.chat({
        messages: [{ role: 'user', content: 'Hello' }],
        signal: controller.signal,
      });
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(800); // Should abort during sleep, not wait for all retries
      expect(error).toBeInstanceOf(AbortError);
      expect((error as AbortError).message).toBe('Sleep aborted');
    }
  });

  test('should complete successfully if not aborted', async () => {
    const successFetch = async () => {
      return new Response(
        JSON.stringify({
          id: 'test-id',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Success response',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    global.fetch = successFetch as unknown as typeof fetch;

    const client = createLLM({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
    });

    const controller = new AbortController();

    const response = await client.chat({
      messages: [{ role: 'user', content: 'Hello' }],
      signal: controller.signal,
    });

    expect(response.content).toBe('Success response');
  });

  test('should work without signal parameter (backward compatibility)', async () => {
    const compatFetch = async () => {
      return new Response(
        JSON.stringify({
          id: 'test-id',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Success response',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    global.fetch = compatFetch as unknown as typeof fetch;

    const client = createLLM({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
    });

    const response = await client.chat({
      messages: [{ role: 'user', content: 'Hello' }],
      // No signal parameter
    });

    expect(response.content).toBe('Success response');
  });

  test('should abort with custom reason', async () => {
    const client = createLLM({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
    });

    const controller = new AbortController();
    const customReason = new Error('User cancelled operation');

    setTimeout(() => controller.abort(customReason), 100);

    try {
      await client.chat({
        messages: [{ role: 'user', content: 'Hello' }],
        signal: controller.signal,
      });
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });
});
