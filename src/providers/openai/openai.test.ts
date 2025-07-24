import { describe, expect, it, beforeEach, afterEach, afterAll, mock } from 'bun:test';
import { z } from 'zod';
import { OpenAIProvider } from './openai';
// import type { ChatRequest } from '../provider';

// Store original fetch
const originalFetch = global.fetch;

// Mock fetch for API calls
global.fetch = mock() as any;

describe('OpenAI Provider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider('test-api-key');
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
      expect(provider.name).toBe('openai');
      expect(provider.capabilities).toEqual({
        streaming: true,
        tools: true,
        structuredOutput: true,
        vision: true,
        maxTokens: 128000,
      });
    });

    it('should support feature detection', () => {
      expect(provider.supportsFeature('streaming')).toBe(true);
      expect(provider.supportsFeature('tools')).toBe(true);
      expect(provider.supportsFeature('structuredOutput')).toBe(true);
      expect(provider.supportsFeature('vision')).toBe(true);
      expect(provider.supportsFeature('unknown')).toBe(false);
    });
  });

  describe('Chat Completion', () => {
    it('should make basic chat request', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
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
              content: 'Hello! How can I help you?',
            },
            finish_reason: 'stop',
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const response = await provider.chat({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.content).toBe('Hello! How can I help you?');
      expect(response.usage).toEqual({
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      });
      expect(response.model).toBe('gpt-4');
      expect(response.finishReason).toBe('stop');

      // Verify API call
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('"messages"'),
        }),
      );
    });

    it('should handle structured output with JSON schema', async () => {
      const schema = z.object({
        answer: z.string(),
        confidence: z.number().min(0).max(1),
      });

      const mockResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
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
              content: null,
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'respond_with_structured_output',
                    arguments: '{"answer": "Paris", "confidence": 0.95}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const response = await provider.chat<z.infer<typeof schema>>({
        messages: [{ role: 'user', content: 'What is the capital of France?' }],
        schema,
      });

      expect(response.content).toEqual({ answer: 'Paris', confidence: 0.95 });

      // Verify tools were created for structured output
      const callArgs = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callArgs.tools).toBeDefined();
      expect(callArgs.tools).toHaveLength(1);
      expect(callArgs.tools[0].function.name).toBe('respond_with_structured_output');
      expect(callArgs.tool_choice).toBe('required');
    });

    it('should handle tool calls', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
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
              content: null,
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location": "Paris"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const weatherTool = {
        name: 'get_weather',
        description: 'Get weather for a location',
        parameters: z.object({ location: z.string() }),
      };

      const response = await provider.chat({
        messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
        tools: [weatherTool],
        toolChoice: 'required',
      });

      expect(response.content).toBe('');
      expect(response.finishReason).toBe('tool_calls');
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0]).toEqual({
        id: 'call_123',
        name: 'get_weather',
        arguments: { location: 'Paris' },
      });

      // Verify tool_choice was set
      const callArgs = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callArgs.tool_choice).toBe('required');
    });

    it('should handle OpenAI-specific features', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
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
              content: 'Response',
            },
            finish_reason: 'stop',
            logprobs: {
              content: [
                {
                  token: 'Response',
                  logprob: -0.5,
                  top_logprobs: [
                    { token: 'Response', logprob: -0.5 },
                    { token: 'Reply', logprob: -1.2 },
                  ],
                },
              ],
            },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const response = await provider.chat({
        messages: [{ role: 'user', content: 'Hello' }],
        features: {
          logprobs: true,
          topLogprobs: 2,
        },
      });

      expect(response.systemFingerprint).toBe('fp_12345');
      expect(response.logprobs).toBeDefined();
      expect(response.logprobs?.[0]?.token).toBe('Response');
      expect(response.logprobs?.[0]?.topLogprobs).toHaveLength(2);

      // Verify features were passed
      const callArgs = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callArgs.logprobs).toBe(true);
      expect(callArgs.top_logprobs).toBe(2);
    });

    it('should handle API errors', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers(),
        json: async () => ({
          error: {
            message: 'Rate limit exceeded',
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
          },
        }),
      });

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(
        provider.chat({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow('OpenAI API error (429): Rate limit exceeded');
    });
  });

  describe('Streaming', () => {
    it('should handle streaming responses', async () => {
      const chunks = [
        'data: {"id":"1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
        'data: {"id":"1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n',
        'data: {"id":"1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
        'data: [DONE]\n\n',
      ];

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
          controller.close();
        },
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      const response = await provider.stream({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const collectedChunks: string[] = [];
      for await (const chunk of response) {
        collectedChunks.push(chunk);
      }

      expect(collectedChunks).toEqual(['Hello', ' world']);

      const complete = await response.complete();
      expect(complete.content).toBe('Hello world');
      expect(complete.usage.totalTokens).toBe(15);
    });
  });
});
