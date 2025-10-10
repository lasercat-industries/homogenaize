import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { z } from 'zod';
import { createOpenAILLM } from '../client';
import { ValidationError } from './errors';

describe('Validation Error Retry Behavior', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    mock.restore();
  });

  it('should retry when Zod validation fails initially', async () => {
    let attemptCount = 0;

    const schema = z.object({
      answer: z.number(),
      explanation: z.string(),
    });

    // Mock fetch - first attempt returns invalid data, second attempt returns valid data
    const mockFetch = mock(() => {
      attemptCount++;

      if (attemptCount === 1) {
        // First attempt: invalid schema (missing required fields)
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
                    content: '{"answer": "not a number"}', // Invalid: answer should be number
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
        } as any);
      }

      // Second attempt: valid data
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 'test-id-2',
            object: 'chat.completion',
            created: Date.now(),
            model: 'gpt-4',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: '{"answer": 4, "explanation": "Two plus two equals four"}',
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
      } as any);
    });

    // @ts-expect-error - Mock global fetch
    global.fetch = mockFetch;

    const client = createOpenAILLM({
      apiKey: 'test-key',
      model: 'gpt-4',
      retry: {
        maxRetries: 2,
        initialDelay: 10,
      },
    });

    const response = await client.chat({
      messages: [{ role: 'user', content: 'What is 2+2?' }],
      schema,
    });

    expect(attemptCount).toBe(2); // Should retry once after validation error
    expect(response.content).toEqual({
      answer: 4,
      explanation: 'Two plus two equals four',
    });
  });

  it('should fail after max retries if validation keeps failing', async () => {
    let attemptCount = 0;

    const schema = z.object({
      answer: z.number(),
    });

    // Mock fetch - always returns invalid data
    const mockFetch = mock(() => {
      attemptCount++;
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
                  content: '{"answer": "always invalid"}', // Always invalid
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
      } as any);
    });

    // @ts-expect-error - Mock global fetch
    global.fetch = mockFetch;

    const client = createOpenAILLM({
      apiKey: 'test-key',
      model: 'gpt-4',
      retry: {
        maxRetries: 2,
        initialDelay: 10,
      },
    });

    try {
      await client.chat({
        messages: [{ role: 'user', content: 'What is 2+2?' }],
        schema,
      });
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(attemptCount).toBe(3); // Initial attempt + 2 retries
    }
  });

  it('should respect custom retry config for validation errors', async () => {
    let attemptCount = 0;
    const onRetryMock = mock();

    const schema = z.object({
      value: z.number(),
    });

    // Mock fetch - first two attempts return invalid data, third succeeds
    const mockFetch = mock(() => {
      attemptCount++;

      if (attemptCount <= 2) {
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
                    content: '{"value": "invalid"}',
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
        } as any);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 'test-id-3',
            object: 'chat.completion',
            created: Date.now(),
            model: 'gpt-4',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: '{"value": 42}',
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
      } as any);
    });

    // @ts-expect-error - Mock global fetch
    global.fetch = mockFetch;

    const client = createOpenAILLM({
      apiKey: 'test-key',
      model: 'gpt-4',
      retry: {
        maxRetries: 3,
        initialDelay: 10,
        onRetry: onRetryMock,
      },
    });

    const response = await client.chat({
      messages: [{ role: 'user', content: 'Give me a number' }],
      schema,
    });

    expect(attemptCount).toBe(3);
    expect(response.content).toEqual({ value: 42 });
    expect(onRetryMock).toHaveBeenCalledTimes(2); // Called for each retry
  });

  it('should handle JSON Schema validation errors as retriable', async () => {
    let attemptCount = 0;

    const jsonSchema = {
      type: 'object',
      properties: {
        count: { type: 'number' },
      },
      required: ['count'],
      additionalProperties: false,
    } as const;

    // Mock fetch - first attempt invalid, second valid
    const mockFetch = mock(() => {
      attemptCount++;

      if (attemptCount === 1) {
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
                    content: '{"count": "not a number"}', // Invalid
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
        } as any);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 'test-id-2',
            object: 'chat.completion',
            created: Date.now(),
            model: 'gpt-4',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: '{"count": 5}',
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
      } as any);
    });

    // @ts-expect-error - Mock global fetch
    global.fetch = mockFetch;

    const client = createOpenAILLM({
      apiKey: 'test-key',
      model: 'gpt-4',
      retry: {
        maxRetries: 2,
        initialDelay: 10,
      },
    });

    const response = await client.chat<{ count: number }>({
      messages: [{ role: 'user', content: 'Count to 5' }],
      schema: jsonSchema as any,
    });

    expect(attemptCount).toBe(2);
    expect(response.content).toEqual({ count: 5 });
  });
});
