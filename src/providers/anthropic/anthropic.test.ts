import { describe, expect, it, beforeEach, afterEach, afterAll, mock } from 'bun:test';
import { z } from 'zod';
import { AnthropicProvider } from './anthropic';
import type { ChatRequest } from '../provider';

// Store original fetch
const originalFetch = global.fetch;

// Mock fetch for API calls
global.fetch = mock() as any;

describe('Anthropic Provider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider('test-api-key');
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
      expect(provider.name).toBe('anthropic');
      expect(provider.capabilities).toEqual({
        streaming: true,
        tools: true,
        structuredOutput: true,
        vision: true,
        maxTokens: 200000,
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
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-opus-20240229',
        content: [{ type: 'text', text: 'Hello!' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
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

      expect(response.content).toBe('Hello!');
      expect(response.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      });
      expect(response.model).toBe('claude-3-opus-20240229');

      // Check API call
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-api-key': 'test-api-key',
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('should handle system messages correctly', async () => {
      const mockResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-opus-20240229',
        content: [{ type: 'text', text: 'I am a helpful assistant.' }],
        usage: { input_tokens: 20, output_tokens: 10 },
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
      expect(callArgs.system).toBe('You are a helpful assistant.');
      expect(callArgs.messages).toHaveLength(1);
      expect(callArgs.messages[0].role).toBe('user');
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
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-opus-20240229',
          content: [
            {
              type: 'tool_use',
              id: 'tool_123',
              name: 'respond_with_structured_output',
              input: { name: 'John', age: 30, city: 'NYC' },
            },
          ],
          usage: { input_tokens: 50, output_tokens: 20 },
        }),
      });

      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'Generate a person' }],
        schema,
      };

      const response = await provider.chat<z.infer<typeof schema>>(request);

      // Provider returns parsed content when schema is provided
      expect(response.content).toEqual({ name: 'John', age: 30, city: 'NYC' });

      // Check that tools were created for structured output
      const callArgs = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callArgs.tools).toBeDefined();
      expect(callArgs.tools).toHaveLength(1);
      expect(callArgs.tools[0].name).toBe('respond_with_structured_output');
      expect(callArgs.tool_choice).toEqual({
        type: 'tool',
        name: 'respond_with_structured_output',
      });
    });

    it('should handle tool calls', async () => {
      const mockResponse = {
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
        usage: { input_tokens: 50, output_tokens: 30 },
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
        id: 'tool_123',
        name: 'get_weather',
        arguments: { location: 'San Francisco' },
      });

      // Check API call includes tools
      const callArgs = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callArgs.tools).toHaveLength(1);
      expect(callArgs.tools[0].name).toBe('get_weather');
    });

    it('should handle Anthropic-specific features', async () => {
      const mockResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-opus-20240229',
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const request = {
        messages: [{ role: 'user', content: 'Hello' }],
        features: {
          thinking: true,
          cacheControl: true,
        },
      };

      await provider.chat(request as any);

      // Anthropic-specific features would be in the request
      // For now, we'll just verify the call was made
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should handle thinking tokens feature', async () => {
      const mockResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-opus-20240229',
        content: [
          { type: 'thinking', text: 'Let me think about this...' },
          { type: 'text', text: 'The answer is 42.' },
        ],
        usage: { input_tokens: 100, output_tokens: 50, thinking_tokens: 25 },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const request = {
        messages: [{ role: 'user', content: 'What is the meaning of life?' }],
        features: {
          thinking: true,
          maxThinkingTokens: 1000,
        },
      };

      const response = await provider.chat(request as any);

      // Check that thinking feature is passed in request
      const callArgs = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callArgs.max_thinking_tokens).toBe(1000);

      // Check that thinking content is returned in response
      expect(response.thinking).toBe('Let me think about this...');
      expect(response.content).toBe('The answer is 42.');
      expect(response.usage.totalTokens).toBe(175); // input + output + thinking
    });

    it('should handle API errors', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers(),
        json: async () => ({
          error: {
            type: 'invalid_request_error',
            message: 'Invalid request',
          },
        }),
      });

      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(provider.chat(request)).rejects.toThrow(
        'Anthropic API error (400): Invalid request',
      );
    });
  });

  describe('Streaming', () => {
    it('should handle streaming responses', async () => {
      const chunks = [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","model":"claude-3-opus-20240229","content":[],"usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
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

      expect(collected).toEqual(['Hello', ' world']);

      const complete = await stream.complete();
      expect(complete.content).toBe('Hello world');
      expect(complete.usage.inputTokens).toBe(10);
      expect(complete.usage.outputTokens).toBe(5);
    });
  });
});
