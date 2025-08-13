import { describe, expect, it, beforeEach, afterAll, mock } from 'bun:test';
import { z } from 'zod';
import { createGeminiLLM } from '../client';

// Store original fetch
const originalFetch = global.fetch;

// Mock fetch globally
global.fetch = mock() as any;

describe('Gemini Client Integration', () => {
  beforeEach(() => {
    (global.fetch as any).mockClear();
  });

  // Restore original fetch after all tests
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('should create Gemini client and make chat request', async () => {
    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: 'Hello from Gemini!' }],
            role: 'model',
          },
          finishReason: 'STOP',
          index: 0,
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        totalTokenCount: 30,
      },
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      json: async () => mockResponse,
    });

    const client = createGeminiLLM({
      apiKey: 'test-key',
      model: 'gemini-1.5-pro',
    });

    const response = await client.chat({
      messages: [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' },
      ],
    });

    expect(response.content).toBe('Hello from Gemini!');
    expect(response.usage.totalTokens).toBe(30);
    expect(response.finishReason).toBe('stop');

    // Verify the API call
    const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(callBody).toMatchObject({
      systemInstruction: {
        parts: [{ text: 'You are a helpful assistant' }],
      },
      contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
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
      headers: new Headers(),
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({ name: 'Alice', age: 30, city: 'New York' }),
                },
              ],
              role: 'model',
            },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 50,
          candidatesTokenCount: 20,
          totalTokenCount: 70,
        },
      }),
    });

    const client = createGeminiLLM({
      apiKey: 'test-key',
      model: 'gemini-1.5-pro',
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

    // Verify native structured output was used (not tools)
    const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(callBody.tools).toBeUndefined();
    expect(callBody.generationConfig.responseMimeType).toBe('application/json');
    expect(callBody.generationConfig.responseSchema).toBeDefined();
    expect(callBody.generationConfig.responseSchema.type).toBe('OBJECT');
  });

  it('should handle Gemini-specific features', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: 'Safe response' }],
              role: 'model',
            },
            finishReason: 'STOP',
            index: 0,
            safetyRatings: [
              {
                category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                probability: 'NEGLIGIBLE',
              },
            ],
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
        },
      }),
    });

    const client = createGeminiLLM({
      apiKey: 'test-key',
      model: 'gemini-1.5-pro',
    });

    const response = await client.chat({
      messages: [{ role: 'user', content: 'Tell me about safety' }],
      features: {
        safetySettings: [
          {
            category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
            threshold: 'BLOCK_ONLY_HIGH',
          },
        ],
      } as any,
    });

    expect(response.content).toBe('Safe response');
    expect(response.safetyRatings).toBeDefined();
    expect(response.safetyRatings?.[0]?.category).toBe('HARM_CATEGORY_DANGEROUS_CONTENT');
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

    const client = createGeminiLLM({
      apiKey: 'test-key',
      model: 'gemini-1.5-pro',
    });

    const tool = client.defineTool(weatherTool);
    expect(tool.name).toBe('get_weather');

    // Mock a response with tool calls
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'get_weather',
                    args: { location: 'San Francisco' },
                  },
                },
              ],
              role: 'model',
            },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 50,
          candidatesTokenCount: 30,
          totalTokenCount: 80,
        },
      }),
    });

    const response = await client.chat({
      messages: [{ role: 'user', content: 'What is the weather?' }],
      tools: [tool],
    });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls?.[0]?.name).toBe('get_weather');

    // Execute the tool
    const results = await client.executeTools(response.toolCalls || []);
    expect(results[0]?.result).toEqual({
      temperature: 72,
      location: 'San Francisco',
    });
  });
});
