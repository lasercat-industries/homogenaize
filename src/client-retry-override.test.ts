import { describe, expect, it, beforeEach, mock } from 'bun:test';
import { createOpenAILLM } from './client';
import { LLMError } from './retry/errors';

describe('Retry Config Override', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    mock.restore();
  });

  it('should use retry config from chat options when provided', async () => {
    let attemptCount = 0;

    // Mock fetch to fail once, then succeed
    const mockFetch = mock((_url: string) => {
      attemptCount++;

      if (attemptCount === 1) {
        // First attempt fails with 429 (rate limit)
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: {
            get: (name: string) => (name === 'Retry-After' ? '1' : null),
          },
          json: () =>
            Promise.resolve({
              error: { message: 'Rate limit exceeded' },
            }),
        } as any);
      }

      // Second attempt succeeds
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
                message: { role: 'assistant', content: 'Success after retry' },
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
      // No default retry config
    });

    const response = await client.chat({
      messages: [{ role: 'user', content: 'Test' }],
      // Override with custom retry config for this call
      retry: {
        maxRetries: 2,
        initialDelay: 10,
      },
    });

    expect(attemptCount).toBe(2); // maxRetries: 2 means up to 2 retries after initial attempt
    expect(response.content).toBe('Success after retry');
  });

  it('should use client default retry config when no override provided', async () => {
    let attemptCount = 0;

    // Mock fetch to fail once, then succeed
    const mockFetch = mock(() => {
      attemptCount++;

      if (attemptCount === 1) {
        // First attempt fails with 500 (server error)
        return Promise.resolve({
          ok: false,
          status: 500,
          headers: {
            get: () => null,
          },
          json: () =>
            Promise.resolve({
              error: { message: 'Internal server error' },
            }),
        } as any);
      }

      // Second attempt succeeds
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
                message: { role: 'assistant', content: 'Success with default retry' },
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
      // Client has default retry config
      retry: {
        maxRetries: 3,
        initialDelay: 50,
      },
    });

    const response = await client.chat({
      messages: [{ role: 'user', content: 'Test' }],
      // No retry override - should use client default
    });

    expect(attemptCount).toBe(2);
    expect(response.content).toBe('Success with default retry');
  });

  it('should disable retries when override sets maxAttempts to 1', async () => {
    let attemptCount = 0;

    // Mock fetch to always fail
    const mockFetch = mock(() => {
      attemptCount++;
      return Promise.resolve({
        ok: false,
        status: 429,
        headers: {
          get: (name: string) => (name === 'Retry-After' ? '1' : null),
        },
        json: () =>
          Promise.resolve({
            error: { message: 'Rate limit exceeded' },
          }),
      } as any);
    });

    // @ts-expect-error - Mock global fetch
    global.fetch = mockFetch;

    const client = createOpenAILLM({
      apiKey: 'test-key',
      model: 'gpt-4',
      // Client has retry enabled by default
      retry: {
        maxRetries: 3,
      },
    });

    try {
      await client.chat({
        messages: [{ role: 'user', content: 'Test' }],
        // Override to disable retries for this specific call
        retry: {
          maxRetries: 0,
        },
      });
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(LLMError);
      expect(attemptCount).toBe(1); // maxRetries: 0 means no retries
    }
  });

  it('should allow different retry configs for concurrent requests', async () => {
    const attemptCounts = { req1: 0, req2: 0 };

    // Mock fetch differently for each request
    const mockFetch = mock((_url: string, options: any) => {
      const body = JSON.parse(options.body);
      const isReq1 = body.messages[0].content === 'Request 1';

      if (isReq1) {
        attemptCounts.req1++;
        if (attemptCounts.req1 === 1) {
          return Promise.resolve({
            ok: false,
            status: 500,
            headers: {
              get: () => null,
            },
            json: () => Promise.resolve({ error: { message: 'Server error' } }),
          } as any);
        }
      } else {
        attemptCounts.req2++;
        if (attemptCounts.req2 <= 2) {
          return Promise.resolve({
            ok: false,
            status: 503,
            headers: {
              get: () => null,
            },
            json: () => Promise.resolve({ error: { message: 'Service unavailable' } }),
          } as any);
        }
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
                  content: isReq1 ? 'Response 1' : 'Response 2',
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
    });

    // Make two concurrent requests with different retry configs
    const [response1, response2] = await Promise.all([
      client.chat({
        messages: [{ role: 'user', content: 'Request 1' }],
        retry: {
          maxRetries: 1,
          initialDelay: 10,
        },
      }),
      client.chat({
        messages: [{ role: 'user', content: 'Request 2' }],
        retry: {
          maxRetries: 2,
          initialDelay: 20,
        },
      }),
    ]);

    expect(attemptCounts.req1).toBe(2); // maxRetries: 1 means 1 retry after initial
    expect(attemptCounts.req2).toBe(3); // maxRetries: 2 means 2 retries after initial
    expect(response1.content).toBe('Response 1');
    expect(response2.content).toBe('Response 2');
  });
});
