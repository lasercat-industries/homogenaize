import { describe, expect, it, beforeEach, beforeAll, afterAll, mock } from 'bun:test';
import { z } from 'zod';
import { createOpenAILLM } from '../client';

describe('OpenAI Client Integration', () => {
  let originalFetch: typeof global.fetch;

  beforeAll(() => {
    // Store original fetch and replace with mock
    originalFetch = global.fetch;
    global.fetch = mock() as any;
  });

  beforeEach(() => {
    (global.fetch as any).mockClear();
  });

  // Restore original fetch after all tests
  afterAll(() => {
    global.fetch = originalFetch;
  });
  it('should create OpenAI client and make chat request', async () => {
    const mockResponse = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1234567890,
      model: 'gpt-4o-mini',
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
            content: 'Hello from OpenAI!',
          },
          finish_reason: 'stop',
        },
      ],
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      json: async () => mockResponse,
    });

    const client = createOpenAILLM({
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
    });

    const response = await client.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(response.content).toBe('Hello from OpenAI!');
    expect(response.model).toBe('gpt-4o-mini');
    expect(response.usage.totalTokens).toBe(30);

    // Verify the API was called with correct model
    const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(callBody.model).toBe('gpt-4o-mini');
  });

  it('should handle structured output with schema', async () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      city: z.string(),
    });

    const mockResponse = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1234567890,
      model: 'gpt-4o-mini',
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
            content: '{"name": "John Doe", "age": 30, "city": "New York"}',
          },
          finish_reason: 'stop',
        },
      ],
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      json: async () => mockResponse,
    });

    const client = createOpenAILLM({
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
    });

    const response = await client.chat({
      messages: [{ role: 'user', content: 'Give me a person profile' }],
      schema,
    });

    // Response should be parsed and validated
    expect(response.content).toEqual({
      name: 'John Doe',
      age: 30,
      city: 'New York',
    });

    // Verify native response_format was used for structured output
    const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(callBody.response_format).toBeDefined();
    expect(callBody.response_format.type).toBe('json_schema');
    expect(callBody.response_format.json_schema).toBeDefined();
    expect(callBody.response_format.json_schema.schema).toBeDefined();
    expect(callBody.tools).toBeUndefined();
    expect(callBody.tool_choice).toBeUndefined();
  });

  it('should handle OpenAI-specific features', async () => {
    const mockResponse = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1234567890,
      model: 'gpt-4o-mini',
      system_fingerprint: 'fp_12345',
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
            content: 'Response with features',
          },
          finish_reason: 'stop',
          logprobs: {
            content: [
              {
                token: 'Response',
                logprob: -0.5,
                top_logprobs: [{ token: 'Response', logprob: -0.5 }],
              },
            ],
          },
        },
      ],
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      json: async () => mockResponse,
    });

    const client = createOpenAILLM({
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
    });

    const response = await client.chat({
      messages: [{ role: 'user', content: 'Hello' }],
      features: {
        logprobs: true,
        topLogprobs: 1,
        seed: 42,
      },
    });

    expect(response.systemFingerprint).toBe('fp_12345');
    expect(response.logprobs).toBeDefined();
    expect(response.logprobs?.[0]?.token).toBe('Response');

    // Verify features were passed to API
    const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(callBody.logprobs).toBe(true);
    expect(callBody.top_logprobs).toBe(1);
    expect(callBody.seed).toBe(42);
  });

  it('should define and execute tools', async () => {
    const client = createOpenAILLM({
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
    });

    const weatherTool = client.defineTool({
      name: 'get_weather',
      description: 'Get weather for a location',
      schema: z.object({
        location: z.string(),
        unit: z.enum(['celsius', 'fahrenheit']).optional(),
      }),
      execute: async (params) => ({
        temperature: 20,
        unit: params.unit || 'celsius',
        condition: 'sunny',
      }),
    });

    expect(weatherTool.name).toBe('get_weather');

    // Execute tool
    const results = await client.executeTools([
      {
        id: 'call_123',
        name: 'get_weather',
        arguments: { location: 'Paris', unit: 'celsius' },
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]?.result).toEqual({
      temperature: 20,
      unit: 'celsius',
      condition: 'sunny',
    });
  });
});
