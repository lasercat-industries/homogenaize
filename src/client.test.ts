import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import type { LLMClient } from './client';
import { createLLM, createOpenAILLM, createAnthropicLLM, createGeminiLLM } from './client';
import type { ProviderChatResponse, ProviderModels } from './providers/types';

describe('LLM Client', () => {
  describe('Factory functions', () => {
    it('should create generic client with const assertion', () => {
      const client = createLLM({
        provider: 'openai' as const,
        apiKey: 'test-key',
        model: 'gpt-4',
      });

      // TypeScript should infer LLMClient<'openai'>
      expect(client.provider).toBe('openai');
      expect(client.model).toBe('gpt-4');
    });

    it('should create OpenAI client with specific factory', () => {
      const client = createOpenAILLM({
        apiKey: 'test-key',
        model: 'gpt-4',
      });

      expect(client.provider).toBe('openai');
      expect(client.model).toBe('gpt-4');
    });

    it('should create Anthropic client with specific factory', () => {
      const client = createAnthropicLLM({
        apiKey: 'test-key',
        model: 'claude-3-5-sonnet-20241022',
      });

      expect(client.provider).toBe('anthropic');
      expect(client.model).toBe('claude-3-5-sonnet-20241022');
    });

    it('should create Gemini client with specific factory', () => {
      const client = createGeminiLLM({
        apiKey: 'test-key',
        model: 'gemini-1.5-pro',
      });

      expect(client.provider).toBe('gemini');
      expect(client.model).toBe('gemini-1.5-pro');
    });
  });

  describe('Client configuration', () => {
    it('should accept default options', () => {
      const client = createLLM({
        provider: 'openai' as const,
        apiKey: 'test-key',
        model: 'gpt-4',
        defaultOptions: {
          temperature: 0.7,
          maxTokens: 1000,
        },
      });

      expect(client.defaultOptions?.temperature).toBe(0.7);
      expect(client.defaultOptions?.maxTokens).toBe(1000);
    });
  });

  describe('Type safety', () => {
    it('should enforce provider-specific features at compile time', () => {
      createOpenAILLM({
        apiKey: 'test-key',
        model: 'gpt-4',
      });

      // This test validates that TypeScript compilation succeeds
      // with correct features and fails with incorrect ones
      const validRequest = {
        messages: [{ role: 'user' as const, content: 'Hello' }],
        features: {
          logprobs: true,
          topLogprobs: 5,
        },
      };

      expect(validRequest.features.logprobs).toBe(true);

      // The following would cause TypeScript errors:
      // validRequest.features.thinking = true; // Error: thinking doesn't exist on OpenAI features
    });
  });

  describe('Mock client implementation', () => {
    // Create a mock implementation for testing
    class MockLLMClient<P extends 'openai' | 'anthropic' | 'gemini'> implements LLMClient<P> {
      constructor(
        public provider: P,
        public apiKey: string,
        public model: ProviderModels[P],
        public defaultOptions?: {
          temperature?: number;
          maxTokens?: number;
        },
      ) {}

      async chat<T = string>(_options: any): Promise<ProviderChatResponse<P, T>> {
        return {
          content: 'Mock response' as T,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          },
          model: this.model,
        } as ProviderChatResponse<P, T>;
      }

      async stream<T = string>(
        _options: any,
      ): Promise<{
        complete(): Promise<ProviderChatResponse<P, T>>;
        [Symbol.asyncIterator](): AsyncIterator<T, any, any>;
      }> {
        const chunks = ['Mock', ' ', 'stream'];
        let index = 0;

        return {
          async *[Symbol.asyncIterator](): AsyncIterator<T, any, any> {
            while (index < chunks.length) {
              yield chunks[index++] as T;
            }
          },
          async complete(): Promise<ProviderChatResponse<P, T>> {
            return {
              content: 'Mock stream' as T,
              usage: {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
              },
              model: 'mock-model',
            } as ProviderChatResponse<P, T>;
          },
        };
      }

      defineTool(config: any) {
        return {
          name: config.name,
          description: config.description,
          parameters: config.schema,
          execute: config.execute,
        };
      }

      async executeTools(toolCalls: any[]) {
        return toolCalls.map((call) => ({
          toolCallId: call.id,
          toolName: call.name,
          result: { mock: 'result' },
        }));
      }

      async listModels() {
        return [
          { id: 'mock-model-1', name: 'Mock Model 1' },
          { id: 'mock-model-2', name: 'Mock Model 2' },
        ];
      }
    }

    it('should implement chat method', async () => {
      const client = new MockLLMClient('openai', 'test-key', 'gpt-4');
      const response = await client.chat({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.content).toBe('Mock response');
      expect(response.usage.totalTokens).toBe(15);
    });

    it('should implement streaming', async () => {
      const client = new MockLLMClient('anthropic', 'test-key', 'claude-3-opus-20240229');
      const stream = await client.stream({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        if (chunk !== undefined) {
          chunks.push(chunk);
        }
      }

      expect(chunks).toEqual(['Mock', ' ', 'stream']);
    });

    it('should support tool definition', () => {
      const client = new MockLLMClient('gemini', 'test-key', 'gemini-1.5-pro');
      const tool = client.defineTool({
        name: 'get_weather',
        description: 'Get weather',
        schema: z.object({ location: z.string() }),
        execute: async (params: any) => ({ temp: 20, location: params.location }),
      });

      expect(tool.name).toBe('get_weather');
      expect(tool.description).toBe('Get weather');
    });

    it('should include tool name in executeTools results', async () => {
      const client = new MockLLMClient('openai', 'test-key', 'gpt-4');

      const toolCalls = [
        { id: 'call-1', name: 'calculator', arguments: { a: 5, b: 3 } },
        { id: 'call-2', name: 'weather', arguments: { location: 'NYC' } },
      ];

      const results = await client.executeTools(toolCalls);

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        toolCallId: 'call-1',
        toolName: 'calculator',
        result: { mock: 'result' },
      });
      expect(results[1]).toMatchObject({
        toolCallId: 'call-2',
        toolName: 'weather',
        result: { mock: 'result' },
      });
    });
  });
});
