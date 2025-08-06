import { describe, expect, it, beforeEach, afterEach, afterAll, mock } from 'bun:test';
import { z } from 'zod';
import { GeminiProvider } from './gemini';
import type { ChatRequest } from '../provider';

// Store original fetch
const originalFetch = global.fetch;

// Mock fetch for API calls
global.fetch = mock() as any;

describe('Gemini Provider', () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider('test-api-key');
    (global.fetch as any).mockClear();
  });

  afterEach(() => {
    mock.restore();
  });

  // Restore original fetch after all tests
  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('Configuration', () => {
    it('should initialize with correct capabilities', () => {
      expect(provider.name).toBe('gemini');
      expect(provider.capabilities).toEqual({
        streaming: true,
        tools: true,
        structuredOutput: true,
        vision: true,
        maxTokens: 1048576, // Gemini 1.5 Pro supports up to 1M tokens
      });
    });

    it('should support feature detection', () => {
      expect(provider.supportsFeature('streaming')).toBe(true);
      expect(provider.supportsFeature('tools')).toBe(true);
      expect(provider.supportsFeature('nonexistent')).toBe(false);
    });
  });

  describe('Chat Completion', () => {
    it('should make basic chat request', async () => {
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
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const response = await provider.chat(request);

      expect(response.content).toBe('Hello from Gemini!');
      expect(response.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      });
      expect(response.finishReason).toBe('stop');

      // Check API call
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('generativelanguage.googleapis.com'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('should handle system messages correctly', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'I am a helpful assistant.' }],
              role: 'model',
            },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 10,
          totalTokenCount: 30,
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const request: ChatRequest = {
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Who are you?' },
        ],
      };

      await provider.chat(request);

      const callArgs = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callArgs.systemInstruction).toEqual({
        parts: [{ text: 'You are a helpful assistant.' }],
      });
      expect(callArgs.contents).toHaveLength(1);
      expect(callArgs.contents[0].role).toBe('user');
    });

    it('should handle structured output with JSON schema', async () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
        city: z.string(),
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'respond_with_structured_output',
                      args: { name: 'John', age: 30, city: 'NYC' },
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
            candidatesTokenCount: 20,
            totalTokenCount: 70,
          },
        }),
      });

      const request: ChatRequest<z.infer<typeof schema>> = {
        messages: [{ role: 'user', content: 'Generate a person' }],
        schema,
      };

      const response = await provider.chat<z.infer<typeof schema>>(request);

      // Provider returns parsed content when schema is provided
      expect(response.content).toEqual({ name: 'John', age: 30, city: 'NYC' });

      // Check that tools were created for structured output
      const callArgs = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callArgs.tools).toBeDefined();
      expect(callArgs.tools[0].functionDeclarations).toHaveLength(1);
      expect(callArgs.tools[0].functionDeclarations[0].name).toBe('respond_with_structured_output');
      expect(callArgs.toolConfig.functionCallingConfig.mode).toBe('ANY');
    });

    it('should handle tool calls', async () => {
      const mockResponse = {
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
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const tools = [
        {
          name: 'get_weather',
          description: 'Get weather for a location',
          parameters: z.object({ location: z.string() }),
        },
      ];

      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools,
      };

      const response = await provider.chat(request);

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0]).toEqual({
        id: 'get_weather_0',
        name: 'get_weather',
        arguments: { location: 'San Francisco' },
      });

      // Check API call includes tools
      const callArgs = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callArgs.tools).toHaveLength(1);
      expect(callArgs.tools[0].functionDeclarations[0].name).toBe('get_weather');
    });

    it('should handle Gemini-specific features', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Safe response' }],
              role: 'model',
            },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const request = {
        messages: [{ role: 'user', content: 'Hello' }],
        features: {
          safetySettings: [
            {
              category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
              threshold: 'BLOCK_ONLY_HIGH',
            },
          ],
        },
      };

      await provider.chat(request as any);

      const callArgs = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callArgs.safetySettings).toHaveLength(1);
      expect(callArgs.safetySettings[0].category).toBe('HARM_CATEGORY_DANGEROUS_CONTENT');
    });

    it('should handle API errors', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers(),
        json: async () => ({
          error: {
            code: 400,
            message: 'Invalid request',
            status: 'INVALID_ARGUMENT',
          },
        }),
      });

      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(provider.chat(request)).rejects.toThrow(
        'Gemini API error (400): Invalid request',
      );
    });
  });

  describe('Streaming', () => {
    it('should handle streaming responses', async () => {
      const chunks = [
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: 'Hello' }] },
              finishReason: null,
            },
          ],
        }) + '\n',
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: ' world' }] },
              finishReason: null,
            },
          ],
        }) + '\n',
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: '!' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
        }) + '\n',
      ];

      let chunkIndex = 0;
      const encoder = new TextEncoder();

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => ({
            read: async () => {
              if (chunkIndex < chunks.length) {
                return {
                  done: false,
                  value: encoder.encode(chunks[chunkIndex++]),
                };
              }
              return { done: true };
            },
          }),
        },
      });

      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const stream = await provider.stream(request);
      const collected: string[] = [];

      for await (const chunk of stream) {
        collected.push(chunk);
      }

      expect(collected).toEqual(['Hello', ' world', '!']);

      const complete = await stream.complete();
      expect(complete.content).toBe('Hello world!');
      expect(complete.usage.inputTokens).toBe(10);
      expect(complete.usage.outputTokens).toBe(5);
    });
  });
});
