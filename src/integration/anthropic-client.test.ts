import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { z } from 'zod';
import { createAnthropicLLM } from '../client';

// Store original fetch
const originalFetch = global.fetch;

// Mock fetch globally
global.fetch = vi.fn() as any;

describe('Anthropic Client Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Restore original fetch after all tests
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('should create Anthropic client and make chat request', async () => {
    const mockResponse = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      model: 'claude-3-opus-20240229',
      content: [{ type: 'text', text: 'Hello from Claude!' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 20,
      },
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const client = createAnthropicLLM({
      apiKey: 'test-key',
      model: 'claude-3-opus-20240229',
    });

    const response = await client.chat({
      messages: [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' },
      ],
    });

    expect(response.content).toBe('Hello from Claude!');
    expect(response.usage.totalTokens).toBe(30);
    expect(response.model).toBe('claude-3-opus-20240229');

    // Verify the API call
    const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(callBody).toMatchObject({
      model: 'claude-3-opus-20240229',
      system: 'You are a helpful assistant',
      messages: [{ role: 'user', content: 'Hello' }],
    });
  });

  it('should handle structured output with schema', async () => {
    const PersonSchema = z.object({
      name: z.string(),
      age: z.number(),
      city: z.string(),
    });

    // type Person = z.infer<typeof PersonSchema>;

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-opus-20240229',
        content: [
          {
            type: 'tool_use',
            id: 'tool_123',
            name: 'respond_with_structured_output',
            input: { name: 'Alice', age: 30, city: 'New York' },
          },
        ],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 50, output_tokens: 20 },
      }),
    });

    const client = createAnthropicLLM({
      apiKey: 'test-key',
      model: 'claude-3-opus-20240229',
    });

    const response = await client.chat({
      messages: [{ role: 'user', content: 'Generate a person' }],
      schema: PersonSchema,
    });

    expect(response.content).toEqual({
      name: 'Alice',
      age: 30,
      city: 'New York',
    });

    // Verify tools were created internally for structured output
    const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(callBody.tools).toBeDefined();
    expect(callBody.tools).toHaveLength(1);
    expect(callBody.tools[0].name).toBe('respond_with_structured_output');
  });

  it('should handle Anthropic-specific features', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-opus-20240229',
        content: [{ type: 'text', text: 'Thoughtful response' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    });

    const client = createAnthropicLLM({
      apiKey: 'test-key',
      model: 'claude-3-opus-20240229',
    });

    const response = await client.chat({
      messages: [{ role: 'user', content: 'Think step by step' }],
      features: {
        thinking: true,
        cacheControl: true,
      } as any,
    });

    expect(response.content).toBe('Thoughtful response');
    // ID is not part of the standard response interface
  });

  it('should define and execute tools', async () => {
    const weatherTool = {
      name: 'get_weather',
      description: 'Get the current weather',
      schema: z.object({
        location: z.string(),
      }),
      execute: async (params: { location: string }) => {
        return { temperature: 72, location: params.location };
      },
    };

    const client = createAnthropicLLM({
      apiKey: 'test-key',
      model: 'claude-3-opus-20240229',
    });

    const tool = client.defineTool(weatherTool);
    expect(tool.name).toBe('get_weather');

    // Mock a response with tool calls
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-opus-20240229',
        content: [
          {
            type: 'tool_use',
            id: 'tool_123',
            name: 'get_weather',
            input: { location: 'San Francisco' },
          },
        ],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 50, output_tokens: 30 },
      }),
    });

    const response = await client.chat({
      messages: [{ role: 'user', content: 'What is the weather?' }],
      tools: [tool],
    });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls?.[0]?.name).toBe('get_weather');

    // Execute the tool
    const results = await client.executeTools(response.toolCalls!);
    console.log('Tool execution results:', results);
    expect(results).toHaveLength(1);
    expect(results[0]?.result).toEqual({
      temperature: 72,
      location: 'San Francisco',
    });
  });
});
