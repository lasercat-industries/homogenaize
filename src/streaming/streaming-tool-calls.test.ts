import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll, mock } from 'bun:test';
import { z } from 'zod';
import { OpenAIProvider } from '../providers/openai';
import { AnthropicProvider } from '../providers/anthropic';
import { GeminiProvider } from '../providers/gemini';

/**
 * These tests validate that tool calls work correctly with streaming.
 *
 * Currently, all three providers have a bug where tool calls are tracked
 * during streaming but NOT returned in the complete() response.
 *
 * These tests should PASS when the bug is fixed.
 */

describe('Streaming Tool Calls', () => {
  let originalFetch: typeof global.fetch;

  beforeAll(() => {
    originalFetch = global.fetch;
    global.fetch = mock() as any;
  });

  beforeEach(() => {
    (global.fetch as any).mockClear();
  });

  afterEach(() => {
    mock.restore();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  // Helper to create a ReadableStream from chunks
  function createStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    });
  }

  // Common tool definition for tests
  const weatherTool = {
    name: 'get_weather',
    description: 'Get weather for a location',
    parameters: z.object({
      location: z.string(),
      unit: z.enum(['celsius', 'fahrenheit']).optional(),
    }),
  };

  describe('OpenAI Provider', () => {
    let provider: OpenAIProvider;

    beforeEach(() => {
      provider = new OpenAIProvider('test-api-key');
    });

    it('should return tool calls from streaming response via complete()', async () => {
      // OpenAI streaming format for tool calls
      // Tool calls come in delta chunks with index-based accumulation
      const chunks = [
        'data: {"id":"1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_abc123","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"location\\""}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":": \\"Paris\\", "}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"unit\\": \\"celsius\\"}"}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":20,"completion_tokens":15,"total_tokens":35}}\n\n',
        'data: [DONE]\n\n',
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: createStream(chunks),
      });

      const response = await provider.stream({
        messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
        tools: [weatherTool],
        toolChoice: 'auto',
      });

      // Consume the stream
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of response) {
        // Just consume
      }

      const result = await response.complete();

      // Verify tool calls are returned
      expect(result.finishReason).toBe('tool_calls');
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        id: 'call_abc123',
        name: 'get_weather',
        arguments: { location: 'Paris', unit: 'celsius' },
      });
    });

    it('should handle multiple tool calls in streaming', async () => {
      // Multiple tool calls in a single streaming response
      const chunks = [
        'data: {"id":"1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"location\\": \\"Paris\\"}"}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_2","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"function":{"arguments":"{\\"location\\": \\"London\\"}"}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":25,"completion_tokens":30,"total_tokens":55}}\n\n',
        'data: [DONE]\n\n',
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: createStream(chunks),
      });

      const response = await provider.stream({
        messages: [{ role: 'user', content: 'What is the weather in Paris and London?' }],
        tools: [weatherTool],
        toolChoice: 'auto',
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of response) {
        // Consume
      }

      const result = await response.complete();

      expect(result.finishReason).toBe('tool_calls');
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls).toHaveLength(2);
      const toolCalls = result.toolCalls!;
      expect(toolCalls[0]!.name).toBe('get_weather');
      expect(toolCalls[0]!.arguments).toEqual({ location: 'Paris' });
      expect(toolCalls[1]!.name).toBe('get_weather');
      expect(toolCalls[1]!.arguments).toEqual({ location: 'London' });
    });

    it('should not include tool calls when only text content is streamed', async () => {
      const chunks = [
        'data: {"id":"1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
        'data: {"id":"1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n',
        'data: {"id":"1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
        'data: [DONE]\n\n',
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: createStream(chunks),
      });

      const response = await provider.stream({
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [weatherTool],
        toolChoice: 'auto',
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of response) {
        // Consume
      }

      const result = await response.complete();

      expect(result.finishReason).toBe('stop');
      expect(result.content).toBe('Hello world');
      expect(result.toolCalls).toBeUndefined();
    });
  });

  describe('Anthropic Provider', () => {
    let provider: AnthropicProvider;

    beforeEach(() => {
      provider = new AnthropicProvider('test-api-key');
    });

    it('should return tool calls from streaming response via complete()', async () => {
      // Anthropic streaming format - SSE events for tool use
      const chunks = [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","content":[],"model":"claude-3-opus-20240229","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":25,"output_tokens":1}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_123","name":"get_weather","input":{}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"loc"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"ation\\": \\"Paris\\"}"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":35}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: createStream(chunks),
      });

      const response = await provider.stream({
        messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
        tools: [weatherTool],
        toolChoice: 'auto',
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of response) {
        // Consume
      }

      const result = await response.complete();

      // Verify tool calls are returned
      expect(result.finishReason).toBe('tool_calls');
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        id: 'toolu_123',
        name: 'get_weather',
        arguments: { location: 'Paris' },
      });
    });

    it('should handle multiple tool calls in Anthropic streaming', async () => {
      const chunks = [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","content":[],"model":"claude-3-opus-20240229","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":30,"output_tokens":1}}}\n\n',
        // First tool call
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"location\\": \\"Paris\\"}"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        // Second tool call
        'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_2","name":"get_weather","input":{}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"location\\": \\"London\\"}"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":50}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: createStream(chunks),
      });

      const response = await provider.stream({
        messages: [{ role: 'user', content: 'What is the weather in Paris and London?' }],
        tools: [weatherTool],
        toolChoice: 'auto',
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of response) {
        // Consume
      }

      const result = await response.complete();

      expect(result.finishReason).toBe('tool_calls');
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls).toHaveLength(2);
      const toolCalls = result.toolCalls!;
      expect(toolCalls[0]!.name).toBe('get_weather');
      expect(toolCalls[0]!.arguments).toEqual({ location: 'Paris' });
      expect(toolCalls[1]!.name).toBe('get_weather');
      expect(toolCalls[1]!.arguments).toEqual({ location: 'London' });
    });

    it('should not include tool calls when only text content is streamed', async () => {
      const chunks = [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","content":[],"model":"claude-3-opus-20240229","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello world"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: createStream(chunks),
      });

      const response = await provider.stream({
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [weatherTool],
        toolChoice: 'auto',
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of response) {
        // Consume
      }

      const result = await response.complete();

      expect(result.finishReason).toBe('stop');
      expect(result.content).toBe('Hello world');
      expect(result.toolCalls).toBeUndefined();
    });
  });

  describe('Gemini Provider', () => {
    let provider: GeminiProvider;

    beforeEach(() => {
      provider = new GeminiProvider('test-api-key');
    });

    it('should return tool calls (function calls) from streaming response via complete()', async () => {
      // Gemini streaming format - SSE with functionCall parts
      const chunks = [
        'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"get_weather","args":{"location":"Paris"}}}]},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":20,"candidatesTokenCount":15,"totalTokenCount":35}}\n\n',
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: createStream(chunks),
      });

      const response = await provider.stream({
        messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
        tools: [weatherTool],
        toolChoice: 'auto',
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of response) {
        // Consume
      }

      const result = await response.complete();

      // Verify tool calls are returned
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        id: expect.any(String), // Gemini generates synthetic IDs
        name: 'get_weather',
        arguments: { location: 'Paris' },
      });
    });

    it('should handle multiple function calls in Gemini streaming', async () => {
      const chunks = [
        'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"get_weather","args":{"location":"Paris"}}},{"functionCall":{"name":"get_weather","args":{"location":"London"}}}]},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":25,"candidatesTokenCount":30,"totalTokenCount":55}}\n\n',
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: createStream(chunks),
      });

      const response = await provider.stream({
        messages: [{ role: 'user', content: 'What is the weather in Paris and London?' }],
        tools: [weatherTool],
        toolChoice: 'auto',
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of response) {
        // Consume
      }

      const result = await response.complete();

      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls).toHaveLength(2);
      const toolCalls = result.toolCalls!;
      expect(toolCalls[0]!.name).toBe('get_weather');
      expect(toolCalls[0]!.arguments).toEqual({ location: 'Paris' });
      expect(toolCalls[1]!.name).toBe('get_weather');
      expect(toolCalls[1]!.arguments).toEqual({ location: 'London' });
    });

    it('should not include tool calls when only text content is streamed', async () => {
      const chunks = [
        'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]},"finishReason":null,"index":0}]}\n\n',
        'data: {"candidates":[{"content":{"role":"model","parts":[{"text":" world"}]},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"totalTokenCount":15}}\n\n',
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: createStream(chunks),
      });

      const response = await provider.stream({
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [weatherTool],
        toolChoice: 'auto',
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of response) {
        // Consume
      }

      const result = await response.complete();

      expect(result.finishReason).toBe('stop');
      expect(result.content).toBe('Hello world');
      expect(result.toolCalls).toBeUndefined();
    });
  });

  describe('Cross-Provider Consistency', () => {
    it('should have consistent tool call response format across providers', async () => {
      // This test ensures all providers return tool calls in the same format
      // when streaming is complete

      // OpenAI
      const openaiProvider = new OpenAIProvider('test-key');
      const openaiChunks = [
        'data: {"id":"1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_oai","type":"function","function":{"name":"get_weather","arguments":"{\\"location\\": \\"Paris\\"}"}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":20,"completion_tokens":15,"total_tokens":35}}\n\n',
        'data: [DONE]\n\n',
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: createStream(openaiChunks),
      });

      const openaiResponse = await openaiProvider.stream({
        messages: [{ role: 'user', content: 'Weather in Paris?' }],
        tools: [weatherTool],
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of openaiResponse) {
        // Consume stream
      }
      const openaiResult = await openaiResponse.complete();

      // Anthropic
      const anthropicProvider = new AnthropicProvider('test-key');
      const anthropicChunks = [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","content":[],"model":"claude-3-opus-20240229","usage":{"input_tokens":25,"output_tokens":1}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_ant","name":"get_weather","input":{}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"location\\": \\"Paris\\"}"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":35}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: createStream(anthropicChunks),
      });

      const anthropicResponse = await anthropicProvider.stream({
        messages: [{ role: 'user', content: 'Weather in Paris?' }],
        tools: [weatherTool],
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of anthropicResponse) {
        // Consume stream
      }
      const anthropicResult = await anthropicResponse.complete();

      // Gemini
      const geminiProvider = new GeminiProvider('test-key');
      const geminiChunks = [
        'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"get_weather","args":{"location":"Paris"}}}]},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":20,"candidatesTokenCount":15,"totalTokenCount":35}}\n\n',
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: createStream(geminiChunks),
      });

      const geminiResponse = await geminiProvider.stream({
        messages: [{ role: 'user', content: 'Weather in Paris?' }],
        tools: [weatherTool],
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of geminiResponse) {
        // Consume stream
      }
      const geminiResult = await geminiResponse.complete();

      // All should have tool calls
      expect(openaiResult.toolCalls).toBeDefined();
      expect(anthropicResult.toolCalls).toBeDefined();
      expect(geminiResult.toolCalls).toBeDefined();

      // All should have exactly 1 tool call
      expect(openaiResult.toolCalls).toHaveLength(1);
      expect(anthropicResult.toolCalls).toHaveLength(1);
      expect(geminiResult.toolCalls).toHaveLength(1);

      const openaiToolCall = openaiResult.toolCalls![0]!;
      const anthropicToolCall = anthropicResult.toolCalls![0]!;
      const geminiToolCall = geminiResult.toolCalls![0]!;

      // All should have the same tool name
      expect(openaiToolCall.name).toBe('get_weather');
      expect(anthropicToolCall.name).toBe('get_weather');
      expect(geminiToolCall.name).toBe('get_weather');

      // All should have the same arguments
      expect(openaiToolCall.arguments).toEqual({ location: 'Paris' });
      expect(anthropicToolCall.arguments).toEqual({ location: 'Paris' });
      expect(geminiToolCall.arguments).toEqual({ location: 'Paris' });

      // All should have an id (format may differ by provider)
      expect(openaiToolCall.id).toBeDefined();
      expect(anthropicToolCall.id).toBeDefined();
      expect(geminiToolCall.id).toBeDefined();
    });
  });
});
